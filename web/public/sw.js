// Offline support: stale-while-revalidate for same-origin GETs. First visit online, then works offline.
// ponytail: old hashed assets are never evicted; add cleanup on 'activate' if the cache grows too much.
const CACHE = 'meshcode-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    const fresh = fetch(request)
      .then((res) => {
        if (res.ok) cache.put(request, res.clone());
        return res;
      })
      .catch(() => cached ?? Response.error());
    event.waitUntil(fresh);
    return cached ?? fresh;
  })());
});
