import type { Config } from '../config.js';
import { many, type Queryable } from '../db.js';

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

export async function getSettings(db: Queryable, config: Pick<Config, 'defaultBusinessName'>): Promise<AppSettings> {
  const rows = await many<{ key: string; value: string }>(db, 'SELECT key, value FROM app_settings');
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const result = defaultSettings(config);
  for (const [field, key] of Object.entries(KEYS) as Array<[keyof AppSettings, string]>) {
    const value = map.get(key);
    if (value !== undefined) result[field] = value;
  }
  return result;
}

export async function updateSettings(db: Queryable, patch: Partial<AppSettings>): Promise<void> {
  for (const [field, key] of Object.entries(KEYS) as Array<[keyof AppSettings, string]>) {
    const value = patch[field];
    if (value === undefined) continue;
    await db.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, value],
    );
  }
}
