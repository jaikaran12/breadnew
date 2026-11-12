import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { discountPercent, TALLY_HEADER, tallyRows, tallyWorkbook } from '../src/tally';
import type { Sale } from '../src/types';
import { columnName, excelDate } from '../src/xlsx';

// Copied by hand from the owner's Tally template (Sales_1.xlsx), in order. Tally maps columns by these exact headings.
const TEMPLATE_HEADINGS =
  'Voucher Date|Voucher Type Name|Voucher Type Class|Change Mode |Voucher Number|Buyer Name|Buyer/Supplier - Bill to/from|' +
  'Buyer/Supplier - Mailing Name|Buyer/Supplier - Address|Buyer/Supplier - State|Buyer/Supplier - Country|' +
  'Buyer/Supplier - Pincode|Buyer/Supplier - GST Registration Type|Buyer/Supplier - GSTIN/UIN|Buyer/Supplier - Place of Supply|' +
  'Price Level|Sales Ledger|Ledger Amount|Top Ledger Amount Dr/Cr|Item Name|Billed Quantity|Item Rate|Item Rate per|Disc%|' +
  'Item Amount|Bottom Ledger Amount Dr/Cr|IGST|IGST AMT|CGST|CGST AMT|SGST|SGST AMT|Roundoff Amount Ledger|' +
  'Roundoff Amount Ledger Amount|Voucher Narration|Do you want to generate payment link/QR Code|WhattsApp';

const base = {
  clientId: 'x',
  driverId: 1,
  driverName: 'Ramesh',
  areaId: 1,
  areaName: 'Gandhi Nagar',
  soldAt: '2026-11-06T04:00:00.000Z',
  paymentMode: 'cash',
  discountPaise: 0,
  returnedQuantity: 0,
  returnedPaise: 0,
  status: 'completed',
  cancelledAt: null,
  cancelledBy: null,
  cancelReason: null,
  createdAt: '2026-11-06T04:00:01.000Z',
  priceMismatch: false,
  returns: [],
};
const item = (name: string, qty: number, rate: number, kind: 'percent' | 'amount' | null, value: number | null, discount: number) => ({
  productId: 1,
  productName: name,
  unitPricePaise: rate,
  listPricePaise: rate,
  quantity: qty,
  discountKind: kind,
  discountValue: value,
  discountPaise: discount,
  listDiscountPaise: discount,
  lineTotalPaise: rate * qty - discount,
});

// Bill 12: shop without GSTIN; Classic White 3 × ₹17, Brown 2 × ₹42.50 at 5% off (₹4.25), Milk 800 2 × ₹75 at ₹2 off each (₹4);
// expired back: 1 Brown at 5% off (₹40.37) and 2 Pav swapped by an older app version (no charge)
const bill12 = {
  ...base,
  id: 12,
  saleDate: '2026-11-06',
  storeId: 1,
  storeName: 'NEW KIRANA STORE MAIN BAZAR',
  storeAddress: 'Near temple\nMain Bazar',
  storePincode: '180011',
  storeGstin: null,
  totalQuantity: 7,
  discountPaise: 825,
  returnedQuantity: 3,
  returnedPaise: 4037,
  totalPaise: 5100 + 8075 + 14600 - 4037,
  items: [
    item('Classic White Loaf 200GMS', 3, 1700, null, null, 0),
    item('Brown Bread 350GMS', 2, 4250, 'percent', 500, 425),
    item('Milk Bread 800GMS', 2, 7500, 'amount', 200, 400),
  ],
  returns: [
    { productId: 2, productName: 'Brown Bread 350GMS', quantity: 1, unitPricePaise: 4250, listPricePaise: 4250, discountKind: 'percent', discountValue: 500, discountPaise: 213, listDiscountPaise: 213, creditPaise: 4037 },
    { productId: 3, productName: 'Pav 6 pcs', quantity: 2, unitPricePaise: 3000, listPricePaise: 3000, discountKind: null, discountValue: null, discountPaise: 0, listDiscountPaise: 0, creditPaise: 0 },
  ],
} as unknown as Sale;

// Bill 9 (earlier day): registered shop
const bill9 = {
  ...base,
  id: 9,
  saleDate: '2026-11-05',
  storeId: 2,
  storeName: 'Sharma Kirana',
  storeAddress: 'Main road',
  storePincode: null,
  storeGstin: '01ABCDE1234F1ZE',
  totalQuantity: 1,
  totalPaise: 1700,
  items: [item('Classic White Loaf 200GMS', 1, 1700, null, null, 0)],
} as unknown as Sale;

