/*
 * Offline copy of the app (service worker).
 *
 * Strategy: "stale-while-revalidate". Every file of the app is served from the cache at once
 * (the app opens without a network), and fetched again in the background to refresh the
 * cache, so the next visit gets the latest version. Data never goes through here: it lives in
 * localStorage and in the user's own file.
 *
 * Bump CACHE when the list of files changes.
 */
'use strict';

const CACHE = 'ds-tracker-v4';
const FILES = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/model.js',
  'js/storage.js',
  'js/ics.js',
  'js/schedule.js',
  'js/calendar.js',
  'js/td.js',
  'js/app.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
