import { distanceM, type LatLng } from './geo';

interface Located {
  lat: number | null;
  lng: number | null;
}

const at = (s: Located): LatLng | null => (s.lat !== null && s.lng !== null ? { lat: s.lat, lng: s.lng } : null);

/**
 * Orders shops so each next one is the closest not visited yet, starting from the first shop.
 * Shops without a location keep their order at the end.
 */
export function nearestOrder<T extends Located>(stops: T[]): T[] {
  const located = stops.filter((s) => at(s));
  const unlocated = stops.filter((s) => !at(s));
  if (located.length < 3) return [...located, ...unlocated];
  const result = [located[0]];
  const left = located.slice(1);
  while (left.length) {
    const from = at(result[result.length - 1])!;
    let best = 0;
    for (let i = 1; i < left.length; i++) if (distanceM(from, at(left[i])!) < distanceM(from, at(left[best])!)) best = i;
    result.push(left.splice(best, 1)[0]);
  }
  return [...result, ...unlocated];
}

/** Straight-line length of a route through its shops with a location, in metres (roads are longer). */
export function routeLengthM(stops: Located[]): number {
  const points = stops.map(at).filter((p): p is LatLng => Boolean(p));
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceM(points[i - 1], points[i]);
  return total;
}

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "1234567" → "Every day", "123456" → "Mon–Sat", "135" → "Mon, Wed, Fri". */
export function daysLabel(days: string): string {
  const set = [...new Set(days.split(''))].sort();
  if (set.length === 7) return 'Every day';
  const s = set.join('');
  if (s === '123456') return 'Mon–Sat';
  if (s === '12345') return 'Mon–Fri';
  return set.map((d) => DAY_NAMES[Number(d) - 1]).join(', ');
}

/** 450 → "450 m", 1250 → "1.3 km". */
export function metres(d: number): string {
  return d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`;
}
