import type { Config } from '../config.js';
import { isUniqueViolation, nowIso, type Db, type Statement } from '../db.js';
import { badRequest, conflict } from '../errors.js';
import { dateInZone } from '../util/dates.js';
import { judgeVisit, weekday, type VisitStatus } from './geo.js';
import { visitRadius } from './settings.js';

/** Why a driver made no bill at a shop. */
export const NO_BILL_REASONS = ['closed', 'stock_ok', 'owner_away', 'other'] as const;
export type NoBillReason = (typeof NO_BILL_REASONS)[number];

/** Where the phone was when the driver made the bill / "no bill" (from the phone's GPS). */
export interface PhoneLocation {
  lat: number;
  lng: number;
  /** Metres, as reported by the phone. */
  accuracy?: number | null;
  /** When the phone measured it (phone clock). */
  at?: string | null;
}

/** The verdict of a visit, as shown to the driver and the owner. */
export interface VisitInfo {
  status: VisitStatus;
  distanceM: number | null;
  radiusM: number;
}

export interface ShopForVisit {
  id: number;
  lat: number | null;
  lng: number | null;
  locationStatus: 'owner' | 'driver' | null;
}

/** A location measured long before the bill (the GPS stopped updating) does not count. */
const MAX_FIX_AGE_MS = 10 * 60 * 1000;
const MAX_FUTURE_MS = 10 * 60 * 1000;
const MAX_PAST_MS = 7 * 24 * 60 * 60 * 1000;

/** The time of a visit: the phone's time, unless its clock is badly wrong. */
export function resolveVisitTime(raw: string | null | undefined, now: number): Date {
  if (!raw) return new Date(now);
  const t = Date.parse(raw);
  if (!Number.isFinite(t) || t > now + MAX_FUTURE_MS || t < now - MAX_PAST_MS) return new Date(now);
  return new Date(t);
}

/** The phone's location, or null if it is missing or too old compared with the visit (same phone clock). */
export function usableLocation(location: PhoneLocation | null | undefined, deviceVisitedAt: string | null | undefined) {
  if (!location) return null;
  if (location.at && deviceVisitedAt) {
    const age = Date.parse(deviceVisitedAt) - Date.parse(location.at);
    if (Number.isFinite(age) && age > MAX_FIX_AGE_MS) return null;
  }
  return location;
}

export async function shopForVisit(db: Db, storeId: number): Promise<(ShopForVisit & { areaId: number }) | undefined> {
  return db.first(
    `SELECT id, area_id AS "areaId", lat, lng, location_status AS "locationStatus" FROM stores WHERE id = ?1`,
    [storeId],
  );
}

/**
 * Statements that save one visit and refresh the driver's route plan for that day (so later route changes do
 * not rewrite old days). They go in the same batch as the bill, if there is one.
 */
export function visitStatements(v: {
  clientId: string;
  driverId: number;
  shop: ShopForVisit;
  kind: 'bill' | 'no_bill';
  /** The bill's client id (kind "bill"): the visit is linked to that bill. */
  saleClientId?: string | null;
  reason?: string | null;
  note?: string | null;
  visitedAt: Date;
  timezone: string;
  routeId?: number | null;
  location: PhoneLocation | null;
  deviceVisitedAt: string | null;
  radiusM: number;
}): { statements: Statement[]; info: VisitInfo } {
  const phone = v.location ? { lat: v.location.lat, lng: v.location.lng } : null;
  const shop = v.shop.lat !== null && v.shop.lng !== null ? { lat: v.shop.lat, lng: v.shop.lng } : null;
  const judged = judgeVisit(phone, shop, v.radiusM);
  const day = dateInZone(v.visitedAt, v.timezone);
  const now = nowIso();
  const statements: Statement[] = [
    {
      sql: `INSERT INTO visits (client_id, driver_id, store_id, sale_id, kind, reason, note, visited_at, visit_date, route_id,
                                lat, lng, accuracy_m, shop_lat, shop_lng, shop_location_status, distance_m, radius_m, status,
                                device_visited_at, created_at)
            VALUES (?1, ?2, ?3, (SELECT id FROM sales WHERE client_id = ?4), ?5, ?6, ?7, ?8, ?9,
                    (SELECT id FROM routes WHERE id = ?10), ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)`,
      params: [
        v.clientId,
        v.driverId,
        v.shop.id,
        v.saleClientId ?? null,
        v.kind,
        v.reason ?? null,
        v.note || null,
        v.visitedAt.toISOString(),
        day,
        v.routeId ?? null,
        phone?.lat ?? null,
        phone?.lng ?? null,
        v.location?.accuracy ?? null,
        shop?.lat ?? null,
        shop?.lng ?? null,
        shop ? v.shop.locationStatus : null,
        judged.distanceM,
        v.radiusM,
        judged.status,
        v.deviceVisitedAt,
        now,
      ],
    },
    {
      // The driver's whole plan for that day: every active route of theirs that runs on that weekday.
      sql: `INSERT INTO route_days (day, driver_id, route_id, route_name, store_ids, updated_at)
            SELECT ?1, ?2, r.id, r.name,
                   (SELECT json_group_array(store_id) FROM (SELECT store_id FROM route_stops WHERE route_id = r.id ORDER BY position)),
                   ?4
              FROM routes r
             WHERE r.driver_id = ?2 AND r.is_active = 1 AND instr(r.days, ?3) > 0
            ON CONFLICT (day, driver_id, route_id) DO UPDATE SET
              route_name = excluded.route_name, store_ids = excluded.store_ids, updated_at = excluded.updated_at`,
      params: [day, v.driverId, String(weekday(day)), now],
    },
  ];
  return { statements, info: { status: judged.status, distanceM: judged.distanceM, radiusM: v.radiusM } };
}

