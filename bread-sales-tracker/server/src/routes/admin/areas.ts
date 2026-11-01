import { Router } from 'express';
import { z } from 'zod';
import { isUniqueViolation, nowIso, type Db } from '../../db.js';
import { conflict, notFound } from '../../errors.js';
import { bumpCatalogStatement } from '../../services/settings.js';
import { idParam } from './helpers.js';

const areaSchema = z.object({
  name: z.string().trim().min(1, 'Area name is required').max(80),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
});

const AREA_RETURNING = `RETURNING id, name, sort_order AS "sortOrder", is_active AS "isActive", created_at AS "createdAt"`;

export function areasRouter(db: Db): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const areas = await db.all(
      `SELECT a.id, a.name, a.sort_order AS "sortOrder", a.is_active AS "isActive", a.created_at AS "createdAt",
              count(s.id) FILTER (WHERE s.is_active = 1) AS "storeCount",
              count(s.id) FILTER (WHERE s.is_active = 0) AS "inactiveStoreCount"
         FROM areas a LEFT JOIN stores s ON s.area_id = a.id
        GROUP BY a.id
        ORDER BY a.is_active DESC, a.sort_order, lower(a.name)`,
    );
    res.json({ areas });
  });

  router.post('/', async (req, res) => {
    const body = areaSchema.parse(req.body);
    try {
      const [inserted] = await db.batch([
        {
          sql: `INSERT INTO areas (name, sort_order, is_active) VALUES (?1, coalesce(?2, 0), coalesce(?3, 1)) ${AREA_RETURNING}`,
          params: [body.name, body.sortOrder ?? null, body.isActive ?? null],
        },
        bumpCatalogStatement(),
      ]);
      res.status(201).json({ area: inserted.rows[0] });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('An area with this name already exists');
      throw err;
    }
  });

  router.put('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    const body = areaSchema.partial().parse(req.body);
    try {
      const [updated] = await db.batch([
        {
          sql: `UPDATE areas SET name = coalesce(?2, name), sort_order = coalesce(?3, sort_order),
                       is_active = coalesce(?4, is_active), updated_at = ?5
                 WHERE id = ?1 ${AREA_RETURNING}`,
          params: [id, body.name ?? null, body.sortOrder ?? null, body.isActive ?? null, nowIso()],
        },
        bumpCatalogStatement(),
      ]);
      if (!updated.rows[0]) throw notFound('Area not found');
      res.json({ area: updated.rows[0] });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('An area with this name already exists');
      throw err;
    }
  });

  return router;
}
