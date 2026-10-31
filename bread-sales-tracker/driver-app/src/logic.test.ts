import { describe, expect, it } from 'vitest';
import { productCode } from './components/ui';
import { rupees } from './money';
import { billsForDate, getState, linesTotal, summarize, draftLines, __setStateForTests } from './store';
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
    expect(linesTotal(lines)).toEqual({ totalPaise: 41750, quantity: 10 });
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
    expect(summarize(bills)).toEqual({ bills: 3, totalPaise: 15500, cashPaise: 8000, upiPaise: 5000, creditPaise: 2500, quantity: 4 });
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
