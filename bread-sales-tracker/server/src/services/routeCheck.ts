import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { todayInZone } from '../util/dates.js';
import { weekday } from './geo.js';
import { visitRadius } from './settings.js';
import { VISIT_COLUMNS, type Visit } from './visits.js';

export interface CheckVisit extends Visit {
  storeName: string;
  areaName: string;
  driverName: string;
  /** For a visit with a bill: its amount and whether it was cancelled later. */
  saleTotalPaise: number | null;
  saleStatus: 'completed' | 'cancelled' | null;
}

export interface CheckStop {
  position: number;
  storeId: number;
  storeName: string;
  areaName: string;
  lat: number | null;
  lng: number | null;
  locationStatus: 'owner' | 'driver' | null;
  visits: CheckVisit[];
  state: 'visited' | 'missed';
  /** Visited before a shop that comes earlier in the route. */
  outOfOrder: boolean;
}

export interface CheckSummary {
  planned: number;
  visited: number;
  missed: number;
  outOfOrder: number;
  visits: number;
  bills: number;
  noBills: number;
  ok: number;
  far: number;
  noGps: number;
  noShopLocation: number;
}

export interface CheckDriver {
  driverId: number;
  driverName: string;
  routes: Array<{ routeId: number; name: string; stops: CheckStop[] }>;
  /** Shops visited that were not on the driver's routes that day. */
  extraVisits: CheckVisit[];
  summary: CheckSummary;
}

export interface RouteCheck {
  date: string;
  today: string;
  radiusM: number;
  /** "plan": the routes as the drivers had them that day; "current": today's (or no saved plan) — current routes. */
  drivers: CheckDriver[];
  totals: CheckSummary;
}

const emptySummary = (): CheckSummary => ({
  planned: 0,
  visited: 0,
  missed: 0,
  outOfOrder: 0,
  visits: 0,
  bills: 0,
  noBills: 0,
  ok: 0,
  far: 0,
  noGps: 0,
  noShopLocation: 0,
});

interface PlanRow {
  driverId: number;
  routeId: number;
  name: string;
  storeIds: string;
}

/**
 * Planned stops against visits for one day (all drivers, or one). For today the current routes are the plan;
 * for an earlier day, the plan saved that day (if the driver made any visit), else the current routes.
 */
