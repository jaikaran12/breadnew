import { Router } from 'express';
import type { Config } from '../../config.js';
import type { Db } from '../../db.js';
import { SUMMARY_COLUMNS } from '../../services/sales.js';
import { addDays, parseDateParam, todayInZone } from '../../util/dates.js';

const TREND_DAYS = 14;

/** Everything on the home screen of the admin site for one day. */
export function dashboardRouter(config: Config, db: Db): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const today = todayInZone(config.appTimezone);
    const date = parseDateParam(req.query.date, today);
    const [totals, byDriver, byArea, byProduct, returnsByProduct, recent, counts] = await Promise.all([
      db.first(
        `SELECT ${SUMMARY_COLUMNS},
                coalesce(sum(total_paise) FILTER (WHERE status = 'cancelled'), 0) AS "cancelledPaise",
                count(DISTINCT store_id) FILTER (WHERE status = 'completed') AS "storesVisited",
                count(DISTINCT driver_id) FILTER (WHERE status = 'completed') AS "activeDrivers"
           FROM sales WHERE sale_date = ?1`,
        [date],
      ),
      db.all(
        `SELECT d.id AS "driverId", d.name, ${SUMMARY_COLUMNS},
                count(DISTINCT s.store_id) FILTER (WHERE s.status = 'completed') AS "storesVisited",
                max(s.sold_at) AS "lastSaleAt"
           FROM sales s JOIN drivers d ON d.id = s.driver_id
          WHERE s.sale_date = ?1
          GROUP BY d.id ORDER BY "totalPaise" DESC`,
        [date],
      ),
      db.all(
        `SELECT a.id AS "areaId", a.name,
                count(s.id) FILTER (WHERE s.total_quantity > 0) AS bills, coalesce(sum(s.total_paise), 0) AS "totalPaise",
                coalesce(sum(s.returned_quantity), 0) AS "returnedQuantity", coalesce(sum(s.returned_paise), 0) AS "returnedPaise",
                count(DISTINCT s.store_id) AS "storesVisited",
                (SELECT count(*) FROM stores x WHERE x.area_id = a.id AND x.is_active = 1) AS "totalStores"
           FROM sales s JOIN areas a ON a.id = s.area_id
          WHERE s.sale_date = ?1 AND s.status = 'completed'
          GROUP BY a.id ORDER BY "totalPaise" DESC`,
        [date],
      ),
      db.all(
        `SELECT p.id AS "productId", p.name, p.color, sum(si.quantity) AS quantity,
                sum(si.line_total_paise) AS "totalPaise"
           FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
          WHERE s.sale_date = ?1 AND s.status = 'completed'
          GROUP BY p.id ORDER BY p.sort_order, lower(p.name)`,
        [date],
      ),
      // Expired items taken back today; valuePaise is what was taken off the bills for them.
      db.all(
        `SELECT p.id AS "productId", p.name, p.color, sum(r.quantity) AS quantity,
                sum(r.credit_paise) AS "valuePaise", count(DISTINCT s.store_id) AS stores
           FROM sale_returns r JOIN sales s ON s.id = r.sale_id JOIN products p ON p.id = r.product_id
          WHERE s.sale_date = ?1 AND s.status = 'completed'
          GROUP BY p.id ORDER BY quantity DESC, p.sort_order`,
        [date],
      ),
      db.all(
        `SELECT s.id, s.sold_at AS "soldAt", s.payment_mode AS "paymentMode", s.total_paise AS "totalPaise",
                s.total_quantity AS "totalQuantity", s.returned_quantity AS "returnedQuantity",
                s.returned_paise AS "returnedPaise", s.discount_paise AS "discountPaise", s.status, d.name AS "driverName", st.name AS "storeName",
                a.name AS "areaName"
           FROM sales s JOIN drivers d ON d.id = s.driver_id JOIN stores st ON st.id = s.store_id
           JOIN areas a ON a.id = s.area_id
          WHERE s.sale_date = ?1
          ORDER BY s.sold_at DESC, s.id DESC LIMIT 15`,
        [date],
      ),
      db.first(
        `SELECT (SELECT count(*) FROM stores WHERE is_active = 1) AS stores,
                (SELECT count(*) FROM products WHERE is_active = 1) AS products,
                (SELECT count(*) FROM drivers WHERE is_active = 1) AS drivers,
                (SELECT count(*) FROM areas WHERE is_active = 1) AS areas`,
      ),
    ]);
    res.json({ date, today, totals, byDriver, byArea, byProduct, returnsByProduct, recent, counts });
  });

  /** Sales of the 14 days up to `date` (a separate call: it changes slowly, so the website asks less often). */
  router.get('/trend', async (req, res) => {
    const today = todayInZone(config.appTimezone);
    const date = parseDateParam(req.query.date, today);
    const first = addDays(date, -(TREND_DAYS - 1));
    const rows = await db.all<{ date: string; bills: number; totalPaise: number }>(
      `SELECT sale_date AS date, count(*) FILTER (WHERE total_quantity > 0) AS bills, sum(total_paise) AS "totalPaise"
         FROM sales WHERE sale_date BETWEEN ?1 AND ?2 AND status = 'completed'
        GROUP BY sale_date`,
      [first, date],
    );
    const byDate = new Map(rows.map((r) => [r.date, r]));
    const trend = Array.from({ length: TREND_DAYS }, (_, i) => {
      const day = addDays(first, i);
      return { date: day, bills: byDate.get(day)?.bills ?? 0, totalPaise: byDate.get(day)?.totalPaise ?? 0 };
    });
    res.json({ date, trend });
  });

  return router;
}