export interface NoBillInput {
  clientId: string;
  storeId: number;
  reason: NoBillReason;
  note?: string | null;
  visitedAt?: string;
  location?: PhoneLocation | null;
  routeId?: number | null;
}

export interface Visit {
  id: number;
  clientId: string;
  driverId: number;
  storeId: number;
  saleId: number | null;
  kind: 'bill' | 'no_bill';
  reason: string | null;
  note: string | null;
  visitedAt: string;
  visitDate: string;
  routeId: number | null;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  shopLat: number | null;
  shopLng: number | null;
  shopLocationStatus: 'owner' | 'driver' | null;
  distanceM: number | null;
  radiusM: number;
  status: VisitStatus;
}

export const VISIT_COLUMNS = `v.id, v.client_id AS "clientId", v.driver_id AS "driverId", v.store_id AS "storeId",
  v.sale_id AS "saleId", v.kind, v.reason, v.note, v.visited_at AS "visitedAt", v.visit_date AS "visitDate",
  v.route_id AS "routeId", v.lat, v.lng, v.accuracy_m AS "accuracyM", v.shop_lat AS "shopLat", v.shop_lng AS "shopLng",
  v.shop_location_status AS "shopLocationStatus", v.distance_m AS "distanceM", v.radius_m AS "radiusM", v.status`;

/** Saves a "no bill" visit sent by a driver's phone. Sending the same one twice returns the first copy. */
export async function createNoBillVisit(
  db: Db,
  config: Pick<Config, 'appTimezone'>,
  driverId: number,
  input: NoBillInput,
): Promise<{ visit: Visit; created: boolean }> {
  const existing = async () => {
    const row = await db.first<Visit>(`SELECT ${VISIT_COLUMNS} FROM visits v WHERE v.client_id = ?1`, [input.clientId]);
    if (row && row.driverId !== driverId) throw conflict('This visit was already sent by another driver');
    return row;
  };
  const already = await existing();
  if (already) return { visit: already, created: false };
  const [shop, radiusM] = await Promise.all([shopForVisit(db, input.storeId), visitRadius(db)]);
  if (!shop) throw badRequest('Shop not found. Refresh the shop list and try again.');
  const visitedAt = resolveVisitTime(input.visitedAt, Date.now());
  const deviceVisitedAt = input.visitedAt && Number.isFinite(Date.parse(input.visitedAt)) ? new Date(input.visitedAt).toISOString() : null;
  const { statements } = visitStatements({
    clientId: input.clientId,
    driverId,
    shop,
    kind: 'no_bill',
    reason: input.reason,
    note: input.note,
    visitedAt,
    timezone: config.appTimezone,
    routeId: input.routeId,
    location: usableLocation(input.location, deviceVisitedAt),
    deviceVisitedAt,
    radiusM,
  });
  try {
    await db.batch(statements);
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await existing();
      if (winner) return { visit: winner, created: false };
    }
    throw err;
  }
  return { visit: (await existing())!, created: true };
}
