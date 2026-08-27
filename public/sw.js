// Minimal app-shell service worker — offline load + "Add to Home Screen"
// installability. Deliberately does NOT cache Firestore data or any
// cross-origin request (Firestore's own channels, Google Fonts, the Gemini/
// Sentry endpoints, etc.) — that's services/firebase.ts's persistentLocalCache
// job, and hand-rolling a second cache on top of it would just create two
// sources of truth for the same data.
//
// Bump CACHE_VERSION on any deploy that changes the app shell itself
// (index.html, this file, the manifest, the icons) — content-hashed JS/CSS
// chunks under /assets/ don't need it, since a new build produces new
// filenames and the browser's own HTTP cache (see firebase.json's
// "immutable" header on /assets/**) already handles those correctly.
const CACHE_VERSION = 'ftt-shell-v1';
const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(n => n !== CACHE_VERSION).map(n => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return; // never intercept writes
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // cross-origin: let it pass through untouched

  // Navigations (loading the app itself): network-first so staff always get
  // the latest build when online, falling back to the cached shell so a
  // refresh while offline still loads the app instead of the browser's
  // offline error page.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  // Static, content-hashed build assets: cache-first — they're immutable per
  // filename (a new deploy ships new filenames), so there's nothing to
  // revalidate.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(res => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(cache => cache.put(request, copy));
        return res;
      })),
    );
    return;
  }

  // Everything else same-origin (icons, manifest, root-level static files):
  // network falling back to cache.
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});
