import crypto from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Config } from './config.js';
import { nowIso, type Db } from './db.js';
import { HttpError, unauthorized } from './errors.js';
import type { AuthAdmin, AuthDriver } from './types.js';

export const ADMIN_COOKIE = 'bst_admin';
const ADMIN_TOKEN_DAYS = 30;
const DRIVER_TOKEN_DAYS = 365;
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

// PBKDF2-SHA256. Kept light enough for Cloudflare's free plan (10 ms CPU per request); wrong guesses are
// limited by the account lock (5 tries) and per-network rate limits, which is what protects short PINs.
const PBKDF2_ITERATIONS = 5000;

export async function hashSecret(secret: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(secret, salt, PBKDF2_ITERATIONS, 32, 'sha256');
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [scheme, iter, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'pbkdf2' || !iter || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.pbkdf2Sync(secret, Buffer.from(saltB64, 'base64'), Number(iter), expected.length, 'sha256');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Used when the account does not exist, so that response time does not reveal it. */
export async function burnTime(secret: string): Promise<void> {
  crypto.pbkdf2Sync(secret, 'not-a-real-salt', PBKDF2_ITERATIONS, 32, 'sha256');
}

interface TokenPayload {
  sub: number;
  role: 'admin' | 'driver';
  tv: number;
  exp: number;
}

function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString('base64url');
}

function signature(config: Config, body: string): string {
  return crypto.createHmac('sha256', config.jwtSecret).update(body).digest('base64url');
}

/** Small signed token: base64url(JSON payload) + "." + HMAC-SHA256 signature. */
function sign(config: Config, payload: Omit<TokenPayload, 'exp'>, days: number): string {
  const body = b64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + days * 86400 }));
  return `${body}.${signature(config, body)}`;
}

function verify(config: Config, token: string): TokenPayload | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = Buffer.from(signature(config, body));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<TokenPayload>;
    if (typeof p.sub !== 'number' || (p.role !== 'admin' && p.role !== 'driver') || typeof p.tv !== 'number') return null;
    if (typeof p.exp !== 'number' || p.exp * 1000 < Date.now()) return null;
    return p as TokenPayload;
  } catch {
    return null;
  }
}

export function signDriverToken(config: Config, driverId: number, tokenVersion: number): string {
  return sign(config, { sub: driverId, role: 'driver', tv: tokenVersion }, DRIVER_TOKEN_DAYS);
}

export function signAdminToken(config: Config, adminId: number, tokenVersion: number): string {
  return sign(config, { sub: adminId, role: 'admin', tv: tokenVersion }, ADMIN_TOKEN_DAYS);
}

export function setAdminCookie(config: Config, res: Response, token: string): void {
  res.cookie(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    maxAge: ADMIN_TOKEN_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearAdminCookie(config: Config, res: Response): void {
  res.clearCookie(ADMIN_COOKIE, { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/' });
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token.trim() : null;
}

export function requireDriver(config: Config, db: Db): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = bearerToken(req);
    const payload = token ? verify(config, token) : null;
    if (!payload || payload.role !== 'driver') throw unauthorized();
    const driver = await db.first<AuthDriver & { isActive: boolean; tokenVersion: number; lastSeenAt: string | null }>(
      `SELECT id, name, phone, is_active AS isActive, token_version AS tokenVersion, last_seen_at AS lastSeenAt
         FROM drivers WHERE id = ?1`,
      [payload.sub],
    );
    if (!driver || driver.tokenVersion !== payload.tv) throw unauthorized();
    if (!driver.isActive) throw unauthorized('Your account is turned off. Please contact the owner.', 'driver_disabled');
    // "Last used" only needs to be roughly right: write it at most every 5 minutes.
    if (!driver.lastSeenAt || Date.now() - Date.parse(driver.lastSeenAt) > 5 * 60 * 1000) {
      await db.run('UPDATE drivers SET last_seen_at = ?1 WHERE id = ?2', [nowIso(), driver.id]);
    }
    req.driver = { id: driver.id, name: driver.name, phone: driver.phone };
    next();
  };
}

export function requireAdmin(config: Config, db: Db): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = (req.cookies?.[ADMIN_COOKIE] as string | undefined) ?? bearerToken(req);
    const payload = token ? verify(config, token) : null;
    if (!payload || payload.role !== 'admin') throw unauthorized();
    const admin = await db.first<AuthAdmin & { tokenVersion: number }>(
      `SELECT id, name, username, token_version AS tokenVersion FROM admins WHERE id = ?1`,
      [payload.sub],
    );
    if (!admin || admin.tokenVersion !== payload.tv) throw unauthorized();
    req.admin = { id: admin.id, name: admin.name, username: admin.username };
    next();
  };
}

/**
 * Blocks cross-site form posts against the admin API (on top of SameSite cookies):
 * state-changing requests must come from the same host.
 */
export const sameOriginOnly: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = '';
    }
    const forwarded = String(req.headers['x-forwarded-host'] ?? '')
      .split(',')[0]
      .trim();
    const allowed = [req.headers.host, forwarded].filter(Boolean);
    if (!originHost || !allowed.includes(originHost)) {
      throw unauthorized('Request blocked: it did not come from the admin website', 'bad_origin');
    }
  }
  next();
};

/** Simple fixed-window rate limit per client network (memory only; no timers, so it also runs on Cloudflare). */
export function rateLimit(options: { windowMs: number; limit: number; message: string }): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req, _res, next) => {
    const key = String(req.headers['cf-connecting-ip'] ?? req.ip ?? 'unknown');
    const now = Date.now();
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }
    entry.count++;
    if (entry.count > options.limit) throw new HttpError(429, options.message, 'rate_limited');
    next();
  };
}
