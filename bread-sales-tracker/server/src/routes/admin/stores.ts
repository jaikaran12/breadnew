import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { isUniqueViolation, likePattern, nowIso, type Db, type Statement } from '../../db.js';
import { badRequest, conflict, notFound } from '../../errors.js';
import { attachItems, SALE_SELECT, type SaleRow } from '../../services/sales.js';
import { bumpCatalogStatement } from '../../services/settings.js';
import { parseCsv } from '../../util/csv.js';
import { addDays, todayInZone } from '../../util/dates.js';
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

const STORE_FROM = `FROM stores st JOIN areas a ON a.id = st.area_id LEFT JOIN drivers d ON d.id = st.created_by_driver_id`;

const DUPLICATE_STORE = 'A shop with this name already exists in this area. Add a landmark to the name to tell them apart.';

/** Lower-cases A-Z only, exactly like SQLite's lower() used by the unique name indexes. */
function sqlLower(text: string): string {
  return text.replace(/[A-Z]/g, (c) => c.toLowerCase());
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

/** Rows per INSERT statement in an import (each statement gets its rows as one JSON value). */
const IMPORT_CHUNK = 500;

export function storesRouter(config: Config, db: Db): Router {
  const router = Router();

  const getStore = (id: number) => db.first(`SELECT ${STORE_COLUMNS} ${STORE_FROM} WHERE st.id = ?1`, [id]);

  /**
   * Shop list with "last bill" and "last 30 days" figures. There are only a few hundred shops, so all
   * matching shops are read in one query and the page is cut out here.
   */
  router.get('/', async (req, res) => {
    const f = listSchema.parse(cleanQuery(req.query));
    const today = todayInZone(config.appTimezone);
    const w = new Where();
    const since = w.param(addDays(today, -29));
    if (f.status === 'active') w.raw('st.is_active = 1');
    if (f.status === 'inactive') w.raw('st.is_active = 0');
    if (f.areaId) w.add('st.area_id = ?', f.areaId);
    if (f.q) {
      const p = w.param(likePattern(f.q));
      w.raw(
        `(st.name LIKE ${p} ESCAPE '\\' OR st.owner_name LIKE ${p} ESCAPE '\\' OR st.phone LIKE ${p} ESCAPE '\\' OR st.address LIKE ${p} ESCAPE '\\')`,
      );
    }
    if (f.notVisitedDays) {
      const cutoff = w.param(new Date(Date.now() - f.notVisitedDays * 86_400_000).toISOString());
      w.raw(`(st.last_sale_at IS NULL OR st.last_sale_at < ${cutoff})`);
    }
    const order = {
      name: 'lower(st.name)',
      area: 'a.sort_order, lower(a.name), lower(st.name)',
      lastVisit: 'st.last_sale_at DESC NULLS LAST, lower(st.name)',
      sales30: 'coalesce(r.amount30, 0) DESC, lower(st.name)',
    }[f.sort];
    const rows = await db.all(
      `WITH recent AS (
              SELECT store_id, count(*) AS bills30, sum(total_paise) AS amount30
                FROM sales WHERE sale_date >= ${since} AND status = 'completed' GROUP BY store_id
            ),
            st AS (
              SELECT x.*, (SELECT y.sold_at FROM sales y WHERE y.store_id = x.id AND y.status = 'completed'
                            ORDER BY y.sold_at DESC LIMIT 1) AS last_sale_at
                FROM stores x
            )
       SELECT ${STORE_COLUMNS}, st.last_sale_at AS "lastSaleAt",
              coalesce(r.bills30, 0) AS "bills30", coalesce(r.amount30, 0) AS "amount30Paise"
         FROM st JOIN areas a ON a.id = st.area_id
         LEFT JOIN drivers d ON d.id = st.created_by_driver_id
         LEFT JOIN recent r ON r.store_id = st.id
         ${w.sql}
        ORDER BY ${order}`,
      w.values,
    );
    const start = (f.page - 1) * f.pageSize;
    res.json({ stores: rows.slice(start, start + f.pageSize), total: rows.length, page: f.page, pageSize: f.pageSize });
  });

  router.get('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    const today = todayInZone(config.appTimezone);
    const store = await getStore(id);
    if (!store) throw notFound('Shop not found');
    const since = addDays(today, -29);
    const [stats, products30, recentRows] = await Promise.all([
      db.first(
        `SELECT count(*) AS "billsAllTime", coalesce(sum(total_paise), 0) AS "amountAllTimePaise",
                count(*) FILTER (WHERE sale_date >= ?2) AS "bills30",
                coalesce(sum(total_paise) FILTER (WHERE sale_date >= ?2), 0) AS "amount30Paise",
                coalesce(sum(total_paise) FILTER (WHERE sale_date >= ?2 AND payment_mode = 'credit'), 0) AS "credit30Paise",
                min(sold_at) AS "firstSaleAt", max(sold_at) AS "lastSaleAt"
           FROM sales WHERE store_id = ?1 AND status = 'completed'`,
        [id, since],
      ),
      db.all(
        `SELECT si.product_id AS "productId", p.name, sum(si.quantity) AS quantity, sum(si.line_total_paise) AS "amountPaise"
           FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
          WHERE s.store_id = ?1 AND s.status = 'completed' AND s.sale_date >= ?2
          GROUP BY si.product_id ORDER BY p.sort_order, p.name`,
        [id, since],
      ),
      db.all<SaleRow>(`${SALE_SELECT} WHERE s.store_id = ?1 ORDER BY s.sold_at DESC LIMIT 30`, [id]),
    ]);
    res.json({ store, stats, products30, since, recentSales: await attachItems(db, recentRows) });
  });

  router.post('/', async (req, res) => {
    const body = storeSchema.parse(req.body);
    const area = await db.first('SELECT id FROM areas WHERE id = ?1', [body.areaId]);
    if (!area) throw badRequest('Area not found');
    try {
      const [inserted] = await db.batch([
        {
          sql: `INSERT INTO stores (area_id, name, owner_name, phone, address, notes, is_active, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, coalesce(?7, 1), ?8, ?8) RETURNING id`,
          params: [
            body.areaId,
            body.name,
            body.ownerName || null,
            cleanPhone(body.phone),
            body.address || null,
            body.notes || null,
            body.isActive ?? null,
            nowIso(),
          ],
        },
        bumpCatalogStatement(),
      ]);
      res.status(201).json({ store: await getStore(Number(inserted.rows[0].id)) });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(DUPLICATE_STORE);
      throw err;
    }
  });

  router.put('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    const body = storeSchema.partial().parse(req.body);
    if (body.areaId) {
      const area = await db.first('SELECT id FROM areas WHERE id = ?1', [body.areaId]);
      if (!area) throw badRequest('Area not found');
    }
    const has = (k: keyof typeof body) => body[k] !== undefined;
    try {
      const [updated] = await db.batch([
        {
          sql: `UPDATE stores SET
                   area_id = coalesce(?2, area_id),
                   name = coalesce(?3, name),
                   owner_name = CASE WHEN ?4 THEN ?5 ELSE owner_name END,
                   phone = CASE WHEN ?6 THEN ?7 ELSE phone END,
                   address = CASE WHEN ?8 THEN ?9 ELSE address END,
                   notes = CASE WHEN ?10 THEN ?11 ELSE notes END,
                   is_active = coalesce(?12, is_active),
                   updated_at = ?13
                 WHERE id = ?1`,
          params: [
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
            nowIso(),
          ],
        },
        bumpCatalogStatement(),
      ]);
      if (updated.changes === 0) throw notFound('Shop not found');
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(DUPLICATE_STORE);
      throw err;
    }
    res.json({ store: await getStore(id) });
  });

  /**
   * Bulk import from CSV / pasted Excel cells. Columns (header row required, any order):
   * Area, Shop name, Owner, Phone, Address, Notes. Missing areas are created.
   * Shops that already exist (same name in the same area) are skipped, so the same file can be imported twice.
   * Everything is saved in one transaction.
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

    const [areaRows, storeRows] = await Promise.all([
      db.all<{ id: number; name: string }>('SELECT id, name FROM areas'),
      db.all<{ areaId: number; name: string }>('SELECT area_id AS "areaId", name FROM stores'),
    ]);
    // Area key -> existing area id, or the exact name of an area this import creates.
    const areas = new Map<string, number | string>(areaRows.map((a) => [sqlLower(a.name), a.id]));
    const existing = new Set(storeRows.map((s) => `${s.areaId}:${sqlLower(s.name)}`));
    const newStores: Array<[number | null, string | null, string, string | null, string | null, string | null, string | null]> =
      [];

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
      let area = areas.get(sqlLower(areaName));
      if (area === undefined) {
        area = areaName;
        areas.set(sqlLower(areaName), area);
        result.areasCreated.push(areaName);
      }
      const key = `${typeof area === 'number' ? area : `new:${sqlLower(area)}`}:${sqlLower(name)}`;
      if (existing.has(key)) {
        result.skippedExisting++;
        continue;
      }
      existing.add(key);
      newStores.push([
        typeof area === 'number' ? area : null,
        typeof area === 'string' ? area : null,
        name,
        col(row, 'owner').slice(0, 120) || null,
        cleanPhone(col(row, 'phone')),
        col(row, 'address').slice(0, 300) || null,
        col(row, 'notes').slice(0, 500) || null,
      ]);
      result.storesCreated++;
    }

    if (!body.dryRun && (newStores.length > 0 || result.areasCreated.length > 0)) {
      const now = nowIso();
      const statements: Statement[] = [];
      if (result.areasCreated.length > 0) {
        statements.push({
          sql: `INSERT INTO areas (name, created_at, updated_at) SELECT value, ?2, ?2 FROM json_each(?1)`,
          params: [JSON.stringify(result.areasCreated), now],
        });
      }
      for (let i = 0; i < newStores.length; i += IMPORT_CHUNK) {
        statements.push({
          sql: `INSERT INTO stores (area_id, name, owner_name, phone, address, notes, created_at, updated_at)
                SELECT coalesce(json_extract(j.value, '$[0]'), (SELECT a.id FROM areas a WHERE a.name = json_extract(j.value, '$[1]'))),
                       json_extract(j.value, '$[2]'), json_extract(j.value, '$[3]'), json_extract(j.value, '$[4]'),
                       json_extract(j.value, '$[5]'), json_extract(j.value, '$[6]'), ?2, ?2
                  FROM json_each(?1) j`,
          params: [JSON.stringify(newStores.slice(i, i + IMPORT_CHUNK)), now],
        });
      }
      statements.push(bumpCatalogStatement());
      try {
        await db.batch(statements);
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict('The shop list changed while importing. Please try again.');
        throw err;
      }
    }
    res.json(result);
  });

  return router;
}
