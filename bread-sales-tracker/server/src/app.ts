import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { errorHandler, notFound } from './errors.js';
import { rateLimit } from './auth.js';
import { driverRouter } from './routes/driver.js';
import { adminRouter } from './routes/admin/index.js';
import { ensureInitialAdmin } from './services/bootstrap.js';

function exists(file: string): boolean {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

/** Serves a built web app folder (only when running with Node; on Cloudflare the files are served as static assets). */
function serveSpa(app: Express, mountPath: string, dir: string): boolean {
  const indexFile = path.join(dir, 'index.html');
  if (!exists(indexFile)) return false;
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
  const base = mountPath === '/' ? '' : mountPath;
  app.get(`${base}/{*rest}`, (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    if (/\.[a-z0-9]{2,5}$/i.test(req.path)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexFile);
  });
  if (base) app.get(base, (_req, res) => res.redirect(`${base}/`));
  return true;
}

export function assetLinks(config: Config) {
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: config.androidAppId,
        sha256_cert_fingerprints: config.androidCertFingerprints,
      },
    },
  ];
}

export function createApp(config: Config, db: Db): Express {
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

  // Creates the first admin account (from ADMIN_USERNAME / ADMIN_PASSWORD) on the first request.
  let ready: Promise<void> | null = null;
  app.use('/api', async (_req, _res, next) => {
    ready ??= ensureInitialAdmin(db, config).catch((err) => {
      ready = null;
      throw err;
    });
    await ready;
    next();
  });

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.loginRateLimit,
    message: 'Too many login attempts from this network. Please wait 15 minutes.',
  });

  // Digital Asset Links: tells Chrome that the Android wrapper app (signed with these keys) belongs to
  // this website, so it can show the driver app full screen without a browser address bar.
  app.get('/.well-known/assetlinks.json', (_req, res) => {
    if (config.androidCertFingerprints.length === 0) {
      res.status(404).json({ error: 'ANDROID_CERT_SHA256 is not set' });
      return;
    }
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(assetLinks(config));
  });

  // For health checks: answers without touching the database.
  app.get('/api/ping', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/health', async (_req, res) => {
    try {
      await db.first('SELECT 1 AS ok');
      res.json({ ok: true, time: new Date().toISOString() });
    } catch {
      res.status(503).json({ ok: false, error: 'database unavailable' });
    }
  });

  app.use('/api/driver', driverRouter(config, db, loginLimiter));
  app.use('/api/admin', adminRouter(config, db, loginLimiter));
  app.use('/api', (_req, _res) => {
    throw notFound();
  });

  // Built web apps, when running with Node (on Cloudflare they are static assets).
  serveSpa(app, '/driver', path.join(config.publicDir, 'driver'));
  const hasAdmin = serveSpa(app, '/', path.join(config.publicDir, 'admin'));
  if (!hasAdmin) {
    app.get('/', (_req, res) => {
      res.type('text').send('Bread Sales API is running. Build the admin website (admin-web) to use it from this address.');
    });
  }

  app.use(errorHandler);
  return app;
}
