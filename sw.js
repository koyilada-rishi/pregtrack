// Pregnancy Care Tracker — service worker.
//
// Caches the app shell (HTML/CSS/JS/icons/manifest) and the static content
// JSON so the app opens and reads offline. It does NOT touch API calls
// (those are POST requests to Apps Script, which the Cache API can't key
// on anyway) — js/api.js already keeps its own "last-fetched data" cache in
// localStorage for that. js/config.js is deliberately left out of the
// precache list: it's user-provided and gitignored, so it may not exist
// yet on first install, and forcing it into addAll() would fail the whole
// install if so.
//
// Bump CACHE_VERSION whenever app shell files change, so returning users
// pick up the new version instead of a stale cached one.

const CACHE_VERSION = "v1";
const CACHE_NAME = "pct-shell-" + CACHE_VERSION;

const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/api.js",
  "./js/i18n.js",
  "./js/mock.js",
  "./manifest.json",
  "./data/weeks.json",
  "./data/food.json",
  "./data/warnings.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only ever cache same-origin GETs. Everything else (API POSTs, the
  // Chart.js CDN script, cross-origin anything) goes straight to the
  // network untouched.
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

// Serves from cache immediately when available (so the app opens instantly
// and works offline), while updating the cache in the background for next
// time. Falls back to the network if nothing is cached yet.
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || (await networkFetch) || Response.error();
}
