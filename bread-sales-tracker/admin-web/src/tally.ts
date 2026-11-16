import { fetchSalesForExport, saveFile, type Progress } from './exporting';
import type { DiscountRule, Sale } from './types';
import { buildXlsx, XLSX_TYPE, type Cell } from './xlsx';

/*
 * Bills as an Excel file for Tally's bulk upload, in the owner's template ("Accounting Voucher" sheet).
 * The headings, their order and the fixed values are copied exactly from that template — Tally maps the
 * columns by these headings, so do not change them (note the space after "Change Mode " and the spelling
 * "WhattsApp"). One row per bill line; all rows of a bill share its voucher number (the bill number).
 */

export const TALLY_HEADER = [
  'Voucher Date',
  'Voucher Type Name',
  'Voucher Type Class',
  'Change Mode ',
  'Voucher Number',
  'Buyer Name',
  'Buyer/Supplier - Bill to/from',
  'Buyer/Supplier - Mailing Name',
  'Buyer/Supplier - Address',
  'Buyer/Supplier - State',
  'Buyer/Supplier - Country',
  'Buyer/Supplier - Pincode',
  'Buyer/Supplier - GST Registration Type',
  'Buyer/Supplier - GSTIN/UIN',
  'Buyer/Supplier - Place of Supply',
  'Price Level',
  'Sales Ledger',
  'Ledger Amount',
  'Top Ledger Amount Dr/Cr',
  'Item Name',
  'Billed Quantity',
  'Item Rate',
  'Item Rate per',
  'Disc%',
  'Item Amount',
  'Bottom Ledger Amount Dr/Cr',
  'IGST',
  'IGST AMT',
  'CGST',
  'CGST AMT',
  'SGST',
  'SGST AMT',
  'Roundoff Amount Ledger',
  'Roundoff Amount Ledger Amount',
  'Voucher Narration',
  'Do you want to generate payment link/QR Code',
  'WhattsApp',
] as const;

/** Values that are the same on every row, exactly as in the template. */
export const TALLY = {
  sheetName: 'Accounting Voucher',
  dateFormat: 'dd-mm-yyyy',
  voucherTypeName: 'Bill of Supply',
  voucherTypeClass: 'Bill of Supply',
  changeMode: 'Item Invoice',
  state: 'Jammu & Kashmir',
  country: 'India',
  placeOfSupply: 'Jammu & Kashmir',
  /** Shop with a GSTIN */
  registered: 'Regular',
  /** Shop without a GSTIN */
  unregistered: 'Unregistered/Consumer',
  priceLevel: 'Retailer',
  salesLedger: 'Sales',
  topLedgerDrCr: 'Cr',
  ratePer: 'nos',
  bottomLedgerDrCr: 'Dr',
  igst: 'IGST',
  cgst: 'CGST',
  sgst: 'SGST',
  roundOffLedger: 'Roundoff Amount',
  /** Left blank. */
  narration: '',
  paymentLinkQr: 'No',
  whatsApp: 'Esc',
} as const;

/** Column widths of the template, so the file opens looking the same. */
const WIDTHS = [
  15.83203125, 21.33203125, 21.33203125, 13.33203125, 17.6640625, 31.33203125, 23.33203125, 25.6640625, 21.5, 21.5, 21,
  21.33203125, 19.33203125, 19.33203125, 19.33203125, 19.33203125, 19.33203125, 17.33203125, 19.1640625, 14.1640625,
  13.6640625, 13.6640625, 12.1640625, 12.1640625, 11.6640625, 26.1640625, 13.33203125, 13.33203125, 13.33203125,
  13.33203125, 13.33203125, 13.33203125, 13.33203125, 13.33203125,
];

const rupees = (paise: number) => Math.round(paise) / 100;

/**
 * The discount of a line as a percent of the rate. A % discount stays as it is (5% → 5); a "₹ off each"
 * discount is converted: ₹2 off a ₹75 rate = 2.6667%. The line amount itself is always the bill's exact amount.
 */
export function discountPercent(line: {
  unitPricePaise: number;
  discountKind: DiscountRule['kind'] | null;
  discountValue: number | null;
  discountPaise: number;
}): number {
  if (!line.discountKind || !line.discountValue || !(line.discountPaise > 0) || line.unitPricePaise <= 0) return 0;
  if (line.discountKind === 'percent') return Math.min(line.discountValue, 10000) / 100;
  const offEach = Math.min(line.discountValue, line.unitPricePaise);
  return Math.round((offEach / line.unitPricePaise) * 1_000_000) / 10_000;
}

export interface TallyOptions {
  /** Expired items taken back go in the bill as minus lines, so the Tally bill equals the net amount. */
  returns: boolean;
}

export interface TallyFile {
  rows: Cell[][];
  bills: number;
  /** Sum of all rows' amounts (paise). */
  amountPaise: number;
  /** Bills that had nothing to put in the file (only expired items taken back, with returns left out). */
  skipped: number;
  /** Shops in the file without a GSTIN (they go as Unregistered/Consumer), and without a pincode ("Name (Area)"). */
  shopsWithoutGstin: string[];
  shopsWithoutPincode: string[];
  /** Different shops with the same name: Tally would put their bills on one party ledger. */
  sameNameShops: string[];
}

