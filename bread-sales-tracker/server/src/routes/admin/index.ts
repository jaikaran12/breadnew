import { Router } from 'express';
import type { RateLimitRequestHandler } from 'express-rate-limit';
import type { Config } from '../../config.js';
import type { Pool } from '../../db.js';
import { notFound } from '../../errors.js';
import { requireAdmin, sameOriginOnly } from '../../auth.js';
import { adminAccountRouter, adminPublicRouter } from './account.js';
import { areasRouter } from './areas.js';
import { dashboardRouter } from './dashboard.js';
import { driversRouter } from './drivers.js';
import { productsRouter } from './products.js';
import { reportsRouter } from './reports.js';
import { salesRouter } from './sales.js';
import { storesRouter } from './stores.js';
import { tallyRouter } from './tally.js';

export function adminRouter(config: Config, pool: Pool, loginLimiter: RateLimitRequestHandler): Router {
  const router = Router();
  router.use(sameOriginOnly);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use(adminPublicRouter(config, pool, loginLimiter));
  router.use(requireAdmin(config, pool));
  router.use(adminAccountRouter(config, pool));
  router.use('/dashboard', dashboardRouter(config, pool));
  router.use('/sales', salesRouter(config, pool));
  router.use('/reports', reportsRouter(config, pool));
  router.use('/tally', tallyRouter(config, pool));
  router.use('/areas', areasRouter(pool));
  router.use('/stores', storesRouter(config, pool));
  router.use('/products', productsRouter(pool));
  router.use('/drivers', driversRouter(config, pool));
  router.use((_req, _res) => {
    throw notFound();
  });
  return router;
}
