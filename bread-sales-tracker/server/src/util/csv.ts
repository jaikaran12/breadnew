/**
 * Minimal CSV/TSV support for importing shop lists and exporting reports.
 * Handles quoted fields, escaped quotes ("") and CRLF line endings. The delimiter is
 * detected from the header line so text pasted straight from Excel (tab separated) works too.
 */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts: Array<[string, number]> = [
    ['\t', (firstLine.match(/\t/g) ?? []).length],
    [',', (firstLine.match(/,/g) ?? []).length],
    [';', (firstLine.match(/;/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

export function parseCsv(input: string, delimiter = detectDelimiter(input)): string[][] {
  const text = input.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop completely empty lines
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Stop spreadsheet apps from treating user text as a formula.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Builds a CSV document. Starts with a BOM so Excel shows Hindi and ₹ correctly. */
export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header, ...rows].map((r) => r.map(escapeCell).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}
