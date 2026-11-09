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

  function showUpdateReady() {
    if (document.getElementById('sg-update-ready') || !document.body) return;
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
    pill.addEventListener('click', reloadOnce);
    document.body.appendChild(pill);
  }

  function applyUpdate() {
    // Never yank the page from under someone who is typing or looking at it.
    if (document.visibilityState === 'hidden' && !isTyping()) reloadOnce();
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
      reloadOnce();
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

      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') check(false);
      });
      window.addEventListener('focus', function () { check(false); });
      window.addEventListener('online', function () { check(true); });
      window.addEventListener('pageshow', function (ev) { if (ev.persisted) check(true); });
      setInterval(function () { check(false); }, 20 * 60 * 1000);
      check(true);
    }).catch(function (err) {
      console.warn('Service worker registration failed:', err);
    });
  }

  // Register after first paint so it never competes with page load.
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();
