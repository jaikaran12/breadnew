import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { isUniqueViolation, many, one, type Pool } from '../../db.js';
import { conflict, notFound } from '../../errors.js';
import { hashSecret } from '../../auth.js';
import { todayInZone } from '../../util/dates.js';
import { normalizeMobile } from '../../util/phone.js';
import { idParam } from './helpers.js';

const pinSchema = z.string().trim().regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits');
const phoneSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const phone = normalizeMobile(v);
    if (!phone) {
      ctx.addIssue({ code: 'custom', message: 'Enter a 10 digit mobile number' });
      return z.NEVER;
    }
    return phone;
  });

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  phone: phoneSchema,
  pin: pinSchema,
  vehicleNumber: z.string().trim().max(30).optional().nullable(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80).optional(),
  phone: phoneSchema.optional(),
  vehicleNumber: z.string().trim().max(30).optional().nullable(),
  isActive: z.boolean().optional(),
});

const DRIVER_COLUMNS = `d.id, d.name, d.phone, d.vehicle_number AS "vehicleNumber", d.is_active AS "isActive",
  d.last_login_at AS "lastLoginAt", d.last_seen_at AS "lastSeenAt", d.created_at AS "createdAt",
  (d.locked_until IS NOT NULL AND d.locked_until > now()) AS "isLocked"`;

export function driversRouter(config: Config, pool: Pool): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const today = todayInZone(config.appTimezone);
    const drivers = await many(
      pool,
      `SELECT ${DRIVER_COLUMNS},
              coalesce(t.bills, 0) AS "todayBills", coalesce(t.amount, 0) AS "todayAmountPaise",
              t.last_sale_at AS "lastSaleAt"
         FROM drivers d
         LEFT JOIN (
           SELECT driver_id, count(*)::int AS bills, sum(total_paise) AS amount, max(sold_at) AS last_sale_at
             FROM sales WHERE sale_date = $1 AND status = 'completed' GROUP BY driver_id
         ) t ON t.driver_id = d.id
        ORDER BY d.is_active DESC, lower(d.name)`,
      [today],
    );
    res.json({ drivers, today });
  });

  router.post('/', async (req, res) => {
    const body = createSchema.parse(req.body);
    try {
      const created = await one<{ id: number }>(
        pool,
        `INSERT INTO drivers (name, phone, pin_hash, vehicle_number) VALUES ($1, $2, $3, $4) RETURNING id`,
        [body.name, body.phone, await hashSecret(body.pin), body.vehicleNumber || null],
      );
      const driver = await one(pool, `SELECT ${DRIVER_COLUMNS} FROM drivers d WHERE d.id = $1`, [created!.id]);
      res.status(201).json({ driver });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('A driver with this phone number already exists');
      throw err;
    }
  });

  router.put('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    const body = updateSchema.parse(req.body);
    try {
      const updated = await one<{ id: number }>(
        pool,
        `UPDATE drivers SET
            name = coalesce($2, name),
            phone = coalesce($3, phone),
            vehicle_number = CASE WHEN $4::boolean THEN $5 ELSE vehicle_number END,
            is_active = coalesce($6, is_active),
            -- Turning a driver off logs their phone out immediately.
            token_version = CASE WHEN $6::boolean IS FALSE AND is_active THEN token_version + 1 ELSE token_version END,
            updated_at = now()
          WHERE id = $1 RETURNING id`,
        [
          id,
          body.name ?? null,
          body.phone ?? null,
          body.vehicleNumber !== undefined,
          body.vehicleNumber || null,
          body.isActive ?? null,
        ],
      );
      if (!updated) throw notFound('Driver not found');
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('A driver with this phone number already exists');
      throw err;
    }
    const driver = await one(pool, `SELECT ${DRIVER_COLUMNS} FROM drivers d WHERE d.id = $1`, [id]);
    res.json({ driver });
  });

  /** Sets a new PIN. The driver's phone is logged out and must log in with the new PIN. */
  router.post('/:id/pin', async (req, res) => {
    const id = idParam(req.params.id);
    const { pin } = z.object({ pin: pinSchema }).parse(req.body);
    const updated = await one(
      pool,
      `UPDATE drivers SET pin_hash = $2, token_version = token_version + 1, failed_login_attempts = 0,
              locked_until = NULL, updated_at = now()
        WHERE id = $1 RETURNING id`,
      [id, await hashSecret(pin)],
    );
    if (!updated) throw notFound('Driver not found');
    res.json({ ok: true });
  });

  /** Clears a lock after too many wrong PINs. */
  router.post('/:id/unlock', async (req, res) => {
    const id = idParam(req.params.id);
    const updated = await one(
      pool,
      'UPDATE drivers SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1 RETURNING id',
      [id],
    );
    if (!updated) throw notFound('Driver not found');
    res.json({ ok: true });
  });

  /** Logs the driver out of every phone (e.g. lost phone) without changing the PIN. */
  router.post('/:id/logout', async (req, res) => {
    const id = idParam(req.params.id);
    const updated = await one(
      pool,
      'UPDATE drivers SET token_version = token_version + 1 WHERE id = $1 RETURNING id',
      [id],
    );
    if (!updated) throw notFound('Driver not found');
    res.json({ ok: true });
  });

  return router;
}
