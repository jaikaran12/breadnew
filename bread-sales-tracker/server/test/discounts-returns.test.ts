import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lineDiscount, lineTotal, ruleLabel } from '../src/services/billMath.js';
import { seedBasics, setupTestApp, uuid, type TestContext } from './helpers.js';

let ctx: TestContext;
let s: Awaited<ReturnType<typeof seedBasics>>;
const auth = () => ({ Authorization: `Bearer ${s.token}` });
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

beforeAll(async () => {
  ctx = await setupTestApp();
  s = await seedBasics(ctx.app);
});

afterAll(() => {
  ctx.close();
});

// The same table of cases is in driver-app/src/billMath.test.ts: phone and server must agree to the paisa.
const CASES: Array<[kind: 'percent' | 'amount' | null, value: number, unit: number, qty: number, discount: number]> = [
  [null, 0, 4000, 10, 0],
  ['percent', 500, 4000, 10, 2000], // 5% of ₹400
  ['percent', 500, 4250, 3, 638], // 5% of ₹127.50 = ₹6.375 → ₹6.38 (half up)
  ['percent', 250, 4250, 1, 106], // 2.5% of ₹42.50 = ₹1.0625 → ₹1.06
  ['percent', 1000, 4500, 7, 3150],
  ['percent', 10000, 3000, 2, 6000], // 100%
  ['percent', 333, 999, 1, 33], // 3.33% of ₹9.99 = 33.2667 paise → 33
  ['amount', 200, 4000, 10, 2000], // ₹2 off each
  ['amount', 5000, 4000, 2, 8000], // more than the price: never below zero
  ['amount', 150, 0, 5, 0],
  ['percent', 500, 4000, 0, 0],
];

describe('bill arithmetic (discounts)', () => {
  it('gives the same paisa-exact answers as the phone', () => {
    for (const [kind, value, unit, qty, discount] of CASES) {
      const rule = kind ? { kind, value } : null;
      expect(lineDiscount(rule, unit, qty), `${kind} ${value} ${unit}×${qty}`).toBe(discount);
      expect(lineTotal(rule, unit, qty)).toBe(unit * qty - discount);
    }
    expect(ruleLabel({ kind: 'percent', value: 500 })).toBe('5%');
    expect(ruleLabel({ kind: 'percent', value: 250 })).toBe('2.5%');
    expect(ruleLabel({ kind: 'amount', value: 200 })).toBe('₹2 off each');
    expect(ruleLabel({ kind: 'amount', value: 150 })).toBe('₹1.50 off each');
  });
});

