import { badRequest } from '../errors.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar date (YYYY-MM-DD) of an instant in the given IANA time zone. */
export function dateInZone(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

export function todayInZone(timeZone: string): string {
  return dateInZone(new Date(), timeZone);
}

export function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Returns the value if it is a valid YYYY-MM-DD date, the fallback if empty, else throws 400. */
export function parseDateParam(value: unknown, fallback: string, name = 'date'): string {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !isValidDate(value)) throw badRequest(`${name} must be a date like 2024-01-31`);
  return value;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
