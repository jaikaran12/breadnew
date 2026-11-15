import { Router } from 'express';
import { z } from 'zod';
import { isUniqueViolation, nowIso, type Db, type Statement } from '../../db.js';
import { badRequest, conflict, notFound } from '../../errors.js';
import { bumpCatalogStatement } from '../../services/settings.js';
import { idParam } from './helpers.js';

/** Days a route runs: "1".."7" (Monday … Sunday), any order; stored sorted, without repeats. */
const daysSchema = z
  .string()
  .trim()
  .regex(/^[1-7]{1,7}$/, 'Pick at least one day')
  .transform((d) => [...new Set(d.split(''))].sort().join(''));

const routeSchema = z.object({
  name: z.string().trim().min(1, 'Route name is required').max(80),
  driverId: z.number().int().positive().nullable().optional(),
  days: daysSchema.optional(),
  isActive: z.boolean().optional(),
  notes: z.string().trim().max(300).nullable().optional(),
  /** The shops in the order the driver goes. Replaces the whole list. */
  storeIds: z.array(z.number().int().positive()).max(400).optional(),
});

const DUPLICATE = 'A route with this name already exists. Pick another name.';

export interface RouteStop {
  position: number;
  storeId: number;
  name: string;
  areaId: number;
  areaName: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  locationStatus: 'owner' | 'driver' | null;
  isActive: boolean;
}

/** Delivery routes: which shops a driver visits, in order, on which days. */
export function deliveryRoutesRouter(db: Db): Router {
  const router = Router();

  const getRoute = async (id: number) => {
    const route = await db.first<Record<string, unknown>>(
      `SELECT r.id, r.name, r.driver_id AS "driverId", d.name AS "driverName", r.days, r.is_active AS "isActive", r.notes,
              r.created_at AS "createdAt", r.updated_at AS "updatedAt"
         FROM routes r LEFT JOIN drivers d ON d.id = r.driver_id WHERE r.id = ?1`,
      [id],
    );
    if (!route) return undefined;
    const stops = await db.all<RouteStop>(
      `SELECT rs.position, rs.store_id AS "storeId", st.name, st.area_id AS "areaId", a.name AS "areaName", st.address,
              st.lat, st.lng, st.location_status AS "locationStatus", st.is_active AS "isActive"
         FROM route_stops rs JOIN stores st ON st.id = rs.store_id JOIN areas a ON a.id = st.area_id
        WHERE rs.route_id = ?1 ORDER BY rs.position`,
      [id],
    );
    return { ...route, stops };
  };

  /** Checks the shop list and returns the statements that replace a route's stops (route by id, or by its unique name). */
  const stopStatements = async (route: { id: number } | { name: string }, storeIds: number[]): Promise<Statement[]> => {
    if (new Set(storeIds).size !== storeIds.length) throw badRequest('A shop is in the route twice');
    if (storeIds.length) {
      const found = await db.all<{ id: number }>(`SELECT id FROM stores WHERE id IN (SELECT value FROM json_each(?1))`, [
        JSON.stringify(storeIds),
      ]);
      if (found.length !== storeIds.length) throw badRequest('Some shops in the route no longer exist. Reload the page.');
    }
    const routeIdSql = 'id' in route ? '?2' : '(SELECT id FROM routes WHERE lower(name) = lower(?2))';
    const key = 'id' in route ? route.id : route.name;
    return [
      { sql: `DELETE FROM route_stops WHERE route_id = ${routeIdSql.replace('?2', '?1')}`, params: [key] },
      {
        sql: `INSERT INTO route_stops (route_id, store_id, position)
              SELECT ${routeIdSql}, value, CAST(key AS INTEGER) + 1 FROM json_each(?1)`,
        params: [JSON.stringify(storeIds), key],
      },
    ];
  };

  router.get('/', async (_req, res) => {
    const routes = await db.all(
      `SELECT r.id, r.name, r.driver_id AS "driverId", d.name AS "driverName", r.days, r.is_active AS "isActive", r.notes,
              r.updated_at AS "updatedAt",
              (SELECT count(*) FROM route_stops rs WHERE rs.route_id = r.id) AS "stopCount",
              (SELECT count(*) FROM route_stops rs JOIN stores st ON st.id = rs.store_id
                WHERE rs.route_id = r.id AND st.lat IS NULL) AS "withoutLocation"
         FROM routes r LEFT JOIN drivers d ON d.id = r.driver_id
        ORDER BY r.is_active DESC, lower(r.name)`,
    );
    res.json({ routes });
  });

  router.get('/:id', async (req, res) => {
    const route = await getRoute(idParam(req.params.id));
    if (!route) throw notFound('Route not found');
    res.json({ route });
  });

  router.post('/', async (req, res) => {
    const body = routeSchema.parse(req.body);
    if (body.driverId) {
      const driver = await db.first('SELECT id FROM drivers WHERE id = ?1', [body.driverId]);
      if (!driver) throw badRequest('Driver not found');
    }
    const now = nowIso();
    try {
      const [inserted] = await db.batch([
        {
          sql: `INSERT INTO routes (name, driver_id, days, is_active, notes, created_at, updated_at)
                VALUES (?1, ?2, ?3, coalesce(?4, 1), ?5, ?6, ?6) RETURNING id`,
          params: [body.name, body.driverId ?? null, body.days ?? '1234567', body.isActive ?? null, body.notes || null, now],
        },
        ...(await stopStatements({ name: body.name }, body.storeIds ?? [])),
        bumpCatalogStatement(),
      ]);
      res.status(201).json({ route: await getRoute(Number(inserted.rows[0].id)) });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(DUPLICATE);
      throw err;
    }
  });

  router.put('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    const body = routeSchema.partial().parse(req.body);
    if (body.driverId) {
      const driver = await db.first('SELECT id FROM drivers WHERE id = ?1', [body.driverId]);
      if (!driver) throw badRequest('Driver not found');
    }
    const exists = await db.first('SELECT id FROM routes WHERE id = ?1', [id]);
    if (!exists) throw notFound('Route not found');
    try {
      await db.batch([
        {
          sql: `UPDATE routes SET
                  name = coalesce(?2, name),
                  driver_id = CASE WHEN ?3 THEN ?4 ELSE driver_id END,
                  days = coalesce(?5, days),
                  is_active = coalesce(?6, is_active),
                  notes = CASE WHEN ?7 THEN ?8 ELSE notes END,
                  updated_at = ?9
                WHERE id = ?1`,
          params: [
            id,
            body.name ?? null,
            body.driverId !== undefined,
            body.driverId ?? null,
            body.days ?? null,
            body.isActive ?? null,
            body.notes !== undefined,
            body.notes || null,
            nowIso(),
          ],
        },
        ...(body.storeIds ? await stopStatements({ id }, body.storeIds) : []),
        bumpCatalogStatement(),
      ]);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(DUPLICATE);
      throw err;
    }
    res.json({ route: await getRoute(id) });
  });

  router.delete('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    const [deleted] = await db.batch([{ sql: 'DELETE FROM routes WHERE id = ?1', params: [id] }, bumpCatalogStatement()]);
    if (deleted.changes === 0) throw notFound('Route not found');
    res.json({ ok: true });
  });

  return router;
}
