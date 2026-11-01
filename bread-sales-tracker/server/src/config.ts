import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  /** SQLite file used when running with Node (tests, self-hosting). Not used on Cloudflare. */
  databasePath: string;
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
  /** Android wrapper app: package name + SHA-256 signing certificate fingerprints (for assetlinks.json). */
  androidAppId: string;
  androidCertFingerprints: string[];
}

// On Cloudflare there is no file system path for this module; paths are only used when running with Node.
const here = (() => {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return '/';
  }
})();

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

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): Config {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';

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

  return {
    nodeEnv,
    isProduction,
    port: int(env.PORT, 8080, 'PORT'),
    databasePath: env.DATABASE_PATH || path.resolve(here, '..', 'data', 'bread.sqlite'),
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
    androidAppId: env.ANDROID_APP_ID?.trim() || 'com.breadsales.driver',
    androidCertFingerprints: (env.ANDROID_CERT_SHA256 ?? '')
      .split(/[\s,]+/)
      .map((f) => f.trim().toUpperCase())
      .filter((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f)),
  };
}
