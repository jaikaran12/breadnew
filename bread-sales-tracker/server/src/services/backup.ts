import { once } from 'node:events';
import type { Writable } from 'node:stream';
import type pg from 'pg';
import { latestMigration } from '../migrate.js';
import type { Pool, Queryable } from '../db.js';

/**
 * Tables in the order they must be restored (parents before children).
 * Every table is ordered by its first column (the primary key) when exported.
 */
export const BACKUP_TABLES = [
  'app_settings',
  'admins',
  'areas',
  'drivers',
  'stores',
  'products',
  'product_price_history',
  'sales',
  'sale_items',
  'settlements',
] as const;

export const BACKUP_FORMAT = 'bread-sales-backup';
const BATCH = 2000;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: 1;
  createdAt: string;
  migration: string | null;
  tables: Record<string, Array<Record<string, unknown>>>;
}

async function write(out: Writable, chunk: string): Promise<void> {
  if (!out.write(chunk)) await once(out, 'drain');
}

/**
 * Streams a complete copy of the database as JSON into `out` (usually a gzip stream).
 * Uses one read-only snapshot, so the copy is consistent even while drivers keep sending bills.
 */
export async function writeBackup(pool: Pool, out: Writable): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const header = {
      format: BACKUP_FORMAT,
      version: 1,
      createdAt: new Date().toISOString(),
      migration: await latestMigration(),
    };
    await write(out, `${JSON.stringify(header).slice(0, -1)},"tables":{`);
    for (const [ti, table] of BACKUP_TABLES.entries()) {
      await write(out, `${ti ? ',' : ''}${JSON.stringify(table)}:[`);
      let offset = 0;
      let first = true;
      for (;;) {
        const { rows } = await client.query(`SELECT * FROM ${table} ORDER BY 1 LIMIT ${BATCH} OFFSET ${offset}`);
        if (rows.length === 0) break;
        const text = rows.map((r) => JSON.stringify(r)).join(',');
        await write(out, `${first ? '' : ','}${text}`);
        first = false;
        offset += rows.length;
        if (rows.length < BATCH) break;
      }
      counts[table] = offset;
      await write(out, ']');
    }
    await write(out, '}}\n');
    await client.query('COMMIT');
    return counts;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** True when the database has no business data yet (only allowed target for a plain restore). */
export async function isDatabaseEmpty(db: Queryable): Promise<boolean> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT (SELECT count(*) FROM areas) + (SELECT count(*) FROM stores) + (SELECT count(*) FROM products)
          + (SELECT count(*) FROM drivers) + (SELECT count(*) FROM sales) AS n`,
  );
  return Number(rows[0]?.n ?? 0) === 0;
}

/**
 * Loads a backup into the database (schema must already be migrated).
 * With `replace`, all existing data is removed first. Runs in one transaction: all or nothing.
 */
export async function restoreBackup(
  pool: Pool,
  backup: BackupFile,
  options: { replace: boolean },
): Promise<Record<string, number>> {
  if (backup?.format !== BACKUP_FORMAT || typeof backup.tables !== 'object') {
    throw new Error('This file is not a Bread Sales backup');
  }
  const latest = await latestMigration();
  if (backup.migration && latest && backup.migration > latest) {
    throw new Error(`The backup was made by a newer version of the app (${backup.migration}). Update the app first.`);
  }
  const client = await pool.connect();
  const counts: Record<string, number> = {};
  try {
    await client.query('BEGIN');
    if (options.replace) {
      await client.query(`TRUNCATE ${[...BACKUP_TABLES].reverse().join(', ')} RESTART IDENTITY CASCADE`);
    } else if (!(await isDatabaseEmpty(client))) {
      throw new Error('The database already has data. Use the "replace" option to overwrite it.');
    } else {
      // A fresh server creates the first admin by itself; the backup brings its own admins.
      await client.query('TRUNCATE app_settings, admins RESTART IDENTITY CASCADE');
    }
    for (const table of BACKUP_TABLES) {
      const rows = backup.tables[table] ?? [];
      counts[table] = rows.length;
      if (rows.length === 0) continue;
      const columns = await tableColumns(client, table);
      // Only columns present in the backup: newer columns keep their default values.
      const present = columns.filter((c) => Object.prototype.hasOwnProperty.call(rows[0], c));
      const list = present.map((c) => `"${c}"`).join(', ');
      for (let i = 0; i < rows.length; i += 1000) {
        await client.query(
          `INSERT INTO ${table} (${list}) SELECT ${list} FROM json_populate_recordset(NULL::${table}, $1::json)`,
          [JSON.stringify(rows.slice(i, i + 1000))],
        );
      }
      if (columns.includes('id')) {
        await client.query(
          `SELECT setval(pg_get_serial_sequence('${table}', 'id'), coalesce((SELECT max(id) FROM ${table}), 1), (SELECT max(id) FROM ${table}) IS NOT NULL)`,
        );
      }
    }
    await client.query('COMMIT');
    return counts;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function tableColumns(client: pg.PoolClient, table: string): Promise<string[]> {
  const { rows } = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((r) => r.column_name);
}
