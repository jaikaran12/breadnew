import { describe, expect, it } from 'vitest';
import { paiseText, salesCsv, toCsv } from '../src/exporting';
import type { Sale } from '../src/types';

describe('CSV files made in the browser', () => {
  it('quotes commas, quotes and new lines, and blocks spreadsheet formulas', () => {
    const csv = toCsv(['Shop', 'Note', 'Amount'], [['Patel Stores, Main Road', 'said "ok"\nlater', '=1+2'], ['Jain', '-5', null]]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Shop,Note,Amount',
      '"Patel Stores, Main Road","said ""ok""\nlater",\'=1+2',
      'Jain,-5,',
      '',
    ]);
  });

  it('writes rupee amounts as plain numbers', () => {
    expect([paiseText(4250), paiseText(100000), paiseText(5), paiseText(-1250), paiseText(null)]).toEqual([
      '42.50',
      '1000.00',
      '0.05',
      '-12.50',
      '0.00',
    ]);
  });

  it('makes one row per bill or one row per product line', () => {
    const sale = {
      id: 7,
      saleDate: '2026-01-31',
      soldAt: '2026-01-31T03:15:00.000Z',
      driverName: 'Ramesh',
      areaName: 'Gandhi Nagar',
      storeName: 'Sharma Kirana',
      paymentMode: 'upi',
      totalQuantity: 5,
      totalPaise: 20500,
      status: 'completed',
      cancelledBy: null,
      cancelReason: null,
      items: [
        { productId: 1, productName: 'Milk Bread', unitPricePaise: 4000, listPricePaise: 4000, quantity: 3, lineTotalPaise: 12000 },
        { productId: 2, productName: 'Brown Bread', unitPricePaise: 4250, listPricePaise: 4250, quantity: 2, lineTotalPaise: 8500 },
      ],
    } as unknown as Sale;
    const bills = salesCsv([sale], 'bills');
    expect(bills.rows).toEqual([[7, '2026-01-31', '08:45 am', 'Ramesh', 'Gandhi Nagar', 'Sharma Kirana', 'UPI', 5, '205.00', 'completed', '', '']]);
    const items = salesCsv([sale], 'items');
    expect(items.rows.map((r) => [r[6], r[7], r[8], r[9]])).toEqual([
      ['Milk Bread', 3, '40.00', '120.00'],
      ['Brown Bread', 2, '42.50', '85.00'],
    ]);
  });
});
