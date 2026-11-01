import request from 'supertest';
import express, { type Express } from 'express';
import { createApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import type { Db, Statement } from '../src/db.js';
import { openSqliteDb } from '../src/db-sqlite.js';
import { migrate } from '../src/migrate.js';
import { ensureInitialAdmin } from '../src/services/bootstrap.js';

export const ADMIN = { username: 'owner', password: 'owner-pass-123' };

/**
 * Cloudflare D1 limits the app must stay under: at most 100 values bound to one statement, and a limited
 * number of queries per request (we aim for far fewer than 50). The tests record the largest values seen.
 */
export const D1_MAX_PARAMS = 100;
export const QUERY_BUDGET_PER_REQUEST = 25;
export const usage = { maxParams: 0, maxQueriesPerRequest: 0, worstRequest: '' };

export interface TestContext {
  config: Config;
  db: Db;
  app: Express;
  close(): void;
}

/** Wraps the database to count statements per HTTP request and check the bound-value limit. */
function measured(db: Db, counter: { n: number }): Db {
  const check = (s: Statement) => {
    counter.n++;
    const n = s.params?.length ?? 0;
    if (n > D1_MAX_PARAMS) throw new Error(`Statement binds ${n} values (D1 allows ${D1_MAX_PARAMS}): ${s.sql.slice(0, 80)}`);
    usage.maxParams = Math.max(usage.maxParams, n);
  };
  return {
    all: (sql, params) => (check({ sql, params }), db.all(sql, params)),
    first: (sql, params) => (check({ sql, params }), db.first(sql, params)),
    run: (sql, params) => (check({ sql, params }), db.run(sql, params)),
    batch: (statements) => (statements.forEach(check), db.batch(statements)),
    exec: (sql) => db.exec(sql),
  } as Db;
}

/** Fresh empty in-memory database + app for a test file. */
export async function setupTestApp(overrides: Record<string, string> = {}): Promise<TestContext> {
  const config = loadConfig({
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-test-secret-test-secret-123',
    APP_TIMEZONE: 'Asia/Kolkata',
    LOGIN_RATE_LIMIT: '1000',
    ADMIN_USERNAME: ADMIN.username,
    ADMIN_PASSWORD: ADMIN.password,
    PUBLIC_DIR: '/nonexistent-public-dir',
    ...overrides,
  });
  const sqlite = openSqliteDb(':memory:');
  await migrate(sqlite, () => undefined);
  await ensureInitialAdmin(sqlite, config, () => undefined);
  const counter = { n: 0 };
  const inner = createApp(config, measured(sqlite, counter));
  const app = express();
  app.use((req, res, next) => {
    counter.n = 0;
    res.on('finish', () => {
      if (counter.n > usage.maxQueriesPerRequest) {
        usage.maxQueriesPerRequest = counter.n;
        usage.worstRequest = `${req.method} ${req.originalUrl}`;
      }
    });
    next();
  });
  app.use(inner);
  return { config, db: sqlite, app, close: () => sqlite.close() };
}

export async function loginAdmin(app: Express) {
  const agent = request.agent(app);
  await agent.post('/api/admin/login').send(ADMIN).expect(200);
  return agent;
}

export function uuid(): string {
  return crypto.randomUUID();
}

/** Creates an area, shops, products and a driver through the admin API. */
export async function seedBasics(app: Express) {
  const admin = await loginAdmin(app);
  const area = (await admin.post('/api/admin/areas').send({ name: 'Gandhi Nagar' }).expect(201)).body.area;
  const area2 = (await admin.post('/api/admin/areas').send({ name: 'Station Road' }).expect(201)).body.area;
  const store = (
    await admin.post('/api/admin/stores').send({ areaId: area.id, name: 'Sharma Kirana', phone: '+91 98765 43210' }).expect(201)
  ).body.store;
  const store2 = (await admin.post('/api/admin/stores').send({ areaId: area2.id, name: 'Gupta General Store' }).expect(201))
    .body.store;
  const milk = (await admin.post('/api/admin/products').send({ name: 'Milk Bread', pricePaise: 4000 }).expect(201)).body
    .product;
  const brown = (
    await admin.post('/api/admin/products').send({ name: 'Brown Bread', localName: 'ब्राउन ब्रेड', pricePaise: 4250 }).expect(201)
  ).body.product;
  const pav = (await admin.post('/api/admin/products').send({ name: 'Pav (6 pcs)', pricePaise: 2500 }).expect(201)).body
    .product;
  const driver = (
    await admin.post('/api/admin/drivers').send({ name: 'Ramesh', phone: '9000000001', pin: '1234' }).expect(201)
  ).body.driver;
  const login = await request(app).post('/api/driver/login').send({ phone: '9000000001', pin: '1234' }).expect(200);
  return { admin, area, area2, store, store2, milk, brown, pav, driver, token: login.body.token as string };
}
