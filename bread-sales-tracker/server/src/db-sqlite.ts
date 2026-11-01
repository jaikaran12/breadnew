import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { normalizeParam, normalizeRow, returnsRows, type Db, type Row, type RunResult, type Statement } from './db.js';

/** SQLite database in a file (or ':memory:'), for tests and for running on your own computer/server. */
export function openSqliteDb(file: string): Db & { close(): void } {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');

  const execOne = (sql: string, params: unknown[] = []): RunResult => {
    const stmt = db.prepare(sql);
    const args = params.map(normalizeParam) as Array<string | number | null>;
    if (returnsRows(sql)) {
      const rows = (stmt.all(...args) as Row[]).map(normalizeRow);
      return { changes: rows.length, lastRowId: 0, rows };
    }
    const r = stmt.run(...args);
    return { changes: Number(r.changes), lastRowId: Number(r.lastInsertRowid), rows: [] };
  };

  return {
    async all<R>(sql: string, params?: unknown[]) {
      return execOne(sql, params).rows as R[];
    },
    async first<R>(sql: string, params?: unknown[]) {
      return execOne(sql, params).rows[0] as R | undefined;
    },
    async run(sql: string, params?: unknown[]) {
      return execOne(sql, params);
    },
    async batch(statements: Statement[]) {
      db.exec('BEGIN');
      try {
        const results = statements.map((s) => execOne(s.sql, s.params));
        db.exec('COMMIT');
        return results;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    async exec(sql: string) {
      db.exec(sql);
    },
    close() {
      db.close();
    },
  };
}
