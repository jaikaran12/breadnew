import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openSqliteDb } from '../src/db-sqlite.js';
import { migrate, MIGRATIONS_DIR } from '../src/migrate.js';
import { restoreBackup, type BackupFile } from '../src/services/backup.js';

/** A database exactly as the first version left it (only 0001 applied), with a few bills. */
async function oldDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bread-mig-'));
  fs.copyFileSync(path.join(MIGRATIONS_DIR, '0001_init.sql'), path.join(dir, '0001_init.sql'));
  const db = openSqliteDb(':memory:');
  await migrate(db, () => undefined, dir);
  await db.exec(`
    INSERT INTO areas (id, name) VALUES (1, 'Gandhi Nagar');
    INSERT INTO stores (id, area_id, name) VALUES (1, 1, 'Sharma Kirana'), (2, 1, 'Gupta Store');
    INSERT INTO products (id, name, price_paise) VALUES (1, 'Milk Bread', 4000), (2, 'Pav', 2500);
    INSERT INTO drivers (id, name, phone, pin_hash) VALUES (1, 'Ramesh', '9000000001', 'x');
    INSERT INTO sales (id, client_id, driver_id, store_id, area_id, sold_at, sale_date, payment_mode, total_paise, total_quantity, status)
      VALUES (1, 'a', 1, 1, 1, '2026-11-01T04:00:00.000Z', '2026-11-01', 'cash', 13000, 4, 'completed'),
             (2, 'b', 1, 2, 1, '2026-11-01T05:00:00.000Z', '2026-11-01', 'upi', 2500, 1, 'cancelled');
    INSERT INTO sale_items (id, sale_id, product_id, product_name, unit_price_paise, list_price_paise, quantity, line_total_paise)
      VALUES (1, 1, 1, 'Milk Bread', 4000, 4000, 2, 8000), (2, 1, 2, 'Pav', 2500, 2500, 2, 5000), (3, 2, 2, 'Pav', 2500, 2500, 1, 2500);
    INSERT INTO settlements (driver_id, settle_date, expected_cash_paise, cash_received_paise) VALUES (1, '2026-11-01', 13000, 13000);
  `);
  fs.rmSync(dir, { recursive: true, force: true });
  return db;
}

describe('database upgrade 0002 (discounts and returns)', () => {
  it('keeps every bill and line exactly', async () => {
    const db = await oldDatabase();
    const snapshot = () =>
      db.all(`SELECT s.id, s.client_id, s.total_paise, s.total_quantity, s.status, si.id AS item, si.product_id,
                     si.quantity, si.unit_price_paise, si.line_total_paise
                FROM sales s JOIN sale_items si ON si.sale_id = s.id ORDER BY si.id`);
    const before = await snapshot();
    expect(await migrate(db, () => undefined)).toEqual(['0002_discounts_returns.sql']);
    expect(await snapshot()).toEqual(before);
    expect(await db.all('PRAGMA foreign_key_check')).toEqual([]);
    expect(await db.first('PRAGMA integrity_check')).toEqual({ integrity_check: 'ok' });
    expect(await db.first(`SELECT count(*) AS n FROM sqlite_master WHERE name LIKE '%\\_old' ESCAPE '\\' OR name LIKE '%\\_new' ESCAPE '\\'`)).toEqual({ n: 0 });
    const migrated = await db.first('SELECT discount_paise, returned_quantity FROM sales WHERE id = 1');
    expect(migrated).toEqual({ discount_paise: 0, returned_quantity: 0 });

    // New bills continue after the old ids; deleting a bill still removes its lines and returns.
    await db.run(`INSERT INTO sales (client_id, driver_id, store_id, area_id, sold_at, sale_date, payment_mode, total_paise,
                                     total_quantity, returned_quantity)
                  VALUES ('c', 1, 1, 1, '2026-11-02T04:00:00.000Z', '2026-11-02', 'cash', 0, 0, 2)`);
    const id = (await db.first<{ id: number }>(`SELECT id FROM sales WHERE client_id = 'c'`))!.id;
    expect(id).toBe(3);
    await db.run(`INSERT INTO sale_returns (sale_id, product_id, product_name, quantity, unit_price_paise) VALUES (?1, 1, 'Milk Bread', 2, 4000)`, [id]);
    await db.run('DELETE FROM sales WHERE id = 1');
    expect(await db.first('SELECT count(*) AS n FROM sale_items WHERE sale_id = 1')).toEqual({ n: 0 });
    await db.run('DELETE FROM sales WHERE id = ?1', [id]);
    expect(await db.first('SELECT count(*) AS n FROM sale_returns')).toEqual({ n: 0 });
    db.close();
  });

  it('restores a backup made by the first version into the new tables', async () => {
    const old = await oldDatabase();
    // The first version backed up these tables only.
    const tables: BackupFile['tables'] = {};
    for (const t of ['app_settings', 'admins', 'areas', 'drivers', 'stores', 'products', 'product_price_history', 'sales', 'sale_items', 'settlements']) {
      tables[t] = await old.all(`SELECT * FROM ${t}`);
    }
    const backup: BackupFile = { format: 'bread-sales-backup', version: 1, createdAt: new Date().toISOString(), migration: '0001_init.sql', tables };
    old.close();
    const db = openSqliteDb(':memory:');
    await migrate(db, () => undefined);
    const counts = await restoreBackup(db, backup, { replace: true });
    expect(counts).toMatchObject({ sales: 2, sale_items: 3, settlements: 1 });
    expect(await db.first('SELECT sum(line_total_paise) AS t, sum(discount_paise) AS d FROM sale_items')).toEqual({ t: 15500, d: 0 });
    db.close();
  });
});