describe('shop discounts (admin)', () => {
  it('saves, lists and replaces the discounts of one shop', async () => {
    const before = (await request(ctx.app).get('/api/driver/catalog').set(auth()).expect(200)).body.version;
    const put = await s.admin
      .put(`/api/admin/stores/${s.store.id}/discounts`)
      .send({
        discounts: [
          { productId: s.milk.id, kind: 'percent', value: 500 },
          { productId: s.brown.id, kind: 'amount', value: 200 },
        ],
      })
      .expect(200);
    expect(put.body.discounts.map((d: { productId: number; kind: string; value: number }) => [d.productId, d.kind, d.value])).toEqual([
      [s.milk.id, 'percent', 500],
      [s.brown.id, 'amount', 200],
    ]);

    const catalog = (await request(ctx.app).get('/api/driver/catalog').set(auth()).expect(200)).body;
    expect(catalog.version).not.toBe(before);
    expect(catalog.discounts).toEqual([
      { storeId: s.store.id, productId: s.milk.id, kind: 'percent', value: 500 },
      { storeId: s.store.id, productId: s.brown.id, kind: 'amount', value: 200 },
    ]);

    const overview = await s.admin.get('/api/admin/discounts').expect(200);
    expect(overview.body.discounts).toHaveLength(2);
    expect(overview.body.discounts[0]).toMatchObject({ storeName: 'Sharma Kirana', areaName: 'Gandhi Nagar', productName: 'Milk Bread', pricePaise: 4000 });

    const list = await s.admin.get('/api/admin/stores').query({ q: 'sharma' }).expect(200);
    expect(list.body.stores[0].discountCount).toBe(2);
    const detail = await s.admin.get(`/api/admin/stores/${s.store.id}`).expect(200);
    expect(detail.body.discounts.map((d: { name: string }) => d.name)).toEqual(['Milk Bread', 'Brown Bread']);
  });

  it('rejects impossible discounts', async () => {
    const url = `/api/admin/stores/${s.store.id}/discounts`;
    await s.admin.put(url).send({ discounts: [{ productId: s.milk.id, kind: 'percent', value: 10001 }] }).expect(400);
    await s.admin.put(url).send({ discounts: [{ productId: s.milk.id, kind: 'amount', value: 4001 }] }).expect(400);
    await s.admin.put(url).send({ discounts: [{ productId: s.milk.id, kind: 'free', value: 1 }] }).expect(400);
    await s.admin
      .put(url)
      .send({ discounts: [{ productId: s.milk.id, kind: 'percent', value: 500 }, { productId: s.milk.id, kind: 'amount', value: 100 }] })
      .expect(400);
    await s.admin.put('/api/admin/stores/99999/discounts').send({ discounts: [] }).expect(404);
    // Nothing changed
    const still = await s.admin.get(`/api/admin/stores/${s.store.id}/discounts`).expect(200);
    expect(still.body.discounts).toHaveLength(2);
  });
});

describe('bills with discounts', () => {
  it('takes the discount off each line and checks the total', async () => {
    // Milk 10 × ₹40 − 5% (₹20) = ₹380; Brown 3 × ₹42.50 − ₹2 each (₹6) = ₹121.50; Pav 2 × ₹25 = ₹50 → ₹551.50
    const body = {
      clientId: uuid(),
      storeId: s.store.id,
      paymentMode: 'cash',
      items: [
        { productId: s.milk.id, quantity: 10, unitPricePaise: 4000, discount: { kind: 'percent', value: 500 } },
        { productId: s.brown.id, quantity: 3, unitPricePaise: 4250, discount: { kind: 'amount', value: 200 } },
        { productId: s.pav.id, quantity: 2, unitPricePaise: 2500 },
      ],
      totalPaise: 55150,
    };
    await request(ctx.app).post('/api/driver/sales').set(auth()).send({ ...body, clientId: uuid(), totalPaise: 57750 }).expect(400);
    const res = await request(ctx.app).post('/api/driver/sales').set(auth()).send(body).expect(201);
    const sale = res.body.sale;
    expect(sale.totalPaise).toBe(55150);
    expect(sale.discountPaise).toBe(2600);
    expect(sale.totalQuantity).toBe(15);
    expect(sale.priceMismatch).toBe(false);
    expect(sale.items.map((i: { discountKind: string; discountPaise: number; lineTotalPaise: number }) => [i.discountKind, i.discountPaise, i.lineTotalPaise])).toEqual([
      ['percent', 2000, 38000],
      ['amount', 600, 12150],
      [null, 0, 5000],
    ]);
  });

  it('keeps what the phone charged but flags an old discount list', async () => {
    // A phone with an old copy of the lists (no discount) bills Milk Bread at full price.
    const res = await request(ctx.app)
      .post('/api/driver/sales')
      .set(auth())
      .send({
        clientId: uuid(),
        storeId: s.store.id,
        paymentMode: 'upi',
        items: [{ productId: s.milk.id, quantity: 2, unitPricePaise: 4000 }],
        totalPaise: 8000,
      })
      .expect(201);
    expect(res.body.sale.totalPaise).toBe(8000);
    expect(res.body.sale.priceMismatch).toBe(true);
    expect(res.body.sale.items[0]).toMatchObject({ discountPaise: 0, listDiscountPaise: 400 });
    // A shop without discounts is not flagged
    const other = await request(ctx.app)
      .post('/api/driver/sales')
      .set(auth())
      .send({
        clientId: uuid(),
        storeId: s.store2.id,
        paymentMode: 'cash',
        items: [{ productId: s.milk.id, quantity: 2, unitPricePaise: 4000 }],
        totalPaise: 8000,
      })
      .expect(201);
    expect(other.body.sale.priceMismatch).toBe(false);
  });

  it('refuses a broken discount', async () => {
    const post = (discount: unknown) =>
      request(ctx.app)
        .post('/api/driver/sales')
        .set(auth())
        .send({
          clientId: uuid(),
          storeId: s.store.id,
          paymentMode: 'cash',
          items: [{ productId: s.milk.id, quantity: 1, unitPricePaise: 4000, discount }],
          totalPaise: 4000,
        });
    await post({ kind: 'percent', value: 0 }).expect(400);
    await post({ kind: 'percent', value: 20000 }).expect(400);
    await post({ kind: 'gift', value: 100 }).expect(400);
  });
});

