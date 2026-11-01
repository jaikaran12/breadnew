/* Service worker for the driver app (in Chrome and inside the Android wrapper app).
   - Opens instantly: the saved copy of the app is shown at once, and a fresh copy is downloaded in the
     background for next time (the free server may need a minute to wake up).
   - Works without internet: all app files are kept on the phone.
   Bills themselves are stored by the app (localStorage), not here. API calls are never cached. */
const CACHE = 'breadsales-driver-v2';
const SHELL = './';

function assetUrls(html) {
  return [...html.matchAll(/(?:src|href)="\.?\/?((?:assets\/[^"]+)|icon\.svg|manifest\.webmanifest|icons\/[^"]+)"/g)].map(
    (m) => `./${m[1]}`,
  );
}

/** Downloads the newest app page + its files; replaces the saved copy only when everything arrived. */
async function refreshShell() {
  const cache = await caches.open(CACHE);
  const res = await fetch(SHELL, { cache: 'no-store' });
  if (!res.ok) return;
  const html = await res.clone().text();
  const assets = assetUrls(html);
  await Promise.all(
    assets.map(async (url) => {
      if (await cache.match(url)) return;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`asset ${url} ${r.status}`);
      await cache.put(url, r);
    }),
  );
  await cache.put(SHELL, res);
  // Remove files the new version no longer uses.
  const keep = new Set(assets.map((u) => new URL(u, self.registration.scope).href));
  for (const req of await cache.keys()) {
    if (req.url.includes('/assets/') && !keep.has(req.url)) await cache.delete(req);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    refreshShell()
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const saved = await cache.match(SHELL);
        if (saved) {
          // Show the saved app now; update it in the background.
          event.waitUntil(refreshShell().catch(() => undefined));
          return saved;
        }
        const res = await fetch(req);
        event.waitUntil(refreshShell().catch(() => undefined));
        return res;
      })(),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && (url.pathname.includes('/assets/') || url.pathname.includes('/icons/'))) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
