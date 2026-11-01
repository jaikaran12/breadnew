import type { Config } from '../config.js';
import { nowIso, type Db, type Statement } from '../db.js';

export interface AppSettings {
  businessName: string;
  businessPhone: string;
  billFooter: string;
}

const KEYS: Record<keyof AppSettings, string> = {
  businessName: 'business_name',
  businessPhone: 'business_phone',
  billFooter: 'bill_footer',
};

export function defaultSettings(config: Pick<Config, 'defaultBusinessName'>): AppSettings {
  return { businessName: config.defaultBusinessName, businessPhone: '', billFooter: 'Thank you!' };
}

export async function getSettings(db: Db, config: Pick<Config, 'defaultBusinessName'>): Promise<AppSettings> {
  const rows = await db.all<{ key: string; value: string }>('SELECT key, value FROM app_settings');
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const result = defaultSettings(config);
  for (const [field, key] of Object.entries(KEYS) as Array<[keyof AppSettings, string]>) {
    const value = map.get(key);
    if (value !== undefined) result[field] = value;
  }
  return result;
}

export function setSettingStatement(key: string, value: string): Statement {
  return {
    sql: `INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
          ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    params: [key, value, nowIso()],
  };
}

export async function getSetting(db: Db, key: string): Promise<string | undefined> {
  return (await db.first<{ value: string }>('SELECT value FROM app_settings WHERE key = ?1', [key]))?.value;
}

/**
 * The phones keep a copy of areas, shops, products and prices. Every change to those bumps this number,
 * so a phone learns (from its next bill) that it should download a fresh copy.
 */
export function bumpCatalogStatement(): Statement {
  return {
    sql: `INSERT INTO app_settings (key, value, updated_at) VALUES ('catalog_rev', '1', ?1)
          ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = excluded.updated_at`,
    params: [nowIso()],
  };
}

export async function catalogRevision(db: Db): Promise<string> {
  return (await getSetting(db, 'catalog_rev')) ?? '0';
}

export async function updateSettings(db: Db, patch: Partial<AppSettings>): Promise<void> {
  const statements: Statement[] = [];
  for (const [field, key] of Object.entries(KEYS) as Array<[keyof AppSettings, string]>) {
    const value = patch[field];
    if (value !== undefined) statements.push(setSettingStatement(key, value));
  }
  if (statements.length) await db.batch([...statements, bumpCatalogStatement()]);
}
