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
    // Phones check this before each bill (one cheap request) and download the lists again only if it changed.
    const version = (await request(ctx.app).get('/api/driver/catalog/version').set(auth()).expect(200)).body.version;
    expect(version).toBe(catalog.version);
    await request(ctx.app).get('/api/driver/catalog/version').expect(401);
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
  const post = (body: object) => request(ctx.app).post('/api/driver/sales').set(auth()).send(body);
  const noDiscount = { discountKind: null, discountValue: null, discountPaise: 0, listDiscountPaise: 0 };

  it('takes the value of expired items off the bill: given − returned = net amount', async () => {
    // Gupta (no discounts): given Milk 5 × ₹40 = ₹200; back Milk 2 × ₹40 + Pav 1 × ₹25 = ₹105 → net ₹95
    const body = {
      clientId: uuid(),
      storeId: s.store2.id,
      paymentMode: 'cash',
      items: [{ productId: s.milk.id, quantity: 5, unitPricePaise: 4000 }],
      returns: [
        { productId: s.milk.id, quantity: 2, unitPricePaise: 4000 },
        { productId: s.pav.id, quantity: 1, unitPricePaise: 2500 },
      ],
      totalPaise: 9500,
    };
    // The total must be the net amount
    const wrong = await post({ ...body, clientId: uuid(), totalPaise: 20000 }).expect(400);
    expect(wrong.body.details.expectedTotalPaise).toBe(9500);
    const res = await post(body).expect(201);
    expect(res.body.sale).toMatchObject({
      totalPaise: 9500,
      returnedPaise: 10500,
      totalQuantity: 5,
      returnedQuantity: 3,
      discountPaise: 0,
      priceMismatch: false,
    });
    expect(res.body.sale.returns).toEqual([
      { productId: s.milk.id, productName: 'Milk Bread', quantity: 2, unitPricePaise: 4000, listPricePaise: 4000, ...noDiscount, creditPaise: 8000 },
      { productId: s.pav.id, productName: 'Pav (6 pcs)', quantity: 1, unitPricePaise: 2500, listPricePaise: 2500, ...noDiscount, creditPaise: 2500 },
    ]);
  });

  it('a swap at a shop with a discount comes to zero', async () => {
    // Sharma gets ₹2 off each Brown Bread: 1 fresh given for 1 expired, ₹40.50 each way.
    const brown = { productId: s.brown.id, quantity: 1, unitPricePaise: 4250, discount: { kind: 'amount', value: 200 } };
    const res = await post({ clientId: uuid(), storeId: s.store.id, paymentMode: 'cash', items: [brown], returns: [brown], totalPaise: 0 }).expect(201);
    expect(res.body.sale).toMatchObject({ totalPaise: 0, returnedPaise: 4050, discountPaise: 200, priceMismatch: false });
    expect(res.body.sale.returns[0]).toMatchObject({ discountKind: 'amount', discountValue: 200, discountPaise: 200, listDiscountPaise: 200, creditPaise: 4050 });
  });

  it('returns worth more than what was given: the shop gets money back', async () => {
    // Sharma: given Pav 1 × ₹25; back Milk 3 × ₹40 − 5% (₹6) = ₹114 → net −₹89
    const res = await post({
      clientId: uuid(),
      storeId: s.store.id,
      paymentMode: 'cash',
      items: [{ productId: s.pav.id, quantity: 1, unitPricePaise: 2500 }],
      returns: [{ productId: s.milk.id, quantity: 3, unitPricePaise: 4000, discount: { kind: 'percent', value: 500 } }],
      totalPaise: -8900,
    }).expect(201);
    expect(res.body.sale).toMatchObject({ totalPaise: -8900, returnedPaise: 11400, totalQuantity: 1, returnedQuantity: 3 });
    expect(res.body.sale.returns[0]).toMatchObject({ discountPaise: 600, creditPaise: 11400 });

    // Only expired items taken back, nothing given (taken off the shop's udhaar)
    const only = await post({
      clientId: uuid(),
      storeId: s.store2.id,
      paymentMode: 'credit',
      items: [],
      returns: [{ productId: s.brown.id, quantity: 2, unitPricePaise: 4250 }],
      totalPaise: -8500,
    }).expect(201);
    expect(only.body.sale).toMatchObject({ totalPaise: -8500, totalQuantity: 0, returnedQuantity: 2, returnedPaise: 8500, items: [] });
  });

  it('flags returns valued with an old price list', async () => {
    // A phone with an old copy of the lists (no discount) values the expired Milk Bread at full price.
    const res = await post({
      clientId: uuid(),
      storeId: s.store.id,
      paymentMode: 'upi',
      items: [{ productId: s.pav.id, quantity: 2, unitPricePaise: 2500 }],
      returns: [{ productId: s.milk.id, quantity: 1, unitPricePaise: 4000 }],
      totalPaise: 1000,
    }).expect(201);
    expect(res.body.sale).toMatchObject({ totalPaise: 1000, returnedPaise: 4000, priceMismatch: true });
    expect(res.body.sale.returns[0]).toMatchObject({ discountPaise: 0, listDiscountPaise: 200, creditPaise: 4000 });
  });

  it('older app versions: returns sent without a rate cost nothing', async () => {
    const res = await post({
      clientId: uuid(),
      storeId: s.store2.id,
      paymentMode: 'cash',
      items: [{ productId: s.milk.id, quantity: 5, unitPricePaise: 4000 }],
      returns: [
        { productId: s.milk.id, quantity: 2 },
        { productId: s.pav.id, quantity: 1 },
      ],
      totalPaise: 20000,
    }).expect(201);
    expect(res.body.sale).toMatchObject({ totalPaise: 20000, returnedPaise: 0, totalQuantity: 5, returnedQuantity: 3, priceMismatch: false });
    expect(res.body.sale.returns).toEqual([
      { productId: s.milk.id, productName: 'Milk Bread', quantity: 2, unitPricePaise: 4000, listPricePaise: 4000, ...noDiscount, creditPaise: 0 },
      { productId: s.pav.id, productName: 'Pav (6 pcs)', quantity: 1, unitPricePaise: 2500, listPricePaise: 2500, ...noDiscount, creditPaise: 0 },
    ]);
    // A visit where expired bread was only swapped
    const swap = await post({ clientId: uuid(), storeId: s.store2.id, paymentMode: 'cash', items: [], returns: [{ productId: s.brown.id, quantity: 4 }], totalPaise: 0 }).expect(201);
    expect(swap.body.sale).toMatchObject({ totalPaise: 0, totalQuantity: 0, returnedQuantity: 4, returnedPaise: 0, items: [] });
  });

  it('refuses empty or broken returns', async () => {
    const bill = (extra: object) => post({ clientId: uuid(), storeId: s.store2.id, paymentMode: 'cash', items: [], totalPaise: 0, ...extra });
    await bill({}).expect(400);
    await bill({ returns: [] }).expect(400);
    await bill({ returns: [{ productId: s.milk.id, quantity: 0 }] }).expect(400);
    await bill({ returns: [{ productId: 99999, quantity: 1 }] }).expect(400);
    await bill({ returns: [{ productId: s.milk.id, quantity: 1 }, { productId: s.milk.id, quantity: 2 }] }).expect(400);
    await bill({ returns: [{ productId: s.milk.id, quantity: 1, unitPricePaise: -4000 }], totalPaise: 4000 }).expect(400);
    await bill({ returns: [{ productId: s.milk.id, quantity: 1, unitPricePaise: 4000, discount: { kind: 'percent', value: 0 } }], totalPaise: -4000 }).expect(400);
    // Wrong net total (the value of the return was not taken off)
    await bill({ returns: [{ productId: s.milk.id, quantity: 1, unitPricePaise: 4000 }], totalPaise: 0 }).expect(400);
    await bill({ returns: [{ productId: s.milk.id, quantity: 100_000, unitPricePaise: 10_000_000 }], totalPaise: -1_000_000_000_000 }).expect(400);
  });

  it('uses net amounts in the day summary, reports, dashboard, tally and shop page', async () => {
    // Bills of the day (net): ₹551.50 cash, ₹80 upi, ₹80 cash (Gupta), ₹95 cash (Gupta, ₹105 back),
    // ₹0 swap, −₹89 cash, −₹85 udhaar (Gupta), ₹10 upi (old list), ₹200 cash + ₹0 swap (older app, Gupta)
    const day = (await request(ctx.app).get('/api/driver/sales').set(auth()).expect(200)).body;
    const summary = {
      bills: 8,
      totalPaise: 84250,
      cashPaise: 83750,
      upiPaise: 9000,
      creditPaise: -8500,
      quantity: 33,
      discountPaise: 2800,
      returnedQuantity: 17,
      returnedPaise: 38450,
    };
    expect(day.summary).toMatchObject(summary);

    const byProduct = (await s.admin.get('/api/admin/reports').query({ groupBy: 'product' }).expect(200)).body;
    const row = (name: string) => byProduct.rows.find((r: { label: string }) => r.label === name);
    // Each product: given − its returns (also split by payment), adding up to the totals
    expect(row('Milk Bread')).toMatchObject({ bills: 5, quantity: 24, amountPaise: 70600, cashPaise: 66600, upiPaise: 4000, creditPaise: 0, discountPaise: 2000, returnedQuantity: 8, returnedPaise: 23400 });
    expect(row('Brown Bread')).toMatchObject({ bills: 2, quantity: 4, amountPaise: 3650, cashPaise: 12150, upiPaise: 0, creditPaise: -8500, discountPaise: 800, returnedQuantity: 7, returnedPaise: 12550 });
    expect(row('Pav (6 pcs)')).toMatchObject({ bills: 3, quantity: 5, amountPaise: 10000, cashPaise: 5000, upiPaise: 5000, returnedQuantity: 2, returnedPaise: 2500 });
    expect(byProduct.totals).toMatchObject(summary);
    const sum = (k: string) => byProduct.rows.reduce((acc: number, r: Record<string, number>) => acc + r[k], 0);
    expect([sum('amountPaise'), sum('cashPaise'), sum('upiPaise'), sum('creditPaise')]).toEqual([84250, 83750, 9000, -8500]);

    const byStore = (await s.admin.get('/api/admin/reports').query({ groupBy: 'store' }).expect(200)).body;
    const store = (name: string) => byStore.rows.find((r: { label: string }) => r.label === name);
    expect(store('Sharma Kirana')).toMatchObject({ bills: 5, amountPaise: 55250, returnedQuantity: 5, returnedPaise: 19450, discountPaise: 2800 });
    expect(store('Gupta General Store')).toMatchObject({ bills: 3, amountPaise: 29000, returnedQuantity: 12, returnedPaise: 19000, discountPaise: 0 });

    const dash = (await s.admin.get('/api/admin/dashboard').expect(200)).body;
    expect(dash.totals).toMatchObject(summary);
    expect(dash.returnsByProduct.map((r: { name: string; quantity: number; valuePaise: number }) => [r.name, r.quantity, r.valuePaise])).toEqual([
      ['Milk Bread', 8, 23400],
      ['Brown Bread', 7, 12550],
      ['Pav (6 pcs)', 2, 2500],
    ]);
    expect(dash.byArea.map((a: { totalPaise: number; returnedPaise: number }) => [a.totalPaise, a.returnedPaise]).sort()).toEqual(
      [[29000, 19000], [55250, 19450]].sort(),
    );

    const tally = (await s.admin.get('/api/admin/tally').query({ date: today() }).expect(200)).body;
    const ramesh = tally.drivers.find((d: { driverId: number }) => d.driverId === s.driver.id);
    expect(ramesh).toMatchObject({ bills: 8, totalPaise: 84250, cashPaise: 83750, upiPaise: 9000, creditPaise: -8500, returnedQuantity: 17, returnedPaise: 38450 });
    expect(tally.totals).toMatchObject({ cashPaise: 83750, returnedPaise: 38450 });

    const detail = (await s.admin.get(`/api/admin/stores/${s.store2.id}`).expect(200)).body;
    expect(detail.stats).toMatchObject({ bills30: 3, amount30Paise: 29000, returned30: 12, returned30Paise: 19000 });
    expect(detail.returns30.map((r: { name: string; quantity: number; valuePaise: number }) => [r.name, r.quantity, r.valuePaise])).toEqual([
      ['Milk Bread', 4, 8000],
      ['Brown Bread', 6, 8500],
      ['Pav (6 pcs)', 2, 2500],
    ]);
  });

  it('cancelling a bill also removes its returns from the totals', async () => {
    const day = (await request(ctx.app).get('/api/driver/sales').set(auth()).expect(200)).body;
    const moneyBack = day.sales.find((x: { totalPaise: number }) => x.totalPaise === -8500);
    await request(ctx.app).post(`/api/driver/sales/${moneyBack.id}/cancel`).set(auth()).expect(200);
    const after = (await s.admin.get('/api/admin/dashboard').expect(200)).body;
    expect(after.totals).toMatchObject({ totalPaise: 92750, creditPaise: 0, returnedQuantity: 15, returnedPaise: 29950, cancelledBills: 1 });
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
