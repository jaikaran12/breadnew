import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
// src/migrate.ts and dist/migrate.js both sit one level below the server folder.
export const MIGRATIONS_DIR = path.resolve(here, '..', 'migrations');

// Any constant works; it just has to be the same for every app instance.
const MIGRATION_LOCK_ID = 7250331;

/**
 * Applies every .sql file in migrations/ that has not been applied yet, in file-name order.
 * Everything runs in ONE transaction holding a transaction-level advisory lock, so it is safe
 * to run on every start-up, from several instances at once, and through a connection pooler
 * such as PgBouncer / Neon's "-pooler" address (session-level locks are not safe there).
 */
export async function migrate(pool: pg.Pool, log: (msg: string) => void = console.log): Promise<string[]> {
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
    );
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      log(`Applying database migration ${file}`);
      try {
        await client.query(sql);
      } catch (err) {
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      applied.push(file);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return applied;
}

/** Name of the newest migration file (recorded in backups). */
export async function latestMigration(): Promise<string | null> {
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  return files[files.length - 1] ?? null;
}
