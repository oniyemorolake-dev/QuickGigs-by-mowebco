/* SwiftGigs service worker
 * BUILD_ID is auto-stamped by scripts/stamp-cache-version.js (pre-commit + CI).
 *
 * Strategy
 *   HTML            network-first with a timeout, cached copy as fallback
 *                   (fresh when online, instant when the connection is poor).
 *   CSS / JS / img  stale-while-revalidate: answer from cache immediately,
 *                   then re-check the server in the background and tell open
 *                   pages when something changed.
 *
 * Why stale-while-revalidate: the old worker was cache-first, so a changed
 * file only reached people after BUILD_ID changed AND the browser noticed the
 * new sw.js. Anything that delayed either step left phones on old code. Now
 * every asset refreshes itself within one visit, whatever BUILD_ID says.
 * A BUILD_ID change still starts a clean cache, as before.
 */
var BUILD_ID = 'f4e0a1d-1794604193';
var CACHE_NAME = 'quickgigs-' + BUILD_ID;
var OFFLINE_FALLBACK = '/dashboard.html';

// How long a slow network may hold up a page before the cached copy is used.
var HTML_TIMEOUT_MS = 3500;
// Each asset is re-checked at most this often (conditional request, usually a 304).
var REVALIDATE_EVERY_MS = 5 * 60 * 1000;

var STATIC_ASSETS = [
  '/QuickGigsLogo.png',
  '/manifest.json',
  '/qg-tokens.css',
  '/sg-app.css',
  '/qg-theme.js',
  '/qg-config.js',
  '/sg-sw-register.js'
];

var lastChecked = {};      // url -> time of last revalidation
var notifyTimer = null;    // batches "assets changed" messages

function isHtmlRequest(url) {
  var path = url.pathname || '';
  return path === '/' || path.endsWith('.html');
}

function isOurCache(name) {
  return name === CACHE_NAME;
}

function cacheable(response) {
  return response && response.ok && response.type === 'basic';
}

/** SHA-256 of the body. Headers (ETag, Last-Modified) differ between GitHub's
 *  CDN servers for the same file, so comparing them reported phantom updates. */
function bodyHash(response) {
  if (!response) return Promise.resolve('');
  return response.clone().arrayBuffer().then(function (buf) {
    return crypto.subtle.digest('SHA-256', buf);
  }).then(function (d) {
    return Array.prototype.map.call(new Uint8Array(d), function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
  }).catch(function () { return ''; });
}

/** Only code and styles justify asking people to refresh. */
function worthAnnouncing(url) {
  var path = new URL(url).pathname;
  return /\.(js|css)$/.test(path);
}

function notifyClientsSoon() {
  if (notifyTimer) return;
  notifyTimer = setTimeout(function () {
    notifyTimer = null;
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      list.forEach(function (client) {
        try { client.postMessage({ type: 'QG_ASSETS_UPDATED', buildId: BUILD_ID }); } catch (e) {}
      });
    });
  }, 1500);
}

/** Fetch a fresh copy (bypassing the HTTP cache's heuristics) and store it. */
function refresh(request, cache, cached) {
  // 'no-cache' = always revalidate with the server; unchanged files cost a 304.
  return fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(function (response) {
    if (!cacheable(response)) return response;
    var check = (cached && worthAnnouncing(request.url))
      ? Promise.all([bodyHash(cached), bodyHash(response)])
      : Promise.resolve(null);
    return check.then(function (hashes) {
      var changed = !!(hashes && hashes[0] && hashes[1] && hashes[0] !== hashes[1]);
      return cache.put(request, response.clone()).then(function () {
        if (changed) notifyClientsSoon();
        return response;
      });
    });
  });
}

function staleWhileRevalidate(event) {
  var request = event.request;
  return caches.open(CACHE_NAME).then(function (cache) {
    return cache.match(request).then(function (cached) {
      if (!cached) return refresh(request, cache, null);

      var now = Date.now();
      var last = lastChecked[request.url] || 0;
      if (now - last > REVALIDATE_EVERY_MS) {
        lastChecked[request.url] = now;
        // Clone before handing `cached` to the page: once the page reads it,
        // its body can no longer be copied for the comparison.
        event.waitUntil(refresh(request, cache, cached.clone()).catch(function () {}));
      }
      return cached;
    });
  });
}

function networkFirstHtml(event) {
  var request = event.request;

  var network = Promise.resolve(event.preloadResponse).then(function (preloaded) {
    return preloaded || fetch(request, { cache: 'no-store' });
  }).then(function (response) {
    if (cacheable(response)) {
      var copy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then(function (cache) {
        return cache.put(request, copy);
      }));
    }
    return response;
  });

  var fromCache = function () {
    return caches.match(request, { ignoreSearch: true }).then(function (cached) {
      if (cached) return cached;
      if (request.mode === 'navigate') return caches.match(OFFLINE_FALLBACK);
      return undefined;
    });
  };

  // Slow connection: after the timeout, show the cached page if there is one.
  // The network request keeps going and updates the cache for next time.
  var timeout = new Promise(function (resolve) {
    setTimeout(function () {
      fromCache().then(function (cached) { if (cached) resolve(cached); });
    }, HTML_TIMEOUT_MS);
  });

  return Promise.race([
    network.catch(function () {
      return fromCache().then(function (cached) {
        return cached || Response.error();
      });
    }),
    timeout
  ]);
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // 'reload' so a fresh install never copies stale files out of the HTTP cache.
      return Promise.all(STATIC_ASSETS.map(function (path) {
        return fetch(path, { cache: 'reload' }).then(function (response) {
          if (cacheable(response)) return cache.put(path, response);
        }).catch(function () { /* partial ok */ });
      }));
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
      // Start page requests in parallel with worker start-up (faster cold opens).
      if (self.registration.navigationPreload) {
        return self.registration.navigationPreload.enable().catch(function () {});
      }
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
  // Page asks for an immediate re-check of everything (e.g. app brought to front).
  if (event.data.type === 'QG_REVALIDATE_NOW') {
    lastChecked = {};
  }
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;

  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/rest/v1/') >= 0 || url.pathname.indexOf('/storage/') >= 0) return;

  // Never intercept the service worker script or the build marker.
  if (url.pathname === '/sw.js' || url.pathname.endsWith('/sw.js')) return;
  if (url.pathname === '/qg-build-id.json') return;

  if (isHtmlRequest(url)) {
    event.respondWith(networkFirstHtml(event));
    return;
  }

  // CSS / JS / images / everything else same-origin.
  event.respondWith(staleWhileRevalidate(event));
});
