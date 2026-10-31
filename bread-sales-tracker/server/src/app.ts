import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import type { Config } from './config.js';
import type { Pool } from './db.js';
import { errorHandler, notFound } from './errors.js';
import { driverRouter } from './routes/driver.js';
import { adminRouter } from './routes/admin/index.js';

function serveSpa(app: Express, mountPath: string, dir: string): boolean {
  const indexFile = path.join(dir, 'index.html');
  if (!fs.existsSync(indexFile)) return false;
  app.use(
    mountPath,
    express.static(dir, {
      index: false,
      setHeaders(res, filePath) {
        // Vite puts content hashes in asset file names, so they can be cached forever.
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );
  const sendIndex: express.RequestHandler = (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexFile);
  };
  const base = mountPath === '/' ? '' : mountPath;
  app.get(`${base}/{*rest}`, (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    // Missing asset files should be a real 404, not the app page.
    if (/\.[a-z0-9]{2,5}$/i.test(req.path)) return next();
    sendIndex(req, res, next);
  });
  if (base) app.get(base, (_req, res) => res.redirect(`${base}/`));
  return true;
}

export function createApp(config: Config, pool: Pool): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          // The site may also be used over plain http on a local network.
          upgradeInsecureRequests: null,
          'img-src': ["'self'", 'data:', 'blob:'],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '3mb' }));
  app.use(cookieParser());

  if (config.logRequests) {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        if (req.originalUrl.startsWith('/api/')) {
          console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
        }
      });
      next();
    });
  }

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.loginRateLimit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many login attempts from this network. Please wait 15 minutes.', code: 'rate_limited' },
  });

  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, time: new Date().toISOString() });
    } catch {
      res.status(503).json({ ok: false, error: 'database unavailable' });
    }
  });

  app.use('/api/driver', driverRouter(config, pool, loginLimiter));
  app.use('/api/admin', adminRouter(config, pool, loginLimiter));
  app.use('/api', (_req, _res) => {
    throw notFound();
  });

  // Built web apps (present in the Docker image / after `npm run build` in the web folders).
  serveSpa(app, '/driver', path.join(config.publicDir, 'driver'));
  const hasAdmin = serveSpa(app, '/', path.join(config.publicDir, 'admin'));
  if (!hasAdmin) {
    app.get('/', (_req, res) => {
      res
        .type('text')
        .send('Bread Sales API is running. Build the admin website (admin-web) to use it from this address.');
    });
  }

  app.use(errorHandler);
  return app;
}
