/**
 * Database access used by the whole server. The same SQL (SQLite dialect) runs on:
 *  - Cloudflare D1 in production (see db-d1.ts), and
 *  - SQLite on a normal computer for tests and self-hosting (see db-sqlite.ts).
 *
 * Money is stored as whole paise (INTEGER), dates as 'YYYY-MM-DD' text and timestamps as ISO-8601 UTC text,
 * so totals are exact and nothing depends on the server's time zone.
 */
export type Row = Record<string, unknown>;

export interface Statement {
  sql: string;
  params?: unknown[];
}

export interface RunResult {
  changes: number;
  lastRowId: number;
  rows: Row[];
}

export interface Db {
  all<R = Row>(sql: string, params?: unknown[]): Promise<R[]>;
  first<R = Row>(sql: string, params?: unknown[]): Promise<R | undefined>;
  run(sql: string, params?: unknown[]): Promise<RunResult>;
  /** Runs several statements as one all-or-nothing transaction. */
  batch(statements: Statement[]): Promise<RunResult[]>;
  /** Runs SQL text with several statements and no parameters (schema changes). */
  exec(sql: string): Promise<void>;
}

/** Values the drivers accept: booleans become 1/0, dates become ISO text, undefined becomes NULL. */
export function normalizeParam(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** Columns named isSomething hold 0/1 in SQLite; give them back to the app as true/false. */
export function normalizeRow(row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = /^is[A-Z]/.test(key) && (value === 0 || value === 1) ? value === 1 : value;
  }
  return out;
}

export function returnsRows(sql: string): boolean {
  return /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);
}

export function isUniqueViolation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /UNIQUE constraint failed/i.test(message);
}

/** Current time as stored in the database. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Escapes % and _ for LIKE ... ESCAPE '\\'. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
