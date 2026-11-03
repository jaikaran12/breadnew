import { Router } from 'express';
import { z } from 'zod';
import { nowIso, type Db } from '../../db.js';
import { badRequest, notFound } from '../../errors.js';
import { ruleLabel } from '../../services/billMath.js';
import { bumpCatalogStatement } from '../../services/settings.js';
import { idParam } from './helpers.js';

const discountSchema = z.discriminatedUnion('kind', [
  // hundredths of a percent: 500 = 5%, 250 = 2.5%
  z.object({ productId: z.number().int().positive(), kind: z.literal('percent'), value: z.number().int().min(1).max(10_000) }),
  // paise off each unit
  z.object({ productId: z.number().int().positive(), kind: z.literal('amount'), value: z.number().int().min(1).max(10_000_000) }),
]);

const OVERVIEW_COLUMNS = `d.store_id AS "storeId", st.name AS "storeName", st.is_active AS "isStoreActive",
  a.id AS "areaId", a.name AS "areaName", d.product_id AS "productId", p.name AS "productName",
  p.is_active AS "isProductActive", p.price_paise AS "pricePaise", d.kind, d.value, d.updated_at AS "updatedAt"`;

/** GET /api/admin/discounts — every shop's special rates, for the overview page. */
export function discountsRouter(db: Db): Router {
  const router = Router();
  router.get('/', async (_req, res) => {
    const discounts = await db.all(
      `SELECT ${OVERVIEW_COLUMNS}
         FROM store_discounts d
         JOIN stores st ON st.id = d.store_id
         JOIN areas a ON a.id = st.area_id
         JOIN products p ON p.id = d.product_id
        ORDER BY a.sort_order, lower(a.name), lower(st.name), p.sort_order, lower(p.name)`,
    );
    res.json({ discounts });
  });
  return router;
}

/** GET/PUT /api/admin/stores/:id/discounts — one shop's special rates. */
export function storeDiscountsRouter(db: Db): Router {
  const router = Router();

  const list = (storeId: number) =>
    db.all(
      `SELECT d.product_id AS "productId", d.kind, d.value, d.updated_at AS "updatedAt"
         FROM store_discounts d JOIN products p ON p.id = d.product_id
        WHERE d.store_id = ?1 ORDER BY p.sort_order, lower(p.name)`,
      [storeId],
    );

  router.get('/:id/discounts', async (req, res) => {
    const id = idParam(req.params.id);
    const store = await db.first('SELECT id FROM stores WHERE id = ?1', [id]);
    if (!store) throw notFound('Shop not found');
    res.json({ discounts: await list(id) });
  });

  /** Replaces all of the shop's discounts with the given list (products left out lose their discount). */
  router.put('/:id/discounts', async (req, res) => {
    const id = idParam(req.params.id);
    const { discounts } = z.object({ discounts: z.array(discountSchema).max(500) }).parse(req.body);
    const ids = discounts.map((d) => d.productId);
    if (new Set(ids).size !== ids.length) throw badRequest('A product appears twice');
    const store = await db.first('SELECT id FROM stores WHERE id = ?1', [id]);
    if (!store) throw notFound('Shop not found');
    const products = await db.all<{ id: number; name: string; pricePaise: number }>(
      'SELECT id, name, price_paise AS "pricePaise" FROM products WHERE id IN (SELECT value FROM json_each(?1))',
      [JSON.stringify(ids)],
    );
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const d of discounts) {
      const product = byId.get(d.productId);
      if (!product) throw badRequest(`Unknown product id ${d.productId}`);
      if (d.kind === 'amount' && d.value > product.pricePaise) {
        throw badRequest(`${product.name}: ${ruleLabel(d)} is more than its price`);
      }
    }
    const now = nowIso();
    await db.batch([
      {
        sql: `DELETE FROM store_discounts WHERE store_id = ?1 AND product_id NOT IN (SELECT value FROM json_each(?2))`,
        params: [id, JSON.stringify(ids)],
      },
      {
        sql: `INSERT INTO store_discounts (store_id, product_id, kind, value, created_at, updated_at)
              SELECT ?1, json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]'), json_extract(j.value, '$[2]'), ?3, ?3
                FROM json_each(?2) j
               WHERE true
              ON CONFLICT (store_id, product_id) DO UPDATE SET
                kind = excluded.kind,
                value = excluded.value,
                updated_at = CASE WHEN store_discounts.kind <> excluded.kind OR store_discounts.value <> excluded.value
                                  THEN excluded.updated_at ELSE store_discounts.updated_at END`,
        params: [id, JSON.stringify(discounts.map((d) => [d.productId, d.kind, d.value])), now],
      },
      bumpCatalogStatement(),
    ]);
    res.json({ discounts: await list(id) });
  });

  return router;
}
