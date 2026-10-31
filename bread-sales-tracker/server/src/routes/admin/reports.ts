import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { many, one, type Pool } from '../../db.js';
import { badRequest } from '../../errors.js';
import { SUMMARY_COLUMNS } from '../../services/sales.js';
import { toCsv } from '../../util/csv.js';
import { daysBetween, todayInZone } from '../../util/dates.js';
import { paiseToRupeesString } from '../../util/money.js';
import { cleanQuery, salesFilterSchema, salesWhere } from './helpers.js';

const reportSchema = salesFilterSchema.omit({ status: true, q: true, paymentMode: true }).extend({
  groupBy: z.enum(['product', 'store', 'area', 'driver', 'day']).default('product'),
  format: z.enum(['json', 'csv']).default('json'),
});

export interface ReportRow {
  key: number | string;
  label: string;
  sublabel: string | null;
  bills: number;
  quantity: number;
  amountPaise: number;
  cashPaise: number;
  upiPaise: number;
  creditPaise: number;
  storesVisited?: number;
  totalStores?: number;
  lastSaleAt?: Date | null;
}

const PAY_SPLIT = (amountExpr: string) => `
  coalesce(sum(${amountExpr}) FILTER (WHERE s.payment_mode = 'cash'), 0) AS "cashPaise",
  coalesce(sum(${amountExpr}) FILTER (WHERE s.payment_mode = 'upi'), 0) AS "upiPaise",
  coalesce(sum(${amountExpr}) FILTER (WHERE s.payment_mode = 'credit'), 0) AS "creditPaise"`;

const MAX_DAYS = 400;

export function reportsRouter(config: Config, pool: Pool): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const f = reportSchema.parse(cleanQuery(req.query));
    const today = todayInZone(config.appTimezone);
    const fromDate = f.from ?? today;
    const toDate = f.to ?? fromDate;
    if (toDate < fromDate) throw badRequest('"To" date is before "From" date');
    if (daysBetween(fromDate, toDate) > MAX_DAYS) throw badRequest(`Choose at most ${MAX_DAYS} days`);
    const w = salesWhere({ ...f, status: 'completed' }, today, 'completed');
    const where = w.sql;
    const base = `FROM sales s JOIN stores st ON st.id = s.store_id`;

    let rows: ReportRow[];
    switch (f.groupBy) {
      case 'product':
        rows = await many<ReportRow>(
          pool,
          `SELECT p.id AS key, p.name AS label, p.local_name AS sublabel,
                  count(DISTINCT s.id)::int AS bills, sum(si.quantity)::int AS quantity,
                  sum(si.line_total_paise) AS "amountPaise", ${PAY_SPLIT('si.line_total_paise')}
             ${base} JOIN sale_items si ON si.sale_id = s.id JOIN products p ON p.id = si.product_id
             ${where}
            GROUP BY p.id ORDER BY p.sort_order, lower(p.name)`,
          w.values,
        );
        break;
      case 'store':
        rows = await many<ReportRow>(
          pool,
          `SELECT st.id AS key, st.name AS label, a.name AS sublabel,
                  count(*)::int AS bills, sum(s.total_quantity)::int AS quantity,
                  sum(s.total_paise) AS "amountPaise", ${PAY_SPLIT('s.total_paise')},
                  max(s.sold_at) AS "lastSaleAt"
             ${base} JOIN areas a ON a.id = st.area_id
             ${where}
            GROUP BY st.id, a.name ORDER BY "amountPaise" DESC, lower(st.name)`,
          w.values,
        );
        break;
      case 'area':
        rows = await many<ReportRow>(
          pool,
          `SELECT a.id AS key, a.name AS label, NULL AS sublabel,
                  count(*)::int AS bills, sum(s.total_quantity)::int AS quantity,
                  sum(s.total_paise) AS "amountPaise", ${PAY_SPLIT('s.total_paise')},
                  count(DISTINCT s.store_id)::int AS "storesVisited",
                  (SELECT count(*)::int FROM stores x WHERE x.area_id = a.id AND x.is_active) AS "totalStores"
             ${base} JOIN areas a ON a.id = s.area_id
             ${where}
            GROUP BY a.id ORDER BY "amountPaise" DESC, lower(a.name)`,
          w.values,
        );
        break;
      case 'driver':
        rows = await many<ReportRow>(
          pool,
          `SELECT d.id AS key, d.name AS label, d.phone AS sublabel,
                  count(*)::int AS bills, sum(s.total_quantity)::int AS quantity,
                  sum(s.total_paise) AS "amountPaise", ${PAY_SPLIT('s.total_paise')},
                  count(DISTINCT s.store_id)::int AS "storesVisited"
             ${base} JOIN drivers d ON d.id = s.driver_id
             ${where}
            GROUP BY d.id ORDER BY "amountPaise" DESC, lower(d.name)`,
          w.values,
        );
        break;
      case 'day':
        rows = await many<ReportRow>(
          pool,
          `SELECT s.sale_date AS key, to_char(s.sale_date, 'YYYY-MM-DD') AS label,
                  trim(to_char(s.sale_date, 'Day')) AS sublabel,
                  count(*)::int AS bills, sum(s.total_quantity)::int AS quantity,
                  sum(s.total_paise) AS "amountPaise", ${PAY_SPLIT('s.total_paise')},
                  count(DISTINCT s.store_id)::int AS "storesVisited"
             ${base}
             ${where}
            GROUP BY s.sale_date ORDER BY s.sale_date`,
          w.values,
        );
        break;
    }

    const totals = await one(
      pool,
      `SELECT ${SUMMARY_COLUMNS}, count(DISTINCT s.store_id)::int AS "storesVisited" ${base} ${where}`,
      w.values,
    );

    if (f.format === 'csv') {
      const first = { product: 'Product', store: 'Shop', area: 'Area', driver: 'Driver', day: 'Date' }[f.groupBy];
      const second = { product: 'Local name', store: 'Area', area: '', driver: 'Phone', day: 'Day' }[f.groupBy];
      const header = [first, ...(second ? [second] : []), 'Bills', 'Units', 'Amount (Rs)', 'Cash (Rs)', 'UPI (Rs)', 'Credit (Rs)'];
      const csv = toCsv(
        header,
        rows.map((r) => [
          r.label,
          ...(second ? [r.sublabel ?? ''] : []),
          r.bills,
          r.quantity,
          paiseToRupeesString(r.amountPaise),
          paiseToRupeesString(r.cashPaise),
          paiseToRupeesString(r.upiPaise),
          paiseToRupeesString(r.creditPaise),
        ]),
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="report-${f.groupBy}-${fromDate}-to-${toDate}.csv"`);
      res.send(csv);
      return;
    }

    res.json({ groupBy: f.groupBy, from: fromDate, to: toDate, rows, totals });
  });

  return router;
}
