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
      totalPaise: 20000,
      discountPaise: 500,
      returnedQuantity: 2,
      status: 'completed',
      cancelledBy: null,
      cancelReason: null,
      items: [
        { productId: 1, productName: 'Milk Bread', unitPricePaise: 4000, listPricePaise: 4000, quantity: 3, discountPaise: 0, lineTotalPaise: 12000 },
        { productId: 2, productName: 'Brown Bread', unitPricePaise: 4250, listPricePaise: 4250, quantity: 2, discountPaise: 500, lineTotalPaise: 8000 },
      ],
      returns: [{ productId: 3, productName: 'White Bread', quantity: 2, unitPricePaise: 3500 }],
    } as unknown as Sale;
    const bills = salesCsv([sale], 'bills');
    expect(bills.rows).toEqual([
      [7, '2026-01-31', '08:45 am', 'Ramesh', 'Gandhi Nagar', 'Sharma Kirana', 'UPI', 5, '5.00', '200.00', 2, 'completed', '', ''],
    ]);
    const items = salesCsv([sale], 'items');
    // Type, Product, Qty, Rate, Discount, Amount
    expect(items.rows.map((r) => r.slice(6, 12))).toEqual([
      ['Sale', 'Milk Bread', 3, '40.00', '0.00', '120.00'],
      ['Sale', 'Brown Bread', 2, '42.50', '5.00', '80.00'],
      ['Expired return', 'White Bread', 2, '', '', '0.00'],
    ]);
  });
});
