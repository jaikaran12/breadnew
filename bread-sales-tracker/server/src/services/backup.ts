import type { Db, Row, Statement } from '../db.js';

/**
 * Tables in the order they must be restored (parents before children).
 * Every table is exported ordered by its primary key.
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
export type BackupTable = (typeof BACKUP_TABLES)[number];

export const BACKUP_FORMAT = 'bread-sales-backup';
/** Rows (ids) per request when the admin website downloads a backup (keeps each request small and fast). */
export const BACKUP_PAGE_SIZE = 2000;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: 1;
  createdAt: string;
  migration: string | null;
  tables: Record<string, Row[]>;
}

export function isBackupTable(name: string): name is BackupTable {
  return (BACKUP_TABLES as readonly string[]).includes(name);
}

export async function latestMigration(db: Db): Promise<string | null> {
  const row = await db
    .first<{ name: string }>('SELECT name FROM d1_migrations ORDER BY name DESC LIMIT 1')
    .catch(() => undefined);
  return row?.name ?? null;
}

/**
 * What a backup will contain: the highest row id of every table, read in ONE statement so the set is
 * consistent (a bill and its lines are saved together). Rows added later are left for the next backup.
 * (Counting rows would read every row; the highest id is a single lookup.)
 */
export async function backupInfo(db: Db) {
  const tables = BACKUP_TABLES.filter((t) => t !== 'app_settings');
  const row = await db.first<Record<string, number | null>>(
    `SELECT ${tables.map((t) => `(SELECT max(id) FROM ${t}) AS "${t}"`).join(', ')}`,
  );
  const lastIds: Record<string, number> = {};
  for (const t of tables) lastIds[t] = Number(row?.[t] ?? 0);
  return {
    format: BACKUP_FORMAT,
    version: 1 as const,
    createdAt: new Date().toISOString(),
    migration: await latestMigration(db),
    tables: [...BACKUP_TABLES],
    lastIds,
    pageSize: BACKUP_PAGE_SIZE,
  };
}

/**
 * Raw rows of a table, exactly as stored (0/1 booleans, ISO text timestamps), with after < id <= upto
 * (app_settings: all rows). Ranges of ids instead of OFFSET, so every row is read only once.
 */
export async function backupPage(db: Db, table: BackupTable, after = 0, upto = after + BACKUP_PAGE_SIZE): Promise<Row[]> {
  if (table === 'app_settings') return db.all('SELECT * FROM app_settings ORDER BY key');
  return db.all(`SELECT * FROM ${table} WHERE id > ?1 AND id <= ?2 ORDER BY id`, [after, upto]);
}

/** Builds a complete backup in memory (used by scripts and tests; the website downloads it piece by piece). */
export async function buildBackup(db: Db): Promise<BackupFile> {
  const info = await backupInfo(db);
  const tables: Record<string, Row[]> = { app_settings: await backupPage(db, 'app_settings') };
  for (const table of BACKUP_TABLES) {
    if (table === 'app_settings') continue;
    tables[table] = [];
    for (let after = 0; after < info.lastIds[table]; after += BACKUP_PAGE_SIZE) {
      tables[table].push(...(await backupPage(db, table, after, Math.min(after + BACKUP_PAGE_SIZE, info.lastIds[table]))));
    }
  }
  return { format: BACKUP_FORMAT, version: 1, createdAt: info.createdAt, migration: info.migration, tables };
}

function checkBackup(backup: BackupFile, latest: string | null) {
  if (backup?.format !== BACKUP_FORMAT || typeof backup.tables !== 'object') {
    throw new Error('This file is not a Bread Sales backup');
  }
  if (backup.migration && latest && backup.migration > latest) {
    throw new Error(`The backup was made by a newer version of the app (${backup.migration}). Update the app first.`);
  }
}

/** INSERT statements for every row of the backup (in restore order). */
export function insertStatements(backup: BackupFile): Statement[] {
  const statements: Statement[] = [];
  for (const table of BACKUP_TABLES) {
    for (const row of backup.tables[table] ?? []) {
      const columns = Object.keys(row);
      statements.push({
        sql: `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${columns
          .map((_, i) => `?${i + 1}`)
          .join(', ')})`,
        params: columns.map((c) => row[c]),
      });
    }
  }
  return statements;
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** The whole backup as one SQL script (for `wrangler d1 execute --file` on Cloudflare). */
export function backupToSql(backup: BackupFile, options: { replace: boolean }): string {
  checkBackup(backup, null);
  const lines: string[] = ['PRAGMA defer_foreign_keys = true;'];
  if (options.replace) for (const table of [...BACKUP_TABLES].reverse()) lines.push(`DELETE FROM ${table};`);
  for (const s of insertStatements(backup)) {
    let i = 0;
    lines.push(`${s.sql.replace(/\?\d+/g, () => sqlLiteral(s.params![i++]))};`);
  }
  return `${lines.join('\n')}\n`;
}

/** True when the database has no business data yet (only allowed target for a plain restore). */
export async function isDatabaseEmpty(db: Db): Promise<boolean> {
  const row = await db.first<{ n: number }>(
    `SELECT EXISTS (SELECT 1 FROM areas) + EXISTS (SELECT 1 FROM stores) + EXISTS (SELECT 1 FROM products)
          + EXISTS (SELECT 1 FROM drivers) + EXISTS (SELECT 1 FROM sales) AS n`,
  );
  return Number(row?.n ?? 0) === 0;
}

/**
 * Loads a backup into the database (schema must already exist). With `replace`, all existing data is
 * removed first. Runs as one transaction: all or nothing.
 */
export async function restoreBackup(db: Db, backup: BackupFile, options: { replace: boolean }): Promise<Record<string, number>> {
  checkBackup(backup, await latestMigration(db));
  if (!options.replace && !(await isDatabaseEmpty(db))) {
    throw new Error('The database already has data. Use the "replace" option to overwrite it.');
  }
  // A fresh server creates the first admin by itself; the backup brings its own admins and settings.
  const wipe: Statement[] = [...BACKUP_TABLES].reverse().map((t) => ({ sql: `DELETE FROM ${t}` }));
  const counts: Record<string, number> = {};
  for (const table of BACKUP_TABLES) counts[table] = backup.tables[table]?.length ?? 0;
  await db.batch([...wipe, ...insertStatements(backup)]);
  return counts;
}
