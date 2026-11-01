import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { isUniqueViolation, nowIso, type Db } from '../../db.js';
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
import { getSetting, getSettings, setSettingStatement, updateSettings } from '../../services/settings.js';
import { BACKUP_PAGE_SIZE, backupInfo, backupPage, isBackupTable } from '../../services/backup.js';
import { idParam } from './helpers.js';

const loginSchema = z.object({
  username: z.string().trim().min(1, 'Enter your username').max(100),
  password: z.string().min(1, 'Enter your password').max(200),
});

const passwordSchema = z.string().min(8, 'Password must be at least 8 characters').max(200);

/** Routes that work without being logged in. */
export function adminPublicRouter(config: Config, db: Db, loginLimiter: RequestHandler): Router {
  const router = Router();

  router.post('/login', loginLimiter, async (req, res) => {
    const body = loginSchema.parse(req.body);
    const wrong = new HttpError(401, 'Wrong username or password', 'wrong_credentials');
    const admin = await db.first<{
      id: number;
      name: string;
      username: string;
      passwordHash: string;
      tokenVersion: number;
      failedLoginAttempts: number;
      lockedUntil: string | null;
    }>(
      `SELECT id, name, username, password_hash AS "passwordHash", token_version AS "tokenVersion",
              failed_login_attempts AS "failedLoginAttempts", locked_until AS "lockedUntil"
         FROM admins WHERE lower(username) = lower(?1)`,
      [body.username],
    );
    if (!admin) {
      await burnTime(body.password);
      throw wrong;
    }
    if (admin.lockedUntil && Date.parse(admin.lockedUntil) > Date.now()) {
      const minutes = Math.ceil((Date.parse(admin.lockedUntil) - Date.now()) / 60000);
      throw new HttpError(429, `Too many wrong passwords. Try again after ${minutes} minute(s).`, 'locked');
    }
    if (!(await verifySecret(body.password, admin.passwordHash))) {
      const attempts = admin.failedLoginAttempts + 1;
      if (attempts >= MAX_FAILED_LOGINS) {
        await db.run('UPDATE admins SET failed_login_attempts = 0, locked_until = ?2 WHERE id = ?1', [
          admin.id,
          new Date(Date.now() + LOCK_MINUTES * 60000).toISOString(),
        ]);
      } else {
        await db.run('UPDATE admins SET failed_login_attempts = ?2 WHERE id = ?1', [admin.id, attempts]);
      }
      throw wrong;
    }
    await db.run('UPDATE admins SET failed_login_attempts = 0, locked_until = NULL, last_login_at = ?2 WHERE id = ?1', [
      admin.id,
      nowIso(),
    ]);
    setAdminCookie(config, res, signAdminToken(config, admin.id, admin.tokenVersion));
    res.json({ admin: { id: admin.id, name: admin.name, username: admin.username } });
  });

  router.post('/logout', (_req, res) => {
    clearAdminCookie(config, res);
    res.json({ ok: true });
  });

  return router;
}

/** Routes for the logged-in admin: profile, password, other admins, business settings, backup. */
export function adminAccountRouter(config: Config, db: Db): Router {
  const router = Router();

  router.get('/me', async (req, res) => {
    const [settings, lastBackupAt] = await Promise.all([getSettings(db, config), getSetting(db, 'last_backup_at')]);
    res.json({
      admin: req.admin,
      settings,
      lastBackupAt: lastBackupAt ?? null,
      timezone: config.appTimezone,
      appDownloadUrl: config.appDownloadUrl ?? null,
      cancelWindowMinutes: config.driverCancelWindowMinutes,
    });
  });

  router.post('/password', async (req, res) => {
    const body = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }).parse(req.body);
    const admin = await db.first<{ passwordHash: string }>('SELECT password_hash AS "passwordHash" FROM admins WHERE id = ?1', [
      req.admin!.id,
    ]);
    if (!admin || !(await verifySecret(body.currentPassword, admin.passwordHash))) {
      throw badRequest('Current password is wrong');
    }
    const updated = await db.first<{ tokenVersion: number }>(
      `UPDATE admins SET password_hash = ?2, token_version = token_version + 1 WHERE id = ?1
       RETURNING token_version AS "tokenVersion"`,
      [req.admin!.id, await hashSecret(body.newPassword)],
    );
    // Other browsers are logged out; keep this one logged in.
    setAdminCookie(config, res, signAdminToken(config, req.admin!.id, updated!.tokenVersion));
    res.json({ ok: true });
  });

  /*
   * Backup of all data. The website downloads it in small pages (so each request stays fast and light)
   * and saves one JSON file on the computer. Restore it with: npm run restore -- <file>
   */
  router.get('/backup/info', async (_req, res) => {
    res.json(await backupInfo(db));
  });

  /** Rows with after < id <= upto (at most BACKUP_PAGE_SIZE ids per request). */
  router.get('/backup/table/:name', async (req, res) => {
    const name = String(req.params.name);
    if (!isBackupTable(name)) throw notFound('Unknown table');
    const id = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
    const after = id.default(0).parse(req.query.after ?? undefined);
    const upto = id.default(after + BACKUP_PAGE_SIZE).parse(req.query.upto ?? undefined);
    if (upto < after || upto - after > BACKUP_PAGE_SIZE) throw badRequest(`Ask for at most ${BACKUP_PAGE_SIZE} rows at a time`);
    res.json({ table: name, after, upto, rows: await backupPage(db, name, after, upto) });
  });

  router.post('/backup/done', async (_req, res) => {
    const at = nowIso();
    await db.batch([setSettingStatement('last_backup_at', at)]);
    res.json({ lastBackupAt: at });
  });

  router.get('/settings', async (_req, res) => {
    res.json({ settings: await getSettings(db, config) });
  });

  router.put('/settings', async (req, res) => {
    const body = z
      .object({
        businessName: z.string().trim().min(1, 'Business name is required').max(80).optional(),
        businessPhone: z.string().trim().max(20).optional(),
        billFooter: z.string().trim().max(200).optional(),
      })
      .parse(req.body);
    await updateSettings(db, body);
    res.json({ settings: await getSettings(db, config) });
  });

  router.get('/admins', async (_req, res) => {
    const admins = await db.all(
      `SELECT id, name, username, last_login_at AS "lastLoginAt", created_at AS "createdAt" FROM admins ORDER BY id`,
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
      const admin = await db.first(
        `INSERT INTO admins (name, username, password_hash) VALUES (?1, ?2, ?3)
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
    const count = await db.first<{ n: number }>('SELECT count(*) AS n FROM admins');
    if ((count?.n ?? 0) <= 1) throw badRequest('At least one admin account is needed');
    // Keep history readable: detach references before removing (all in one transaction).
    const results = await db.batch([
      { sql: 'UPDATE product_price_history SET changed_by_admin_id = NULL WHERE changed_by_admin_id = ?1', params: [id] },
      { sql: 'UPDATE settlements SET settled_by_admin_id = NULL WHERE settled_by_admin_id = ?1', params: [id] },
      { sql: 'DELETE FROM admins WHERE id = ?1', params: [id] },
    ]);
    if (results[2].changes === 0) throw notFound('Admin not found');
    res.json({ ok: true });
  });

  return router;
}
