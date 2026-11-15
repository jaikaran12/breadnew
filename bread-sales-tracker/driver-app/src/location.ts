import { useSyncExternalStore } from 'react';

/** A position from the phone's GPS. `at` is when the phone measured it. */
export interface Fix {
  lat: number;
  lng: number;
  /** Metres. */
  accuracy: number;
  at: string;
}

/** off: not listening · waiting: listening, no position yet · ok · denied: the driver refused · unavailable: GPS off/missing */
export type GpsState = 'off' | 'waiting' | 'ok' | 'denied' | 'unavailable';

/** A position older than this is not used for a bill (the driver may have moved). */
export const FIX_MAX_AGE_MS = 2 * 60 * 1000;

let watchId: number | null = null;
let last: Fix | null = null;
let gps: { state: GpsState; fix: Fix | null } = { state: 'off', fix: null };
const listeners = new Set<() => void>();
const set = (next: Partial<typeof gps>) => {
  gps = { ...gps, ...next };
  for (const l of listeners) l();
};

function geo(): Geolocation | null {
  return typeof navigator !== 'undefined' && navigator.geolocation ? navigator.geolocation : null;
}

/** Starts listening to the GPS (on the route and bill screens). Safe to call many times. */
export function startGps(): void {
  const g = geo();
  if (!g) {
    set({ state: 'unavailable' });
    return;
  }
  if (watchId !== null) return;
  set({ state: last ? 'ok' : 'waiting' });
  watchId = g.watchPosition(
    (pos) => {
      last = {
        lat: Math.round(pos.coords.latitude * 1e6) / 1e6,
        lng: Math.round(pos.coords.longitude * 1e6) / 1e6,
        accuracy: Math.round(pos.coords.accuracy),
        at: new Date(pos.timestamp || Date.now()).toISOString(),
      };
      set({ state: 'ok', fix: last });
    },
    (err) => set({ state: err.code === 1 ? 'denied' : last ? 'ok' : 'unavailable' }),
    { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
  );
}

/** Stops listening (saves battery on the other screens). */
export function stopGps(): void {
  const g = geo();
  if (g && watchId !== null) g.clearWatch(watchId);
  watchId = null;
  if (gps.state !== 'denied') set({ state: 'off' });
}

/** The latest position if it is recent enough to stand for "here, now". */
export function freshFix(maxAgeMs = FIX_MAX_AGE_MS): Fix | null {
  if (!last) return null;
  return Date.now() - Date.parse(last.at) <= maxAgeMs ? last : null;
}

/** Waits (up to `timeoutMs`) for a recent position; null if there is none by then. */
export function waitForFix(timeoutMs = 6000): Promise<Fix | null> {
  const now = freshFix();
  if (now || gps.state === 'denied' || !geo()) return Promise.resolve(now);
  startGps();
  return new Promise((resolve) => {
    const done = (fix: Fix | null) => {
      listeners.delete(check);
      clearTimeout(timer);
      resolve(fix);
    };
    const check = () => {
      const fix = freshFix();
      if (fix) done(fix);
      else if (gps.state === 'denied') done(null);
    };
    const timer = setTimeout(() => done(freshFix()), timeoutMs);
    listeners.add(check);
  });
}

export function useGps(): { state: GpsState; fix: Fix | null } {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => gps,
    () => gps,
  );
}

/** For tests: pretend the GPS gave this position. */
export function __setFixForTests(fix: Fix | null, state: GpsState = fix ? 'ok' : 'off'): void {
  last = fix;
  set({ fix, state });
}
