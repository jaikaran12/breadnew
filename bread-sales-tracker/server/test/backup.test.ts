import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db, Row } from '../src/db.js';
import { openSqliteDb } from '../src/db-sqlite.js';
import { migrate } from '../src/migrate.js';
import { BACKUP_PAGE_SIZE, backupToSql, buildBackup, restoreBackup, type BackupFile } from '../src/services/backup.js';
import { seedBasics, setupTestApp, uuid, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await setupTestApp();
});

afterAll(() => {
  ctx.close();
});

async function fingerprint(db: Db) {
  return db.first(`
    SELECT (SELECT count(*) FROM sales) AS sales, (SELECT coalesce(sum(total_paise), 0) FROM sales) AS total,
           (SELECT count(*) FROM sale_items) AS items, (SELECT count(*) FROM stores) AS stores,
           (SELECT count(*) FROM drivers) AS drivers, (SELECT count(*) FROM product_price_history) AS history,
           (SELECT count(*) FROM settlements) AS settlements, (SELECT count(*) FROM admins) AS admins,
           (SELECT group_concat(name, ',') FROM (SELECT name FROM products ORDER BY id)) AS products,
           (SELECT group_concat(key || '=' || value, ',') FROM (SELECT key, value FROM app_settings ORDER BY key)) AS settings`);
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
    other.close();
  });
});

describe('health endpoints', () => {
  it('/api/ping answers without the database', async () => {
    const res = await request(ctx.app).get('/api/ping').expect(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('backup and restore', () => {
  it('downloads a backup piece by piece (like the website) that restores to identical data', async () => {
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
          items: [
            { productId: s.brown.id, quantity: 3, unitPricePaise: 4250 },
            { productId: s.pav.id, quantity: 1, unitPricePaise: 2500 },
          ],
          totalPaise: 15250,
        })
        .expect(201);
    }
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    await s.admin.put('/api/admin/tally').send({ driverId: s.driver.id, date: today, cashReceivedPaise: 15250 }).expect(200);
    await s.admin.put(`/api/admin/products/${s.milk.id}`).send({ pricePaise: 4500 }).expect(200);
    const before = await fingerprint(ctx.db);

    const me1 = await s.admin.get('/api/admin/me').expect(200);
    expect(me1.body.lastBackupAt).toBeNull();

    // What the website does: info, then every table in id ranges, then "done".
    const info = (await s.admin.get('/api/admin/backup/info').expect(200)).body;
    expect(info.format).toBe('bread-sales-backup');
    expect(info.migration).toBe('0002_discounts_returns.sql');
    expect(info.lastIds.sales).toBe(3);
    expect(info.lastIds.sale_items).toBe(6);
    const tables: Record<string, Row[]> = {};
    for (const table of info.tables as string[]) {
      tables[table] = [];
      const last = table === 'app_settings' ? 0 : info.lastIds[table];
      for (let after = 0; table === 'app_settings' ? after === 0 : after < last; after += 2) {
        const upto = Math.min(after + 2, last); // tiny ranges to exercise paging
        const page = await s.admin.get(`/api/admin/backup/table/${table}`).query({ after, upto }).expect(200);
        tables[table].push(...page.body.rows);
        if (table === 'app_settings') break;
      }
    }
    await s.admin.get('/api/admin/backup/table/admins').query({ after: 0, upto: BACKUP_PAGE_SIZE + 1 }).expect(400);
    await s.admin.get('/api/admin/backup/table/sqlite_master').expect(404);
    const done = await s.admin.post('/api/admin/backup/done').expect(200);
    const me2 = await s.admin.get('/api/admin/me').expect(200);
    expect(me2.body.lastBackupAt).toBe(done.body.lastBackupAt);

    const backup: BackupFile = { format: info.format, version: 1, createdAt: info.createdAt, migration: info.migration, tables };
    expect(backup.tables.sales).toHaveLength(3);
    expect(backup.tables.sale_items).toHaveLength(6);
    const full = await buildBackup(ctx.db); // the same thing in one go (used by scripts)
    for (const table of Object.keys(full.tables)) if (table !== 'app_settings') expect(tables[table]).toEqual(full.tables[table]);

    // Refuses to overwrite a database that has data, unless asked to replace it
    await expect(restoreBackup(ctx.db, backup, { replace: false })).rejects.toThrow(/already has data/);

    // Disaster: everything is gone. Fresh empty database, then restore.
    const fresh = openSqliteDb(':memory:');
    await migrate(fresh, () => undefined);
    const counts = await restoreBackup(fresh, backup, { replace: false });
    expect(counts.sales).toBe(3);
    expect(await fingerprint(fresh)).toEqual(before);

    // The same backup as an SQL script (for Cloudflare: wrangler d1 execute --file) gives the same data.
    const viaSql = openSqliteDb(':memory:');
    await migrate(viaSql, () => undefined);
    await viaSql.exec(backupToSql(backup, { replace: true }));
    expect(await fingerprint(viaSql)).toEqual(before);
    viaSql.close();

    // Replace mode wipes the current data first; logins and new bills keep working afterwards.
    const again = await restoreBackup(ctx.db, backup, { replace: true });
    expect(again.sales).toBe(3);
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
    fresh.close();
  });

  it('rejects files that are not backups', async () => {
    await expect(restoreBackup(ctx.db, { hello: 1 } as unknown as BackupFile, { replace: true })).rejects.toThrow(
      /not a Bread Sales backup/,
    );
  });
});
