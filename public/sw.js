const CACHE_NAME = 'daisy-cache-v14';
const OFFLINE_FALLBACK_URL = './index.html';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-512.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Handle background warning notification dispatches from client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    if (self.registration && self.registration.showNotification) {
      event.waitUntil(
        self.registration.showNotification(title, {
          icon: '/icon-512.jpg',
          badge: '/icon-512.jpg',
          vibrate: [250, 120, 250, 120, 400],
          requireInteraction: true,
          ...options,
        })
      );
    }
  }
});

// Focus or open the DAISY app window when user taps a background weather alert notification
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Never cache on localhost / 127.0.0.1 or Vite dev module requests
  if (
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/@') ||
    url.pathname.includes('node_modules') ||
    url.pathname.includes('vite') ||
    url.pathname.includes('hmr') ||
    url.pathname.includes('ws')
  ) {
    return;
  }

  // EXCLUDE live weather, radar tile, SPC feeds, and geocoding services to ensure up-to-the-second updates!
  if (
    url.hostname.includes('weather.gov') ||
    url.hostname.includes('spc.noaa.gov') ||
    url.hostname.includes('openstreetmap.org') ||
    url.hostname.includes('mesonet.agron.iastate.edu') ||
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('script.googleusercontent.com') ||
    (url.hostname.includes('api.windy.com') && url.pathname.includes('/api/'))
  ) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Network-first with cache fallback so code updates always appear immediately
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (event.request.mode === 'navigate') {
            return caches.match(OFFLINE_FALLBACK_URL);
          }
          return new Response('Network error occurred', {
            status: 408,
            headers: { 'Content-Type': 'text/plain' },
          });
        });
      })
  );
});
