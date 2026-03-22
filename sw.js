// DiStory Service Worker
const BASE_PATH = '/distory-app';
const CACHE_NAME = 'distory-v2';
const DYNAMIC_CACHE = 'distory-dynamic-v2';

// App shell files to cache on install
const APP_SHELL = [
  `${BASE_PATH}/`,
  `${BASE_PATH}/index.html`,
  `${BASE_PATH}/manifest.json`,
  `${BASE_PATH}/icon-192.png`,
  `${BASE_PATH}/icon-512.png`,
];

// =====================
// INSTALL: Cache app shell
// =====================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

// =====================
// ACTIVATE: Clean old caches
// =====================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== DYNAMIC_CACHE)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// =====================
// FETCH: Stale-while-revalidate for API, Cache-first for assets
// =====================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and chrome-extension requests
  if (request.method !== 'GET' || url.protocol === 'chrome-extension:') return;

  // For API requests (story-api.dicoding.dev) - stale-while-revalidate
  if (url.hostname === 'story-api.dicoding.dev') {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // For Leaflet tile layers and images - cache first with network fallback
  if (
    url.hostname.includes('tile.openstreetmap.org') ||
    url.hostname.includes('arcgisonline.com') ||
    url.hostname.includes('opentopomap.org')
  ) {
    event.respondWith(cacheFirstWithFallback(request));
    return;
  }

  // For app assets - cache first
  event.respondWith(cacheFirstWithNetworkFallback(request));
});

// Cache first, then network fallback, then offline page
async function cacheFirstWithNetworkFallback(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Return offline fallback for navigation requests
    if (request.mode === 'navigate') {
      const cached = await caches.match(`${BASE_PATH}/`);
      return cached || new Response('<h1>Offline</h1><p>Tidak ada koneksi internet.</p>', {
        headers: { 'Content-Type': 'text/html' }
      });
    }
    return new Response('Network error', { status: 408 });
  }
}

// Cache first (for map tiles)
async function cacheFirstWithFallback(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 408 });
  }
}

// Stale-while-revalidate (for API)
async function staleWhileRevalidate(request) {
  const cache = await caches.open(DYNAMIC_CACHE);
  const cached = await cache.match(request);

  // Fetch in background to update cache
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  // Return cached immediately if available, otherwise wait for network
  return cached || fetchPromise;
}

// =====================
// PUSH: Show notification
// =====================
self.addEventListener('push', (event) => {
  let data = {
    title: 'DiStory',
    options: {
      body: 'Ada cerita baru!',
      icon: `${BASE_PATH}/icon-192.png`,
      badge: `${BASE_PATH}/icon-192.png`,
    },
  };

  if (event.data) {
    try {
      const payload = event.data.json();
      data = {
        title: payload.title || data.title,
        options: {
          body: payload.options?.body || data.options.body,
          icon: `${BASE_PATH}/icon-192.png`,
          badge: `${BASE_PATH}/icon-192.png`,
          data: payload.options?.data || {},
          actions: [
            {
              action: 'view',
              title: 'Lihat Cerita',
            },
            {
              action: 'close',
              title: 'Tutup',
            },
          ],
          requireInteraction: false,
        },
      };
    } catch (e) {
      data.options.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, data.options)
  );
});

// =====================
// NOTIFICATION CLICK: Navigate to story
// =====================
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'close') return;

  const storyId = event.notification.data?.storyId;
  const url = storyId ? `${BASE_PATH}/#/stories/${storyId}` : `${BASE_PATH}/`;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if available
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Open new window
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
