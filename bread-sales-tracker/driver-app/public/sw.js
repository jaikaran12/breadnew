/* Offline support for the browser version of the driver app (the Android app has its files built in).
   Caches the app files so it opens without internet. Bills are stored by the app itself, not here. */
const CACHE = 'breadsales-driver-v1';

async function cacheAppShell() {
  const cache = await caches.open(CACHE);
  const res = await fetch('./', { cache: 'no-store' });
  if (!res.ok) return;
  const html = await res.clone().text();
  await cache.put('./', res);
  const assets = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+|icon\.svg|manifest\.webmanifest)"/g)].map((m) => `./${m[1]}`);
  await Promise.all(
    assets.map((url) =>
      fetch(url)
        .then((r) => (r.ok ? cache.put(url, r) : undefined))
        .catch(() => undefined),
    ),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()));
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
    // Fresh page when online, saved copy when offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./', copy));
          return res;
        })
        .catch(() => caches.match('./')),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && url.pathname.includes('/assets/')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