export async function routeCheck(
  db: Db,
  config: Pick<Config, 'appTimezone'>,
  date: string,
  driverId: number | null = null,
): Promise<RouteCheck> {
  const today = todayInZone(config.appTimezone);
  const day = String(weekday(date));
  const [visits, saved, current, radiusM] = await Promise.all([
    db.all<CheckVisit>(
      `SELECT ${VISIT_COLUMNS}, st.name AS "storeName", a.name AS "areaName", d.name AS "driverName",
              s.total_paise AS "saleTotalPaise", s.status AS "saleStatus"
         FROM visits v
         JOIN stores st ON st.id = v.store_id
         JOIN areas a ON a.id = st.area_id
         JOIN drivers d ON d.id = v.driver_id
         LEFT JOIN sales s ON s.id = v.sale_id
        WHERE v.visit_date = ?1 AND (?2 IS NULL OR v.driver_id = ?2)
        ORDER BY v.visited_at, v.id`,
      [date, driverId],
    ),
    date < today
      ? db.all<PlanRow>(
          `SELECT driver_id AS "driverId", route_id AS "routeId", route_name AS name, store_ids AS "storeIds"
             FROM route_days WHERE day = ?1 AND (?2 IS NULL OR driver_id = ?2) ORDER BY lower(route_name)`,
          [date, driverId],
        )
      : Promise.resolve([] as PlanRow[]),
    db.all<PlanRow>(
      `SELECT r.driver_id AS "driverId", r.id AS "routeId", r.name,
              (SELECT json_group_array(store_id) FROM (SELECT store_id FROM route_stops WHERE route_id = r.id ORDER BY position))
                AS "storeIds"
         FROM routes r
        WHERE r.is_active = 1 AND r.driver_id IS NOT NULL AND instr(r.days, ?1) > 0 AND (?2 IS NULL OR r.driver_id = ?2)
        ORDER BY lower(r.name)`,
      [day, driverId],
    ),
    visitRadius(db),
  ]);

  // Each driver's plan: the saved one for that day if there is one, else the current routes.
  const savedDrivers = new Set(saved.map((p) => p.driverId));
  const plans = [...saved, ...current.filter((p) => !savedDrivers.has(p.driverId))].map((p) => ({
    ...p,
    storeIds: JSON.parse(p.storeIds) as number[],
  }));
  const plannedStoreIds = [...new Set(plans.flatMap((p) => p.storeIds))];
  const driverIds = [...new Set([...plans.map((p) => p.driverId), ...visits.map((v) => v.driverId)])];
  const [stores, drivers] = await Promise.all([
    plannedStoreIds.length
      ? db.all<{ id: number; name: string; areaName: string; lat: number | null; lng: number | null; locationStatus: CheckStop['locationStatus'] }>(
          `SELECT st.id, st.name, a.name AS "areaName", st.lat, st.lng, st.location_status AS "locationStatus"
             FROM stores st JOIN areas a ON a.id = st.area_id WHERE st.id IN (SELECT value FROM json_each(?1))`,
          [JSON.stringify(plannedStoreIds)],
        )
      : Promise.resolve([]),
    driverIds.length
      ? db.all<{ id: number; name: string }>(`SELECT id, name FROM drivers WHERE id IN (SELECT value FROM json_each(?1))`, [
          JSON.stringify(driverIds),
        ])
      : Promise.resolve([]),
  ]);
  const storeById = new Map(stores.map((s) => [s.id, s]));
  const driverName = new Map(drivers.map((d) => [d.id, d.name]));

  const result: CheckDriver[] = driverIds.map((id) => {
    const mine = visits.filter((v) => v.driverId === id);
    const summary = emptySummary();
    const onRoute = new Set<number>();
    const routes = plans
      .filter((p) => p.driverId === id)
      .map((p) => {
        let latest = '';
        const stops: CheckStop[] = p.storeIds.map((storeId, i) => {
          onRoute.add(storeId);
          const store = storeById.get(storeId);
          const at = mine.filter((v) => v.storeId === storeId);
          const first = at[0]?.visitedAt ?? '';
          const outOfOrder = Boolean(first && latest && first < latest);
          if (first && first > latest) latest = first;
          summary.planned++;
          if (at.length) summary.visited++;
          if (outOfOrder) summary.outOfOrder++;
          return {
            position: i + 1,
            storeId,
            storeName: store?.name ?? `Shop #${storeId}`,
            areaName: store?.areaName ?? '',
            lat: store?.lat ?? null,
            lng: store?.lng ?? null,
            locationStatus: store?.locationStatus ?? null,
            visits: at,
            state: at.length ? 'visited' : 'missed',
            outOfOrder,
          };
        });
        return { routeId: p.routeId, name: p.name, stops };
      });
    summary.missed = summary.planned - summary.visited;
    for (const v of mine) {
      summary.visits++;
      if (v.kind === 'bill') summary.bills++;
      else summary.noBills++;
      if (v.status === 'ok') summary.ok++;
      else if (v.status === 'far') summary.far++;
      else if (v.status === 'no_gps') summary.noGps++;
      else summary.noShopLocation++;
    }
    return {
      driverId: id,
      driverName: driverName.get(id) ?? mine[0]?.driverName ?? `Driver #${id}`,
      routes,
      extraVisits: mine.filter((v) => !onRoute.has(v.storeId)),
      summary,
    };
  });
  result.sort((a, b) => a.driverName.localeCompare(b.driverName));
  const totals = emptySummary();
  for (const d of result) for (const k of Object.keys(totals) as Array<keyof CheckSummary>) totals[k] += d.summary[k];
  return { date, today, radiusM, drivers: result, totals };
}
