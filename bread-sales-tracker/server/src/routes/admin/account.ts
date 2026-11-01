import { Router } from 'express';
import { z } from 'zod';
import type { RateLimitRequestHandler } from 'express-rate-limit';
import type { Config } from '../../config.js';
import { isUniqueViolation, many, one, type Pool } from '../../db.js';
import { badRequest, conflict, HttpError, notFound } from '../../errors.js';
import {
  burnTime,
  clearAdminCookie,
  hashSecret,
  LOCK_MINUTES,
  MAX_FAILED_LOGINS,
  setAdminCookie,
  signAdminToken,
  verifySecret,
} from '../../auth.js';
import { getSettings, updateSettings } from '../../services/settings.js';
import { writeBackup } from '../../services/backup.js';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { PassThrough } from 'node:stream';
import { idParam } from './helpers.js';

const loginSchema = z.object({
  username: z.string().trim().min(1, 'Enter your username').max(100),
  password: z.string().min(1, 'Enter your password').max(200),
});

const passwordSchema = z.string().min(8, 'Password must be at least 8 characters').max(200);

/** Routes that work without being logged in. */
export function adminPublicRouter(config: Config, pool: Pool, loginLimiter: RateLimitRequestHandler): Router {
  const router = Router();

  router.post('/login', loginLimiter, async (req, res) => {
    const body = loginSchema.parse(req.body);
    const wrong = new HttpError(401, 'Wrong username or password', 'wrong_credentials');
    const admin = await one<{
      id: number;
      name: string;
      username: string;
      passwordHash: string;
      tokenVersion: number;
      failedLoginAttempts: number;
      lockedUntil: Date | null;
    }>(
      pool,
      `SELECT id, name, username, password_hash AS "passwordHash", token_version AS "tokenVersion",
              failed_login_attempts AS "failedLoginAttempts", locked_until AS "lockedUntil"
         FROM admins WHERE lower(username) = lower($1)`,
      [body.username],
    );
    if (!admin) {
      await burnTime(body.password);
      throw wrong;
    }
    if (admin.lockedUntil && admin.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((admin.lockedUntil.getTime() - Date.now()) / 60000);
      throw new HttpError(429, `Too many wrong passwords. Try again after ${minutes} minute(s).`, 'locked');
    }
    if (!(await verifySecret(body.password, admin.passwordHash))) {
      const attempts = admin.failedLoginAttempts + 1;
      if (attempts >= MAX_FAILED_LOGINS) {
        await pool.query(
          `UPDATE admins SET failed_login_attempts = 0, locked_until = now() + ($2 || ' minutes')::interval
            WHERE id = $1`,
          [admin.id, String(LOCK_MINUTES)],
        );
      } else {
        await pool.query('UPDATE admins SET failed_login_attempts = $2 WHERE id = $1', [admin.id, attempts]);
      }
      throw wrong;
    }
    await pool.query(
      'UPDATE admins SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1',
      [admin.id],
    );
    setAdminCookie(config, res, signAdminToken(config, admin.id, admin.tokenVersion));
    res.json({ admin: { id: admin.id, name: admin.name, username: admin.username } });
  });

  router.post('/logout', (_req, res) => {
    clearAdminCookie(config, res);
    res.json({ ok: true });
  });

  return router;
}