describe('expired returns', () => {
  it('saves returns with a bill; they cost nothing', async () => {
    const res = await request(ctx.app)
      .post('/api/driver/sales')
      .set(auth())
      .send({
        clientId: uuid(),
        storeId: s.store2.id,
        paymentMode: 'cash',
        items: [{ productId: s.milk.id, quantity: 5, unitPricePaise: 4000 }],
        returns: [
          { productId: s.milk.id, quantity: 2 },
          { productId: s.pav.id, quantity: 1 },
        ],
        totalPaise: 20000,
      })
      .expect(201);
    expect(res.body.sale.totalPaise).toBe(20000);
    expect(res.body.sale.totalQuantity).toBe(5);
    expect(res.body.sale.returnedQuantity).toBe(3);
    expect(res.body.sale.returns).toEqual([
      { productId: s.milk.id, productName: 'Milk Bread', quantity: 2, unitPricePaise: 4000 },
      { productId: s.pav.id, productName: 'Pav (6 pcs)', quantity: 1, unitPricePaise: 2500 },
    ]);
  });

  it('allows a visit where only expired bread was replaced', async () => {
    const res = await request(ctx.app)
      .post('/api/driver/sales')
      .set(auth())
      .send({ clientId: uuid(), storeId: s.store2.id, paymentMode: 'cash', items: [], returns: [{ productId: s.brown.id, quantity: 4 }], totalPaise: 0 })
      .expect(201);
    expect(res.body.sale).toMatchObject({ totalPaise: 0, totalQuantity: 0, returnedQuantity: 4, items: [] });
  });

  it('refuses empty or broken returns', async () => {
    const post = (extra: object) =>
      request(ctx.app)
        .post('/api/driver/sales')
        .set(auth())
        .send({ clientId: uuid(), storeId: s.store2.id, paymentMode: 'cash', items: [], totalPaise: 0, ...extra });
    await post({}).expect(400);
    await post({ returns: [] }).expect(400);
    await post({ returns: [{ productId: s.milk.id, quantity: 0 }] }).expect(400);
    await post({ returns: [{ productId: 99999, quantity: 1 }] }).expect(400);
    await post({ returns: [{ productId: s.milk.id, quantity: 1 }, { productId: s.milk.id, quantity: 2 }] }).expect(400);
  });

  it('counts returns and discounts in the day summary, reports, dashboard and tally', async () => {
    const day = (await request(ctx.app).get('/api/driver/sales').set(auth()).expect(200)).body;
    // Bills so far: ₹551.50 cash (disc ₹26), ₹80 upi, ₹80 cash (store 2), ₹200 cash + 3 returned, returns-only 4
    expect(day.summary).toMatchObject({
      bills: 4,
      totalPaise: 55150 + 8000 + 8000 + 20000,
      discountPaise: 2600,
      returnedQuantity: 7,
      quantity: 15 + 2 + 2 + 5,
    });
    const returnOnly = day.sales.find((x: { totalQuantity: number }) => x.totalQuantity === 0);
    expect(returnOnly.returns).toHaveLength(1);

    const byProduct = (await s.admin.get('/api/admin/reports').query({ groupBy: 'product' }).expect(200)).body;
    const row = (name: string) => byProduct.rows.find((r: { label: string }) => r.label === name);
    expect(row('Milk Bread')).toMatchObject({ quantity: 19, discountPaise: 2000, returnedQuantity: 2, returnedValuePaise: 8000 });
    expect(row('Brown Bread')).toMatchObject({ quantity: 3, discountPaise: 600, returnedQuantity: 4, returnedValuePaise: 17000 });
    expect(row('Pav (6 pcs)')).toMatchObject({ returnedQuantity: 1 });
    expect(byProduct.totals).toMatchObject({ discountPaise: 2600, returnedQuantity: 7, bills: 4 });

    const byStore = (await s.admin.get('/api/admin/reports').query({ groupBy: 'store' }).expect(200)).body;
    const gupta = byStore.rows.find((r: { label: string }) => r.label === 'Gupta General Store');
    expect(gupta).toMatchObject({ bills: 2, returnedQuantity: 7, discountPaise: 0 });

    const dash = (await s.admin.get('/api/admin/dashboard').expect(200)).body;
    expect(dash.totals).toMatchObject({ discountPaise: 2600, returnedQuantity: 7, bills: 4 });
    expect(dash.returnsByProduct.map((r: { name: string; quantity: number }) => [r.name, r.quantity])).toEqual([
      ['Brown Bread', 4],
      ['Milk Bread', 2],
      ['Pav (6 pcs)', 1],
    ]);

    const tally = (await s.admin.get('/api/admin/tally').query({ date: today() }).expect(200)).body;
    const ramesh = tally.drivers.find((d: { driverId: number }) => d.driverId === s.driver.id);
    expect(ramesh).toMatchObject({ bills: 4, returnedQuantity: 7, discountPaise: 2600, cashPaise: 55150 + 8000 + 20000 });

    const detail = (await s.admin.get(`/api/admin/stores/${s.store2.id}`).expect(200)).body;
    expect(detail.stats).toMatchObject({ returned30: 7, bills30: 2 });
    expect(detail.returns30.map((r: { name: string; quantity: number }) => [r.name, r.quantity])).toEqual([
      ['Milk Bread', 2],
      ['Brown Bread', 4],
      ['Pav (6 pcs)', 1],
    ]);
  });

  it('cancelling a bill also removes its returns from the totals', async () => {
    const day = (await request(ctx.app).get('/api/driver/sales').set(auth()).expect(200)).body;
    const returnOnly = day.sales.find((x: { totalQuantity: number }) => x.totalQuantity === 0);
    await request(ctx.app).post(`/api/driver/sales/${returnOnly.id}/cancel`).set(auth()).expect(200);
    const after = (await s.admin.get('/api/admin/dashboard').expect(200)).body;
    expect(after.totals.returnedQuantity).toBe(3);
    expect(after.totals.cancelledBills).toBe(1);
  });
});

describe('Cloudflare D1 limits (discounts and returns)', () => {
  it('stays within the bound-value limit and the per-request query budget', async () => {
    const { usage, D1_MAX_PARAMS, QUERY_BUDGET_PER_REQUEST } = await import('./helpers.js');
    expect(usage.maxParams).toBeLessThanOrEqual(D1_MAX_PARAMS);
    expect(usage.maxQueriesPerRequest, usage.worstRequest).toBeLessThanOrEqual(QUERY_BUDGET_PER_REQUEST);
  });
});

describe('phone and server use the same bill arithmetic', () => {
  it('has identical copies of billMath.ts', async () => {
    const fs = await import('node:fs');
    const server = fs.readFileSync(new URL('../src/services/billMath.ts', import.meta.url), 'utf8');
    const phone = fs.readFileSync(new URL('../../driver-app/src/billMath.ts', import.meta.url), 'utf8');
    expect(phone).toBe(server);
  });
});
