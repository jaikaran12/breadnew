import { Router } from 'express';
import type { Config } from '../../config.js';
import { many, one, type Pool } from '../../db.js';
import { SUMMARY_COLUMNS } from '../../services/sales.js';
import { parseDateParam, todayInZone } from '../../util/dates.js';

/** Everything on the home screen of the admin site for one day. */
export function dashboardRouter(config: Config, pool: Pool): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const today = todayInZone(config.appTimezone);
    const date = parseDateParam(req.query.date, today);
    const [totals, byDriver, byArea, byProduct, trend, recent, counts] = await Promise.all([
      one(
        pool,
        `SELECT ${SUMMARY_COLUMNS},
                coalesce(sum(total_paise) FILTER (WHERE status = 'cancelled'), 0) AS "cancelledPaise",
                count(DISTINCT store_id) FILTER (WHERE status = 'completed')::int AS "storesVisited",
                count(DISTINCT driver_id) FILTER (WHERE status = 'completed')::int AS "activeDrivers"
           FROM sales WHERE sale_date = $1`,
        [date],
      ),
      many(
        pool,
        `SELECT d.id AS "driverId", d.name, ${SUMMARY_COLUMNS},
                count(DISTINCT s.store_id) FILTER (WHERE s.status = 'completed')::int AS "storesVisited",
                max(s.sold_at) AS "lastSaleAt"
           FROM sales s JOIN drivers d ON d.id = s.driver_id
          WHERE s.sale_date = $1
          GROUP BY d.id ORDER BY "totalPaise" DESC`,
        [date],
      ),
      many(
        pool,
        `SELECT a.id AS "areaId", a.name,
                count(s.id)::int AS bills, coalesce(sum(s.total_paise), 0) AS "totalPaise",
                count(DISTINCT s.store_id)::int AS "storesVisited",
                (SELECT count(*)::int FROM stores x WHERE x.area_id = a.id AND x.is_active) AS "totalStores"
           FROM sales s JOIN areas a ON a.id = s.area_id
          WHERE s.sale_date = $1 AND s.status = 'completed'
          GROUP BY a.id ORDER BY "totalPaise" DESC`,
        [date],
      ),
      many(
        pool,
        `SELECT p.id AS "productId", p.name, p.color, sum(si.quantity)::int AS quantity,
                sum(si.line_total_paise) AS "totalPaise"
           FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
          WHERE s.sale_date = $1 AND s.status = 'completed'
          GROUP BY p.id ORDER BY p.sort_order, lower(p.name)`,
        [date],
      ),
      many(
        pool,
        `SELECT to_char(d.day, 'YYYY-MM-DD') AS date, count(s.id)::int AS bills,
                coalesce(sum(s.total_paise), 0) AS "totalPaise"
           FROM generate_series($1::date - 13, $1::date, interval '1 day') AS d(day)
           LEFT JOIN sales s ON s.sale_date = d.day::date AND s.status = 'completed'
          GROUP BY d.day ORDER BY d.day`,
        [date],
      ),
      many(
        pool,
        `SELECT s.id, s.sold_at AS "soldAt", s.payment_mode AS "paymentMode", s.total_paise AS "totalPaise",
                s.total_quantity AS "totalQuantity", s.status, d.name AS "driverName", st.name AS "storeName",
                a.name AS "areaName"
           FROM sales s JOIN drivers d ON d.id = s.driver_id JOIN stores st ON st.id = s.store_id
           JOIN areas a ON a.id = s.area_id
          WHERE s.sale_date = $1
          ORDER BY s.sold_at DESC, s.id DESC LIMIT 15`,
        [date],
      ),
      one(
        pool,
        `SELECT (SELECT count(*)::int FROM stores WHERE is_active) AS stores,
                (SELECT count(*)::int FROM products WHERE is_active) AS products,
                (SELECT count(*)::int FROM drivers WHERE is_active) AS drivers,
                (SELECT count(*)::int FROM areas WHERE is_active) AS areas`,
      ),
    ]);
    res.json({ date, today, totals, byDriver, byArea, byProduct, trend, recent, counts });
  });

  return router;
}
