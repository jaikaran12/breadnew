import { Router } from 'express';
import { z } from 'zod';
import { isUniqueViolation, nowIso, type Db } from '../../db.js';
import { badRequest, conflict, notFound } from '../../errors.js';
import { bumpCatalogStatement } from '../../services/settings.js';
import { idParam, paiseSchema } from './helpers.js';

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colour must look like #A1B2C3');

const productSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required').max(80),
  localName: z.string().trim().max(80).optional().nullable(),
  pricePaise: paiseSchema,
  color: colorSchema.optional(),
  isActive: z.boolean().optional(),
});

const PRODUCT_COLUMNS = `p.id, p.name, p.local_name AS "localName", p.price_paise AS "pricePaise", p.color,
  p.sort_order AS "sortOrder", p.is_active AS "isActive", p.created_at AS "createdAt", p.updated_at AS "updatedAt"`;

export function productsRouter(db: Db): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const products = await db.all(
      `SELECT ${PRODUCT_COLUMNS},
              (SELECT max(changed_at) FROM product_price_history h WHERE h.product_id = p.id) AS "priceChangedAt"
         FROM products p ORDER BY p.is_active DESC, p.sort_order, lower(p.name)`,
    );
    res.json({ products });
  });

  router.post('/', async (req, res) => {
    const body = productSchema.parse(req.body);
    const now = nowIso();
    const byName = '(SELECT id FROM products WHERE lower(name) = lower(?1))';
    try {
      const results = await db.batch([
        {
          sql: `INSERT INTO products (name, local_name, price_paise, color, is_active, sort_order, created_at, updated_at)
                VALUES (?1, ?2, ?3, coalesce(?4, '#C68B59'), coalesce(?5, 1),
                        (SELECT coalesce(max(sort_order), 0) + 1 FROM products), ?6, ?6)`,
          params: [body.name, body.localName || null, body.pricePaise, body.color ?? null, body.isActive ?? null, now],
        },
        {
          sql: `INSERT INTO product_price_history (product_id, old_price_paise, new_price_paise, changed_by_admin_id, changed_at)
                VALUES (${byName}, NULL, ?2, ?3, ?4)`,
          params: [body.name, body.pricePaise, req.admin!.id, now],
        },
        bumpCatalogStatement(),
        { sql: `SELECT ${PRODUCT_COLUMNS} FROM products p WHERE p.id = ${byName}`, params: [body.name] },
      ]);
      res.status(201).json({ product: results[3].rows[0] });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('A product with this name already exists');
      throw err;
    }
  });

  router.put('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    const body = productSchema.partial().parse(req.body);
    const now = nowIso();
    try {
      const results = await db.batch([
        // Price history first, while the old price is still in the row (same transaction as the change).
        {
          sql: `INSERT INTO product_price_history (product_id, old_price_paise, new_price_paise, changed_by_admin_id, changed_at)
                SELECT id, price_paise, ?2, ?3, ?4 FROM products WHERE id = ?1 AND ?2 IS NOT NULL AND price_paise <> ?2`,
          params: [id, body.pricePaise ?? null, req.admin!.id, now],
        },
        {
          sql: `UPDATE products SET
                   name = coalesce(?2, name),
                   local_name = CASE WHEN ?3 THEN ?4 ELSE local_name END,
                   price_paise = coalesce(?5, price_paise),
                   color = coalesce(?6, color),
                   is_active = coalesce(?7, is_active),
                   updated_at = ?8
                 WHERE id = ?1`,
          params: [
            id,
            body.name ?? null,
            body.localName !== undefined,
            body.localName || null,
            body.pricePaise ?? null,
            body.color ?? null,
            body.isActive ?? null,
            now,
          ],
        },
        bumpCatalogStatement(),
        { sql: `SELECT ${PRODUCT_COLUMNS} FROM products p WHERE p.id = ?1`, params: [id] },
      ]);
      const product = results[3].rows[0];
      if (!product) throw notFound('Product not found');
      res.json({ product });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('A product with this name already exists');
      throw err;
    }
  });

  /** Saves the display order used in the driver app: body { ids: [3, 1, 2, ...] } */
  router.post('/reorder', async (req, res) => {
    const { ids } = z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) }).parse(req.body);
    if (new Set(ids).size !== ids.length) throw badRequest('Duplicate product ids');
    await db.batch([
      {
        sql: `UPDATE products SET sort_order = (SELECT j.key + 1 FROM json_each(?1) j WHERE j.value = products.id), updated_at = ?2
               WHERE id IN (SELECT value FROM json_each(?1))`,
        params: [JSON.stringify(ids), nowIso()],
      },
      bumpCatalogStatement(),
    ]);
    res.json({ ok: true });
  });

  router.get('/:id/price-history', async (req, res) => {
    const id = idParam(req.params.id);
    const history = await db.all(
      `SELECT h.id, h.old_price_paise AS "oldPricePaise", h.new_price_paise AS "newPricePaise",
              h.changed_at AS "changedAt", a.name AS "changedBy"
         FROM product_price_history h LEFT JOIN admins a ON a.id = h.changed_by_admin_id
        WHERE h.product_id = ?1 ORDER BY h.changed_at DESC, h.id DESC LIMIT 100`,
      [id],
    );
    res.json({ history });
  });

  return router;
}
