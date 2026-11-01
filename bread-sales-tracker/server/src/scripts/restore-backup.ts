/**
 * Restores a backup downloaded from the admin website (Settings > Backup).
 *
 * Into the SQLite file used when running with Node (DATABASE_PATH):
 *   npm run restore -- bread-sales-backup-2026-01-31_0800.json.gz
 *
 * Into Cloudflare D1 (the live website): turn the backup into an SQL file, then load it with wrangler:
 *   npm run restore -- bread-sales-backup-2026-01-31_0800.json.gz --sql restore.sql
 *   npx wrangler d1 execute bread-sales --remote --file restore.sql
 *
 * The target database must be empty (a freshly created one). Add --replace to wipe an existing
 * database first. Everything happens in one transaction: if anything fails, nothing changes.
 */
import fs from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { loadConfig } from '../config.js';
import { openSqliteDb } from '../db-sqlite.js';
import { migrate } from '../migrate.js';
import { backupToSql, restoreBackup, type BackupFile } from '../services/backup.js';

async function main() {
  const args = process.argv.slice(2);
  const sqlIndex = args.indexOf('--sql');
  const sqlOut = sqlIndex >= 0 ? args[sqlIndex + 1] : undefined;
  const file = args.find((a, i) => !a.startsWith('--') && (sqlIndex < 0 || i !== sqlIndex + 1));
  if (!file || (sqlIndex >= 0 && !sqlOut)) {
    console.error('Usage: restore-backup <backup.json.gz> [--replace] [--sql <out.sql>]');
    process.exit(2);
  }
  const raw = await fs.readFile(file);
  const text = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  const backup = JSON.parse(text) as BackupFile;
  const replace = args.includes('--replace');

  if (sqlOut) {
    await fs.writeFile(sqlOut, backupToSql(backup, { replace }));
    console.log(`Wrote ${sqlOut}. Load it with: npx wrangler d1 execute bread-sales --remote --file ${sqlOut}`);
    return;
  }

  const config = loadConfig();
  const db = openSqliteDb(config.databasePath);
  try {
    await migrate(db);
    const counts = await restoreBackup(db, backup, { replace });
    console.log(`Restored backup from ${backup.createdAt}:`);
    for (const [table, n] of Object.entries(counts)) console.log(`  ${table.padEnd(22)} ${n}`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error('Restore failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
