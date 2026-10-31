import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  databaseUrl: string;
  databaseSsl: false | 'verify' | 'no-verify';
  jwtSecret: string;
  /** IANA time zone used to decide which calendar day a sale belongs to. */
  appTimezone: string;
  cookieSecure: boolean;
  trustProxy: boolean | number | string;
  /** How long (minutes) a driver may cancel their own bill after making it. 0 disables. */
  driverCancelWindowMinutes: number;
  adminUsername?: string;
  adminPassword?: string;
  /** Folder holding the built web apps: <publicDir>/admin and <publicDir>/driver */
  publicDir: string;
  /** Optional link shown in the admin site so the owner can share the Android app. */
  appDownloadUrl?: string;
  defaultBusinessName: string;
  /** Login attempts allowed per IP per 15 minutes (brute-force protection). */
  loginRateLimit: number;
  logRequests: boolean;
}

const here = path.dirname(fileURLToPath(import.meta.url));

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function int(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a whole number (got "${value}")`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';

  const databaseUrl =
    env.DATABASE_URL ?? (isProduction ? '' : 'postgres://bread:bread@localhost:5432/bread_dev');
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  let jwtSecret = env.JWT_SECRET ?? '';
  if (!jwtSecret) {
    if (isProduction) throw new Error('JWT_SECRET is required in production (use a long random string)');
    jwtSecret = 'dev-only-insecure-secret-do-not-use-in-production';
  }
  if (isProduction && jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long');
  }

  const appTimezone = env.APP_TIMEZONE || 'Asia/Kolkata';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: appTimezone });
  } catch {
    throw new Error(`APP_TIMEZONE "${appTimezone}" is not a valid time zone (example: Asia/Kolkata)`);
  }

  let trustProxy: boolean | number | string = 1;
  if (env.TRUST_PROXY !== undefined && env.TRUST_PROXY !== '') {
    const raw = env.TRUST_PROXY.trim();
    if (/^\d+$/.test(raw)) trustProxy = Number(raw);
    else if (['true', 'false'].includes(raw.toLowerCase())) trustProxy = raw.toLowerCase() === 'true';
    else trustProxy = raw;
  }

  const sslRaw = (env.DATABASE_SSL ?? '').trim().toLowerCase();
  const databaseSsl: Config['databaseSsl'] =
    sslRaw === 'no-verify' ? 'no-verify' : bool(sslRaw, false) ? 'verify' : false;

  return {
    nodeEnv,
    isProduction,
    port: int(env.PORT, 8080, 'PORT'),
    databaseUrl,
    databaseSsl,
    jwtSecret,
    appTimezone,
    cookieSecure: bool(env.COOKIE_SECURE, isProduction),
    trustProxy,
    driverCancelWindowMinutes: int(env.DRIVER_CANCEL_WINDOW_MINUTES, 30, 'DRIVER_CANCEL_WINDOW_MINUTES'),
    adminUsername: env.ADMIN_USERNAME?.trim() || undefined,
    adminPassword: env.ADMIN_PASSWORD || undefined,
    publicDir: env.PUBLIC_DIR ? path.resolve(env.PUBLIC_DIR) : path.resolve(here, '..', 'public'),
    appDownloadUrl: env.APP_DOWNLOAD_URL?.trim() || undefined,
    defaultBusinessName: env.BUSINESS_NAME?.trim() || 'My Bakery',
    loginRateLimit: int(env.LOGIN_RATE_LIMIT, 30, 'LOGIN_RATE_LIMIT'),
    logRequests: bool(env.LOG_REQUESTS, nodeEnv !== 'test'),
  };
}
