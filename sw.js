/* QuickGigs service worker
 * HTML + JS/CSS: network-first (never serve stale app shell when online).
 * Static assets only: logo + manifest. Old caches are wiped on activate.
 */
var CACHE_NAME = 'quickgigs-v96-msgint';
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
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      // Delete every cache that is not the current version
      return Promise.all(keys.map(function (k) {
        if (k === CACHE_NAME) return Promise.resolve();
        return caches.delete(k);
      }));
    }).then(function () {
      return caches.open(CACHE_NAME).then(function (cache) {
        return cache.addAll(STATIC_ASSETS).catch(function () {});
      });
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;

  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/rest/v1/') >= 0 || url.pathname.indexOf('/storage/') >= 0) return;

  // JS / CSS — always network-first with no-store; cache only as offline fallback
  if (isCodeRequest(url)) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).then(function (response) {
        // Do not put JS/CSS into Cache Storage when online — avoids stale UI forever
        return response;
      }).catch(function () {
        return caches.match(event.request);
      })
    );
    return;
  }

  // HTML — network-first; cache successful responses for offline only
  if (isHtmlRequest(url)) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).then(function (response) {
        if (response && response.ok && response.type === 'basic') {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, copy);
          });
        }
        return response;
      }).catch(function () {
        return caches.match(event.request).then(function (cached) {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match(OFFLINE_FALLBACK);
          }
          return undefined;
        });
      })
    );
    return;
  }

  // Other static (images etc.) — cache-first
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
