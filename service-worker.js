/* ============================================
   DVC AI CHATBOT — Service Worker v1.0
   Offline caching + PWA support
   promode × @dvc 2026
   ============================================ */

const CACHE_NAME = 'dvc-ai-v1';
const STATIC_ASSETS = [
  '/dvcaichat/',
  '/dvcaichat/index.html',
  '/dvcaichat/css/style.css',
  '/dvcaichat/js/app.js',
  '/dvcaichat/manifest.json',
  '/dvcaichat/assets/icon-192.svg',
  '/dvcaichat/assets/icon-512.svg'
];

// Install — cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy: Network first, cache fallback (for API), Cache first for static
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls or status/users JSON (always fresh from network)
  if (url.pathname.includes('/openai/') ||
      url.hostname !== location.hostname && url.pathname.includes('/api/')) {
    return;
  }

  // Always fetch status.json and users.json fresh (never cache)
  if (url.pathname.endsWith('status.json') || url.pathname.endsWith('users.json')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // For everything else: try network, fallback to cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Clone and store in cache for offline
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        return response;
      })
      .catch(() => {
        // Network failed, serve from cache
        return caches.match(event.request);
      })
  );
});
