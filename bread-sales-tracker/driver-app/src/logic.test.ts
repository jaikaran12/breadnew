import { describe, expect, it } from 'vitest';
import { productCode } from './components/ui';
import { rupees } from './money';
import { billsForDate, getState, linesTotal, summarize, draftLines, draftReturns, __setStateForTests } from './store';
import type { Catalog, PendingSale, ServerSale } from './types';

const catalog: Catalog = {
  version: 'v1',
  businessName: 'Test Bakery',
  businessPhone: '',
  billFooter: '',
  cancelWindowMinutes: 30,
  timezone: 'Asia/Kolkata',
  today: '2026-10-31',
  serverTime: '2026-10-31T10:00:00Z',
  areas: [{ id: 1, name: 'Gandhi Nagar' }],
  stores: [{ id: 7, areaId: 1, name: 'Sharma Kirana', ownerName: null, phone: null, address: null }],
  products: [
    { id: 1, name: 'Milk Bread 400g', localName: null, pricePaise: 4000, color: '#fff' },
    { id: 2, name: 'Brown Bread', localName: null, pricePaise: 4250, color: '#fff' },
    { id: 3, name: 'Pav 6 pcs', localName: null, pricePaise: 3000, color: '#fff' },
  ],
};

describe('money', () => {
  it('formats rupees the Indian way', () => {
    expect(rupees(0)).toBe('₹0');
    expect(rupees(4000)).toBe('₹40');
    expect(rupees(4250)).toBe('₹42.50');
    expect(rupees(12345600)).toBe('₹1,23,456');
    expect(rupees(-500)).toBe('-₹5');
  });
});

describe('bill totals', () => {
  it('adds quantity × rate exactly in paise (no rounding errors)', () => {
    __setStateForTests({
      catalog,
      draft: { storeId: 7, storeName: 'Sharma Kirana', areaId: 1, areaName: 'Gandhi Nagar', qty: { 1: 3, 2: 7, 3: 0 }, paymentMode: 'cash' },
    });
    const lines = draftLines(getState());
    expect(lines.map((l) => [l.productId, l.quantity, l.lineTotalPaise])).toEqual([
      [1, 3, 12000],
      [2, 7, 29750],
    ]);
    expect(linesTotal(lines)).toEqual({ totalPaise: 41750, quantity: 10, discountPaise: 0 });
    // 0.1 + 0.2 style float problems cannot happen: 333 × ₹42.50
    __setStateForTests({ draft: { ...getState().draft!, qty: { 2: 333 } } });
    expect(linesTotal(draftLines(getState())).totalPaise).toBe(1415250);
  });

  it('merges bills on the phone with bills from the server and sums the day', () => {
    const pending: PendingSale = {
      clientId: 'p1',
      driverId: 5,
      storeId: 7,
      storeName: 'Sharma Kirana',
      areaId: 1,
      areaName: 'Gandhi Nagar',
      soldAt: '2026-10-31T09:00:00Z',
      saleDate: '2026-10-31',
      paymentMode: 'cash',
      items: [{ productId: 1, name: 'Milk Bread 400g', unitPricePaise: 4000, quantity: 2, lineTotalPaise: 8000 }],
      totalPaise: 8000,
      totalQuantity: 2,
      attempts: 1,
    };
    const sent = (id: number, clientId: string, mode: 'cash' | 'upi' | 'credit', total: number, status: 'completed' | 'cancelled'): ServerSale => ({
      id,
      clientId,
      storeId: 7,
      storeName: 'Sharma Kirana',
      areaId: 1,
      areaName: 'Gandhi Nagar',
      soldAt: `2026-10-31T0${id}:00:00Z`,
      saleDate: '2026-10-31',
      paymentMode: mode,
      totalPaise: total,
      totalQuantity: 1,
      status,
      cancelledBy: status === 'cancelled' ? 'driver' : null,
      cancelReason: null,
      items: [],
    });
    __setStateForTests({
      auth: { token: 't', driver: { id: 5, name: 'Ramesh', phone: '9000000001' } },
      outbox: [pending, { ...pending, clientId: 'other-driver', driverId: 99 }],
      history: {
        '2026-10-31': {
          date: '2026-10-31',
          settled: false,
          fetchedAt: 1,
          sales: [sent(1, 's1', 'upi', 5000, 'completed'), sent(2, 's2', 'cash', 3000, 'cancelled'), sent(3, 's3', 'credit', 2500, 'completed')],
        },
      },
    });
    const bills = billsForDate(getState(), '2026-10-31');
    expect(bills.map((b) => [b.key, b.state])).toEqual([
      ['p1', 'pending'],
      ['s3', 'sent'],
      ['s2', 'cancelled'],
      ['s1', 'sent'],
    ]);
    expect(summarize(bills)).toEqual({ bills: 3, totalPaise: 15500, cashPaise: 8000, upiPaise: 5000, creditPaise: 2500, quantity: 4, returned: 0 });
  });
});

