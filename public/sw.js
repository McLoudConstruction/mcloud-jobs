const CACHE_NAME = 'mcloud-shell-v1';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;

  // Only ever handle same-origin GET requests. Everything else (POST/PATCH
  // to Supabase, Stripe, any cross-origin request) passes straight through
  // untouched — this service worker's job is purely "let a previously
  // visited page still render when offline," not request interception.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    // Page navigations: try the network first (so you always get the
    // freshest version when connected), fall back to whatever was cached
    // last time this page loaded successfully.
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match('/dashboard')))
    );
    return;
  }

  // Static assets (JS/CSS chunks, icons): cache-first, since these are
  // content-hashed by Next.js and never change under the same URL.
  if (request.url.includes('/_next/static/') || request.url.match(/\.(png|jpg|jpeg|svg|ico)$/)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          return response;
        });
      })
    );
  }
});
