import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../../config.js';
import type { Db } from '../../db.js';
import { badRequest } from '../../errors.js';
import { SUMMARY_COLUMNS } from '../../services/sales.js';
import { daysBetween, todayInZone } from '../../util/dates.js';
import { cleanQuery, salesFilterSchema, salesWhere } from './helpers.js';

const reportSchema = salesFilterSchema.omit({ status: true, q: true, paymentMode: true }).extend({
  groupBy: z.enum(['product', 'store', 'area', 'driver', 'day']).default('product'),
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
  lastSaleAt?: string | null;
}

const PAY_SPLIT = (amountExpr: string) => `
  coalesce(sum(${amountExpr}) FILTER (WHERE s.payment_mode = 'cash'), 0) AS "cashPaise",
  coalesce(sum(${amountExpr}) FILTER (WHERE s.payment_mode = 'upi'), 0) AS "upiPaise",
  coalesce(sum(${amountExpr}) FILTER (WHERE s.payment_mode = 'credit'), 0) AS "creditPaise"`;

const MAX_DAYS = 400;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function reportsRouter(config: Config, db: Db): Router {
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

    let sql: string;
    switch (f.groupBy) {
      case 'product':
        sql = `SELECT p.id AS key, p.name AS label, p.local_name AS sublabel,
                      count(DISTINCT s.id) AS bills, sum(si.quantity) AS quantity,
                      sum(si.line_total_paise) AS "amountPaise", ${PAY_SPLIT('si.line_total_paise')}
                 ${base} JOIN sale_items si ON si.sale_id = s.id JOIN products p ON p.id = si.product_id
                 ${where}
                GROUP BY p.id ORDER BY p.sort_order, lower(p.name)`;
        break;
      case 'store':
        sql = `SELECT st.id AS key, st.name AS label, a.name AS sublabel,
                      count(*) AS bills, sum(s.total_quantity) AS quantity,
                      sum(s.total_paise) AS "amountPaise", ${PAY_SPLIT('s.total_paise')},
                      max(s.sold_at) AS "lastSaleAt"
                 ${base} JOIN areas a ON a.id = st.area_id
                 ${where}
                GROUP BY st.id ORDER BY "amountPaise" DESC, lower(st.name)`;
        break;
      case 'area':
        sql = `SELECT a.id AS key, a.name AS label, NULL AS sublabel,
                      count(*) AS bills, sum(s.total_quantity) AS quantity,
                      sum(s.total_paise) AS "amountPaise", ${PAY_SPLIT('s.total_paise')},
                      count(DISTINCT s.store_id) AS "storesVisited",
                      (SELECT count(*) FROM stores x WHERE x.area_id = a.id AND x.is_active = 1) AS "totalStores"
                 ${base} JOIN areas a ON a.id = s.area_id
                 ${where}
                GROUP BY a.id ORDER BY "amountPaise" DESC, lower(a.name)`;
        break;
      case 'driver':
        sql = `SELECT d.id AS key, d.name AS label, d.phone AS sublabel,
                      count(*) AS bills, sum(s.total_quantity) AS quantity,
                      sum(s.total_paise) AS "amountPaise", ${PAY_SPLIT('s.total_paise')},
                      count(DISTINCT s.store_id) AS "storesVisited"
                 ${base} JOIN drivers d ON d.id = s.driver_id
                 ${where}
                GROUP BY d.id ORDER BY "amountPaise" DESC, lower(d.name)`;
        break;
      case 'day':
        sql = `SELECT s.sale_date AS key, s.sale_date AS label, NULL AS sublabel,
                      count(*) AS bills, sum(s.total_quantity) AS quantity,
                      sum(s.total_paise) AS "amountPaise", ${PAY_SPLIT('s.total_paise')},
                      count(DISTINCT s.store_id) AS "storesVisited"
                 ${base}
                 ${where}
                GROUP BY s.sale_date ORDER BY s.sale_date`;
        break;
    }

    const [rows, totals] = await Promise.all([
      db.all<ReportRow>(sql, w.values),
      db.first(`SELECT ${SUMMARY_COLUMNS}, count(DISTINCT s.store_id) AS "storesVisited" ${base} ${where}`, w.values),
    ]);
    if (f.groupBy === 'day') {
      for (const r of rows) r.sublabel = WEEKDAYS[new Date(`${r.key}T00:00:00Z`).getUTCDay()];
    }
    res.json({ groupBy: f.groupBy, from: fromDate, to: toDate, rows, totals });
  });

  return router;
}
