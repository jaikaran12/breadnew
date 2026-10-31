import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { createPool, type Pool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { ensureInitialAdmin } from '../src/services/bootstrap.js';

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://bread:bread@localhost:5432/bread_test';
export const ADMIN = { username: 'owner', password: 'owner-pass-123' };

export interface TestContext {
  config: Config;
  pool: Pool;
  app: Express;
}

/** Fresh empty database + app for a test file. */
export async function setupTestApp(overrides: Record<string, string> = {}): Promise<TestContext> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DB_URL,
    JWT_SECRET: 'test-secret-test-secret-test-secret-123',
    APP_TIMEZONE: 'Asia/Kolkata',
    LOGIN_RATE_LIMIT: '1000',
    ADMIN_USERNAME: ADMIN.username,
    ADMIN_PASSWORD: ADMIN.password,
    PUBLIC_DIR: '/nonexistent-public-dir',
    ...overrides,
  });
  const pool = createPool(config);
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await migrate(pool, () => undefined);
  await ensureInitialAdmin(pool, config, () => undefined);
  return { config, pool, app: createApp(config, pool) };
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
