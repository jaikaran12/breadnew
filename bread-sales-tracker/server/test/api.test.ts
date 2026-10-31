import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, loginAdmin, seedBasics, setupTestApp, uuid, type TestContext } from './helpers.js';

let ctx: TestContext;
let s: Awaited<ReturnType<typeof seedBasics>>;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

function bill(overrides: Record<string, unknown> = {}) {
  // 3 × ₹40 + 2 × ₹42.50 = ₹205
  return {
    clientId: uuid(),
    storeId: s.store.id,
    soldAt: new Date().toISOString(),
    paymentMode: 'cash',
    items: [
      { productId: s.milk.id, quantity: 3, unitPricePaise: 4000 },
      { productId: s.brown.id, quantity: 2, unitPricePaise: 4250 },
    ],
    totalPaise: 20500,
    ...overrides,
  };
}

beforeAll(async () => {
  ctx = await setupTestApp();
  s = await seedBasics(ctx.app);
});

afterAll(async () => {
  await ctx.pool.end();
});

describe('health', () => {
  it('reports ok', async () => {
    const res = await request(ctx.app).get('/api/health').expect(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('admin login', () => {
  it('rejects a wrong password and protects admin routes', async () => {
    await request(ctx.app).post('/api/admin/login').send({ username: 'owner', password: 'nope' }).expect(401);
    await request(ctx.app).get('/api/admin/me').expect(401);
  });

  it('accepts the right password (username is case-insensitive)', async () => {
    const agent = request.agent(ctx.app);
    const res = await agent.post('/api/admin/login').send({ username: 'OWNER', password: ADMIN.password }).expect(200);
    expect(res.headers['set-cookie']?.[0]).toMatch(/HttpOnly/);
    const me = await agent.get('/api/admin/me').expect(200);
    expect(me.body.admin.username).toBe('owner');
    expect(me.body.settings.businessName).toBe('My Bakery');
  });

  it('blocks state-changing requests from another website', async () => {
    const agent = await loginAdmin(ctx.app);
    await agent.post('/api/admin/areas').set('Origin', 'https://evil.example').send({ name: 'X' }).expect(401);
  });
});

describe('driver login', () => {
  it('normalises the phone number and returns a token', async () => {
    const res = await request(ctx.app).post('/api/driver/login').send({ phone: '+91 90000-00001', pin: '1234' }).expect(200);
    expect(res.body.driver.name).toBe('Ramesh');
    expect(res.body.token).toBeTruthy();
  });

  it('locks the account after 5 wrong PINs', async () => {
    await s.admin.post('/api/admin/drivers').send({ name: 'Locky', phone: '9000000099', pin: '4321' }).expect(201);
    for (let i = 0; i < 4; i++) {
      await request(ctx.app).post('/api/driver/login').send({ phone: '9000000099', pin: '0000' }).expect(401);
    }
    await request(ctx.app).post('/api/driver/login').send({ phone: '9000000099', pin: '0000' }).expect(429);
    // Even the right PIN is refused while locked
    await request(ctx.app).post('/api/driver/login').send({ phone: '9000000099', pin: '4321' }).expect(429);
  });

  it('requires a token for driver routes', async () => {
    await request(ctx.app).get('/api/driver/catalog').expect(401);
    await request(ctx.app).get('/api/driver/catalog').set(auth('garbage')).expect(401);
  });
});

describe('catalog', () => {
  it('lists areas, shops and products with prices', async () => {
    const res = await request(ctx.app).get('/api/driver/catalog').set(auth(s.token)).expect(200);
    expect(res.body.areas.map((a: { name: string }) => a.name)).toEqual(['Gandhi Nagar', 'Station Road']);
    expect(res.body.stores).toHaveLength(2);
    expect(res.body.stores.find((x: { name: string }) => x.name === 'Sharma Kirana').phone).toBe('9876543210');
    expect(res.body.products.map((p: { name: string; pricePaise: number }) => [p.name, p.pricePaise])).toEqual([
      ['Milk Bread', 4000],
      ['Brown Bread', 4250],
      ['Pav (6 pcs)', 2500],
    ]);
    expect(res.body.version).toMatch(/^[0-9a-f]{16}$/);
    expect(res.headers['access-control-allow-origin']).toBeUndefined(); // no Origin header sent
  });

  it('allows the Android app origin (CORS)', async () => {
    const res = await request(ctx.app)
      .options('/api/driver/sales')
      .set('Origin', 'https://localhost')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type')
      .expect(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://localhost');
  });
});

describe('creating bills', () => {
  it('saves a bill and calculates the total in paise exactly', async () => {
    const body = bill();
    const res = await request(ctx.app).post('/api/driver/sales').set(auth(s.token)).send(body).expect(201);
    expect(res.body.created).toBe(true);
    expect(res.body.sale.totalPaise).toBe(20500);
    expect(res.body.sale.totalQuantity).toBe(5);
    expect(res.body.sale.storeName).toBe('Sharma Kirana');
    expect(res.body.sale.areaName).toBe('Gandhi Nagar');
    expect(res.body.sale.items.map((i: { lineTotalPaise: number }) => i.lineTotalPaise)).toEqual([12000, 8500]);
    expect(res.body.sale.priceMismatch).toBe(false);
    expect(res.body.catalogVersion).toBeTruthy();
  });

  it('does not create a duplicate when the phone sends the same bill again', async () => {
    const body = bill();
    const first = await request(ctx.app).post('/api/driver/sales').set(auth(s.token)).send(body).expect(201);
    const again = await request(ctx.app).post('/api/driver/sales').set(auth(s.token)).send(body).expect(200);
    expect(again.body.created).toBe(false);
    expect(again.body.sale.id).toBe(first.body.sale.id);
    const count = await ctx.pool.query('SELECT count(*)::int AS n FROM sales WHERE client_id = $1', [body.clientId]);
    expect(count.rows[0].n).toBe(1);
  });

  it('rejects a bill whose total does not match the items', async () => {
    const res = await request(ctx.app)
      .post('/api/driver/sales')
      .set(auth(s.token))
      .send(bill({ totalPaise: 20000 }))
      .expect(400);
    expect(res.body.details.expectedTotalPaise).toBe(20500);
  });

  it('rejects bad input', async () => {
    const post = (b: unknown) => request(ctx.app).post('/api/driver/sales').set(auth(s.token)).send(b as object);
    await post(bill({ items: [] })).expect(400);
    await post(bill({ storeId: 99999 })).expect(400);
    await post(bill({ paymentMode: 'cheque' })).expect(400);
    await post(bill({ clientId: 'not-a-uuid' })).expect(400);
    await post(
      bill({
        items: [{ productId: s.milk.id, quantity: 1.5, unitPricePaise: 4000 }],
        totalPaise: 6000,
      }),
    ).expect(400);
    await post(
      bill({
        items: [
          { productId: s.milk.id, quantity: 1, unitPricePaise: 4000 },
          { productId: s.milk.id, quantity: 1, unitPricePaise: 4000 },
        ],
        totalPaise: 8000,
      }),
    ).expect(400);
    await post(
      bill({ items: [{ productId: 99999, quantity: 1, unitPricePaise: 100 }], totalPaise: 100 }),
    ).expect(400);
  });

  it('keeps the price the driver charged but flags it when it differs from the price list', async () => {
    const res = await request(ctx.app)
      .post('/api/driver/sales')
      .set(auth(s.token))
      .send(bill({ items: [{ productId: s.milk.id, quantity: 2, unitPricePaise: 3800 }], totalPaise: 7600 }))
      .expect(201);
    expect(res.body.sale.totalPaise).toBe(7600);
    expect(res.body.sale.priceMismatch).toBe(true);
    expect(res.body.sale.items[0].listPricePaise).toBe(4000);
  });

  it('puts a bill on the right day in India time and ignores a badly wrong phone clock', async () => {
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
    const r1 = await request(ctx.app)
      .post('/api/driver/sales')
      .set(auth(s.token))
      .send(bill({ soldAt: yesterday.toISOString(), storeId: s.store2.id }))
      .expect(201);
    const expectedDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(yesterday);
    expect(r1.body.sale.saleDate).toBe(expectedDay);

    const r2 = await request(ctx.app)
      .post('/api/driver/sales')
      .set(auth(s.token))
      .send(bill({ soldAt: '2019-01-01T10:00:00Z' }))
      .expect(201);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    expect(r2.body.sale.saleDate).toBe(today);
  });
});

describe('driver bill list and cancel', () => {
  it('shows today\'s bills with cash / UPI / credit totals', async () => {
    const driver = (
      await s.admin.post('/api/admin/drivers').send({ name: 'Suresh', phone: '9000000002', pin: '5555' }).expect(201)
    ).body.driver;
    const token = (await request(ctx.app).post('/api/driver/login').send({ phone: '9000000002', pin: '5555' }).expect(200))
      .body.token;
    await request(ctx.app).post('/api/driver/sales').set(auth(token)).send(bill({ paymentMode: 'cash' })).expect(201);
    await request(ctx.app).post('/api/driver/sales').set(auth(token)).send(bill({ paymentMode: 'upi' })).expect(201);
    await request(ctx.app)
      .post('/api/driver/sales')
      .set(auth(token))
      .send(bill({ paymentMode: 'credit', items: [{ productId: s.pav.id, quantity: 4, unitPricePaise: 2500 }], totalPaise: 10000 }))
      .expect(201);
    const res = await request(ctx.app).get('/api/driver/sales').set(auth(token)).expect(200);
    expect(res.body.summary).toEqual({
      bills: 3,
      totalPaise: 51000,
      cashPaise: 20500,
      upiPaise: 20500,
      creditPaise: 10000,
      quantity: 14,
      cancelledBills: 0,
    });
    expect(res.body.sales).toHaveLength(3);
    expect(res.body.sales[0].items.length).toBeGreaterThan(0);
    expect(driver.id).toBeTruthy();
  });

  it('lets a driver cancel a fresh bill but not someone else\'s', async () => {
    const created = await request(ctx.app).post('/api/driver/sales').set(auth(s.token)).send(bill()).expect(201);
    const other = (
      await s.admin.post('/api/admin/drivers').send({ name: 'Other', phone: '9000000003', pin: '1111' }).expect(201)
    ).body.driver;
    const otherToken = (await request(ctx.app).post('/api/driver/login').send({ phone: '9000000003', pin: '1111' })).body
      .token;
    await request(ctx.app).post(`/api/driver/sales/${created.body.sale.id}/cancel`).set(auth(otherToken)).expect(404);
    const res = await request(ctx.app).post(`/api/driver/sales/${created.body.sale.id}/cancel`).set(auth(s.token)).expect(200);
    expect(res.body.sale.status).toBe('cancelled');
    expect(res.body.sale.cancelledBy).toBe('driver');
    await request(ctx.app).post(`/api/driver/sales/${created.body.sale.id}/cancel`).set(auth(s.token)).expect(409);
    expect(other.id).toBeTruthy();
  });

  it('does not let a driver cancel an old bill', async () => {
    const old = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const created = await request(ctx.app).post('/api/driver/sales').set(auth(s.token)).send(bill({ soldAt: old })).expect(201);
    const res = await request(ctx.app).post(`/api/driver/sales/${created.body.sale.id}/cancel`).set(auth(s.token)).expect(403);
    expect(res.body.code).toBe('cancel_window_passed');
  });

  it('lets a driver add a new shop, reusing an existing one with the same name', async () => {
    const r1 = await request(ctx.app)
      .post('/api/driver/stores')
      .set(auth(s.token))
      .send({ areaId: s.area.id, name: 'New Lucky Store', ownerName: 'Lucky' })
      .expect(201);
    expect(r1.body.store.name).toBe('New Lucky Store');
    const r2 = await request(ctx.app)
      .post('/api/driver/stores')
      .set(auth(s.token))
      .send({ areaId: s.area.id, name: 'new lucky store' })
      .expect(200);
    expect(r2.body.created).toBe(false);
    expect(r2.body.store.id).toBe(r1.body.store.id);
    const list = await s.admin.get('/api/admin/stores').query({ q: 'lucky' }).expect(200);
    expect(list.body.stores[0].createdByDriverName).toBe('Ramesh');
  });
});

describe('admin: products and prices', () => {
  it('records price changes', async () => {
    await s.admin.put(`/api/admin/products/${s.pav.id}`).send({ pricePaise: 3000 }).expect(200);
    const hist = await s.admin.get(`/api/admin/products/${s.pav.id}/price-history`).expect(200);
    expect(hist.body.history.map((h: { newPricePaise: number }) => h.newPricePaise)).toEqual([3000, 2500]);
    expect(hist.body.history[0].oldPricePaise).toBe(2500);
    expect(hist.body.history[0].changedBy).toBe('Owner');
    const catalog = await request(ctx.app).get('/api/driver/catalog').set(auth(s.token)).expect(200);
    expect(catalog.body.products.find((p: { id: number }) => p.id === s.pav.id).pricePaise).toBe(3000);
    // back to the original for the other tests
    await s.admin.put(`/api/admin/products/${s.pav.id}`).send({ pricePaise: 2500 }).expect(200);
  });

  it('hides inactive products from the phone and rejects duplicate names', async () => {
    const p = (await s.admin.post('/api/admin/products').send({ name: 'Rusk', pricePaise: 6000 }).expect(201)).body.product;
    await s.admin.post('/api/admin/products').send({ name: 'rusk', pricePaise: 6000 }).expect(409);
    await s.admin.put(`/api/admin/products/${p.id}`).send({ isActive: false }).expect(200);
    const catalog = await request(ctx.app).get('/api/driver/catalog').set(auth(s.token)).expect(200);
    expect(catalog.body.products.some((x: { id: number }) => x.id === p.id)).toBe(false);
  });

  it('reorders products', async () => {
    await s.admin.post('/api/admin/products/reorder').send({ ids: [s.pav.id, s.milk.id, s.brown.id] }).expect(200);
    const catalog = await request(ctx.app).get('/api/driver/catalog').set(auth(s.token)).expect(200);
    expect(catalog.body.products.map((p: { id: number }) => p.id)).toEqual([s.pav.id, s.milk.id, s.brown.id]);
    await s.admin.post('/api/admin/products/reorder').send({ ids: [s.milk.id, s.brown.id, s.pav.id] }).expect(200);
  });
});

describe('admin: drivers', () => {
  it('logs a driver out when turned off or when the PIN is changed', async () => {
    const d = (await s.admin.post('/api/admin/drivers').send({ name: 'Temp', phone: '9000000004', pin: '2222' }).expect(201))
      .body.driver;
    await s.admin.post('/api/admin/drivers').send({ name: 'Dup', phone: '09000000004', pin: '2222' }).expect(409);
    const t1 = (await request(ctx.app).post('/api/driver/login').send({ phone: '9000000004', pin: '2222' })).body.token;
    await request(ctx.app).get('/api/driver/me').set(auth(t1)).expect(200);

    await s.admin.post(`/api/admin/drivers/${d.id}/pin`).send({ pin: '3333' }).expect(200);
    await request(ctx.app).get('/api/driver/me').set(auth(t1)).expect(401);
    await request(ctx.app).post('/api/driver/login').send({ phone: '9000000004', pin: '2222' }).expect(401);
    const t2 = (await request(ctx.app).post('/api/driver/login').send({ phone: '9000000004', pin: '3333' }).expect(200)).body
      .token;

    await s.admin.put(`/api/admin/drivers/${d.id}`).send({ isActive: false }).expect(200);
    await request(ctx.app).get('/api/driver/me').set(auth(t2)).expect(401);
    const login = await request(ctx.app).post('/api/driver/login').send({ phone: '9000000004', pin: '3333' }).expect(403);
    expect(login.body.code).toBe('driver_disabled');
  });
});

describe('admin: sales, tally and reports', () => {
  let ctx2: TestContext;
  let t: Awaited<ReturnType<typeof seedBasics>>;

  beforeAll(async () => {
    // Separate clean database so the numbers below are exact.
    await ctx.pool.end();
    ctx2 = await setupTestApp();
    ctx = ctx2;
    t = await seedBasics(ctx2.app);
    s = t;
  });

  async function sell(token: string, overrides: Record<string, unknown>) {
    return (await request(ctx2.app).post('/api/driver/sales').set(auth(token)).send(bill(overrides)).expect(201)).body.sale;
  }

  it('lists bills with filters and totals, and exports CSV', async () => {
    await sell(t.token, { paymentMode: 'cash' }); // 205
    await sell(t.token, { paymentMode: 'upi', storeId: t.store2.id }); // 205
    await sell(t.token, {
      paymentMode: 'credit',
      items: [{ productId: t.pav.id, quantity: 10, unitPricePaise: 2500 }],
      totalPaise: 25000,
    }); // 250

    const all = await t.admin.get('/api/admin/sales').expect(200);
    expect(all.body.total).toBe(3);
    expect(all.body.summary.totalPaise).toBe(66000);
    expect(all.body.summary.cashPaise).toBe(20500);

    const upi = await t.admin.get('/api/admin/sales').query({ paymentMode: 'upi' }).expect(200);
    expect(upi.body.total).toBe(1);
    expect(upi.body.sales[0].storeName).toBe('Gupta General Store');

    const byArea = await t.admin.get('/api/admin/sales').query({ areaId: t.area2.id }).expect(200);
    expect(byArea.body.total).toBe(1);

    const search = await t.admin.get('/api/admin/sales').query({ q: 'sharma' }).expect(200);
    expect(search.body.total).toBe(2);

    const csv = await t.admin.get('/api/admin/sales/export.csv').query({ type: 'items' }).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    const lines = csv.text.trim().split('\r\n');
    expect(lines).toHaveLength(1 + 5); // header + 2 + 2 + 1 lines
    expect(lines[0]).toContain('Product');
    expect(csv.text).toContain('42.50');
  });

  it('cancels and restores a bill from the admin site', async () => {
    const sale = await sell(t.token, {});
    await t.admin.post(`/api/admin/sales/${sale.id}/cancel`).send({ reason: '' }).expect(400);
    const res = await t.admin.post(`/api/admin/sales/${sale.id}/cancel`).send({ reason: 'Wrong shop' }).expect(200);
    expect(res.body.sale.status).toBe('cancelled');
    expect(res.body.sale.cancelReason).toContain('Wrong shop');
    const restored = await t.admin.post(`/api/admin/sales/${sale.id}/restore`).expect(200);
    expect(restored.body.sale.status).toBe('completed');
    await t.admin.post(`/api/admin/sales/${sale.id}/cancel`).send({ reason: 'Test bill' }).expect(200);
  });

  it('tallies cash per driver and flags late changes', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const before = await t.admin.get('/api/admin/tally').query({ date: today }).expect(200);
    const row = before.body.drivers.find((d: { driverId: number }) => d.driverId === t.driver.id);
    expect(row.cashPaise).toBe(20500);
    expect(row.upiPaise).toBe(20500);
    expect(row.creditPaise).toBe(25000);
    expect(row.cancelledBills).toBe(1);
    expect(row.settled).toBe(false);

    // Driver hands over ₹200 instead of ₹205
    await t.admin.put('/api/admin/tally').send({ driverId: t.driver.id, date: today, cashReceivedPaise: 20000, note: 'short' }).expect(200);
    const after = await t.admin.get('/api/admin/tally').query({ date: today }).expect(200);
    const settled = after.body.drivers.find((d: { driverId: number }) => d.driverId === t.driver.id);
    expect(settled.settled).toBe(true);
    expect(settled.differencePaise).toBe(-500);
    expect(settled.changedSinceSettled).toBe(false);
    expect(settled.settledBy).toBe('Owner');

    // A settled day cannot be changed from the phone
    const fresh = await sell(t.token, {});
    const cancel = await request(ctx2.app).post(`/api/driver/sales/${fresh.id}/cancel`).set(auth(t.token)).expect(403);
    expect(cancel.body.code).toBe('day_settled');
    const late = await t.admin.get('/api/admin/tally').query({ date: today }).expect(200);
    const lateRow = late.body.drivers.find((d: { driverId: number }) => d.driverId === t.driver.id);
    expect(lateRow.changedSinceSettled).toBe(true);
    expect(lateRow.cashPaise).toBe(41000);

    await t.admin.delete('/api/admin/tally').query({ driverId: t.driver.id, date: today }).expect(200);
    const reopened = await t.admin.get('/api/admin/tally').query({ date: today }).expect(200);
    expect(reopened.body.drivers.find((d: { driverId: number }) => d.driverId === t.driver.id).settled).toBe(false);
    await t.admin.post(`/api/admin/sales/${fresh.id}/cancel`).send({ reason: 'test cleanup' }).expect(200);
  });

  it('builds reports grouped by product, shop, area, driver and day', async () => {
    const product = await t.admin.get('/api/admin/reports').query({ groupBy: 'product' }).expect(200);
    const rows = Object.fromEntries(
      product.body.rows.map((r: { label: string; quantity: number; amountPaise: number }) => [r.label, [r.quantity, r.amountPaise]]),
    );
    expect(rows).toEqual({ 'Milk Bread': [6, 24000], 'Brown Bread': [4, 17000], 'Pav (6 pcs)': [10, 25000] });
    expect(product.body.totals.totalPaise).toBe(66000);
    expect(product.body.totals.bills).toBe(3);

    const store = await t.admin.get('/api/admin/reports').query({ groupBy: 'store' }).expect(200);
    expect(store.body.rows[0]).toMatchObject({ label: 'Sharma Kirana', sublabel: 'Gandhi Nagar', bills: 2, amountPaise: 45500 });

    const area = await t.admin.get('/api/admin/reports').query({ groupBy: 'area' }).expect(200);
    expect(area.body.rows.map((r: { label: string; amountPaise: number }) => [r.label, r.amountPaise])).toEqual([
      ['Gandhi Nagar', 45500],
      ['Station Road', 20500],
    ]);

    const driver = await t.admin.get('/api/admin/reports').query({ groupBy: 'driver' }).expect(200);
    expect(driver.body.rows[0]).toMatchObject({ label: 'Ramesh', bills: 3, cashPaise: 20500, upiPaise: 20500, creditPaise: 25000 });

    const day = await t.admin.get('/api/admin/reports').query({ groupBy: 'day' }).expect(200);
    expect(day.body.rows).toHaveLength(1);
    expect(day.body.rows[0].amountPaise).toBe(66000);

    const csv = await t.admin.get('/api/admin/reports').query({ groupBy: 'product', format: 'csv' }).expect(200);
    expect(csv.text).toContain('Milk Bread');
    expect(csv.text).toContain('240.00');
  });

  it('shows the dashboard for today', async () => {
    const res = await t.admin.get('/api/admin/dashboard').expect(200);
    expect(res.body.totals.totalPaise).toBe(66000);
    expect(res.body.totals.bills).toBe(3);
    expect(res.body.totals.storesVisited).toBe(2);
    expect(res.body.totals.activeDrivers).toBe(1);
    expect(res.body.totals.cancelledBills).toBe(2);
    expect(res.body.trend).toHaveLength(14);
    expect(res.body.trend[13].totalPaise).toBe(66000);
    expect(res.body.byProduct).toHaveLength(3);
    expect(res.body.recent.length).toBe(5);
    expect(res.body.counts).toEqual({ stores: 2, products: 3, drivers: 1, areas: 2 });
  });

  it('shows shop details with purchase history', async () => {
    const res = await t.admin.get(`/api/admin/stores/${t.store.id}`).expect(200);
    expect(res.body.stats.billsAllTime).toBe(2);
    expect(res.body.stats.amountAllTimePaise).toBe(45500);
    expect(res.body.recentSales.length).toBe(4); // includes the cancelled ones
    const list = await t.admin.get('/api/admin/stores').query({ sort: 'sales30' }).expect(200);
    expect(list.body.stores[0].name).toBe('Sharma Kirana');
    expect(list.body.stores[0].amount30Paise).toBe(45500);
  });
});

describe('admin: shop import', () => {
  it('previews, imports and skips duplicates', async () => {
    const csv = [
      'Area,Shop Name,Owner,Phone,Address',
      'Gandhi Nagar,Sharma Kirana,,,', // already exists
      'Gandhi Nagar,"Patel Stores, Main Road",Mr Patel,98200 12345,Near temple',
      'Civil Lines,Jain Kirana,,9811111111,',
      ',Missing Area Store,,,',
    ].join('\n');
    const preview = await s.admin.post('/api/admin/stores/import').send({ csv, dryRun: true }).expect(200);
    expect(preview.body).toMatchObject({ dryRun: true, rows: 4, storesCreated: 2, skippedExisting: 1, areasCreated: ['Civil Lines'] });
    expect(preview.body.errors).toEqual([{ line: 5, message: 'Area and shop name are both required' }]);
    const before = await s.admin.get('/api/admin/stores').expect(200);

    const done = await s.admin.post('/api/admin/stores/import').send({ csv }).expect(200);
    expect(done.body.storesCreated).toBe(2);
    const after = await s.admin.get('/api/admin/stores').expect(200);
    expect(after.body.total).toBe(before.body.total + 2);
    const patel = after.body.stores.find((x: { name: string }) => x.name === 'Patel Stores, Main Road');
    expect(patel).toMatchObject({ ownerName: 'Mr Patel', phone: '9820012345', address: 'Near temple', areaName: 'Gandhi Nagar' });

    const again = await s.admin.post('/api/admin/stores/import').send({ csv }).expect(200);
    expect(again.body.storesCreated).toBe(0);
    expect(again.body.skippedExisting).toBe(3);
  });

  it('accepts tab separated text pasted from Excel', async () => {
    const tsv = 'Area\tShop\tMobile\nRailway Colony\tBalaji Kirana\t9000011111\n';
    const res = await s.admin.post('/api/admin/stores/import').send({ csv: tsv }).expect(200);
    expect(res.body.storesCreated).toBe(1);
    expect(res.body.areasCreated).toEqual(['Railway Colony']);
  });

  it('rejects a file without the needed columns', async () => {
    await s.admin.post('/api/admin/stores/import').send({ csv: 'foo,bar\n1,2' }).expect(400);
  });
});

describe('admin: accounts and settings', () => {
  it('updates business settings shown on the phone', async () => {
    await s.admin.put('/api/admin/settings').send({ businessName: 'Fresh Bake', billFooter: 'Dhanyavaad!' }).expect(200);
    const catalog = await request(ctx.app).get('/api/driver/catalog').set(auth(s.token)).expect(200);
    expect(catalog.body.businessName).toBe('Fresh Bake');
    expect(catalog.body.billFooter).toBe('Dhanyavaad!');
  });

  it('changes password and manages other admins', async () => {
    const agent = await loginAdmin(ctx.app);
    await agent.post('/api/admin/password').send({ currentPassword: 'wrong', newPassword: 'new-password-1' }).expect(400);
    const other = await agent
      .post('/api/admin/admins')
      .send({ name: 'Manager', username: 'manager', password: 'manager-pass-1' })
      .expect(201);
    await agent.post('/api/admin/admins').send({ name: 'Manager', username: 'MANAGER', password: 'manager-pass-1' }).expect(409);
    const manager = request.agent(ctx.app);
    await manager.post('/api/admin/login').send({ username: 'manager', password: 'manager-pass-1' }).expect(200);
    await manager.get('/api/admin/me').expect(200);
    await agent.delete(`/api/admin/admins/${other.body.admin.id}`).expect(200);
    await manager.get('/api/admin/me').expect(401);
  });
});
