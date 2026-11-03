import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { catalogRevision, getSettings } from './settings.js';

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

/** A shop's special rate on one product (applied by the phone; checked again by the server). */
export interface CatalogDiscount {
  storeId: number;
  productId: number;
  kind: 'percent' | 'amount';
  /** percent: hundredths of a percent (250 = 2.5%); amount: paise off each unit */
  value: number;
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
  discounts: CatalogDiscount[];
}

/** Version of the phones' copy of the catalog (cheap: one row). */
export async function catalogVersion(db: Db, config: Pick<Config, 'driverCancelWindowMinutes'>): Promise<string> {
  return `r${await catalogRevision(db)}-c${config.driverCancelWindowMinutes}`;
}

/** Everything the phone needs to make bills offline: areas, shops, products and prices. */
export async function getCatalog(
  db: Db,
  config: Pick<Config, 'defaultBusinessName' | 'driverCancelWindowMinutes'>,
): Promise<Catalog> {
  const [areas, stores, products, discounts, settings, version] = await Promise.all([
    db.all<CatalogArea>(`SELECT id, name FROM areas WHERE is_active = 1 ORDER BY sort_order, lower(name)`),
    db.all<CatalogStore>(
      `SELECT s.id, s.area_id AS "areaId", s.name, s.owner_name AS "ownerName", s.phone, s.address
         FROM stores s JOIN areas a ON a.id = s.area_id
        WHERE s.is_active = 1 AND a.is_active = 1
        ORDER BY lower(s.name)`,
    ),
    db.all<CatalogProduct>(
      `SELECT id, name, local_name AS "localName", price_paise AS "pricePaise", color
         FROM products WHERE is_active = 1 ORDER BY sort_order, lower(name)`,
    ),
    db.all<CatalogDiscount>(
      `SELECT d.store_id AS "storeId", d.product_id AS "productId", d.kind, d.value
         FROM store_discounts d
         JOIN stores s ON s.id = d.store_id AND s.is_active = 1
         JOIN products p ON p.id = d.product_id AND p.is_active = 1
        ORDER BY d.store_id, d.product_id`,
    ),
    getSettings(db, config),
    catalogVersion(db, config),
  ]);
  return {
    version,
    businessName: settings.businessName,
    businessPhone: settings.businessPhone,
    billFooter: settings.billFooter,
    cancelWindowMinutes: config.driverCancelWindowMinutes,
    areas,
    stores,
    products,
    discounts,
  };
}
