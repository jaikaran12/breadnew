import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { many, one, type Pool } from '../../db.js';
import { badRequest, notFound } from '../../errors.js';
import {
  attachItems,
  cancelSaleByAdmin,
  getSale,
  restoreSale,
  SALE_SELECT,
  SUMMARY_COLUMNS,
  type Sale,
} from '../../services/sales.js';
import { toCsv } from '../../util/csv.js';
import { daysBetween, todayInZone } from '../../util/dates.js';
import { paiseToRupeesString } from '../../util/money.js';
import { cleanQuery, idParam, salesFilterSchema, salesWhere } from './helpers.js';

const listSchema = salesFilterSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

const MAX_EXPORT_DAYS = 400;
const PAYMENT_LABEL: Record<string, string> = { cash: 'Cash', upi: 'UPI', credit: 'Credit (Udhaar)' };

export function salesRouter(config: Config, pool: Pool): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const f = listSchema.parse(cleanQuery(req.query));
    const today = todayInZone(config.appTimezone);
    const w = salesWhere(f, today, 'all');
    const from = `FROM sales s JOIN stores st ON st.id = s.store_id`;
    const summary = await one(
      pool,
      `SELECT ${SUMMARY_COLUMNS},
              coalesce(sum(s.total_paise) FILTER (WHERE s.status = 'cancelled'), 0) AS "cancelledPaise",
              count(*)::int AS "rowCount"
         ${from} ${w.sql}`,
      w.values,
    );
    const limit = w.param(f.pageSize);
    const offset = w.param((f.page - 1) * f.pageSize);
    const rows = await many<Omit<Sale, 'items' | 'priceMismatch'>>(
      pool,
      `${SALE_SELECT} ${w.sql} ORDER BY s.sold_at DESC, s.id DESC LIMIT ${limit} OFFSET ${offset}`,
      w.values,
    );
    res.json({
      from: f.from ?? today,
      to: f.to ?? f.from ?? today,
      page: f.page,
      pageSize: f.pageSize,
      total: summary?.rowCount ?? 0,
      summary,
      sales: await attachItems(pool, rows),
    });
  });

  /** CSV download. type=bills (one row per bill) or type=items (one row per product line). */
  router.get('/export.csv', async (req, res) => {
    const query = cleanQuery(req.query);
    const type = z.enum(['bills', 'items']).default('bills').parse(query.type);
    const f = salesFilterSchema.parse(query);
    const today = todayInZone(config.appTimezone);
    const fromDate = f.from ?? today;
    const toDate = f.to ?? fromDate;
    if (daysBetween(fromDate, toDate) > MAX_EXPORT_DAYS) throw badRequest(`Export at most ${MAX_EXPORT_DAYS} days at a time`);
    const w = salesWhere(f, today, 'all');
    const rows = await many<Omit<Sale, 'items' | 'priceMismatch'>>(
      pool,
      `${SALE_SELECT} ${w.sql} ORDER BY s.sold_at, s.id LIMIT 200000`,
      w.values,
    );
    const time = (d: Date) =>
      new Date(d).toLocaleTimeString('en-IN', { timeZone: config.appTimezone, hour: '2-digit', minute: '2-digit' });
    let csv: string;
    if (type === 'bills') {
      csv = toCsv(
        ['Bill no', 'Date', 'Time', 'Driver', 'Area', 'Shop', 'Payment', 'Units', 'Amount (Rs)', 'Status', 'Cancelled by', 'Cancel reason'],
        rows.map((s) => [
          s.id,
          s.saleDate,
          time(s.soldAt),
          s.driverName,
          s.areaName,
          s.storeName,
          PAYMENT_LABEL[s.paymentMode],
          s.totalQuantity,
          paiseToRupeesString(s.totalPaise),
          s.status,
          s.cancelledBy ?? '',
          s.cancelReason ?? '',
        ]),
      );
    } else {
      const withItems = await attachItems(pool, rows);
      csv = toCsv(
        ['Bill no', 'Date', 'Time', 'Driver', 'Area', 'Shop', 'Product', 'Qty', 'Rate (Rs)', 'Amount (Rs)', 'Payment', 'Status'],
        withItems.flatMap((s) =>
          s.items.map((i) => [
            s.id,
            s.saleDate,
            time(s.soldAt),
            s.driverName,
            s.areaName,
            s.storeName,
            i.productName,
            i.quantity,
            paiseToRupeesString(i.unitPricePaise),
            paiseToRupeesString(i.lineTotalPaise),
            PAYMENT_LABEL[s.paymentMode],
            s.status,
          ]),
        ),
      );
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sales-${type}-${fromDate}-to-${toDate}.csv"`);
    res.send(csv);
  });

  router.get('/:id', async (req, res) => {
    const sale = await getSale(pool, idParam(req.params.id));
    if (!sale) throw notFound('Bill not found');
    const settled = await one(pool, 'SELECT 1 FROM settlements WHERE driver_id = $1 AND settle_date = $2', [
      sale.driverId,
      sale.saleDate,
    ]);
    res.json({ sale, daySettled: Boolean(settled) });
  });

  router.post('/:id/cancel', async (req, res) => {
    const { reason } = z
      .object({ reason: z.string().trim().min(2, 'Please write why the bill is cancelled').max(300) })
      .parse(req.body);
    const sale = await cancelSaleByAdmin(pool, idParam(req.params.id), `${reason} (by ${req.admin!.name})`);
    res.json({ sale });
  });

  router.post('/:id/restore', async (req, res) => {
    const sale = await restoreSale(pool, idParam(req.params.id));
    res.json({ sale });
  });

  return router;
}
