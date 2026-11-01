import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../../config.js';
import type { Db } from '../../db.js';
import { notFound } from '../../errors.js';
import {
  attachItems,
  cancelSaleByAdmin,
  getSale,
  restoreSale,
  SALE_SELECT,
  SUMMARY_COLUMNS,
  type SaleRow,
} from '../../services/sales.js';
import { todayInZone } from '../../util/dates.js';
import { cleanQuery, dateString, idParam, salesFilterSchema, salesWhere } from './helpers.js';

const listSchema = salesFilterSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

/** Bills per request when the website downloads bills for a spreadsheet. */
export const EXPORT_PAGE_SIZE = 300;

const exportSchema = salesFilterSchema.omit({ from: true, to: true }).extend({
  date: dateString,
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

export function salesRouter(config: Config, db: Db): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const f = listSchema.parse(cleanQuery(req.query));
    const today = todayInZone(config.appTimezone);
    const w = salesWhere(f, today, 'all');
    const filterValues = [...w.values];
    const limit = w.param(f.pageSize);
    const offset = w.param((f.page - 1) * f.pageSize);
    const [summary, rows] = await Promise.all([
      db.first<{ rowCount: number }>(
        `SELECT ${SUMMARY_COLUMNS},
                coalesce(sum(s.total_paise) FILTER (WHERE s.status = 'cancelled'), 0) AS "cancelledPaise",
                count(*) AS "rowCount"
           FROM sales s JOIN stores st ON st.id = s.store_id ${w.sql}`,
        filterValues,
      ),
      db.all<SaleRow>(`${SALE_SELECT} ${w.sql} ORDER BY s.sold_at DESC, s.id DESC LIMIT ${limit} OFFSET ${offset}`, w.values),
    ]);
    res.json({
      from: f.from ?? today,
      to: f.to ?? f.from ?? today,
      page: f.page,
      pageSize: f.pageSize,
      total: summary?.rowCount ?? 0,
      summary,
      sales: await attachItems(db, rows),
    });
  });

  /**
   * Bills of ONE day with their items, oldest first, in pages. The website calls this day by day to
   * build a spreadsheet (CSV) on the computer, so no single request gets big.
   */
  router.get('/export', async (req, res) => {
    const f = exportSchema.parse(cleanQuery(req.query));
    const today = todayInZone(config.appTimezone);
    const w = salesWhere({ ...f, from: f.date, to: f.date }, today, 'all');
    const limit = w.param(EXPORT_PAGE_SIZE + 1);
    const offset = w.param(f.offset);
    const rows = await db.all<SaleRow>(`${SALE_SELECT} ${w.sql} ORDER BY s.sold_at, s.id LIMIT ${limit} OFFSET ${offset}`, w.values);
    const more = rows.length > EXPORT_PAGE_SIZE;
    res.json({
      date: f.date,
      sales: await attachItems(db, rows.slice(0, EXPORT_PAGE_SIZE)),
      nextOffset: more ? f.offset + EXPORT_PAGE_SIZE : null,
    });
  });

  router.get('/:id', async (req, res) => {
    const sale = await getSale(db, idParam(req.params.id));
    if (!sale) throw notFound('Bill not found');
    const settled = await db.first('SELECT 1 AS x FROM settlements WHERE driver_id = ?1 AND settle_date = ?2', [
      sale.driverId,
      sale.saleDate,
    ]);
    res.json({ sale, daySettled: Boolean(settled) });
  });

  router.post('/:id/cancel', async (req, res) => {
    const { reason } = z
      .object({ reason: z.string().trim().min(2, 'Please write why the bill is cancelled').max(300) })
      .parse(req.body);
    const sale = await cancelSaleByAdmin(db, idParam(req.params.id), `${reason} (by ${req.admin!.name})`);
    res.json({ sale });
  });

  router.post('/:id/restore', async (req, res) => {
    const sale = await restoreSale(db, idParam(req.params.id));
    res.json({ sale });
  });

  return router;
}
