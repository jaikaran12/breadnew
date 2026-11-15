/**
 * Reads a map location the owner pasted or imported: "32.7311, 74.8573", "32.7311 74.8573", or a Google Maps
 * link (…/@32.7311,74.8573,17z, ?q=32.7311,74.8573, …!3d32.7311!4d74.8573). Returns null if none is found.
 * The same file is in admin-web/src/latlng.ts (keep them identical; a server test checks).
 */
export function parseLatLng(text: string | null | undefined): { lat: number; lng: number } | null {
  if (!text) return null;
  let s = String(text).trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    // not URL-encoded
  }
  const num = String.raw`(-?\d{1,3}(?:\.\d+)?)`;
  const patterns = [
    new RegExp(String.raw`!3d${num}!4d${num}`), // place pin in a Google Maps link (most exact)
    new RegExp(String.raw`[?&](?:q|query|ll|destination|daddr|center)=${num}\s*,\s*${num}`),
    new RegExp(String.raw`@${num},${num}`), // map centre in a Google Maps link
    new RegExp(String.raw`^${num}\s*[,\s]\s*${num}$`), // plain "lat, lng"
  ];
  for (const re of patterns) {
    const m = re.exec(s);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) {
      return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
    }
  }
  return null;
}
