/**
 * Distances and visit checks. The same file is in server/src/services/geo.ts and driver-app/src/geo.ts:
 * the phone's warning and the server's verdict must agree, so keep the two files identical (a server test checks).
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** Verdict for a bill or "no bill": at the shop, too far, the phone gave no location, or the shop has no location yet. */
export type VisitStatus = 'ok' | 'far' | 'no_gps' | 'no_shop_location';

/** Metres between two points on the Earth (haversine), rounded to whole metres. */
export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6_371_008.8;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * Judges a visit: within `radiusM` metres of the shop's saved location is "ok", farther is "far".
 * No location from the phone counts first (it is the driver's side), then a shop without a saved location.
 */
export function judgeVisit(
  phone: LatLng | null | undefined,
  shop: LatLng | null | undefined,
  radiusM: number,
): { status: VisitStatus; distanceM: number | null } {
  if (!phone) return { status: 'no_gps', distanceM: null };
  if (!shop) return { status: 'no_shop_location', distanceM: null };
  const d = distanceM(phone, shop);
  return { status: d <= radiusM ? 'ok' : 'far', distanceM: d };
}

/** 1 = Monday … 7 = Sunday, for a business day "YYYY-MM-DD". */
export function weekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}