describe('product badge', () => {
  it('makes short codes', () => {
    expect(productCode('Milk Bread 400g')).toBe('MB');
    expect(productCode('Pav 12 pcs')).toBe('P12');
    expect(productCode('Burger Bun 4 pcs')).toBe('BB');
    expect(productCode('मिल्क ब्रेड')).toBe('मब');
  });
});

describe('bill history cache', () => {
  it('keeps an old day that was just opened even when many newer days are cached', async () => {
    const { actions } = await import('./store');
    const days: Record<string, { date: string; sales: []; settled: boolean; fetchedAt: number }> = {};
    for (let i = 1; i <= 15; i++) {
      const d = `2026-10-${String(i).padStart(2, '0')}`;
      days[d] = { date: d, sales: [], settled: false, fetchedAt: i };
    }
    __setStateForTests({ history: days, auth: { token: 't', driver: { id: 5, name: 'R', phone: '9' } } });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ date: '2026-09-01', today: '2026-10-31', settled: true, sales: [], cancelWindowMinutes: 30 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    try {
      await actions.loadDay('2026-09-01');
    } finally {
      globalThis.fetch = realFetch;
    }
    const history = getState().history;
    expect(history['2026-09-01']?.settled).toBe(true);
    expect(Object.keys(history).length).toBeLessThanOrEqual(12);
  });
});