/** One row per bill line (and per expired line taken back, as a minus line), oldest bill first. */
export function tallyRows(sales: Sale[], options: TallyOptions): TallyFile {
  const rows: Cell[][] = [];
  let bills = 0;
  let skipped = 0;
  let amountPaise = 0;
  const noGstin = new Set<string>();
  const noPincode = new Set<string>();
  const shopsByName = new Map<string, Map<number, string>>();
  const ordered = sales
    .filter((s) => s.status === 'completed')
    .sort((a, b) => a.saleDate.localeCompare(b.saleDate) || a.id - b.id);

  for (const sale of ordered) {
    const gstin = sale.storeGstin || null;
    const pincode = sale.storePincode || null;
    const address = (sale.storeAddress ?? '').replace(/\s*[\r\n]+\s*/g, ', ').trim() || null;
    const party: Cell[] = [
      { date: sale.saleDate },
      TALLY.voucherTypeName,
      TALLY.voucherTypeClass,
      TALLY.changeMode,
      sale.id,
      sale.storeName,
      sale.storeName,
      sale.storeName,
      address,
      TALLY.state,
      TALLY.country,
      pincode ? Number(pincode) : null,
      gstin ? TALLY.registered : TALLY.unregistered,
      gstin,
      TALLY.placeOfSupply,
      TALLY.priceLevel,
      TALLY.salesLedger,
    ];
    const tail: Cell[] = [
      TALLY.bottomLedgerDrCr,
      TALLY.igst,
      0,
      TALLY.cgst,
      0,
      TALLY.sgst,
      0,
      TALLY.roundOffLedger,
      0,
      TALLY.narration,
      TALLY.paymentLinkQr,
      TALLY.whatsApp,
    ];
    const line = (amount: number, name: string, quantity: number, ratePaise: number, discount: number): Cell[] => [
      ...party,
      rupees(amount),
      TALLY.topLedgerDrCr,
      name,
      quantity,
      rupees(ratePaise),
      TALLY.ratePer,
      discount,
      rupees(amount),
      ...tail,
    ];

    const lines: Cell[][] = [];
    let billPaise = 0;
    for (const item of sale.items) {
      lines.push(line(item.lineTotalPaise, item.productName, item.quantity, item.unitPricePaise, discountPercent(item)));
      billPaise += item.lineTotalPaise;
    }
    if (options.returns) {
      for (const r of sale.returns ?? []) {
        // Returns made with older app versions were swapped free of charge: nothing was taken off the bill.
        if (!(r.creditPaise > 0)) continue;
        lines.push(line(-r.creditPaise, r.productName, -r.quantity, r.unitPricePaise, discountPercent(r)));
        billPaise -= r.creditPaise;
      }
    }
    if (lines.length === 0) {
      skipped++;
      continue;
    }
    rows.push(...lines);
    bills++;
    amountPaise += billPaise;
    const shop = `${sale.storeName} (${sale.areaName})`;
    if (!gstin) noGstin.add(shop);
    if (!pincode) noPincode.add(shop);
    // Tally matches parties by name (capital letters or not)
    const key = sale.storeName.trim().toLowerCase();
    const same = shopsByName.get(key) ?? new Map<number, string>();
    same.set(sale.storeId, sale.areaName);
    shopsByName.set(key, same);
  }
  const sorted = (set: Set<string> | string[]) => [...set].sort((a, b) => a.localeCompare(b));
  const sameNameShops = [...shopsByName.entries()]
    .filter(([, shops]) => shops.size > 1)
    .map(([, shops]) => {
      const name = ordered.find((x) => shops.has(x.storeId))!.storeName;
      return `${name} (${sorted([...new Set(shops.values())]).join(', ')})`;
    });
  return {
    rows,
    bills,
    amountPaise,
    skipped,
    shopsWithoutGstin: sorted(noGstin),
    shopsWithoutPincode: sorted(noPincode),
    sameNameShops: sorted(sameNameShops),
  };
}

export function tallyWorkbook(file: TallyFile): Uint8Array {
  return buildXlsx({
    name: TALLY.sheetName,
    header: [...TALLY_HEADER],
    rows: file.rows,
    widths: WIDTHS,
    dateFormat: TALLY.dateFormat,
  });
}

/** Fetches the bills (valid ones only), builds the Tally file and saves it. */
export async function downloadTallyFile(
  query: Record<string, string | number | undefined> & { from: string; to: string },
  options: TallyOptions,
  onProgress?: Progress,
): Promise<TallyFile> {
  const sales = await fetchSalesForExport({ ...query, status: 'completed' }, onProgress);
  const file = tallyRows(sales, options);
  if (file.bills === 0) throw new Error('No bills to send to Tally for these dates and filters');
  const data = tallyWorkbook(file);
  saveFile(`tally-sales-${query.from}-to-${query.to}.xlsx`, new Blob([data as Uint8Array<ArrayBuffer>], { type: XLSX_TYPE }));
  return file;
}
