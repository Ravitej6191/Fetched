/* =============================================================================
   Fetched! — Service Worker
   Pages: network-first · other shell files: stale-while-revalidate · API: network only · CDN/posters: capped cache
============================================================================= */

const CACHE       = 'fetched-v10';
const RUNTIME     = 'fetched-runtime-v10';
const MAX_RUNTIME = 120;  // cap on cached posters/fonts

const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './script.js',
  './manifest.json',
  './Assets/Images/dummy.svg',
  './Assets/Images/favicon-32.png',
  './Assets/Images/apple-touch-icon.png',
  './Assets/Images/icon-192.png',
  './Assets/Images/icon-512.png',
  './Assets/Images/icon-maskable-512.png',
];

// ── Install: pre-cache the app shell ─────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE && k !== RUNTIME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

async function putRuntime(request, response) {
  const c = await caches.open(RUNTIME);
  await c.put(request, response);
  const keys = await c.keys();
  if (keys.length > MAX_RUNTIME) {
    await Promise.all(keys.slice(0, keys.length - MAX_RUNTIME).map(k => c.delete(k)));
  }
}

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // OMDB API: always network (fresh data, no caching)
  if (url.hostname === 'www.omdbapi.com') {
    e.respondWith(fetch(e.request).catch(() => new Response('{}', {
      headers: { 'Content-Type': 'application/json' }
    })));
    return;
  }

  // External resources (fonts, posters): network-first, capped cache fallback
  if (url.hostname !== self.location.hostname && url.protocol === 'https:') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) putRuntime(e.request, res.clone());
          return res;
        })
        .catch(() => caches.match(e.request).then(r => r || new Response('', { status: 503 })))
    );
    return;
  }

  // Page loads: network-first so a new index.html (and its icons) show up immediately
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put('./index.html', clone));
          }
          return res;
        })
        .catch(() => caches.match('./index.html').then(r => r || new Response('Offline', { status: 503 })))
    );
    return;
  }

  // Other shell files: stale-while-revalidate (ignoreSearch lets ?v= cache-busters hit the cache)
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
      if (cached) { network.catch(() => {}); return cached; }
      return network.catch(() => caches.match('./index.html').then(r => r || new Response('Offline', { status: 503 })));
    })
  );
});
