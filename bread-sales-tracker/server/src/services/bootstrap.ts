import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { hashSecret } from '../auth.js';

/**
 * Creates the first admin account from ADMIN_USERNAME / ADMIN_PASSWORD when the database has none.
 * Later changes to those variables do nothing: change the password from the admin website instead.
 */
export async function ensureInitialAdmin(db: Db, config: Config, log: (m: string) => void = console.log) {
  const existing = await db.first<{ n: number }>('SELECT count(*) AS n FROM admins');
  if ((existing?.n ?? 0) > 0) return;
  if (!config.adminUsername || !config.adminPassword) {
    log('WARNING: no admin account exists yet. Set ADMIN_USERNAME and ADMIN_PASSWORD to create one.');
    return;
  }
  if (config.isProduction && config.adminPassword.length < 8) {
    // Do not stop the whole server (drivers must keep working); just do not create a weak login.
    log('ERROR: ADMIN_PASSWORD must be at least 8 characters. No admin account was created.');
    return;
  }
  await db.run(`INSERT OR IGNORE INTO admins (name, username, password_hash) VALUES (?1, ?2, ?3)`, [
    'Owner',
    config.adminUsername,
    await hashSecret(config.adminPassword),
  ]);
  log(`Created admin account "${config.adminUsername}"`);
}