const cancelled = { ...bill9, id: 10, status: 'cancelled' } as unknown as Sale;
// Only an expired item taken back, nothing given
const returnsOnly = {
  ...base,
  id: 13,
  saleDate: '2026-11-06',
  storeId: 2,
  storeName: 'Sharma Kirana',
  storeAddress: null,
  storePincode: null,
  storeGstin: '01ABCDE1234F1ZE',
  totalQuantity: 0,
  returnedQuantity: 1,
  returnedPaise: 1700,
  totalPaise: -1700,
  items: [],
  returns: [{ productId: 1, productName: 'Classic White Loaf 200GMS', quantity: 1, unitPricePaise: 1700, listPricePaise: 1700, discountKind: null, discountValue: null, discountPaise: 0, listDiscountPaise: 0, creditPaise: 1700 }],
} as unknown as Sale;

const at = (row: unknown[], heading: string) => row[TEMPLATE_HEADINGS.split('|').indexOf(heading)];

describe('Tally bulk-upload file', () => {
  it('uses exactly the template headings, in the same order', () => {
    expect(TALLY_HEADER.join('|')).toBe(TEMPLATE_HEADINGS);
    expect(TALLY_HEADER).toHaveLength(37);
    expect(columnName(TALLY_HEADER.length - 1)).toBe('AK');
  });

  it('converts discounts to a percent of the rate', () => {
    expect(discountPercent(item('a', 2, 4250, 'percent', 500, 425))).toBe(5);
    expect(discountPercent(item('a', 1, 4250, 'percent', 250, 106))).toBe(2.5);
    expect(discountPercent(item('a', 2, 7500, 'amount', 200, 400))).toBe(2.6667); // ₹2 off ₹75
    expect(discountPercent(item('a', 7, 4250, 'amount', 150, 1050))).toBe(3.5294); // ₹1.50 off ₹42.50
    expect(discountPercent(item('a', 1, 4000, 'amount', 5000, 4000))).toBe(100); // never more than the rate
    expect(discountPercent(item('a', 3, 1700, null, null, 0))).toBe(0);
  });

  it('makes one row per bill line with the bill number, shop details and the default values', () => {
    const file = tallyRows([bill12, cancelled, bill9], { returns: true });
    expect(file.bills).toBe(2);
    // Oldest bill first; cancelled bills left out; the free swap (older app) is not a line
    expect(file.rows.map((r) => [at(r, 'Voucher Number'), at(r, 'Item Name'), at(r, 'Billed Quantity')])).toEqual([
      [9, 'Classic White Loaf 200GMS', 1],
      [12, 'Classic White Loaf 200GMS', 3],
      [12, 'Brown Bread 350GMS', 2],
      [12, 'Milk Bread 800GMS', 2],
      [12, 'Brown Bread 350GMS', -1],
    ]);
    const [registered, first, brown, milk, back] = file.rows;
    expect(first).toEqual([
      { date: '2026-11-06' },
      'Bill of Supply',
      'Bill of Supply',
      'Item Invoice',
      12,
      'NEW KIRANA STORE MAIN BAZAR',
      'NEW KIRANA STORE MAIN BAZAR',
      'NEW KIRANA STORE MAIN BAZAR',
      'Near temple, Main Bazar',
      'Jammu & Kashmir',
      'India',
      180011,
      'Unregistered/Consumer',
      null,
      'Jammu & Kashmir',
      'Retailer',
      'Sales',
      51,
      'Cr',
      'Classic White Loaf 200GMS',
      3,
      17,
      'nos',
      0,
      51,
      'Dr',
      'IGST',
      0,
      'CGST',
      0,
      'SGST',
      0,
      'Roundoff Amount',
      0,
      'test',
      'No',
      'Esc',
    ]);
    expect(first).toHaveLength(37);
    // Discounts: rate stays the bill's rate, Disc% as a percent, amount exactly as on the bill
    expect([at(brown, 'Item Rate'), at(brown, 'Disc%'), at(brown, 'Item Amount'), at(brown, 'Ledger Amount')]).toEqual([42.5, 5, 80.75, 80.75]);
    expect([at(milk, 'Item Rate'), at(milk, 'Disc%'), at(milk, 'Item Amount'), at(milk, 'Ledger Amount')]).toEqual([75, 2.6667, 146, 146]);
    // Expired item taken back: a minus line at the shop's rate
    expect([at(back, 'Billed Quantity'), at(back, 'Item Rate'), at(back, 'Disc%'), at(back, 'Item Amount'), at(back, 'Ledger Amount')]).toEqual([
      -1, 42.5, 5, -40.37, -40.37,
    ]);
    // Registered shop: Regular with its GSTIN; no pincode → empty
    expect([at(registered, 'Buyer/Supplier - GST Registration Type'), at(registered, 'Buyer/Supplier - GSTIN/UIN'), at(registered, 'Buyer/Supplier - Pincode')]).toEqual([
      'Regular',
      '01ABCDE1234F1ZE',
      null,
    ]);
    // Each bill's rows add up to its net amount
    const sum = (id: number) => file.rows.filter((r) => at(r, 'Voucher Number') === id).reduce((a, r) => a + Math.round((at(r, 'Item Amount') as number) * 100), 0);
    expect(sum(12)).toBe(bill12.totalPaise);
    expect(sum(9)).toBe(bill9.totalPaise);
    expect(file.amountPaise).toBe(bill12.totalPaise + bill9.totalPaise);
    expect(file.shopsWithoutGstin).toEqual(['NEW KIRANA STORE MAIN BAZAR (Gandhi Nagar)']);
    expect(file.shopsWithoutPincode).toEqual(['Sharma Kirana (Gandhi Nagar)']);
    expect(file.sameNameShops).toEqual([]);
    // Two different shops called "Sharma Kirana" (Tally would merge them)
    const other = { ...bill9, id: 14, storeId: 7, areaName: 'Station Road', storeName: 'SHARMA KIRANA' } as unknown as Sale;
    expect(tallyRows([bill9, other], { returns: true }).sameNameShops).toEqual(['Sharma Kirana (Gandhi Nagar, Station Road)']);
  });

  it('can leave the expired returns out', () => {
    const file = tallyRows([bill12, returnsOnly], { returns: false });
    expect(file.rows).toHaveLength(3);
    expect(file.rows.every((r) => (at(r, 'Billed Quantity') as number) > 0)).toBe(true);
    expect(file.skipped).toBe(1); // the returns-only visit has nothing to send
    expect(file.amountPaise).toBe(5100 + 8075 + 14600);
    const withReturns = tallyRows([returnsOnly], { returns: true });
    expect(withReturns.rows.map((r) => [at(r, 'Billed Quantity'), at(r, 'Item Amount')])).toEqual([[-1, -17]]);
  });

  it('writes an Excel file Tally can read: sheet "Accounting Voucher", text headings, real dates shown as dd-mm-yyyy', () => {
    const zip = unzipSync(tallyWorkbook(tallyRows([bill12, bill9], { returns: true })));
    expect(Object.keys(zip)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/worksheets/sheet1.xml',
      'xl/styles.xml',
      'xl/sharedStrings.xml',
    ]);
    const workbook = strFromU8(zip['xl/workbook.xml']);
    expect(workbook).toContain('<sheet name="Accounting Voucher" sheetId="1" r:id="rId1"/>');
    const strings = strFromU8(zip['xl/sharedStrings.xml']);
    const sharedList = [...strings.matchAll(/<si><t(?: xml:space="preserve")?>(.*?)<\/t><\/si>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    // The first 37 shared strings are the headings, in order; the space after "Change Mode " is kept
    expect(sharedList.slice(0, 37).join('|')).toBe(TEMPLATE_HEADINGS);
    expect(strings).toContain('<t xml:space="preserve">Change Mode </t>');
    expect(strings).toContain('Jammu &amp; Kashmir');
    const styles = strFromU8(zip['xl/styles.xml']);
    expect(styles).toContain('<numFmt numFmtId="164" formatCode="dd-mm-yyyy"/>');
    const sheet = strFromU8(zip['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('<dimension ref="A1:AK6"/>');
    // Row 2 is bill 9 (5 Nov 2026): a date cell with the dd-mm-yyyy style, then text cells, then numbers
    expect(sheet).toContain(`<c r="A2" s="1"><v>${excelDate('2026-11-05')}</v></c>`);
    expect(excelDate('2026-11-06')).toBe(46332);
    expect(sheet).toMatch(/<c r="E2"><v>9<\/v><\/c>/);
    expect(sheet).toMatch(/<c r="V4"><v>42\.5<\/v><\/c>/);
    expect(sheet).toMatch(/<c r="Y6"><v>-40\.37<\/v><\/c>/);
    // Empty cells are left out, like Excel does (no GSTIN for bill 12)
    expect(sheet).not.toMatch(/<c r="N3"/);
  });
});
