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
  /** Saved location (null = none yet), and who placed it: 'owner' or 'driver' (not checked by the owner yet). */
  lat: number | null;
  lng: number | null;
  locationStatus: 'owner' | 'driver' | null;
}

/** A route of the logged-in driver: the shops in order, on the days of the week it runs (1 = Monday … 7 = Sunday). */
export interface CatalogRoute {
  id: number;
  name: string;
  days: string;
  storeIds: number[];
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
  routes: CatalogRoute[];
  /** How far (metres) from a shop's location the driver may be when making a bill or "no bill". */
  visitRadiusM: number;
}

/** Version of the phones' copy of the catalog (cheap: one row). */
export async function catalogVersion(db: Db, config: Pick<Config, 'driverCancelWindowMinutes'>): Promise<string> {
  return `r${await catalogRevision(db)}-c${config.driverCancelWindowMinutes}`;
}

/** Everything the phone needs to make bills offline: areas, shops, products and prices. */
export async function getCatalog(
  db: Db,
  config: Pick<Config, 'defaultBusinessName' | 'driverCancelWindowMinutes'>,
  /** The driver whose routes are included (none when not given). */
  driverId?: number,
): Promise<Catalog> {
  const [areas, stores, products, discounts, settings, version, routeRows] = await Promise.all([
    db.all<CatalogArea>(`SELECT id, name FROM areas WHERE is_active = 1 ORDER BY sort_order, lower(name)`),
    db.all<CatalogStore>(
      `SELECT s.id, s.area_id AS "areaId", s.name, s.owner_name AS "ownerName", s.phone, s.address,
              s.lat, s.lng, s.location_status AS "locationStatus"
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
    driverId
      ? db.all<{ id: number; name: string; days: string; storeIds: string }>(
          `SELECT r.id, r.name, r.days,
                  (SELECT json_group_array(store_id) FROM (
                     SELECT rs.store_id FROM route_stops rs JOIN stores st ON st.id = rs.store_id AND st.is_active = 1
                      WHERE rs.route_id = r.id ORDER BY rs.position)) AS "storeIds"
             FROM routes r WHERE r.driver_id = ?1 AND r.is_active = 1 ORDER BY lower(r.name)`,
          [driverId],
        )
      : Promise.resolve([]),
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
    routes: routeRows.map((r) => ({ id: r.id, name: r.name, days: r.days, storeIds: JSON.parse(r.storeIds) as number[] })),
    visitRadiusM: settings.visitRadiusM,
  };
}
