import { normalizeParam, normalizeRow, returnsRows, type Db, type Row, type RunResult, type Statement } from './db.js';

/** Minimal shape of the Cloudflare D1 binding (so this file needs no Cloudflare type packages). */
interface D1Result {
  results?: Row[];
  meta?: { changes?: number; last_row_id?: number };
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all(): Promise<D1Result>;
  run(): Promise<D1Result>;
}
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
  exec(sql: string): Promise<unknown>;
}

function toResult(r: D1Result): RunResult {
  const rows = (r.results ?? []).map(normalizeRow);
  return { changes: Number(r.meta?.changes ?? rows.length), lastRowId: Number(r.meta?.last_row_id ?? 0), rows };
}

/** Cloudflare D1 (SQLite) database used in production. */
export function d1Db(d1: D1Database): Db {
  const prepare = (sql: string, params: unknown[] = []) => d1.prepare(sql).bind(...params.map(normalizeParam));
  return {
    async all<R>(sql: string, params?: unknown[]) {
      return toResult(await prepare(sql, params).all()).rows as R[];
    },
    async first<R>(sql: string, params?: unknown[]) {
      return toResult(await prepare(sql, params).all()).rows[0] as R | undefined;
    },
    async run(sql: string, params?: unknown[]) {
      const stmt = prepare(sql, params);
      return toResult(returnsRows(sql) ? await stmt.all() : await stmt.run());
    },
    async batch(statements: Statement[]) {
      const results = await d1.batch(statements.map((s) => prepare(s.sql, s.params)));
      return results.map(toResult);
    },
    async exec(sql: string) {
      await d1.exec(sql);
    },
  };
}
