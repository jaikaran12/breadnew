import { Router } from 'express';
import cors from 'cors';
import { z } from 'zod';
import type { Config } from '../config.js';
import { isUniqueViolation, many, one, type Pool } from '../db.js';
import { badRequest, forbidden, HttpError, notFound } from '../errors.js';
import {
  burnTime,
  LOCK_MINUTES,
  MAX_FAILED_LOGINS,
  requireDriver,
  signDriverToken,
  verifySecret,
} from '../auth.js';
import { getCatalog } from '../services/catalog.js';
import {
  attachItems,
  cancelSaleByDriver,
  createSale,
  SALE_SELECT,
  SUMMARY_COLUMNS,
  type DaySummary,
  type Sale,
} from '../services/sales.js';
import { parseDateParam, todayInZone } from '../util/dates.js';
import { cleanPhone, normalizeMobile } from '../util/phone.js';
import type { RateLimitRequestHandler } from 'express-rate-limit';

const loginSchema = z.object({
  phone: z.string().trim().min(1, 'Enter your phone number'),
  pin: z.string().trim().regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits'),
});

const saleSchema = z.object({
  clientId: z.uuid(),
  storeId: z.number().int().positive(),
  soldAt: z.string().max(40).optional(),
  paymentMode: z.enum(['cash', 'upi', 'credit']),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(100_000),
        unitPricePaise: z.number().int().min(0).max(10_000_000),
      }),
    )
    .min(1, 'The bill has no items')
    .max(200),
  totalPaise: z.number().int().min(0),
});

const newStoreSchema = z.object({
  areaId: z.number().int().positive(),
  name: z.string().trim().min(2, 'Shop name is too short').max(120),
  ownerName: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(20).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
});

function idParam(value: string | string[] | undefined): number {
  const id = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isInteger(id) || id <= 0) throw notFound();
  return id;
}

