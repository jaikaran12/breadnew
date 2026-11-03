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
    // Given ₹200 (after ₹5 discount); expired back: White Bread 2 × ₹35 = ₹70 → net ₹130
    const sale = {
      id: 7,
      saleDate: '2026-01-31',
      soldAt: '2026-01-31T03:15:00.000Z',
      driverName: 'Ramesh',
      areaName: 'Gandhi Nagar',
      storeName: 'Sharma Kirana',
      paymentMode: 'upi',
      totalQuantity: 5,
      totalPaise: 13000,
      discountPaise: 500,
      returnedQuantity: 2,
      returnedPaise: 7000,
      status: 'completed',
      cancelledBy: null,
      cancelReason: null,
      items: [
        { productId: 1, productName: 'Milk Bread', unitPricePaise: 4000, listPricePaise: 4000, quantity: 3, discountPaise: 0, lineTotalPaise: 12000 },
        { productId: 2, productName: 'Brown Bread', unitPricePaise: 4250, listPricePaise: 4250, quantity: 2, discountPaise: 500, lineTotalPaise: 8000 },
      ],
      returns: [{ productId: 3, productName: 'White Bread', quantity: 2, unitPricePaise: 3500, discountPaise: 0, creditPaise: 7000 }],
    } as unknown as Sale;
    const bills = salesCsv([sale], 'bills');
    expect(bills.header.slice(7, 13)).toEqual([
      'Units given',
      'Discount (Rs)',
      'Given (Rs)',
      'Expired taken back (units)',
      'Expired taken back (Rs)',
      'Net amount (Rs)',
    ]);
    expect(bills.rows).toEqual([
      [7, '2026-01-31', '08:45 am', 'Ramesh', 'Gandhi Nagar', 'Sharma Kirana', 'UPI', 5, '5.00', '200.00', 2, '70.00', '130.00', 'completed', '', ''],
    ]);
    const items = salesCsv([sale], 'items');
    // Type, Product, Qty, Rate, Discount, Amount: the amounts of a bill add up to its net amount
    expect(items.rows.map((r) => r.slice(6, 12))).toEqual([
      ['Sale', 'Milk Bread', 3, '40.00', '0.00', '120.00'],
      ['Sale', 'Brown Bread', 2, '42.50', '5.00', '80.00'],
      ['Expired return', 'White Bread', 2, '35.00', '0.00', '-70.00'],
    ]);

    // A swap made with an older app version: no charge
    const old = { ...sale, totalPaise: 20000, returnedPaise: 0, returns: [{ productId: 3, productName: 'White Bread', quantity: 2, unitPricePaise: 3500, creditPaise: 0 }] } as unknown as Sale;
    expect(salesCsv([old], 'items').rows[2].slice(6, 13)).toEqual(['Expired return', 'White Bread', 2, '', '', '0.00', '']);
    expect(salesCsv([old], 'bills').rows[0].slice(9, 13)).toEqual(['200.00', 2, '0.00', '200.00']);
  });
});
