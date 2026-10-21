// Pregnancy Care Tracker — service worker.
//
// Caches the app shell (HTML/CSS/JS/icons/manifest) and the static content
// JSON so the app opens and reads offline. It does NOT touch API calls
// (those are POST requests to Apps Script, which the Cache API can't key
// on anyway) — js/store.js already keeps its own "last-fetched data" cache
// (and the bootstrap cache) in localStorage for that. js/defaults.js IS
// listed below even though it's committed (not user-provided like v1's
// config.js was) — it's still a real file app.js's module graph imports,
// and must be cached for a true cold-start offline load (the very first
// visit, before this service worker is even controlling the page, so its
// own fetch handler never got a chance to opportunistically cache it).
//
// All paths below are relative ("./..."), resolved against this script's
// own URL — required for GitHub Pages, which serves the site from
// /<repo-name>/ rather than the domain root.
//
// Bump CACHE_VERSION whenever app shell files change (added/removed a
// file here), so returning users pick up the new version instead of a
// stale cached one that cache.addAll() would otherwise keep serving.
//
// IMPORTANT: this list must include every file app.js's module graph
// actually imports. cache.addAll() is all-or-nothing — one wrong/stale
// entry (e.g. a file that's since been deleted) fails the *entire*
// install silently, breaking all offline support with no visible error.
// This happened for real once already (js/mock.js stayed listed here
// after being deleted elsewhere) — double-check this list whenever a JS
// file is added, renamed, or removed.

const CACHE_VERSION = "v11";
const CACHE_NAME = "pct-shell-" + CACHE_VERSION;

const APP_SHELL = [
  "./",
  "./index.html",
  "./css/tokens.css",
  "./css/style.css",
  "./css/fonts/plus-jakarta-sans-400.woff2",
  "./css/fonts/plus-jakarta-sans-500.woff2",
  "./css/fonts/plus-jakarta-sans-600.woff2",
  "./css/fonts/plus-jakarta-sans-700.woff2",
  "./css/fonts/material-symbols-subset.woff2",
  "./js/app.js",
  "./js/api.js",
  "./js/store.js",
  "./js/countdown.js",
  "./js/schedule.js",
  "./js/quickadd.js",
  "./js/defaults.js",
  "./js/i18n.js",
  "./js/icons.js",
  "./manifest.json",
  "./data/weeks.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener("install", (event) => {
  // Deliberately no self.skipWaiting() here: on a fresh install (nothing
  // controlling the page yet) a worker with no competing controller
  // activates on its own regardless. On an update, this new worker instead
  // sits "waiting" until the page explicitly asks it to take over (the
  // message handler below) — see js/app.js's update-prompt banner, which is
  // what sends that message once she taps it. Without this, an update would
  // silently take over an open tab mid-use with no chance to save/finish
  // whatever she's doing.
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
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