/** Routes for the logged-in admin: profile, password, other admins, business settings. */
export function adminAccountRouter(config: Config, pool: Pool): Router {
  const router = Router();

  router.get('/me', async (req, res) => {
    const settings = await getSettings(pool, config);
    const backup = await one<{ value: string }>(pool, `SELECT value FROM app_settings WHERE key = 'last_backup_at'`);
    res.json({
      admin: req.admin,
      settings,
      lastBackupAt: backup?.value ?? null,
      timezone: config.appTimezone,
      appDownloadUrl: config.appDownloadUrl ?? null,
      cancelWindowMinutes: config.driverCancelWindowMinutes,
    });
  });

  router.post('/password', async (req, res) => {
    const body = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }).parse(req.body);
    const admin = await one<{ passwordHash: string }>(
      pool,
      'SELECT password_hash AS "passwordHash" FROM admins WHERE id = $1',
      [req.admin!.id],
    );
    if (!admin || !(await verifySecret(body.currentPassword, admin.passwordHash))) {
      throw badRequest('Current password is wrong');
    }
    const updated = await one<{ tokenVersion: number }>(
      pool,
      `UPDATE admins SET password_hash = $2, token_version = token_version + 1 WHERE id = $1
       RETURNING token_version AS "tokenVersion"`,
      [req.admin!.id, await hashSecret(body.newPassword)],
    );
    // Other browsers are logged out; keep this one logged in.
    setAdminCookie(config, res, signAdminToken(config, req.admin!.id, updated!.tokenVersion));
    res.json({ ok: true });
  });

  /** Full copy of all data (gzipped JSON). Restore with: node dist/scripts/restore-backup.js <file> */
  router.get('/backup', async (_req, res) => {
    const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="bread-sales-backup-${stamp}.json.gz"`);
    res.setHeader('Cache-Control', 'no-store');
    const json = new PassThrough();
    const done = pipeline(json, createGzip(), res);
    try {
      await writeBackup(pool, json);
      json.end();
      await done;
      await pool.query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ('last_backup_at', $1, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [new Date().toISOString()],
      );
    } catch (err) {
      console.error('Backup failed', err);
      json.destroy(err as Error);
      res.destroy();
    }
  });

  router.get('/settings', async (_req, res) => {
    res.json({ settings: await getSettings(pool, config) });
  });

  router.put('/settings', async (req, res) => {
    const body = z
      .object({
        businessName: z.string().trim().min(1, 'Business name is required').max(80).optional(),
        businessPhone: z.string().trim().max(20).optional(),
        billFooter: z.string().trim().max(200).optional(),
      })
      .parse(req.body);
    await updateSettings(pool, body);
    res.json({ settings: await getSettings(pool, config) });
  });

  router.get('/admins', async (_req, res) => {
    const admins = await many(
      pool,
      `SELECT id, name, username, last_login_at AS "lastLoginAt", created_at AS "createdAt"
         FROM admins ORDER BY id`,
    );
    res.json({ admins });
  });

  router.post('/admins', async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(1, 'Name is required').max(80),
        username: z
          .string()
          .trim()
          .min(3, 'Username must be at least 3 characters')
          .max(60)
          .regex(/^[a-zA-Z0-9._@-]+$/, 'Username can only use letters, numbers and . _ @ -'),
        password: passwordSchema,
      })
      .parse(req.body);
    try {
      const admin = await one(
        pool,
        `INSERT INTO admins (name, username, password_hash) VALUES ($1, $2, $3)
         RETURNING id, name, username, created_at AS "createdAt"`,
        [body.name, body.username, await hashSecret(body.password)],
      );
      res.status(201).json({ admin });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('That username is already taken');
      throw err;
    }
  });

  router.delete('/admins/:id', async (req, res) => {
    const id = idParam(req.params.id);
    if (id === req.admin!.id) throw badRequest('You cannot remove your own account');
    const count = await one<{ n: number }>(pool, 'SELECT count(*)::int AS n FROM admins');
    if ((count?.n ?? 0) <= 1) throw badRequest('At least one admin account is needed');
    // Keep history readable: detach references before removing.
    await pool.query('UPDATE product_price_history SET changed_by_admin_id = NULL WHERE changed_by_admin_id = $1', [id]);
    await pool.query('UPDATE settlements SET settled_by_admin_id = NULL WHERE settled_by_admin_id = $1', [id]);
    const result = await pool.query('DELETE FROM admins WHERE id = $1', [id]);
    if (result.rowCount === 0) throw notFound('Admin not found');
    res.json({ ok: true });
  });

  return router;
}
