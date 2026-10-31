import type { NextFunction, Request, RequestHandler, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Config } from './config.js';
import { one, type Pool } from './db.js';
import { unauthorized } from './errors.js';
import type { AuthAdmin, AuthDriver } from './types.js';

export const ADMIN_COOKIE = 'bst_admin';
const ADMIN_TOKEN_DAYS = 30;
const DRIVER_TOKEN_DAYS = 365;
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

interface TokenPayload {
  sub: string;
  role: 'admin' | 'driver';
  tv: number;
}

export function hashSecret(secret: string): Promise<string> {
  return bcrypt.hash(secret, 10);
}

export function verifySecret(secret: string, hash: string): Promise<boolean> {
  return bcrypt.compare(secret, hash);
}

// Used when the account does not exist, so that response time does not reveal it.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-secret', 10);
export async function burnTime(secret: string): Promise<void> {
  await bcrypt.compare(secret, DUMMY_HASH);
}

function sign(config: Config, payload: TokenPayload, days: number): string {
  return jwt.sign(payload, config.jwtSecret, { algorithm: 'HS256', expiresIn: `${days}d` });
}

function verify(config: Config, token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    if (typeof decoded !== 'object' || decoded === null) return null;
    const p = decoded as Partial<TokenPayload>;
    if (typeof p.sub !== 'string' || (p.role !== 'admin' && p.role !== 'driver') || typeof p.tv !== 'number') {
      return null;
    }
    return p as TokenPayload;
  } catch {
    return null;
  }
}

export function signDriverToken(config: Config, driverId: number, tokenVersion: number): string {
  return sign(config, { sub: String(driverId), role: 'driver', tv: tokenVersion }, DRIVER_TOKEN_DAYS);
}

export function signAdminToken(config: Config, adminId: number, tokenVersion: number): string {
  return sign(config, { sub: String(adminId), role: 'admin', tv: tokenVersion }, ADMIN_TOKEN_DAYS);
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

export function requireDriver(config: Config, pool: Pool): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = bearerToken(req);
    const payload = token ? verify(config, token) : null;
    if (!payload || payload.role !== 'driver') throw unauthorized();
    const driver = await one<AuthDriver & { isActive: boolean; tokenVersion: number }>(
      pool,
      `UPDATE drivers SET last_seen_at = now()
        WHERE id = $1
        RETURNING id, name, phone, is_active AS "isActive", token_version AS "tokenVersion"`,
      [Number(payload.sub)],
    );
    if (!driver || driver.tokenVersion !== payload.tv) throw unauthorized();
    if (!driver.isActive) throw unauthorized('Your account is turned off. Please contact the owner.', 'driver_disabled');
    req.driver = { id: driver.id, name: driver.name, phone: driver.phone };
    next();
  };
}

export function requireAdmin(config: Config, pool: Pool): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = (req.cookies?.[ADMIN_COOKIE] as string | undefined) ?? bearerToken(req);
    const payload = token ? verify(config, token) : null;
    if (!payload || payload.role !== 'admin') throw unauthorized();
    const admin = await one<AuthAdmin & { tokenVersion: number }>(
      pool,
      `SELECT id, name, username, token_version AS "tokenVersion" FROM admins WHERE id = $1`,
      [Number(payload.sub)],
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
