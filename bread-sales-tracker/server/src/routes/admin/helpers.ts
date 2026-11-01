import { z } from 'zod';
import { likePattern } from '../../db.js';
import { notFound } from '../../errors.js';
import { isValidDate } from '../../util/dates.js';

/** Collects SQL conditions and their parameters (?1, ?2, ...) for dynamic filters. */
export class Where {
  readonly parts: string[] = [];
  readonly values: unknown[] = [];

  /** Adds a value and returns its placeholder, e.g. "?3". */
  param(value: unknown): string {
    this.values.push(value);
    return `?${this.values.length}`;
  }

  /** add('s.driver_id = ?', 5) */
  add(condition: string, value: unknown): this {
    this.parts.push(condition.replace('?', this.param(value)));
    return this;
  }

  raw(condition: string): this {
    this.parts.push(condition);
    return this;
  }

  get sql(): string {
    return this.parts.length ? `WHERE ${this.parts.join(' AND ')}` : '';
  }
}

export const dateString = z.string().refine(isValidDate, 'must be a date like 2024-01-31');
export const optionalId = z.coerce.number().int().positive().optional();

/** Query-string values: treat "" as missing. */
export function cleanQuery(query: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(query)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value !== '' && value !== undefined && value !== null) out[k] = value;
  }
  return out;
}

export function idParam(value: string | string[] | undefined): number {
  const id = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isInteger(id) || id <= 0) throw notFound();
  return id;
}

/** "₹40.50" style input from forms arrives as paise already; this only guards the range. */
export const paiseSchema = z.number().int().min(0).max(10_000_000);

export const salesFilterSchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  driverId: optionalId,
  areaId: optionalId,
  storeId: optionalId,
  paymentMode: z.enum(['cash', 'upi', 'credit']).optional(),
  status: z.enum(['completed', 'cancelled', 'all']).optional(),
  q: z.string().trim().max(100).optional(),
});
export type SalesFilter = z.infer<typeof salesFilterSchema>;

/** WHERE clause for the sales table (alias s, joined stores alias st). */
export function salesWhere(filter: SalesFilter, today: string, defaultStatus: 'completed' | 'all'): Where {
  const w = new Where();
  w.add('s.sale_date >= ?', filter.from ?? today);
  w.add('s.sale_date <= ?', filter.to ?? filter.from ?? today);
  if (filter.driverId) w.add('s.driver_id = ?', filter.driverId);
  if (filter.areaId) w.add('s.area_id = ?', filter.areaId);
  if (filter.storeId) w.add('s.store_id = ?', filter.storeId);
  if (filter.paymentMode) w.add('s.payment_mode = ?', filter.paymentMode);
  const status = filter.status ?? defaultStatus;
  if (status !== 'all') w.add('s.status = ?', status);
  if (filter.q) {
    const p = w.param(likePattern(filter.q));
    const idMatch = /^#?\d+$/.test(filter.q) ? ` OR s.id = ${w.param(Number(filter.q.replace('#', '')))}` : '';
    w.raw(`(st.name LIKE ${p} ESCAPE '\\' OR st.owner_name LIKE ${p} ESCAPE '\\'${idMatch})`);
  }
  return w;
}
