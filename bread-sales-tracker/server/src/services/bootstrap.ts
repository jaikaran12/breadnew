import type { Config } from '../config.js';
import { one, type Pool } from '../db.js';
import { hashSecret } from '../auth.js';

/**
 * Creates the first admin account from ADMIN_USERNAME / ADMIN_PASSWORD when the database has none.
 * Later changes to those variables do nothing: change the password from the admin website instead.
 */
export async function ensureInitialAdmin(pool: Pool, config: Config, log: (m: string) => void = console.log) {
  const existing = await one<{ n: number }>(pool, 'SELECT count(*)::int AS n FROM admins');
  if ((existing?.n ?? 0) > 0) return;
  if (!config.adminUsername || !config.adminPassword) {
    log('WARNING: no admin account exists yet. Set ADMIN_USERNAME and ADMIN_PASSWORD and restart to create one.');
    return;
  }
  if (config.isProduction && config.adminPassword.length < 8) {
    throw new Error('ADMIN_PASSWORD must be at least 8 characters');
  }
  await pool.query(
    `INSERT INTO admins (name, username, password_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    ['Owner', config.adminUsername, await hashSecret(config.adminPassword)],
  );
  log(`Created admin account "${config.adminUsername}"`);
}
