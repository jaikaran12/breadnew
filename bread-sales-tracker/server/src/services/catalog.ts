import crypto from 'node:crypto';
import type { Config } from '../config.js';
import { many, type Queryable } from '../db.js';
import { getSettings } from './settings.js';

export interface CatalogArea {
  id: number;
  name: string;
}

export interface CatalogStore {
  id: number;
  areaId: number;
  name: string;
  ownerName: string | null;
  phone: string | null;
  address: string | null;
}

export interface CatalogProduct {
  id: number;
  name: string;
  localName: string | null;
  pricePaise: number;
  color: string;
}

export interface Catalog {
  version: string;
  businessName: string;
  businessPhone: string;
  billFooter: string;
  cancelWindowMinutes: number;
  areas: CatalogArea[];
  stores: CatalogStore[];
  products: CatalogProduct[];
}

/** Everything the phone needs to make bills offline: areas, shops, products and prices. */
export async function getCatalog(
  db: Queryable,
  config: Pick<Config, 'defaultBusinessName' | 'driverCancelWindowMinutes'>,
): Promise<Catalog> {
  const [areas, stores, products, settings] = await Promise.all([
    many<CatalogArea>(db, `SELECT id, name FROM areas WHERE is_active ORDER BY sort_order, lower(name)`),
    many<CatalogStore>(
      db,
      `SELECT s.id, s.area_id AS "areaId", s.name, s.owner_name AS "ownerName", s.phone, s.address
         FROM stores s JOIN areas a ON a.id = s.area_id
        WHERE s.is_active AND a.is_active
        ORDER BY lower(s.name)`,
    ),
    many<CatalogProduct>(
      db,
      `SELECT id, name, local_name AS "localName", price_paise AS "pricePaise", color
         FROM products WHERE is_active ORDER BY sort_order, lower(name)`,
    ),
    getSettings(db, config),
  ]);
  const body = {
    businessName: settings.businessName,
    businessPhone: settings.businessPhone,
    billFooter: settings.billFooter,
    cancelWindowMinutes: config.driverCancelWindowMinutes,
    areas,
    stores,
    products,
  };
  const version = crypto.createHash('sha1').update(JSON.stringify(body)).digest('hex').slice(0, 16);
  return { version, ...body };
}
