import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// src/migrate.ts and dist/migrate.js both sit one level below the server folder.
export const MIGRATIONS_DIR = path.resolve(here, '..', 'migrations');

// Same bookkeeping table as Cloudflare's `wrangler d1 migrations apply`, so both see the same history.
const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS d1_migrations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)`;

/**
 * Applies every .sql file in migrations/ that has not been applied yet, in file-name order.
 * Used for tests and self-hosting with Node. On Cloudflare, `wrangler d1 migrations apply` does this.
 */
export async function migrate(db: Db, log: (msg: string) => void = console.log, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec(CREATE_TABLE);
  const done = new Set((await db.all<{ name: string }>('SELECT name FROM d1_migrations')).map((r) => r.name));
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await fs.readFile(path.join(dir, file), 'utf8');
    log(`Applying database migration ${file}`);
    try {
      await db.exec(`BEGIN;\n${sql}\n;INSERT INTO d1_migrations (name) VALUES ('${file.replace(/'/g, "''")}');\nCOMMIT;`);
    } catch (err) {
      await db.exec('ROLLBACK').catch(() => undefined);
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
    applied.push(file);
  }
  return applied;
}
