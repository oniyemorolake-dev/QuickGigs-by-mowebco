/* SwiftGigs — service worker registration and app updates.
 *
 * Loaded on EVERY page. Before this file existed, registration lived in
 * qg-pwa.js, which only four pages load (home, login, workers, categories).
 * The installed app opens on dashboard.html, so it never looked for a new
 * version and never reloaded when one arrived.
 *
 * What it does:
 *   - registers /sw.js
 *   - looks for a new version when the app comes to the front, comes back
 *     online, is restored from the back/forward cache, and every 20 minutes
 *   - reloads once when a new worker takes over
 *   - when the worker reports refreshed files: reloads quietly if the app is
 *     in the background, otherwise shows a one-tap "New version ready" pill
 */
(function () {
  if (window.__sgSwRegister) return;
  window.__sgSwRegister = true;
  if (!('serviceWorker' in navigator)) return;

  var refreshing = false;
  var newBuild = '';   // set when the server reports a build this app is not running
  var hadController = !!navigator.serviceWorker.controller;

  function isTyping() {
    var el = document.activeElement;
    return !!(el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || '')) ||
      !!(el && el.isContentEditable);
  }

  function reloadOnce() {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  }

  /* A new build was published: drop the saved copies of the app's files so
     the reload fetches every one fresh, even if the phone has not picked up
     the new service worker yet. Otherwise a plain reload. */
  function freshReload() {
    if (!newBuild) { reloadOnce(); return; }
    try { sessionStorage.setItem('sg-applied-build', newBuild); } catch (e) {}
    var wipe = (window.caches && caches.keys)
      ? caches.keys().then(function (keys) { return Promise.all(keys.map(function (k) { return caches.delete(k); })); })
      : Promise.resolve();
    Promise.race([wipe, new Promise(function (r) { setTimeout(r, 1500); })]).then(reloadOnce, reloadOnce);
  }

  function showUpdateReady() {
    if (document.getElementById('sg-update-ready') || !document.body) return;
    // Just refreshed for an update: give the new files a minute to settle.
    try {
      var applied = Number(sessionStorage.getItem('sg-update-applied') || 0);
      if (applied && Date.now() - applied < 60 * 1000) return;
    } catch (e) {}
    var pill = document.createElement('button');
    pill.id = 'sg-update-ready';
    pill.type = 'button';
    pill.setAttribute('aria-live', 'polite');
    pill.textContent = 'New version ready · Tap to refresh';
    pill.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);' +
      'bottom:calc(84px + env(safe-area-inset-bottom,0px));z-index:2147483000;' +
      'padding:10px 16px;border:0;border-radius:999px;font:600 14px/1.2 inherit;' +
      'background:var(--primary,#8B5CF6);color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.35);' +
      'cursor:pointer;max-width:calc(100vw - 32px);white-space:nowrap';
    pill.addEventListener('click', function () {
      try { sessionStorage.setItem('sg-update-applied', String(Date.now())); } catch (e) {}
      freshReload();
    });
    document.body.appendChild(pill);
  }

  function applyUpdate() {
    // Never yank the page from under someone who is typing or looking at it.
    if (document.visibilityState === 'hidden' && !isTyping()) freshReload();
    else showUpdateReady();
  }

  // A new worker took control. First install (no previous controller) needs nothing.
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (!hadController) { hadController = true; return; }
    applyUpdate();
  });

  // The worker refreshed one or more cached files in the background.
  navigator.serviceWorker.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'QG_ASSETS_UPDATED') applyUpdate();
  });

  // If an update arrived while visible, apply it as soon as the app is backgrounded.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' &&
        document.getElementById('sg-update-ready') && !isTyping()) {
      freshReload();
    }
  });

  function start() {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(function (reg) {
      if (reg.waiting) { try { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (e) {} }
      reg.addEventListener('updatefound', function () {
        var w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', function () {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            try { w.postMessage({ type: 'SKIP_WAITING' }); } catch (e) {}
          }
        });
      });

      var lastCheck = 0;
      function check(force) {
        var now = Date.now();
        if (!force && now - lastCheck < 60 * 1000) return;
        lastCheck = now;
        try { reg.update(); } catch (e) {}
        try {
          if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ type: 'QG_REVALIDATE_NOW' });
          }
        } catch (e2) {}
      }

      /* Ask the server which build is live and compare with the one this app
         is running. Before this, a fix only showed up when the app was closed
         and reopened, or after 20 minutes. The file is tiny. */
      function runningBuild() {
        return new Promise(function (resolve) {
          var ctrl = navigator.serviceWorker.controller;
          if (!ctrl || typeof MessageChannel !== 'function') { resolve(''); return; }
          var ch = new MessageChannel();
          var t = setTimeout(function () { resolve(''); }, 1500);
          ch.port1.onmessage = function (ev) { clearTimeout(t); resolve((ev.data && ev.data.buildId) || ''); };
          try { ctrl.postMessage({ type: 'GET_BUILD_ID' }, [ch.port2]); } catch (e) { clearTimeout(t); resolve(''); }
        });
      }
      var lastBuildCheck = 0;
      function checkBuild() {
        if (document.visibilityState === 'hidden' || !navigator.onLine) return;
        var now = Date.now();
        if (now - lastBuildCheck < 45 * 1000) return;
        lastBuildCheck = now;
        Promise.all([
          fetch('/qg-build-id.json?t=' + now, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
          runningBuild()
        ]).then(function (res) {
          var live = res[0] && res[0].buildId;
          var mine = res[1];
          if (!live || !mine || live === mine) return;
          try { if (sessionStorage.getItem('sg-applied-build') === live) return; } catch (e) {}
          newBuild = live;
          try { reg.update(); } catch (e2) {}
          applyUpdate();
        });
      }
      setInterval(checkBuild, 2 * 60 * 1000);
      setTimeout(checkBuild, 15 * 1000);

      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') { check(false); checkBuild(); }
      });
      window.addEventListener('focus', function () { check(false); });
      window.addEventListener('online', function () { check(true); });
      window.addEventListener('pageshow', function (ev) { if (ev.persisted) check(true); });
      setInterval(function () { check(false); }, 20 * 60 * 1000);
      // On page load just ask for a new worker; the page's own requests already
      // refresh its files, so forcing a full re-check here only re-announced
      // the update that was just applied.
      lastCheck = Date.now();
      try { reg.update(); } catch (e) {}
    }).catch(function (err) {
      console.warn('Service worker registration failed:', err);
    });
  }

  // Register after first paint so it never competes with page load.
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();
