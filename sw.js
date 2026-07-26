/* QuickGigs service worker — never cache JS/CSS (always fresh); HTML network-first */
var CACHE_NAME = 'quickgigs-v74';
var OFFLINE_FALLBACK = '/dashboard.html';

var STATIC_ASSETS = [
  '/QuickGigsLogo.png',
  '/manifest.json'
];

function isHtmlRequest(url) {
  var path = url.pathname || '';
  return path === '/' || path.endsWith('.html');
}

function isCodeRequest(url) {
  var path = url.pathname || '';
  return path.endsWith('.js') || path.endsWith('.css');
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(STATIC_ASSETS).catch(function () { /* partial ok */ });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      // Wipe ALL caches so old pay/sync JS cannot stick
      return Promise.all(keys.map(function (k) { return caches.delete(k); }));
    }).then(function () {
      return caches.open(CACHE_NAME).then(function (cache) {
        return cache.addAll(STATIC_ASSETS).catch(function () {});
      });
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;

  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/rest/v1/') >= 0 || url.pathname.indexOf('/storage/') >= 0) return;

  // Always fetch fresh JS/CSS — never serve stale pay/complete logic
  if (isCodeRequest(url)) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).catch(function () {
        return caches.match(event.request);
      })
    );
    return;
  }

  if (isHtmlRequest(url)) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).then(function (response) {
        return response;
      }).catch(function () {
        return caches.match(event.request).then(function (cached) {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match(OFFLINE_FALLBACK);
          }
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (response) {
        if (!response || response.status !== 200 || response.type !== 'basic') return response;
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        return response;
      });
    })
  );
});
