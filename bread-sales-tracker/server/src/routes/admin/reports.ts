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
  /** Discount given (already taken off amountPaise). */
  discountPaise: number;
  /** Expired units taken back and replaced (no money). */
  returnedQuantity: number;
  /** Product report only: what the replaced units were worth at list price. */
  returnedValuePaise?: number;
  sortOrder?: number;
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
        sql = `SELECT p.id AS key, p.name AS label, p.local_name AS sublabel, p.sort_order AS "sortOrder",
                      count(DISTINCT s.id) AS bills, sum(si.quantity) AS quantity,
                      sum(si.line_total_paise) AS "amountPaise", ${PAY_SPLIT('si.line_total_paise')},
                      sum(si.discount_paise) AS "discountPaise", 0 AS "returnedQuantity", 0 AS "returnedValuePaise"
                 ${base} JOIN sale_items si ON si.sale_id = s.id JOIN products p ON p.id = si.product_id
                 ${where}
                GROUP BY p.id ORDER BY p.sort_order, lower(p.name)`;
        break;
      case 'store':
        sql = `SELECT st.id AS key, st.name AS label, a.name AS sublabel,
                      count(*) FILTER (WHERE s.total_quantity > 0) AS bills, sum(s.total_quantity) AS quantity,
                      sum(s.total_paise) AS "amountPaise", ${PAY_SPLIT('s.total_paise')},
                      sum(s.discount_paise) AS "discountPaise", sum(s.returned_quantity) AS "returnedQuantity",
                      max(s.sold_at) AS "lastSaleAt"
                 ${base} JOIN areas a ON a.id = st.area_id
                 ${where}
                GROUP BY st.id ORDER BY "amountPaise" DESC, lower(st.name)`;
        break;
      case 'area':
        sql = `SELECT a.id AS key, a.name AS label, NULL AS sublabel,
                      count(*) FILTER (WHERE s.total_quantity > 0) AS bills, sum(s.total_quantity) AS quantity,
                      sum(s.total_paise) AS "amountPaise", ${PAY_SPLIT('s.total_paise')},
                      sum(s.discount_paise) AS "discountPaise", sum(s.returned_quantity) AS "returnedQuantity",
                      count(DISTINCT s.store_id) AS "storesVisited",
                      (SELECT count(*) FROM stores x WHERE x.area_id = a.id AND x.is_active = 1) AS "totalStores"
                 ${base} JOIN areas a ON a.id = s.area_id
                 ${where}
                GROUP BY a.id ORDER BY "amountPaise" DESC, lower(a.name)`;
        break;
      case 'driver':
        sql = `SELECT d.id AS key, d.name AS label, d.phone AS sublabel,
                      count(*) FILTER (WHERE s.total_quantity > 0) AS bills, sum(s.total_quantity) AS quantity,
                      sum(s.total_paise) AS "amountPaise", ${PAY_SPLIT('s.total_paise')},
                      sum(s.discount_paise) AS "discountPaise", sum(s.returned_quantity) AS "returnedQuantity",
                      count(DISTINCT s.store_id) AS "storesVisited"
                 ${base} JOIN drivers d ON d.id = s.driver_id
                 ${where}
                GROUP BY d.id ORDER BY "amountPaise" DESC, lower(d.name)`;
        break;
      case 'day':
        sql = `SELECT s.sale_date AS key, s.sale_date AS label, NULL AS sublabel,
                      count(*) FILTER (WHERE s.total_quantity > 0) AS bills, sum(s.total_quantity) AS quantity,
                      sum(s.total_paise) AS "amountPaise", ${PAY_SPLIT('s.total_paise')},
                      sum(s.discount_paise) AS "discountPaise", sum(s.returned_quantity) AS "returnedQuantity",
                      count(DISTINCT s.store_id) AS "storesVisited"
                 ${base}
                 ${where}
                GROUP BY s.sale_date ORDER BY s.sale_date`;
        break;
    }

    const [rows, totals, returns] = await Promise.all([
      db.all<ReportRow>(sql, w.values),
      db.first(`SELECT ${SUMMARY_COLUMNS}, count(DISTINCT s.store_id) AS "storesVisited" ${base} ${where}`, w.values),
      f.groupBy === 'product'
        ? db.all<{ key: number; label: string; sublabel: string | null; sortOrder: number; quantity: number; valuePaise: number }>(
            `SELECT p.id AS key, p.name AS label, p.local_name AS sublabel, p.sort_order AS "sortOrder",
                    sum(r.quantity) AS quantity, sum(r.quantity * r.unit_price_paise) AS "valuePaise"
               ${base} JOIN sale_returns r ON r.sale_id = s.id JOIN products p ON p.id = r.product_id
               ${where}
              GROUP BY p.id`,
            w.values,
          )
        : Promise.resolve([]),
    ]);
    if (f.groupBy === 'product' && returns.length > 0) {
      const byKey = new Map(rows.map((r) => [r.key, r]));
      for (const ret of returns) {
        const row = byKey.get(ret.key);
        if (row) {
          row.returnedQuantity = ret.quantity;
          row.returnedValuePaise = ret.valuePaise;
        } else {
          rows.push({
            key: ret.key,
            label: ret.label,
            sublabel: ret.sublabel,
            sortOrder: ret.sortOrder,
            bills: 0,
            quantity: 0,
            amountPaise: 0,
            cashPaise: 0,
            upiPaise: 0,
            creditPaise: 0,
            discountPaise: 0,
            returnedQuantity: ret.quantity,
            returnedValuePaise: ret.valuePaise,
          });
        }
      }
      rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.label.localeCompare(b.label));
    }
    if (f.groupBy === 'day') {
      for (const r of rows) r.sublabel = WEEKDAYS[new Date(`${r.key}T00:00:00Z`).getUTCDay()];
    }
    res.json({ groupBy: f.groupBy, from: fromDate, to: toDate, rows, totals });
  });

  return router;
}