export function driverRouter(config: Config, pool: Pool, loginLimiter: RateLimitRequestHandler): Router {
  const router = Router();

  // The Android app runs on its own origin (https://localhost) and authenticates with a
  // bearer token (no cookies), so cross-origin calls are safe to allow here.
  router.use(cors({ origin: true, credentials: false, maxAge: 86400 }));

  router.post('/login', loginLimiter, async (req, res) => {
    const body = loginSchema.parse(req.body);
    const phone = normalizeMobile(body.phone);
    const wrong = new HttpError(401, 'Wrong phone number or PIN', 'wrong_credentials');
    if (!phone) {
      await burnTime(body.pin);
      throw wrong;
    }
    const driver = await one<{
      id: number;
      name: string;
      phone: string;
      pinHash: string;
      isActive: boolean;
      tokenVersion: number;
      failedLoginAttempts: number;
      lockedUntil: Date | null;
    }>(
      pool,
      `SELECT id, name, phone, pin_hash AS "pinHash", is_active AS "isActive", token_version AS "tokenVersion",
              failed_login_attempts AS "failedLoginAttempts", locked_until AS "lockedUntil"
         FROM drivers WHERE phone = $1`,
      [phone],
    );
    if (!driver) {
      await burnTime(body.pin);
      throw wrong;
    }
    if (driver.lockedUntil && driver.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((driver.lockedUntil.getTime() - Date.now()) / 60000);
      throw new HttpError(429, `Too many wrong PINs. Try again after ${minutes} minute(s).`, 'locked');
    }
    const ok = await verifySecret(body.pin, driver.pinHash);
    if (!ok) {
      const attempts = driver.failedLoginAttempts + 1;
      if (attempts >= MAX_FAILED_LOGINS) {
        await pool.query(
          `UPDATE drivers SET failed_login_attempts = 0,
                  locked_until = now() + ($2 || ' minutes')::interval WHERE id = $1`,
          [driver.id, String(LOCK_MINUTES)],
        );
        throw new HttpError(429, `Too many wrong PINs. Try again after ${LOCK_MINUTES} minutes.`, 'locked');
      }
      await pool.query('UPDATE drivers SET failed_login_attempts = $2 WHERE id = $1', [driver.id, attempts]);
      throw wrong;
    }
    if (!driver.isActive) throw forbidden('Your account is turned off. Please contact the owner.', 'driver_disabled');
    await pool.query(
      `UPDATE drivers SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now(), last_seen_at = now()
        WHERE id = $1`,
      [driver.id],
    );
    res.json({
      token: signDriverToken(config, driver.id, driver.tokenVersion),
      driver: { id: driver.id, name: driver.name, phone: driver.phone },
    });
  });

  const auth = requireDriver(config, pool);

  router.get('/me', auth, async (req, res) => {
    res.json({ driver: req.driver, serverTime: new Date().toISOString(), today: todayInZone(config.appTimezone) });
  });

  router.get('/catalog', auth, async (_req, res) => {
    const catalog = await getCatalog(pool, config);
    res.set('Cache-Control', 'no-cache');
    res.json({
      ...catalog,
      timezone: config.appTimezone,
      today: todayInZone(config.appTimezone),
      serverTime: new Date().toISOString(),
    });
  });

  router.post('/sales', auth, async (req, res) => {
    const input = saleSchema.parse(req.body);
    const { sale, created } = await createSale(pool, config, req.driver!.id, input);
    const catalog = await getCatalog(pool, config);
    res.status(created ? 201 : 200).json({ sale, created, catalogVersion: catalog.version });
  });

  router.get('/sales', auth, async (req, res) => {
    const today = todayInZone(config.appTimezone);
    const date = parseDateParam(req.query.date, today);
    const rows = await many<Omit<Sale, 'items' | 'priceMismatch'>>(
      pool,
      `${SALE_SELECT} WHERE s.driver_id = $1 AND s.sale_date = $2 ORDER BY s.sold_at DESC LIMIT 1000`,
      [req.driver!.id, date],
    );
    const sales = await attachItems(pool, rows);
    const summary = await one<DaySummary>(
      pool,
      `SELECT ${SUMMARY_COLUMNS} FROM sales WHERE driver_id = $1 AND sale_date = $2`,
      [req.driver!.id, date],
    );
    const settled = await one(pool, 'SELECT 1 FROM settlements WHERE driver_id = $1 AND settle_date = $2', [
      req.driver!.id,
      date,
    ]);
    res.json({ date, today, summary, settled: Boolean(settled), sales, cancelWindowMinutes: config.driverCancelWindowMinutes });
  });

  router.post('/sales/:id/cancel', auth, async (req, res) => {
    if (config.driverCancelWindowMinutes === 0) {
      throw forbidden('Cancelling bills from the phone is turned off. Please call the owner.', 'cancel_disabled');
    }
    const sale = await cancelSaleByDriver(pool, config, req.driver!.id, idParam(req.params.id));
    res.json({ sale });
  });

  router.post('/stores', auth, async (req, res) => {
    const body = newStoreSchema.parse(req.body);
    const area = await one<{ id: number }>(pool, 'SELECT id FROM areas WHERE id = $1 AND is_active', [body.areaId]);
    if (!area) throw badRequest('Area not found');
    try {
      const store = await one(
        pool,
        `INSERT INTO stores (area_id, name, owner_name, phone, address, created_by_driver_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, area_id AS "areaId", name, owner_name AS "ownerName", phone, address`,
        [body.areaId, body.name, body.ownerName || null, cleanPhone(body.phone), body.address || null, req.driver!.id],
      );
      res.status(201).json({ store, created: true });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Same name already exists in this area: use that shop instead of creating a duplicate.
      const existing = await one<{ isActive: boolean } & Record<string, unknown>>(
        pool,
        `SELECT id, area_id AS "areaId", name, owner_name AS "ownerName", phone, address, is_active AS "isActive"
           FROM stores WHERE area_id = $1 AND lower(name) = lower($2)`,
        [body.areaId, body.name],
      );
      if (!existing) throw err;
      const { isActive, ...store } = existing;
      if (!isActive) throw forbidden('This shop was removed by the owner. Please call the owner.', 'store_inactive');
      res.json({ store, created: false });
    }
  });

  // Unknown driver endpoints
  router.use((_req, _res) => {
    throw notFound();
  });

  return router;
}
