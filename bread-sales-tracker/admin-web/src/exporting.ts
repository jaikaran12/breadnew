import { api, qs } from './api';
import { addDays, getTimeZone, PAYMENT_LABEL } from './format';
import type { Sale } from './types';

/*
 * Spreadsheet (CSV) files and backups are put together here in the browser from small pieces fetched
 * one after another, so the (free) server never has to build one big file in a single request.
 */

export type Progress = (done: number, total: number) => void;

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Stop spreadsheet apps from treating user text as a formula.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** CSV text. Starts with a BOM so Excel shows Hindi and ₹ correctly. */
export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header, ...rows].map((r) => r.map(escapeCell).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Paise -> "1234.50" (plain number for Excel). */
export function paiseText(paise: number | null | undefined): string {
  const p = Math.round(Number(paise ?? 0));
  const abs = Math.abs(p);
  return `${p < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function saveFile(fileName: string, content: BlobPart | Blob, type = 'text/csv;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function saveCsv(fileName: string, header: string[], rows: unknown[][]) {
  saveFile(fileName, toCsv(header, rows));
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { timeZone: getTimeZone(), hour: '2-digit', minute: '2-digit' });

export const MAX_EXPORT_DAYS = 400;

type SalesQuery = Record<string, string | number | undefined>;

/** All bills between query.from and query.to (with their items), fetched day by day. */
export async function fetchSalesForExport(query: SalesQuery & { from: string; to: string }, onProgress?: Progress): Promise<Sale[]> {
  const { from, to, ...filters } = query;
  const days: string[] = [];
  for (let d = from; d <= to && days.length <= MAX_EXPORT_DAYS; d = addDays(d, 1)) days.push(d);
  if (days.length > MAX_EXPORT_DAYS) throw new Error(`Download at most ${MAX_EXPORT_DAYS} days at a time`);
  const all: Sale[] = [];
  for (const [i, date] of days.entries()) {
    let offset: number | null = 0;
    while (offset !== null) {
      const page: { sales: Sale[]; nextOffset: number | null } = await api.get('/sales/export', { ...filters, date, offset });
      all.push(...page.sales);
      offset = page.nextOffset;
    }
    onProgress?.(i + 1, days.length);
  }
  return all;
}

export function salesCsv(sales: Sale[], type: 'bills' | 'items'): { header: string[]; rows: unknown[][] } {
  if (type === 'bills') {
    return {
      header: [
        'Bill no',
        'Date',
        'Time',
        'Driver',
        'Area',
        'Shop',
        'Payment',
        'Units',
        'Discount (Rs)',
        'Amount (Rs)',
        'Expired taken back (units)',
        'Status',
        'Cancelled by',
        'Cancel reason',
      ],
      rows: sales.map((s) => [
        s.id,
        s.saleDate,
        clock(s.soldAt),
        s.driverName,
        s.areaName,
        s.storeName,
        s.totalQuantity > 0 ? (PAYMENT_LABEL[s.paymentMode] ?? s.paymentMode) : '',
        s.totalQuantity,
        paiseText(s.discountPaise ?? 0),
        paiseText(s.totalPaise),
        s.returnedQuantity ?? 0,
        s.status,
        s.cancelledBy ?? '',
        s.cancelReason ?? '',
      ]),
    };
  }
  return {
    header: [
      'Bill no',
      'Date',
      'Time',
      'Driver',
      'Area',
      'Shop',
      'Type',
      'Product',
      'Qty',
      'Rate (Rs)',
      'Discount (Rs)',
      'Amount (Rs)',
      'Payment',
      'Status',
    ],
    rows: sales.flatMap((s) => [
      ...s.items.map((i) => [
        s.id,
        s.saleDate,
        clock(s.soldAt),
        s.driverName,
        s.areaName,
        s.storeName,
        'Sale',
        i.productName,
        i.quantity,
        paiseText(i.unitPricePaise),
        paiseText(i.discountPaise ?? 0),
        paiseText(i.lineTotalPaise),
        PAYMENT_LABEL[s.paymentMode] ?? s.paymentMode,
        s.status,
      ]),
      // Expired items taken back and replaced: no money, so no rate or amount.
      ...(s.returns ?? []).map((r) => [
        s.id,
        s.saleDate,
        clock(s.soldAt),
        s.driverName,
        s.areaName,
        s.storeName,
        'Expired return',
        r.productName,
        r.quantity,
        '',
        '',
        paiseText(0),
        '',
        s.status,
      ]),
    ]),
  };
}

interface BackupInfo {
  format: string;
  version: 1;
  createdAt: string;
  migration: string | null;
  tables: string[];
  lastIds: Record<string, number>;
  pageSize: number;
}

/**
 * Downloads every table in pieces and saves one backup file (gzip-compressed JSON when the browser can,
 * plain JSON otherwise). Restore it with the restore script in the server folder (see README).
 */
export async function downloadBackup(onProgress?: Progress): Promise<void> {
  const info = await api.get<BackupInfo>('/backup/info');
  const ranges: Array<{ table: string; after: number; upto: number }> = [];
  for (const table of info.tables) {
    const last = table === 'app_settings' ? 0 : (info.lastIds[table] ?? 0);
    if (table === 'app_settings') ranges.push({ table, after: 0, upto: 0 });
    for (let after = 0; after < last; after += info.pageSize) {
      ranges.push({ table, after, upto: Math.min(after + info.pageSize, last) });
    }
  }
  // JSON text is built in pieces (a big single string could be too much for the browser).
  const parts: string[] = [
    `{"format":${JSON.stringify(info.format)},"version":${info.version},"createdAt":${JSON.stringify(info.createdAt)},` +
      `"migration":${JSON.stringify(info.migration)},"tables":{`,
  ];
  let done = 0;
  for (const [ti, table] of info.tables.entries()) {
    parts.push(`${ti ? ',' : ''}${JSON.stringify(table)}:[`);
    let first = true;
    for (const r of ranges.filter((x) => x.table === table)) {
      const page = await api.get<{ rows: unknown[] }>(`/backup/table/${table}${qs({ after: r.after, upto: r.upto })}`);
      if (page.rows.length) {
        parts.push(`${first ? '' : ','}${JSON.stringify(page.rows).slice(1, -1)}`);
        first = false;
      }
      onProgress?.(++done, ranges.length);
    }
    parts.push(']');
  }
  parts.push('}}');

  const stamp = info.createdAt.slice(0, 16).replace('T', '_').replace(':', '');
  let blob = new Blob(parts, { type: 'application/json' });
  let name = `bread-sales-backup-${stamp}.json`;
  if (typeof CompressionStream !== 'undefined') {
    blob = await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
    name += '.gz';
  }
  saveFile(name, blob, blob.type || 'application/gzip');
  await api.post('/backup/done');
}
