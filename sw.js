/*
  Service Worker — Trading Journal PWA
  Strategi: Pre-cache semua CDN + app pada install,
  lalu cache-first untuk aset statis, network-first untuk halaman.
*/

const CACHE_NAME = 'tj-offline-v4';

// Daftar semua resource yang WAJIB di-cache saat install
// Ini mencakup CDN external sehingga app 100% offline
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  // Chart.js
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  // Font Awesome CSS + fallback
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  // Google Fonts CSS (browser akan fetch font files otomatis lalu di-cache oleh SW)
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap'
];

// Install: pre-cache semua resource penting
self.addEventListener('install', event => {
  console.log('[SW] Install — pre-caching', PRECACHE_URLS.length, 'resources');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // Gunakan addAll dengan error handling per-item
        // agar 1 gagal tidak menggagalkan yang lain
        return Promise.allSettled(
          PRECACHE_URLS.map(url =>
            cache.add(url).catch(err => {
              console.warn('[SW] Gagal cache:', url, err.message);
              return null; // skip yang gagal
            })
          )
        );
      })
      .then(() => self.skipWaiting()) // Aktifkan SW segera
  );
});

// Activate: hapus cache versi lama
self.addEventListener('activate', event => {
  console.log('[SW] Activate — membersihkan cache lama');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Hapus cache lama:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim()) // Ambil alih semua tab
  );
});

// Fetch: tentukan strategi berdasarkan tipe request
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Hanya handle GET request
  if (request.method !== 'GET') return;

  // Strategi berdasarkan sumber
  if (isCDNRequest(url)) {
    // CDN: cache-first, fallback network
    event.respondWith(cacheFirst(request));
  } else if (isNavigationRequest(request)) {
    // Halaman utama: network-first, fallback cache
    event.respondWith(networkFirst(request));
  } else if (isGoogleFontsFile(url)) {
    // File font dari gstatic: cache-first
    event.respondWith(cacheFirst(request));
  } else {
    // Lainnya: network-first, fallback cache
    event.respondWith(networkFirst(request));
  }
});

// --- Strategi Cache ---

// Cache-first: cek cache dulu, kalau tidak ada baru fetch
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Offline dan tidak ada cache — return error sederhana
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

// Network-first: coba fetch dulu, kalau gagal ambil dari cache
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;

    // Untuk navigasi yang gagal, serve index.html dari cache
    if (request.mode === 'navigate') {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
    }

    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

// --- Helper ---

function isCDNRequest(url) {
  return url.hostname.includes('cdn.jsdelivr.net') ||
         url.hostname.includes('cdnjs.cloudflare.com') ||
         url.hostname.includes('unpkg.com');
}

function isGoogleFontsFile(url) {
  return url.hostname === 'fonts.gstatic.com';
}

function isNavigationRequest(request) {
  return request.mode === 'navigate' ||
         (request.method === 'GET' && request.headers.get('accept')?.includes('text/html'));
}
