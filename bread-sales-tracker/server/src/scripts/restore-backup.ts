/**
 * Restores a backup downloaded from the admin website (Settings > Backup).
 *
 *   DATABASE_URL=postgres://... node dist/scripts/restore-backup.js bread-sales-backup-2026-01-31_0800.json.gz
 *   (from the server folder in development: npm run restore -- <file>)
 *
 * The target database must be empty (a freshly created one). Add --replace to wipe an existing
 * database first. Everything happens in one transaction: if anything fails, nothing changes.
 */
import fs from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { loadConfig } from '../config.js';
import { createPool } from '../db.js';
import { migrate } from '../migrate.js';
import { restoreBackup, type BackupFile } from '../services/backup.js';

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('Usage: restore-backup <backup.json.gz> [--replace]');
    process.exit(2);
  }
  const raw = await fs.readFile(file);
  const text = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  const backup = JSON.parse(text) as BackupFile;
  const config = loadConfig();
  const pool = createPool(config);
  try {
    await migrate(pool);
    const counts = await restoreBackup(pool, backup, { replace: args.includes('--replace') });
    console.log(`Restored backup from ${backup.createdAt}:`);
    for (const [table, n] of Object.entries(counts)) console.log(`  ${table.padEnd(22)} ${n}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Restore failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
