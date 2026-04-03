// sw.js - Service Worker для офлайн-режима
const CACHE_NAME = 'chess-offline-v3-supabase';

const STATIC_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/supabase-config.js',
  './js/firebase.js',
  './js/auth.js',
  './js/board-ui.js',
  './js/controls.js',
  './js/ui.js',
  './js/game-core.js',
  './js/utils.js',
  './js/themes.js',
  './manifest.json',
  './favicon.ico',
  './assets/icon-192x192.png',
  './assets/icon-512x512.png'
];

const CRITICAL_JS = new Set([
  '/js/app.js',
  '/js/supabase-config.js',
  '/js/firebase.js',
  '/js/auth.js',
  '/js/game-core.js'
]);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;
  const isHtmlRequest = event.request.mode === 'navigate' || requestUrl.pathname === '/' || requestUrl.pathname.endsWith('.html');
  const isCriticalJs = isSameOrigin && CRITICAL_JS.has(requestUrl.pathname);

  // HTML и критический JS: network-first, чтобы быстрее получать обновления после деплоя
  if (isHtmlRequest || isCriticalJs) {
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          if (networkResponse.ok) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
          }
          return networkResponse;
        })
        .catch(err =>
          caches.match(event.request).then(cached => {
            if (cached) return cached;
            if (isHtmlRequest) return caches.match('./index.html');
            throw err;
          })
        )
    );
    return;
  }

  // Статические ассеты: cache-first для офлайн MVP
  if (
    isSameOrigin ||
    requestUrl.hostname.includes('code.jquery.com') ||
    requestUrl.hostname.includes('cdnjs.cloudflare.com') ||
    requestUrl.hostname.includes('unpkg.com') ||
    requestUrl.hostname.includes('cdn.jsdelivr.net')
  ) {
    event.respondWith(
      caches.match(event.request).then(cachedResponse => {
        if (cachedResponse) return cachedResponse;

        return fetch(event.request).then(networkResponse => {
          if (networkResponse.ok) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
          }
          return networkResponse;
        });
      })
    );
  }
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames
          .filter(cacheName => cacheName !== CACHE_NAME)
          .map(cacheName => caches.delete(cacheName))
      )
    )
  );
  self.clients.claim();
});
