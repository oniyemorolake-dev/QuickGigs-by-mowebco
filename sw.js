/* QuickGigs service worker
 * BUILD_ID is auto-stamped by scripts/stamp-cache-version.js (pre-commit + CI).
 * HTML: network-first (fresh when online). CSS/JS/icons: cache-first.
 * Activate purges every Cache Storage entry that is not CACHE_NAME.
 */
var BUILD_ID = 'a6868b1-1787873879';
var CACHE_NAME = 'quickgigs-' + BUILD_ID;
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

function isIconRequest(url) {
  var path = url.pathname || '';
  return /\.(png|jpg|jpeg|gif|webp|svg|ico)$/i.test(path);
}

function isOurCache(name) {
  return name === CACHE_NAME;
}

function cacheFirst(event) {
  return caches.open(CACHE_NAME).then(function (cache) {
    return cache.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (response) {
        if (response && response.ok && response.type === 'basic') {
          cache.put(event.request, response.clone());
        }
        return response;
      });
    });
  });
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
      return Promise.all(keys.map(function (k) {
        if (isOurCache(k)) return Promise.resolve();
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
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data.type === 'GET_BUILD_ID' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ buildId: BUILD_ID, cacheName: CACHE_NAME });
  }
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;

  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/rest/v1/') >= 0 || url.pathname.indexOf('/storage/') >= 0) return;

  // Never intercept the service worker script itself
  if (url.pathname.endsWith('/sw.js') || url.pathname === '/sw.js') return;

  // HTML — network-first; cache only as offline fallback
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

  // CSS / JS / icons — cache-first (query-string versions bust on deploy)
  if (isCodeRequest(url) || isIconRequest(url)) {
    event.respondWith(cacheFirst(event));
    return;
  }

  // Other same-origin GETs — cache-first
  event.respondWith(cacheFirst(event));
});
