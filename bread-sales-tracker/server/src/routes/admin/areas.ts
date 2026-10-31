import { Router } from 'express';
import { z } from 'zod';
import { isUniqueViolation, many, one, type Pool } from '../../db.js';
import { conflict, notFound } from '../../errors.js';
import { idParam } from './helpers.js';

const areaSchema = z.object({
  name: z.string().trim().min(1, 'Area name is required').max(80),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
});

const AREA_COLUMNS = `a.id, a.name, a.sort_order AS "sortOrder", a.is_active AS "isActive", a.created_at AS "createdAt"`;

export function areasRouter(pool: Pool): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const areas = await many(
      pool,
      `SELECT ${AREA_COLUMNS},
              count(s.id) FILTER (WHERE s.is_active)::int AS "storeCount",
              count(s.id) FILTER (WHERE NOT s.is_active)::int AS "inactiveStoreCount"
         FROM areas a LEFT JOIN stores s ON s.area_id = a.id
        GROUP BY a.id
        ORDER BY a.is_active DESC, a.sort_order, lower(a.name)`,
    );
    res.json({ areas });
  });

  router.post('/', async (req, res) => {
    const body = areaSchema.parse(req.body);
    try {
      const area = await one(
        pool,
        `INSERT INTO areas (name, sort_order, is_active) VALUES ($1, coalesce($2, 0), coalesce($3, true))
         RETURNING id, name, sort_order AS "sortOrder", is_active AS "isActive", created_at AS "createdAt"`,
        [body.name, body.sortOrder ?? null, body.isActive ?? null],
      );
      res.status(201).json({ area });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('An area with this name already exists');
      throw err;
    }
  });

  router.put('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    const body = areaSchema.partial().parse(req.body);
    try {
      const area = await one(
        pool,
        `UPDATE areas SET name = coalesce($2, name), sort_order = coalesce($3, sort_order),
                is_active = coalesce($4, is_active), updated_at = now()
          WHERE id = $1
          RETURNING id, name, sort_order AS "sortOrder", is_active AS "isActive", created_at AS "createdAt"`,
        [id, body.name ?? null, body.sortOrder ?? null, body.isActive ?? null],
      );
      if (!area) throw notFound('Area not found');
      res.json({ area });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('An area with this name already exists');
      throw err;
    }
  });

  return router;
}
