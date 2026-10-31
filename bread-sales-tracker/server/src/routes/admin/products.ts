import { Router } from 'express';
import { z } from 'zod';
import { isUniqueViolation, many, one, withTransaction, type Pool } from '../../db.js';
import { badRequest, conflict, notFound } from '../../errors.js';
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

export function productsRouter(pool: Pool): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const products = await many(
      pool,
      `SELECT ${PRODUCT_COLUMNS},
              (SELECT max(changed_at) FROM product_price_history h WHERE h.product_id = p.id) AS "priceChangedAt"
         FROM products p ORDER BY p.is_active DESC, p.sort_order, lower(p.name)`,
    );
    res.json({ products });
  });

  router.post('/', async (req, res) => {
    const body = productSchema.parse(req.body);
    try {
      const product = await withTransaction(pool, async (c) => {
        const created = await one<{ id: number }>(
          c,
          `INSERT INTO products (name, local_name, price_paise, color, is_active, sort_order)
           VALUES ($1, $2, $3, coalesce($4, '#C68B59'), coalesce($5, true),
                   (SELECT coalesce(max(sort_order), 0) + 1 FROM products))
           RETURNING id`,
          [body.name, body.localName || null, body.pricePaise, body.color ?? null, body.isActive ?? null],
        );
        await c.query(
          `INSERT INTO product_price_history (product_id, old_price_paise, new_price_paise, changed_by_admin_id)
           VALUES ($1, NULL, $2, $3)`,
          [created!.id, body.pricePaise, req.admin!.id],
        );
        return one(c, `SELECT ${PRODUCT_COLUMNS} FROM products p WHERE p.id = $1`, [created!.id]);
      });
      res.status(201).json({ product });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('A product with this name already exists');
      throw err;
    }
  });

  router.put('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    const body = productSchema.partial().parse(req.body);
    try {
      const product = await withTransaction(pool, async (c) => {
        const current = await one<{ pricePaise: number }>(
          c,
          'SELECT price_paise AS "pricePaise" FROM products WHERE id = $1 FOR UPDATE',
          [id],
        );
        if (!current) throw notFound('Product not found');
        await c.query(
          `UPDATE products SET
              name = coalesce($2, name),
              local_name = CASE WHEN $3::boolean THEN $4 ELSE local_name END,
              price_paise = coalesce($5, price_paise),
              color = coalesce($6, color),
              is_active = coalesce($7, is_active),
              updated_at = now()
            WHERE id = $1`,
          [
            id,
            body.name ?? null,
            body.localName !== undefined,
            body.localName || null,
            body.pricePaise ?? null,
            body.color ?? null,
            body.isActive ?? null,
          ],
        );
        if (body.pricePaise !== undefined && body.pricePaise !== current.pricePaise) {
          await c.query(
            `INSERT INTO product_price_history (product_id, old_price_paise, new_price_paise, changed_by_admin_id)
             VALUES ($1, $2, $3, $4)`,
            [id, current.pricePaise, body.pricePaise, req.admin!.id],
          );
        }
        return one(c, `SELECT ${PRODUCT_COLUMNS} FROM products p WHERE p.id = $1`, [id]);
      });
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
    await withTransaction(pool, async (c) => {
      for (const [index, id] of ids.entries()) {
        await c.query('UPDATE products SET sort_order = $2, updated_at = now() WHERE id = $1', [id, index + 1]);
      }
    });
    res.json({ ok: true });
  });

  router.get('/:id/price-history', async (req, res) => {
    const id = idParam(req.params.id);
    const history = await many(
      pool,
      `SELECT h.id, h.old_price_paise AS "oldPricePaise", h.new_price_paise AS "newPricePaise",
              h.changed_at AS "changedAt", a.name AS "changedBy"
         FROM product_price_history h LEFT JOIN admins a ON a.id = h.changed_by_admin_id
        WHERE h.product_id = $1 ORDER BY h.changed_at DESC, h.id DESC LIMIT 100`,
      [id],
    );
    res.json({ history });
  });

  return router;
}
