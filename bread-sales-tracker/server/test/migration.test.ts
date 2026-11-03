import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openSqliteDb } from '../src/db-sqlite.js';
import { migrate, MIGRATIONS_DIR } from '../src/migrate.js';
import { restoreBackup, type BackupFile } from '../src/services/backup.js';

/** A database with only the given migrations applied (as an older version of the app left it). */
async function databaseAt(files: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bread-mig-'));
  for (const f of files) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  const db = openSqliteDb(':memory:');
  await migrate(db, () => undefined, dir);
  fs.rmSync(dir, { recursive: true, force: true });
  return db;
}

/** A database exactly as the first version left it (only 0001 applied), with a few bills. */
async function oldDatabase() {
  const db = await databaseAt(['0001_init.sql']);
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
    expect(await migrate(db, () => undefined)).toEqual(['0002_discounts_returns.sql', '0003_returns_on_bill.sql']);
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

/** A database as the version with discounts and returns left it (0001 + 0002), with bills, discounts and returns. */
async function databaseWithReturns() {
  const db = await databaseAt(['0001_init.sql', '0002_discounts_returns.sql']);
  await db.exec(`
    INSERT INTO areas (id, name) VALUES (1, 'Gandhi Nagar');
    INSERT INTO stores (id, area_id, name) VALUES (1, 1, 'Sharma Kirana'), (2, 1, 'Gupta Store');
    INSERT INTO products (id, name, price_paise) VALUES (1, 'Milk Bread', 4000), (2, 'Pav', 2500);
    INSERT INTO drivers (id, name, phone, pin_hash) VALUES (1, 'Ramesh', '9000000001', 'x');
    INSERT INTO store_discounts (store_id, product_id, kind, value) VALUES (1, 1, 'percent', 500);
    INSERT INTO sales (id, client_id, driver_id, store_id, area_id, sold_at, sale_date, payment_mode, total_paise,
                       total_quantity, discount_paise, returned_quantity, status)
      VALUES (1, 'a', 1, 1, 1, '2026-11-02T04:00:00.000Z', '2026-11-02', 'cash', 12600, 4, 400, 3, 'completed'),
             (2, 'b', 1, 2, 1, '2026-11-02T05:00:00.000Z', '2026-11-02', 'cash', 0, 0, 0, 2, 'completed'),
             (3, 'c', 1, 2, 1, '2026-11-02T06:00:00.000Z', '2026-11-02', 'upi', 2500, 1, 0, 0, 'cancelled');
    INSERT INTO sale_items (id, sale_id, product_id, product_name, unit_price_paise, list_price_paise, quantity,
                            discount_kind, discount_value, discount_paise, list_discount_paise, line_total_paise)
      VALUES (1, 1, 1, 'Milk Bread', 4000, 4000, 2, 'percent', 500, 400, 400, 7600),
             (2, 1, 2, 'Pav', 2500, 2500, 2, NULL, NULL, 0, 0, 5000),
             (3, 3, 2, 'Pav', 2500, 2500, 1, NULL, NULL, 0, 0, 2500);
    INSERT INTO sale_returns (id, sale_id, product_id, product_name, quantity, unit_price_paise)
      VALUES (1, 1, 1, 'Milk Bread', 2, 4000), (2, 1, 2, 'Pav', 1, 2500), (3, 2, 1, 'Milk Bread', 2, 4000);
    INSERT INTO settlements (driver_id, settle_date, expected_cash_paise, cash_received_paise) VALUES (1, '2026-11-02', 12600, 12600);
  `);
  return db;
}

describe('database upgrade 0003 (returns on the bill)', () => {
  it('keeps every bill exactly; returns saved before cost nothing', async () => {
    const db = await databaseWithReturns();
    const snapshot = async () => ({
      sales: await db.all(`SELECT id, client_id, payment_mode, total_paise, total_quantity, discount_paise, returned_quantity, status
                             FROM sales ORDER BY id`),
      items: await db.all('SELECT * FROM sale_items ORDER BY id'),
      returns: await db.all('SELECT id, sale_id, product_id, product_name, quantity, unit_price_paise FROM sale_returns ORDER BY id'),
      other: await db.all('SELECT (SELECT count(*) FROM store_discounts) AS d, (SELECT count(*) FROM settlements) AS t'),
    });
    const before = await snapshot();
    expect(await migrate(db, () => undefined)).toEqual(['0003_returns_on_bill.sql']);
    expect(await snapshot()).toEqual(before);
    expect(await db.all('PRAGMA foreign_key_check')).toEqual([]);
    expect(await db.first('PRAGMA integrity_check')).toEqual({ integrity_check: 'ok' });
    expect(await db.first(`SELECT count(*) AS n FROM sqlite_master WHERE name LIKE '%\\_old' ESCAPE '\\' OR name LIKE '%\\_new' ESCAPE '\\'`)).toEqual({ n: 0 });
    // The old returns were swapped free of charge: nothing was taken off their bills.
    expect(await db.all('SELECT returned_paise FROM sales ORDER BY id')).toEqual([{ returned_paise: 0 }, { returned_paise: 0 }, { returned_paise: 0 }]);
    expect(await db.all('SELECT list_price_paise, discount_paise, credit_paise FROM sale_returns ORDER BY id')).toEqual([
      { list_price_paise: 4000, discount_paise: 0, credit_paise: 0 },
      { list_price_paise: 2500, discount_paise: 0, credit_paise: 0 },
      { list_price_paise: 4000, discount_paise: 0, credit_paise: 0 },
    ]);
    const indexes = (await db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name`)).map((r) => r.name);
    expect(indexes).toEqual(expect.arrayContaining(['sales_sale_date_idx', 'sales_driver_date_idx', 'sales_store_idx', 'sale_items_product_idx', 'sale_returns_product_idx']));

    // A new bill may now be below zero (the shop gets money back); what was given never is.
    await db.run(`INSERT INTO sales (client_id, driver_id, store_id, area_id, sold_at, sale_date, payment_mode, total_paise,
                                     total_quantity, returned_quantity, returned_paise)
                  VALUES ('d', 1, 1, 1, '2026-11-03T04:00:00.000Z', '2026-11-03', 'cash', -4000, 0, 1, 4000)`);
    const id = (await db.first<{ id: number }>(`SELECT id FROM sales WHERE client_id = 'd'`))!.id;
    expect(id).toBe(4);
    await db.run(`INSERT INTO sale_returns (sale_id, product_id, product_name, quantity, unit_price_paise, list_price_paise, credit_paise)
                  VALUES (?1, 1, 'Milk Bread', 1, 4000, 4000, 4000)`, [id]);
    await expect(
      db.run(`INSERT INTO sales (client_id, driver_id, store_id, area_id, sold_at, sale_date, payment_mode, total_paise,
                                 total_quantity, returned_quantity, returned_paise)
              VALUES ('e', 1, 1, 1, '2026-11-03T04:00:00.000Z', '2026-11-03', 'cash', -5000, 0, 1, 4000)`),
    ).rejects.toThrow(/CHECK/);
    await expect(
      db.run(`INSERT INTO sale_returns (sale_id, product_id, product_name, quantity, unit_price_paise, credit_paise)
              VALUES (?1, 2, 'Pav', 1, 2500, 2000)`, [id]),
    ).rejects.toThrow(/CHECK/);
    // Deleting a bill still removes its lines and returns.
    await db.run('DELETE FROM sales WHERE id IN (1, ?1)', [id]);
    expect(await db.first('SELECT count(*) AS n FROM sale_items WHERE sale_id = 1')).toEqual({ n: 0 });
    expect(await db.first('SELECT count(*) AS n FROM sale_returns WHERE sale_id IN (1, ?1)', [id])).toEqual({ n: 0 });
    db.close();
  });

  it('restores a backup made before this change into the new tables', async () => {
    const old = await databaseWithReturns();
    const tables: BackupFile['tables'] = {};
    for (const t of ['app_settings', 'admins', 'areas', 'drivers', 'stores', 'products', 'product_price_history', 'store_discounts', 'sales', 'sale_items', 'sale_returns', 'settlements']) {
      tables[t] = await old.all(`SELECT * FROM ${t}`);
    }
    const backup: BackupFile = { format: 'bread-sales-backup', version: 1, createdAt: new Date().toISOString(), migration: '0002_discounts_returns.sql', tables };
    old.close();
    const db = openSqliteDb(':memory:');
    await migrate(db, () => undefined);
    const counts = await restoreBackup(db, backup, { replace: true });
    expect(counts).toMatchObject({ sales: 3, sale_items: 3, sale_returns: 3, store_discounts: 1, settlements: 1 });
    expect(await db.first('SELECT sum(total_paise) AS t, sum(returned_paise) AS r FROM sales')).toEqual({ t: 15100, r: 0 });
    expect(await db.first('SELECT sum(quantity) AS q, sum(credit_paise) AS c FROM sale_returns')).toEqual({ q: 5, c: 0 });
    db.close();
  });
});
