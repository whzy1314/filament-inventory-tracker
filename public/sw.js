const CACHE_NAME = 'filament-tracker-v6';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/logo.svg',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg'
];

const EXTERNAL_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
];

// Install - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Some static assets failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch - network first for API, cache first for static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // API calls - network only (don't cache API responses)
  if (url.pathname.startsWith('/api/')) return;

  // Login page - network first
  if (url.pathname === '/login' || url.pathname === '/login.html') return;

  // Static assets - stale-while-revalidate
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Network failed, return cached if available
        return cachedResponse;
      });

      return cachedResponse || fetchPromise;
    })
  );
});
