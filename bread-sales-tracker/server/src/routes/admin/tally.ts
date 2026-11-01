import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { nowIso, type Db } from '../../db.js';
import { badRequest, notFound } from '../../errors.js';
import { parseDateParam, todayInZone } from '../../util/dates.js';
import { dateString, paiseSchema } from './helpers.js';

interface TallyRow {
  driverId: number;
  driverName: string;
  phone: string;
  isActive: boolean;
  bills: number;
  totalPaise: number;
  cashPaise: number;
  upiPaise: number;
  creditPaise: number;
  cancelledBills: number;
  cancelledPaise: number;
  firstSaleAt: string | null;
  lastSaleAt: string | null;
  settlementId: number | null;
  cashReceivedPaise: number | null;
  settledExpectedCashPaise: number | null;
  note: string | null;
  settledAt: string | null;
  settledBy: string | null;
}

/**
 * Daily cash tally: for each driver, what the bills say they collected (cash / UPI / credit)
 * and what they actually handed over.
 */
export function tallyRouter(config: Config, db: Db): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const today = todayInZone(config.appTimezone);
    const date = parseDateParam(req.query.date, today);
    const rows = await db.all<TallyRow>(
      `SELECT d.id AS "driverId", d.name AS "driverName", d.phone, d.is_active AS "isActive",
              count(s.id) FILTER (WHERE s.status = 'completed') AS bills,
              coalesce(sum(s.total_paise) FILTER (WHERE s.status = 'completed'), 0) AS "totalPaise",
              coalesce(sum(s.total_paise) FILTER (WHERE s.status = 'completed' AND s.payment_mode = 'cash'), 0) AS "cashPaise",
              coalesce(sum(s.total_paise) FILTER (WHERE s.status = 'completed' AND s.payment_mode = 'upi'), 0) AS "upiPaise",
              coalesce(sum(s.total_paise) FILTER (WHERE s.status = 'completed' AND s.payment_mode = 'credit'), 0) AS "creditPaise",
              count(s.id) FILTER (WHERE s.status = 'cancelled') AS "cancelledBills",
              coalesce(sum(s.total_paise) FILTER (WHERE s.status = 'cancelled'), 0) AS "cancelledPaise",
              min(s.sold_at) FILTER (WHERE s.status = 'completed') AS "firstSaleAt",
              max(s.sold_at) FILTER (WHERE s.status = 'completed') AS "lastSaleAt",
              t.id AS "settlementId", t.cash_received_paise AS "cashReceivedPaise",
              t.expected_cash_paise AS "settledExpectedCashPaise", t.note, t.settled_at AS "settledAt",
              a.name AS "settledBy"
         FROM drivers d
         LEFT JOIN sales s ON s.driver_id = d.id AND s.sale_date = ?1
         LEFT JOIN settlements t ON t.driver_id = d.id AND t.settle_date = ?1
         LEFT JOIN admins a ON a.id = t.settled_by_admin_id
        GROUP BY d.id
       HAVING count(s.id) > 0 OR t.id IS NOT NULL OR d.is_active = 1
        ORDER BY lower(d.name)`,
      [date],
    );
    const drivers = rows.map((r) => ({
      ...r,
      settled: r.settlementId !== null,
      differencePaise: r.settlementId !== null ? (r.cashReceivedPaise ?? 0) - r.cashPaise : null,
      // Bills that arrived (or were cancelled) after the tally was saved change the expected cash.
      changedSinceSettled: r.settlementId !== null && r.settledExpectedCashPaise !== r.cashPaise,
    }));
    const sum = (k: keyof TallyRow) => drivers.reduce((acc, d) => acc + (Number(d[k]) || 0), 0);
    res.json({
      date,
      today,
      drivers,
      totals: {
        bills: sum('bills'),
        totalPaise: sum('totalPaise'),
        cashPaise: sum('cashPaise'),
        upiPaise: sum('upiPaise'),
        creditPaise: sum('creditPaise'),
        cashReceivedPaise: sum('cashReceivedPaise'),
        settledDrivers: drivers.filter((d) => d.settled).length,
        driversWithSales: drivers.filter((d) => d.bills > 0).length,
      },
    });
  });

  /** Save (or update) the cash a driver handed over for a day. */
  router.put('/', async (req, res) => {
    const body = z
      .object({
        driverId: z.number().int().positive(),
        date: dateString,
        cashReceivedPaise: paiseSchema.max(1_000_000_000),
        note: z.string().trim().max(300).optional().nullable(),
      })
      .parse(req.body);
    const today = todayInZone(config.appTimezone);
    if (body.date > today) throw badRequest('Cannot settle a future date');
    const driver = await db.first('SELECT id FROM drivers WHERE id = ?1', [body.driverId]);
    if (!driver) throw notFound('Driver not found');
    // Expected cash is worked out inside the same statement, so it matches the bills at this moment.
    const settlement = await db.first(
      `INSERT INTO settlements (driver_id, settle_date, expected_cash_paise, cash_received_paise, note, settled_by_admin_id, settled_at)
       SELECT ?1, ?2,
              (SELECT coalesce(sum(total_paise), 0) FROM sales
                WHERE driver_id = ?1 AND sale_date = ?2 AND status = 'completed' AND payment_mode = 'cash'),
              ?3, ?4, ?5, ?6
        WHERE true
       ON CONFLICT (driver_id, settle_date) DO UPDATE SET
         expected_cash_paise = excluded.expected_cash_paise,
         cash_received_paise = excluded.cash_received_paise,
         note = excluded.note,
         settled_by_admin_id = excluded.settled_by_admin_id,
         settled_at = excluded.settled_at
       RETURNING id, driver_id AS "driverId", settle_date AS "date", expected_cash_paise AS "expectedCashPaise",
                 cash_received_paise AS "cashReceivedPaise", note, settled_at AS "settledAt"`,
      [body.driverId, body.date, body.cashReceivedPaise, body.note || null, req.admin!.id, nowIso()],
    );
    res.json({ settlement });
  });

  /** Re-open a day (removes the saved tally). */
  router.delete('/', async (req, res) => {
    const body = z.object({ driverId: z.coerce.number().int().positive(), date: dateString }).parse(req.query);
    const result = await db.run('DELETE FROM settlements WHERE driver_id = ?1 AND settle_date = ?2', [body.driverId, body.date]);
    if (result.changes === 0) throw notFound('No tally saved for this day');
    res.json({ ok: true });
  });

  return router;
}
