import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../../config.js';
import type { Db } from '../../db.js';
import { routeCheck } from '../../services/routeCheck.js';
import { parseDateParam, todayInZone } from '../../util/dates.js';
import { cleanQuery } from './helpers.js';

/** Route check: each driver's planned shops against where their bills and "no bills" were actually made. */
export function routeCheckRouter(config: Config, db: Db): Router {
  const router = Router();
  router.get('/', async (req, res) => {
    const q = z.object({ driverId: z.coerce.number().int().positive().optional() }).parse(cleanQuery(req.query));
    const date = parseDateParam(req.query.date, todayInZone(config.appTimezone));
    res.json(await routeCheck(db, config, date, q.driverId ?? null));
  });
  return router;
}
