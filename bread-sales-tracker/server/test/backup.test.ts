import { gunzipSync } from 'node:zlib';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/migrate.js';
import { restoreBackup, type BackupFile } from '../src/services/backup.js';
import { seedBasics, setupTestApp, uuid, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await setupTestApp();
});

afterAll(async () => {
  await ctx.pool.end();
});

async function fingerprint() {
  const { rows } = await ctx.pool.query(`
    SELECT (SELECT count(*) FROM sales) AS sales, (SELECT coalesce(sum(total_paise), 0) FROM sales) AS total,
           (SELECT count(*) FROM sale_items) AS items, (SELECT count(*) FROM stores) AS stores,
           (SELECT count(*) FROM drivers) AS drivers, (SELECT count(*) FROM product_price_history) AS history,
           (SELECT count(*) FROM settlements) AS settlements, (SELECT string_agg(name, ',' ORDER BY id) FROM products) AS products`);
  return rows[0];
}

describe('Android wrapper app link', () => {
  it('serves assetlinks.json only when a fingerprint is configured', async () => {
    await request(ctx.app).get('/.well-known/assetlinks.json').expect(404);
    const fp = Array.from({ length: 32 }, (_, i) => (i * 7).toString(16).padStart(2, '0')).join(':');
    const other = await setupTestApp({ ANDROID_CERT_SHA256: `${fp.toLowerCase()}, not-a-fingerprint` });
    const res = await request(other.app).get('/.well-known/assetlinks.json').expect(200);
    expect(res.body).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: 'com.breadsales.driver', sha256_cert_fingerprints: [fp.toUpperCase()] },
      },
    ]);
    await other.pool.end();
  });
});

describe('health endpoints', () => {
  it('/api/ping answers without the database', async () => {
    const res = await request(ctx.app).get('/api/ping').expect(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('backup and restore', () => {
  it('downloads a backup that restores to identical data', async () => {
    const s = await seedBasics(ctx.app);
    const auth = { Authorization: `Bearer ${s.token}` };
    for (const mode of ['cash', 'upi', 'credit']) {
      await request(ctx.app)
        .post('/api/driver/sales')
        .set(auth)
        .send({
          clientId: uuid(),
          storeId: s.store.id,
          paymentMode: mode,
          items: [{ productId: s.brown.id, quantity: 3, unitPricePaise: 4250 }],
          totalPaise: 12750,
        })
        .expect(201);
    }
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    await s.admin.put('/api/admin/tally').send({ driverId: s.driver.id, date: today, cashReceivedPaise: 12750 }).expect(200);
    await s.admin.put(`/api/admin/products/${s.milk.id}`).send({ pricePaise: 4500 }).expect(200);
    const before = await fingerprint();

    const me1 = await s.admin.get('/api/admin/me').expect(200);
    expect(me1.body.lastBackupAt).toBeNull();

    const res = await s.admin
      .get('/api/admin/backup')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-disposition']).toMatch(/bread-sales-backup-.*\.json\.gz/);
    const backup = JSON.parse(gunzipSync(res.body as Buffer).toString('utf8')) as BackupFile;
    expect(backup.format).toBe('bread-sales-backup');
    expect(backup.migration).toBe('001_init.sql');
    expect(backup.tables.sales).toHaveLength(3);
    expect(backup.tables.sale_items).toHaveLength(3);

    const me2 = await s.admin.get('/api/admin/me').expect(200);
    expect(me2.body.lastBackupAt).toBeTruthy();

    // Refuses to overwrite a database that has data, unless asked to replace it
    await expect(restoreBackup(ctx.pool, backup, { replace: false })).rejects.toThrow(/already has data/);

    // Disaster: everything is gone. Fresh empty database, then restore.
    await ctx.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(ctx.pool, () => undefined);
    const counts = await restoreBackup(ctx.pool, backup, { replace: false });
    expect(counts.sales).toBe(3);
    expect(await fingerprint()).toEqual(before);

    // Logins and new bills keep working after the restore (ids continue after the restored ones)
    const login = await request(ctx.app).post('/api/driver/login').send({ phone: '9000000001', pin: '1234' }).expect(200);
    const sale = await request(ctx.app)
      .post('/api/driver/sales')
      .set({ Authorization: `Bearer ${login.body.token}` })
      .send({
        clientId: uuid(),
        storeId: s.store.id,
        paymentMode: 'cash',
        items: [{ productId: s.milk.id, quantity: 1, unitPricePaise: 4500 }],
        totalPaise: 4500,
      })
      .expect(201);
    expect(sale.body.sale.id).toBeGreaterThan(Math.max(...backup.tables.sales.map((x) => Number(x.id))));
    const admin = request.agent(ctx.app);
    await admin.post('/api/admin/login').send({ username: 'owner', password: 'owner-pass-123' }).expect(200);

    // Replace mode wipes the current data first
    const again = await restoreBackup(ctx.pool, backup, { replace: true });
    expect(again.sales).toBe(3);
    expect(await fingerprint()).toEqual(before);
  });

  it('rejects files that are not backups', async () => {
    await expect(restoreBackup(ctx.pool, { hello: 1 } as unknown as BackupFile, { replace: true })).rejects.toThrow(
      /not a Bread Sales backup/,
    );
  });
});
