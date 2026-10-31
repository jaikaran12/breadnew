import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { isUniqueViolation, many, one, withTransaction, type Pool } from '../../db.js';
import { badRequest, conflict, notFound } from '../../errors.js';
import { attachItems, SALE_SELECT, type Sale } from '../../services/sales.js';
import { parseCsv, toCsv } from '../../util/csv.js';
import { addDays, todayInZone } from '../../util/dates.js';
import { paiseToRupeesString } from '../../util/money.js';
import { cleanPhone } from '../../util/phone.js';
import { cleanQuery, idParam, Where } from './helpers.js';

const storeSchema = z.object({
  areaId: z.number().int().positive(),
  name: z.string().trim().min(1, 'Shop name is required').max(120),
  ownerName: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(20).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
});

const listSchema = z.object({
  areaId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  notVisitedDays: z.coerce.number().int().min(1).max(3650).optional(),
  sort: z.enum(['name', 'lastVisit', 'sales30', 'area']).default('area'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(100),
});

const STORE_COLUMNS = `st.id, st.name, st.area_id AS "areaId", a.name AS "areaName", st.owner_name AS "ownerName",
  st.phone, st.address, st.notes, st.is_active AS "isActive", st.created_at AS "createdAt",
  st.created_by_driver_id AS "createdByDriverId", d.name AS "createdByDriverName"`;

const DUPLICATE_STORE = 'A shop with this name already exists in this area. Add a landmark to the name to tell them apart.';

function storeStatsJoin(todayParam: string): string {
  return `LEFT JOIN (
      SELECT store_id,
             max(sold_at) AS last_sale_at,
             count(*) FILTER (WHERE sale_date > ${todayParam}::date - 30)::int AS bills30,
             coalesce(sum(total_paise) FILTER (WHERE sale_date > ${todayParam}::date - 30), 0) AS amount30
        FROM sales WHERE status = 'completed' GROUP BY store_id
    ) agg ON agg.store_id = st.id`;
}

const HEADER_ALIASES: Record<string, 'area' | 'name' | 'owner' | 'phone' | 'address' | 'notes'> = {
  area: 'area',
  'area name': 'area',
  locality: 'area',
  route: 'area',
  name: 'name',
  shop: 'name',
  'shop name': 'name',
  store: 'name',
  'store name': 'name',
  kirana: 'name',
  owner: 'owner',
  'owner name': 'owner',
  contact: 'owner',
  'contact person': 'owner',
  phone: 'phone',
  mobile: 'phone',
  'phone number': 'phone',
  'mobile number': 'phone',
  address: 'address',
  landmark: 'address',
  notes: 'notes',
  note: 'notes',
  remarks: 'notes',
};

export interface ImportResult {
  dryRun: boolean;
  rows: number;
  areasCreated: string[];
  storesCreated: number;
  skippedExisting: number;
  errors: Array<{ line: number; message: string }>;
}

export function storesRouter(config: Config, pool: Pool): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const f = listSchema.parse(cleanQuery(req.query));
    const today = todayInZone(config.appTimezone);
    const w = new Where();
    const todayParam = w.param(today);
    if (f.status === 'active') w.raw('st.is_active');
    if (f.status === 'inactive') w.raw('NOT st.is_active');
    if (f.areaId) w.add('st.area_id = ?', f.areaId);
    if (f.q) {
      const p = w.param(`%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      w.raw(`(st.name ILIKE ${p} OR st.owner_name ILIKE ${p} OR st.phone ILIKE ${p} OR st.address ILIKE ${p})`);
    }
    if (f.notVisitedDays) {
      w.raw(
        `(agg.last_sale_at IS NULL OR agg.last_sale_at < now() - (${w.param(String(f.notVisitedDays))} || ' days')::interval)`,
      );
    }
    const order = {
      name: 'lower(st.name)',
      area: 'a.sort_order, lower(a.name), lower(st.name)',
      lastVisit: 'agg.last_sale_at DESC NULLS LAST, lower(st.name)',
      sales30: 'coalesce(agg.amount30, 0) DESC, lower(st.name)',
    }[f.sort];
    const from = `FROM stores st JOIN areas a ON a.id = st.area_id
                  LEFT JOIN drivers d ON d.id = st.created_by_driver_id
                  ${storeStatsJoin(todayParam)}`;
    const countRow = await one<{ n: number }>(pool, `SELECT count(*)::int AS n ${from} ${w.sql}`, w.values);
    const limit = w.param(f.pageSize);
    const offset = w.param((f.page - 1) * f.pageSize);
    const stores = await many(
      pool,
      `SELECT ${STORE_COLUMNS}, agg.last_sale_at AS "lastSaleAt",
              coalesce(agg.bills30, 0) AS "bills30", coalesce(agg.amount30, 0) AS "amount30Paise"
         ${from} ${w.sql}
        ORDER BY ${order}
        LIMIT ${limit} OFFSET ${offset}`,
      w.values,
    );
    res.json({ stores, total: countRow?.n ?? 0, page: f.page, pageSize: f.pageSize });
  });

  router.get('/export.csv', async (_req, res) => {
    const today = todayInZone(config.appTimezone);
    const rows = await many(
      pool,
      `SELECT ${STORE_COLUMNS}, agg.last_sale_at AS "lastSaleAt", coalesce(agg.amount30, 0) AS "amount30Paise"
         FROM stores st JOIN areas a ON a.id = st.area_id
         LEFT JOIN drivers d ON d.id = st.created_by_driver_id
         ${storeStatsJoin('$1')}
        ORDER BY a.sort_order, lower(a.name), lower(st.name)`,
      [today],
    );
    const csv = toCsv(
      ['Area', 'Shop name', 'Owner', 'Phone', 'Address', 'Notes', 'Active', 'Last bill', 'Sales last 30 days (Rs)'],
      rows.map((r) => [
        r.areaName,
        r.name,
        r.ownerName,
        r.phone,
        r.address,
        r.notes,
        r.isActive ? 'yes' : 'no',
        r.lastSaleAt ? new Date(r.lastSaleAt).toLocaleString('en-IN', { timeZone: config.appTimezone }) : '',
        paiseToRupeesString(r.amount30Paise),
      ]),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="shops-${today}.csv"`);
    res.send(csv);
  });

  router.get('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    const today = todayInZone(config.appTimezone);
    const store = await one(
      pool,
      `SELECT ${STORE_COLUMNS} FROM stores st JOIN areas a ON a.id = st.area_id
         LEFT JOIN drivers d ON d.id = st.created_by_driver_id WHERE st.id = $1`,
      [id],
    );
    if (!store) throw notFound('Shop not found');
    const since = addDays(today, -29);
    const stats = await one(
      pool,
      `SELECT count(*)::int AS "billsAllTime", coalesce(sum(total_paise), 0) AS "amountAllTimePaise",
              count(*) FILTER (WHERE sale_date >= $2)::int AS "bills30",
              coalesce(sum(total_paise) FILTER (WHERE sale_date >= $2), 0) AS "amount30Paise",
              coalesce(sum(total_paise) FILTER (WHERE sale_date >= $2 AND payment_mode = 'credit'), 0) AS "credit30Paise",
              min(sold_at) AS "firstSaleAt", max(sold_at) AS "lastSaleAt"
         FROM sales WHERE store_id = $1 AND status = 'completed'`,
      [id, since],
    );
    const products30 = await many(
      pool,
      `SELECT si.product_id AS "productId", p.name, sum(si.quantity)::int AS quantity,
              sum(si.line_total_paise) AS "amountPaise"
         FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
        WHERE s.store_id = $1 AND s.status = 'completed' AND s.sale_date >= $2
        GROUP BY si.product_id, p.name, p.sort_order ORDER BY p.sort_order, p.name`,
      [id, since],
    );
    const recentRows = await many<Omit<Sale, 'items' | 'priceMismatch'>>(
      pool,
      `${SALE_SELECT} WHERE s.store_id = $1 ORDER BY s.sold_at DESC LIMIT 30`,
      [id],
    );
    res.json({ store, stats, products30, since, recentSales: await attachItems(pool, recentRows) });
  });

  router.post('/', async (req, res) => {
    const body = storeSchema.parse(req.body);
    const area = await one(pool, 'SELECT id FROM areas WHERE id = $1', [body.areaId]);
    if (!area) throw badRequest('Area not found');
    try {
      const created = await one<{ id: number }>(
        pool,
        `INSERT INTO stores (area_id, name, owner_name, phone, address, notes, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, coalesce($7, true)) RETURNING id`,
        [
          body.areaId,
          body.name,
          body.ownerName || null,
          cleanPhone(body.phone),
          body.address || null,
          body.notes || null,
          body.isActive ?? null,
        ],
      );
      const store = await one(
        pool,
        `SELECT ${STORE_COLUMNS} FROM stores st JOIN areas a ON a.id = st.area_id
           LEFT JOIN drivers d ON d.id = st.created_by_driver_id WHERE st.id = $1`,
        [created!.id],
      );
      res.status(201).json({ store });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(DUPLICATE_STORE);
      throw err;
    }
  });

  router.put('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    const body = storeSchema.partial().parse(req.body);
    if (body.areaId) {
      const area = await one(pool, 'SELECT id FROM areas WHERE id = $1', [body.areaId]);
      if (!area) throw badRequest('Area not found');
    }
    const has = (k: keyof typeof body) => body[k] !== undefined;
    try {
      const result = await pool.query(
        `UPDATE stores SET
            area_id = coalesce($2, area_id),
            name = coalesce($3, name),
            owner_name = CASE WHEN $4::boolean THEN $5 ELSE owner_name END,
            phone = CASE WHEN $6::boolean THEN $7 ELSE phone END,
            address = CASE WHEN $8::boolean THEN $9 ELSE address END,
            notes = CASE WHEN $10::boolean THEN $11 ELSE notes END,
            is_active = coalesce($12, is_active),
            updated_at = now()
          WHERE id = $1`,
        [
          id,
          body.areaId ?? null,
          body.name ?? null,
          has('ownerName'),
          body.ownerName || null,
          has('phone'),
          cleanPhone(body.phone),
          has('address'),
          body.address || null,
          has('notes'),
          body.notes || null,
          body.isActive ?? null,
        ],
      );
      if (result.rowCount === 0) throw notFound('Shop not found');
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(DUPLICATE_STORE);
      throw err;
    }
    const store = await one(
      pool,
      `SELECT ${STORE_COLUMNS} FROM stores st JOIN areas a ON a.id = st.area_id
         LEFT JOIN drivers d ON d.id = st.created_by_driver_id WHERE st.id = $1`,
      [id],
    );
    res.json({ store });
  });

  /**
   * Bulk import from CSV / pasted Excel cells. Columns (header row required, any order):
   * Area, Shop name, Owner, Phone, Address, Notes. Missing areas are created.
   * Shops that already exist (same name in the same area) are skipped, so the same file can be imported twice.
   */
  router.post('/import', async (req, res) => {
    const body = z
      .object({ csv: z.string().min(1, 'Paste or upload the shop list').max(2_000_000), dryRun: z.boolean().default(false) })
      .parse(req.body);
    const rows = parseCsv(body.csv);
    if (rows.length < 2) throw badRequest('The file needs a header row and at least one shop');
    const header = rows[0].map((h) => HEADER_ALIASES[h.trim().toLowerCase().replace(/[_*:]/g, ' ').replace(/\s+/g, ' ').trim()]);
    if (!header.includes('area') || !header.includes('name')) {
      throw badRequest('The first row must have column names, including "Area" and "Shop name"');
    }
    const col = (row: string[], key: string) => {
      const i = header.indexOf(key as never);
      return i >= 0 ? (row[i] ?? '').trim() : '';
    };

    const result: ImportResult = {
      dryRun: body.dryRun,
      rows: rows.length - 1,
      areasCreated: [],
      storesCreated: 0,
      skippedExisting: 0,
      errors: [],
    };

    await withTransaction(pool, async (c) => {
      const areas = new Map(
        (await many<{ id: number; name: string }>(c, 'SELECT id, name FROM areas')).map((a) => [a.name.toLowerCase(), a.id]),
      );
      const existing = new Set(
        (await many<{ key: string }>(c, `SELECT area_id || ':' || lower(name) AS key FROM stores`)).map((r) => r.key),
      );
      let fakeId = -1;
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const line = i + 1;
        const areaName = col(row, 'area').replace(/\s+/g, ' ');
        const name = col(row, 'name').replace(/\s+/g, ' ');
        if (!areaName || !name) {
          result.errors.push({ line, message: 'Area and shop name are both required' });
          continue;
        }
        if (name.length > 120 || areaName.length > 80) {
          result.errors.push({ line, message: 'Name is too long' });
          continue;
        }
        let areaId = areas.get(areaName.toLowerCase());
        if (areaId === undefined) {
          if (body.dryRun) {
            areaId = fakeId--;
          } else {
            const created = await one<{ id: number }>(c, 'INSERT INTO areas (name) VALUES ($1) RETURNING id', [areaName]);
            areaId = created!.id;
          }
          areas.set(areaName.toLowerCase(), areaId);
          result.areasCreated.push(areaName);
        }
        const key = `${areaId}:${name.toLowerCase()}`;
        if (existing.has(key)) {
          result.skippedExisting++;
          continue;
        }
        existing.add(key);
        if (!body.dryRun) {
          await c.query(
            `INSERT INTO stores (area_id, name, owner_name, phone, address, notes) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              areaId,
              name,
              col(row, 'owner').slice(0, 120) || null,
              cleanPhone(col(row, 'phone')),
              col(row, 'address').slice(0, 300) || null,
              col(row, 'notes').slice(0, 500) || null,
            ],
          );
        }
        result.storesCreated++;
      }
    });
    res.json(result);
  });

  return router;
}
