/**
 * Fills an EMPTY database with demo data so you can try the apps:
 *   npm run seed:demo                       (the SQLite file in DATABASE_PATH)
 *   npm run seed:demo -- --sql demo.sql     (writes SQL instead, e.g. for a test copy on Cloudflare:
 *                                            npx wrangler d1 execute bread-sales --local --file demo.sql)
 *
 * Demo driver logins: phone 9000000001 … 9000000004, PIN 1234.
 * Refuses to run when the database already has products, shops or bills.
 */
import crypto from 'node:crypto';
import { loadConfig } from '../config.js';
import fs from 'node:fs/promises';
import type { Db, Statement } from '../db.js';
import { openSqliteDb } from '../db-sqlite.js';
import { hashSecret } from '../auth.js';
import { migrate } from '../migrate.js';
import { backupToSql, buildBackup } from '../services/backup.js';
import { ensureInitialAdmin } from '../services/bootstrap.js';
import { updateSettings } from '../services/settings.js';
import { addDays, todayInZone } from '../util/dates.js';

const PRODUCTS: Array<[string, string, number, string]> = [
  ['Milk Bread 400g', 'मिल्क ब्रेड', 4000, '#F4C27A'],
  ['Milk Bread 800g', 'मिल्क ब्रेड बड़ा', 7500, '#E8A33D'],
  ['Brown Bread', 'ब्राउन ब्रेड', 5000, '#8B5A2B'],
  ['Whole Wheat Bread', 'आटा ब्रेड', 5500, '#A0522D'],
  ['Multigrain Bread', 'मल्टीग्रेन ब्रेड', 6000, '#6B8E23'],
  ['Sandwich Bread', 'सैंडविच ब्रेड', 6500, '#D2B48C'],
  ['Pav 6 pcs', 'पाव 6', 3000, '#E07A5F'],
  ['Pav 12 pcs', 'पाव 12', 5500, '#C0392B'],
  ['Burger Bun 4 pcs', 'बर्गर बन', 4000, '#D35400'],
  ['Hot Dog Bun 4 pcs', 'हॉट डॉग बन', 4000, '#B9770E'],
  ['Fruit Bun', 'फ्रूट बन', 1500, '#8E44AD'],
  ['Sweet Bun', 'मीठा बन', 1000, '#E84393'],
  ['Rusk 200g', 'रस्क', 3500, '#7E5109'],
  ['Toast 300g', 'टोस्ट', 4500, '#CA6F1E'],
  ['Pizza Base 2 pcs', 'पिज़्ज़ा बेस', 4500, '#27AE60'],
  ['Garlic Bread', 'गार्लिक ब्रेड', 7000, '#16A085'],
  ['Cream Roll', 'क्रीम रोल', 2000, '#2E86C1'],
];

const AREAS = ['Gandhi Nagar', 'Station Road', 'Civil Lines', 'Shastri Nagar', 'Nehru Colony', 'Old City', 'Railway Colony', 'Industrial Area'];

const SHOP_NAMES = [
  'Sharma Kirana', 'Gupta General Store', 'Jai Hind Provision', 'Balaji Kirana', 'Shree Ganesh Stores',
  'Laxmi Traders', 'New Krishna Kirana', 'Agarwal Stores', 'Maa Durga Kirana', 'Om Sai Provision',
  'Patel Super Mart', 'Jain Kirana', 'Royal Stores', 'Annapurna Kirana', 'Sai Baba Stores',
  'Mahadev Kirana', 'Verma General Store', 'Bharat Provision', 'Lucky Stores', 'Saraswati Kirana',
];
const OWNERS = ['Ramesh ji', 'Sunil', 'Mukesh', 'Anil', 'Vijay', 'Rajesh', 'Deepak', 'Santosh', 'Pooja', 'Kavita'];
const LANDMARKS = ['near temple', 'main road', 'opp. school', 'near bus stand', 'market lane', 'corner shop'];

const DRIVERS: Array<[string, string, string]> = [
  ['Ramesh Kumar', '9000000001', 'MH 12 AB 1234'],
  ['Suresh Yadav', '9000000002', 'MH 12 CD 5678'],
  ['Mahesh Patil', '9000000003', 'MH 12 EF 9012'],
  ['Raju Shaikh', '9000000004', 'MH 12 GH 3456'],
];