describe('shop discounts and expired returns on the phone', () => {
  const withDiscounts: Catalog = {
    ...catalog,
    discounts: [
      { storeId: 7, productId: 1, kind: 'percent', value: 500 },
      { storeId: 7, productId: 2, kind: 'amount', value: 200 },
      { storeId: 99, productId: 3, kind: 'percent', value: 1000 },
    ],
  };

  it("applies the shop's discounts to the bill being made", async () => {
    const { actions } = await import('./store');
    __setStateForTests({
      catalog: withDiscounts,
      outbox: [],
      draft: {
        storeId: 7,
        storeName: 'Sharma Kirana',
        areaId: 1,
        areaName: 'Gandhi Nagar',
        qty: { 1: 10, 2: 3, 3: 2 },
        ret: {},
        mode: 'sale',
        paymentMode: 'cash',
      },
    });
    const lines = draftLines(getState());
    // Milk 10 × ₹40 − 5% = ₹380; Brown 3 × ₹42.50 − ₹2 each = ₹121.50; Pav 2 × ₹30 (discount is for another shop)
    expect(lines.map((l) => [l.productId, l.discountPaise, l.lineTotalPaise])).toEqual([
      [1, 2000, 38000],
      [2, 600, 12150],
      [3, 0, 6000],
    ]);
    expect(linesTotal(lines)).toEqual({ totalPaise: 56150, quantity: 15, discountPaise: 2600 });

    // Expired returns go in their own list and do not change the money
    actions.setMode('return');
    actions.setQty(1, 2);
    actions.setQty(3, 1);
    actions.setQty(3, 0);
    actions.setQty(2, 4);
    expect(draftReturns(getState())).toEqual([
      { productId: 1, name: 'Milk Bread 400g', quantity: 2 },
      { productId: 2, name: 'Brown Bread', quantity: 4 },
    ]);
    expect(linesTotal(draftLines(getState())).totalPaise).toBe(56150);
    // "Clear" in return mode only clears the returns
    actions.clearQty();
    expect(draftReturns(getState())).toEqual([]);
    expect(draftLines(getState())).toHaveLength(3);
  });

  it('saves and sends a visit with only returns (nothing sold)', async () => {
    const { actions } = await import('./store');
    __setStateForTests({
      catalog: withDiscounts,
      outbox: [],
      history: {},
      auth: { token: 't', driver: { id: 5, name: 'Ramesh', phone: '9000000001' } },
      draft: { storeId: 7, storeName: 'Sharma Kirana', areaId: 1, areaName: 'Gandhi Nagar', qty: {}, ret: { 3: 2 }, mode: 'return', paymentMode: 'cash' },
    });
    const sent: unknown[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      sent.push(body);
      return new Response(
        JSON.stringify({
          created: true,
          catalogVersion: 'v1',
          sale: {
            id: 41,
            clientId: body.clientId,
            storeId: 7,
            storeName: 'Sharma Kirana',
            areaId: 1,
            areaName: 'Gandhi Nagar',
            soldAt: body.soldAt,
            saleDate: getState().outbox[0]?.saleDate ?? '2026-10-31',
            paymentMode: 'cash',
            totalPaise: 0,
            totalQuantity: 0,
            returnedQuantity: 2,
            status: 'completed',
            cancelledBy: null,
            cancelReason: null,
            items: [],
            returns: [{ productId: 3, productName: 'Pav 6 pcs', quantity: 2 }],
          },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const key = actions.saveBill();
      expect(key).toBeTruthy();
      await actions.syncNow();
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ storeId: 7, items: [], returns: [{ productId: 3, quantity: 2 }], totalPaise: 0 });
    expect(getState().outbox).toEqual([]);
    const day = Object.values(getState().history)[0];
    const bills = billsForDate(getState(), day.date);
    expect(bills[0].returns).toEqual([{ productId: 3, name: 'Pav 6 pcs', quantity: 2 }]);
    expect(summarize(bills)).toMatchObject({ bills: 0, totalPaise: 0, returned: 2 });
  });

  it('sends the discount it used with each bill line', async () => {
    const { actions } = await import('./store');
    __setStateForTests({
      catalog: withDiscounts,
      outbox: [],
      draft: { storeId: 7, storeName: 'Sharma Kirana', areaId: 1, areaName: 'Gandhi Nagar', qty: { 1: 3 }, ret: { 1: 1 }, mode: 'sale', paymentMode: 'upi' },
    });
    const bodies: Array<{ items: unknown[]; returns: unknown[]; totalPaise: number }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ error: 'down' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    try {
      actions.saveBill();
      await actions.syncNow();
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(bodies[0]).toMatchObject({
      items: [{ productId: 1, quantity: 3, unitPricePaise: 4000, discount: { kind: 'percent', value: 500 } }],
      returns: [{ productId: 1, quantity: 1 }],
      totalPaise: 11400,
    });
    // The server was down: the bill stays on the phone with its returns
    expect(getState().outbox[0]).toMatchObject({ totalPaise: 11400, returns: [{ productId: 1, quantity: 1 }] });
  });

  it('still reads bills saved by the older app version (no returns, no discounts)', () => {
    __setStateForTests({
      outbox: [
        {
          clientId: 'old-1',
          driverId: 5,
          storeId: 7,
          storeName: 'Sharma Kirana',
          areaId: 1,
          areaName: 'Gandhi Nagar',
          soldAt: '2026-10-31T09:00:00Z',
          saleDate: '2026-10-31',
          paymentMode: 'cash',
          items: [{ productId: 1, name: 'Milk Bread 400g', unitPricePaise: 4000, quantity: 2, lineTotalPaise: 8000 }],
          totalPaise: 8000,
          totalQuantity: 2,
          attempts: 0,
        },
      ],
      history: {},
      auth: { token: 't', driver: { id: 5, name: 'Ramesh', phone: '9000000001' } },
    });
    const bills = billsForDate(getState(), '2026-10-31');
    expect(bills[0].returns).toEqual([]);
    expect(summarize(bills)).toMatchObject({ bills: 1, totalPaise: 8000, returned: 0 });
  });
});

describe('new app versions and fresh prices', () => {
  it('switches to a downloaded new version only on the home screen', async () => {
    const { __testHooks, actions } = await import('./store');
    let reloads = 0;
    const hooks = __testHooks({ reload: () => reloads++ });
    const store = new Map<string, string>();
    (globalThis as { sessionStorage?: unknown }).sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    };
    __setStateForTests({ auth: { token: 't', driver: { id: 5, name: 'R', phone: '9' } }, stack: [{ name: 'home' }, { name: 'cart' }] });
    actions.updateReady();
    hooks.applyUpdateIfSafe();
    expect(reloads).toBe(0); // in the middle of a bill: wait
    actions.back();
    hooks.applyUpdateIfSafe();
    expect(reloads).toBe(1); // back home: switch
    actions.updateReady();
    hooks.applyUpdateIfSafe();
    expect(reloads).toBe(1); // never twice in a row
  });

  it('downloads prices and discounts again only when they changed', async () => {
    const { __testHooks } = await import('./store');
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    let serverVersion = 'v1';
    globalThis.fetch = (async (url: string) => {
      calls.push(String(url));
      const body = String(url).endsWith('/catalog/version')
        ? { version: serverVersion }
        : { ...catalog, version: serverVersion, discounts: [{ storeId: 7, productId: 1, kind: 'percent', value: 500 }] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    try {
      __setStateForTests({ auth: { token: 't', driver: { id: 5, name: 'R', phone: '9' } }, catalog: { ...catalog, version: 'v1' } });
      await __testHooks({}).checkCatalogVersion();
      expect(calls.filter((c) => c.endsWith('/api/driver/catalog'))).toHaveLength(0);
      serverVersion = 'v2';
      await __testHooks({}).checkCatalogVersion();
      expect(calls.filter((c) => c.endsWith('/api/driver/catalog'))).toHaveLength(1);
      expect(getState().catalog?.version).toBe('v2');
      expect(getState().catalog?.discounts).toHaveLength(1);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
