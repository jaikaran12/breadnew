import { Router, type RequestHandler } from 'express';
import type { Config } from '../../config.js';
import type { Db } from '../../db.js';
import { notFound } from '../../errors.js';
import { requireAdmin, sameOriginOnly } from '../../auth.js';
import { adminAccountRouter, adminPublicRouter } from './account.js';
import { areasRouter } from './areas.js';
import { dashboardRouter } from './dashboard.js';
import { discountsRouter, storeDiscountsRouter } from './discounts.js';
import { driversRouter } from './drivers.js';
import { productsRouter } from './products.js';
import { reportsRouter } from './reports.js';
import { salesRouter } from './sales.js';
import { storesRouter } from './stores.js';
import { tallyRouter } from './tally.js';

export function adminRouter(config: Config, db: Db, loginLimiter: RequestHandler): Router {
  const router = Router();
  router.use(sameOriginOnly);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use(adminPublicRouter(config, db, loginLimiter));
  router.use(requireAdmin(config, db));
  router.use(adminAccountRouter(config, db));
  router.use('/dashboard', dashboardRouter(config, db));
  router.use('/sales', salesRouter(config, db));
  router.use('/reports', reportsRouter(config, db));
  router.use('/tally', tallyRouter(config, db));
  router.use('/areas', areasRouter(db));
  router.use('/stores', storeDiscountsRouter(db));
  router.use('/stores', storesRouter(config, db));
  router.use('/discounts', discountsRouter(db));
  router.use('/products', productsRouter(db));
  router.use('/drivers', driversRouter(config, db));
  router.use((_req, _res) => {
    throw notFound();
  });
  return router;
}