// Small deterministic random generator so every run creates the same demo data.
let seed = 20240601;
function rand(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
const pick = <T,>(list: T[]): T => list[Math.floor(rand() * list.length)];

async function addDemoData(db: Db, timeZone: string) {
  await updateSettings(db, { businessName: 'Sunrise Bakery', billFooter: 'Thank you! Fresh bread every morning.' });
  const pinHash = await hashSecret('1234');

  const setup: Statement[] = [];
  for (const [i, [name, localName, price, color]] of PRODUCTS.entries()) {
    setup.push({
      sql: `INSERT OR IGNORE INTO products (name, local_name, price_paise, color, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)`,
      params: [name, localName, price, color, i + 1],
    });
    setup.push({
      sql: `INSERT INTO product_price_history (product_id, new_price_paise) SELECT id, ?2 FROM products WHERE name = ?1`,
      params: [name, price],
    });
  }
  for (const [i, area] of AREAS.entries()) {
    setup.push({ sql: `INSERT OR IGNORE INTO areas (name, sort_order) VALUES (?1, ?2)`, params: [area, i + 1] });
    const shopCount = 6 + Math.floor(rand() * 6);
    const used = new Set<string>();
    for (let j = 0; j < shopCount; j++) {
      let shop = pick(SHOP_NAMES);
      if (used.has(shop)) shop = `${shop} (${pick(LANDMARKS)})`;
      if (used.has(shop)) continue;
      used.add(shop);
      const phone = `9${Math.floor(100000000 + rand() * 899999999)}`;
      setup.push({
        sql: `INSERT OR IGNORE INTO stores (area_id, name, owner_name, phone, address)
              SELECT id, ?2, ?3, ?4, ?5 FROM areas WHERE name = ?1`,
        params: [area, shop, pick(OWNERS), phone, `${area}, ${pick(LANDMARKS)}`],
      });
    }
  }
  for (const [name, phone, vehicle] of DRIVERS) {
    setup.push({
      sql: `INSERT OR IGNORE INTO drivers (name, phone, pin_hash, vehicle_number) VALUES (?1, ?2, ?3, ?4)`,
      params: [name, phone, pinHash, vehicle],
    });
  }
  await db.batch(setup);

  // Two weeks of bills. Each driver covers two areas.
  const products = await db.all<{ id: number; name: string; price: number }>(
    'SELECT id, name, price_paise AS price FROM products ORDER BY sort_order',
  );
  const stores = await db.all<{ id: number; areaId: number }>('SELECT id, area_id AS "areaId" FROM stores');
  const drivers = await db.all<{ id: number }>('SELECT id FROM drivers ORDER BY id');
  const areaIds = [...new Set(stores.map((s) => s.areaId))].sort((a, b) => a - b);
  const today = todayInZone(timeZone);
  const sales: Statement[] = [];
  for (let dayOffset = 13; dayOffset >= 0; dayOffset--) {
    const date = addDays(today, -dayOffset);
    for (const [di, driver] of drivers.entries()) {
      const myAreas = areaIds.filter((_, i) => i % drivers.length === di);
      const myStores = stores.filter((s) => myAreas.includes(s.areaId));
      // Today the round is still in progress: only the morning part.
      const visitShare = dayOffset === 0 ? 0.45 : 0.85;
      let minute = 6 * 60 + 30 + Math.floor(rand() * 20);
      for (const store of myStores) {
        if (rand() > visitShare) continue;
        minute += 4 + Math.floor(rand() * 12);
        const lineCount = 2 + Math.floor(rand() * 5);
        const chosen = new Map<number, { id: number; name: string; price: number; qty: number }>();
        for (let k = 0; k < lineCount; k++) {
          const p = products[Math.floor(Math.pow(rand(), 1.6) * products.length)];
          const qty = 1 + Math.floor(rand() * (p.price < 2000 ? 12 : 6));
          chosen.set(p.id, { ...p, qty });
        }
        const lines = [...chosen.values()];
        const total = lines.reduce((acc, l) => acc + l.qty * l.price, 0);
        const qty = lines.reduce((acc, l) => acc + l.qty, 0);
        const r = rand();
        const mode = r < 0.72 ? 'cash' : r < 0.92 ? 'upi' : 'credit';
        const hh = String(Math.floor(minute / 60)).padStart(2, '0');
        const mm = String(minute % 60).padStart(2, '0');
        const soldAt = new Date(`${date}T${hh}:${mm}:00+05:30`).toISOString();
        const clientId = crypto.randomUUID();
        sales.push({
          sql: `INSERT INTO sales (client_id, driver_id, store_id, area_id, sold_at, sale_date, payment_mode,
                                   total_paise, total_quantity, device_sold_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?5)`,
          params: [clientId, driver.id, store.id, store.areaId, soldAt, date, mode, total, qty],
        });
        for (const l of lines) {
          sales.push({
            sql: `INSERT INTO sale_items (sale_id, product_id, product_name, unit_price_paise, list_price_paise, quantity, line_total_paise)
                  VALUES ((SELECT id FROM sales WHERE client_id = ?1), ?2, ?3, ?4, ?4, ?5, ?6)`,
            params: [clientId, l.id, l.name, l.price, l.qty, l.qty * l.price],
          });
        }
      }
    }
  }
  await db.batch(sales);
  const bills = sales.filter((s) => s.sql.includes('INTO sales')).length;
  console.log(`Demo data ready: ${PRODUCTS.length} products, ${stores.length} shops in ${areaIds.length} areas, ${drivers.length} drivers, ${bills} bills.`);
  console.log('Driver app login: phone 9000000001 (or …02, …03, …04), PIN 1234');
}

async function main() {
  const config = loadConfig();
  const args = process.argv.slice(2);
  const sqlIndex = args.indexOf('--sql');
  if (sqlIndex >= 0) {
    const out = args[sqlIndex + 1];
    if (!out) throw new Error('Usage: seed-demo --sql <file.sql>');
    const db = openSqliteDb(':memory:');
    await migrate(db, () => undefined);
    await addDemoData(db, config.appTimezone);
    // The live server creates its own admin account and settings; only the business data goes in the file.
    const backup = await buildBackup(db);
    delete backup.tables.admins;
    delete backup.tables.app_settings;
    await fs.writeFile(out, backupToSql(backup, { replace: false }));
    console.log(`Wrote ${out}`);
    db.close();
    return;
  }

  const db = openSqliteDb(config.databasePath);
  try {
    await migrate(db);
    await ensureInitialAdmin(db, config);
    const counts = await db.first<{ n: number }>(
      `SELECT EXISTS (SELECT 1 FROM products) + EXISTS (SELECT 1 FROM stores) + EXISTS (SELECT 1 FROM sales) AS n`,
    );
    if ((counts?.n ?? 0) > 0 && !args.includes('--force')) {
      console.log('The database already has data, so demo data was NOT added. (Use --force to add anyway.)');
      return;
    }
    await addDemoData(db, config.appTimezone);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
