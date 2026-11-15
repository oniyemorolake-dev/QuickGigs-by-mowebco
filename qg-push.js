/* SwiftGigs phone notifications (Web Push).
   Real push: arrives with the phone's own notification sound even when the
   app is closed. On iPhone this only works once SwiftGigs is added to the
   Home Screen, so the prompt explains that instead of failing silently. */
(function () {
  'use strict';

  var URL_ = 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/push';
  var ASKED = 'qg-push-asked-at';     // last time the banner was shown
  var SYNCED = 'qg-push-synced-at';   // last time this device was confirmed with the server

  function url() { return (window.QG_CONFIG && window.QG_CONFIG.pushUrl) || URL_; }
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function call(body) {
    if (typeof callVerifiedFunction !== 'function') return Promise.resolve({ success: false, error: 'not_ready' });
    return callVerifiedFunction(url(), body);
  }
  function say(text, ok) {
    if (typeof window.showToast === 'function') window.showToast(text, ok === false ? '#ef4444' : undefined);
  }

  var isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var installed = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true;
  var supported = 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';

  /** 'on' | 'off' | 'blocked' | 'needs_install' | 'unsupported' */
  function state() {
    if (!supported) return isIos && !installed ? 'needs_install' : 'unsupported';
    if (Notification.permission === 'denied') return 'blocked';
    if (Notification.permission === 'granted' && get(SYNCED)) return 'on';
    return 'off';
  }

  function keyBytes(b64) {
    var t = String(b64).replace(/-/g, '+').replace(/_/g, '/');
    var bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* Make sure this device has a subscription and the server knows it. */
  async function sync() {
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    if (!sub) {
      var k = await call({ action: 'key' });
      if (!k || !k.public_key) throw new Error('no_key');
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(k.public_key) });
    }
    var res = await call({ action: 'subscribe', subscription: sub.toJSON() });
    if (!res || !res.success) throw new Error((res && res.error) || 'subscribe_failed');
    set(SYNCED, String(Date.now()));
    return true;
  }

  /** Must be called from a tap: browsers only show the permission box then. */
  async function enable(opts) {
    opts = opts || {};
    var st = state();
    if (st === 'needs_install') { showInstallHelp(); return false; }
    if (st === 'unsupported') { say('This browser cannot show notifications. Try Chrome, or add SwiftGigs to your Home Screen.', false); return false; }
    if (st === 'blocked') {
      say('Notifications are blocked for SwiftGigs. Turn them on in your phone or browser settings, then try again.', false);
      return false;
    }
    try {
      var perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (perm !== 'granted') { paintControls(); return false; }
      await sync();
      paintControls();
      if (!opts.quiet) {
        var t = await call({ action: 'test' });
        say(t && t.sent ? 'Notifications are on. A test one is on its way.' : 'Notifications are on.');
      }
      return true;
    } catch (e) {
      say('Could not turn notifications on. Check your connection and try again.', false);
      return false;
    }
  }

  async function disable() {
    try {
      var reg = await navigator.serviceWorker.ready;
      var sub = await reg.pushManager.getSubscription();
      if (sub) {
        await call({ action: 'unsubscribe', endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
    } catch (e) {}
    try { localStorage.removeItem(SYNCED); } catch (e) {}
    paintControls();
    say('Notifications are off on this device.');
  }

  /* ── UI ─────────────────────────────────────────────────────────────── */
  function css() {
    if (document.getElementById('qgPushCss')) return;
    var s = document.createElement('style');
    s.id = 'qgPushCss';
    s.textContent =
      '.qg-push-bar{position:fixed;left:12px;right:12px;bottom:calc(84px + env(safe-area-inset-bottom));z-index:10900;max-width:456px;margin:0 auto;padding:14px;border-radius:14px;background:var(--surface,#fff);color:var(--text,#111);border:1px solid var(--border,#ddd);box-shadow:0 8px 28px rgba(0,0,0,.18);}' +
      '.qg-push-bar b{display:block;font-size:15px;font-weight:700;}' +
      '.qg-push-bar p{margin:4px 0 12px;font-size:13.5px;line-height:1.45;color:var(--text-muted,#666);}' +
      '.qg-push-bar ol{margin:4px 0 12px;padding-left:20px;font-size:13.5px;line-height:1.6;color:var(--text-muted,#666);}' +
      '.qg-push-row{display:flex;gap:8px;}' +
      '.qg-push-row button{flex:1;height:42px;border-radius:12px;border:1px solid var(--border,#ddd);background:transparent;color:var(--text,#111);font:inherit;font-size:14px;font-weight:700;cursor:pointer;}' +
      '.qg-push-row button.yes{background:var(--primary,#6d28d9);border-color:var(--primary,#6d28d9);color:#fff;}';
    document.head.appendChild(s);
  }
  function bar(html) {
    css();
    var old = document.getElementById('qgPushBar');
    if (old) old.remove();
    var el = document.createElement('div');
    el.id = 'qgPushBar';
    el.className = 'qg-push-bar';
    el.setAttribute('role', 'dialog');
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
  }
  function showInstallHelp() {
    var el = bar('<b>Add SwiftGigs to your Home Screen</b>' +
      '<p>iPhone only allows notifications from apps on the Home Screen.</p>' +
      '<ol><li>Tap the Share button in Safari</li><li>Choose "Add to Home Screen"</li><li>Open SwiftGigs from the new icon and turn notifications on</li></ol>' +
      '<div class="qg-push-row"><button type="button" data-x>Got it</button></div>');
    el.querySelector('[data-x]').onclick = function () { el.remove(); };
  }
  function showAsk() {
    var el = bar('<b>Turn on notifications</b>' +
      '<p>Hear right away about messages, offers, accepted gigs and payments.</p>' +
      '<div class="qg-push-row"><button type="button" data-x>Not now</button><button type="button" class="yes" data-y>Turn on</button></div>');
    el.querySelector('[data-x]').onclick = function () { el.remove(); };
    el.querySelector('[data-y]').onclick = function () { el.remove(); enable(); };
  }

  /* Any element with data-qg-push becomes the on/off control (Profile uses it). */
  function paintControls() {
    var st = state();
    Array.prototype.forEach.call(document.querySelectorAll('[data-qg-push]'), function (el) {
      var label = el.querySelector('[data-qg-push-label]');
      var sw = el.querySelector('.sg-switch');
      var words = st === 'on' ? 'On for this device.'
        : st === 'blocked' ? 'Blocked. Allow SwiftGigs in your phone settings.'
        : st === 'needs_install' ? 'Add SwiftGigs to your Home Screen first.'
        : st === 'unsupported' ? 'Not available in this browser.'
        : 'Sound and banner on your phone, even when the app is closed.';
      if (label) label.textContent = words;
      if (sw) {
        sw.setAttribute('aria-checked', st === 'on' ? 'true' : 'false');
        sw.classList.toggle('on', st === 'on');
      }
    });
  }

  /* A short two-note chime for when something arrives while the app is open.
     The phone's own sound covers the closed-app case. */
  var audio = null;
  function chime() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audio = audio || new Ctx();
      if (audio.state === 'suspended') audio.resume();
      [[880, 0], [1175, 0.14]].forEach(function (n) {
        var osc = audio.createOscillator(), gain = audio.createGain();
        osc.type = 'sine';
        osc.frequency.value = n[0];
        var t = audio.currentTime + n[1];
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        osc.connect(gain); gain.connect(audio.destination);
        osc.start(t); osc.stop(t + 0.3);
      });
    } catch (e) {}
  }

  function boot() {
    document.addEventListener('click', function (e) {
      var ctl = e.target.closest && e.target.closest('[data-qg-push]');
      if (ctl) { e.preventDefault(); if (state() === 'on') disable(); else enable(); return; }
      // Logging out: this device stops receiving the account's notifications.
      if (e.target.closest && e.target.closest('#sgLogout, [data-qg-logout]') && supported) {
        try { localStorage.removeItem(SYNCED); } catch (err) {}
        navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); })
          .then(function (sub) { if (sub) sub.unsubscribe(); }).catch(function () {});
      }
    }, true);

    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', function (ev) {
        if (!ev.data || ev.data.type !== 'QG_PUSH' || document.hidden) return;
        chime();
        document.dispatchEvent(new CustomEvent('qg-push', { detail: ev.data }));
      });
    }

    paintControls();
    var tries = 0;
    var wait = setInterval(function () {
      tries++;
      if (!(window._currentUser && window._currentUser.uid)) { if (tries > 60) clearInterval(wait); return; }
      clearInterval(wait);
      var st = state();
      if (supported && Notification.permission === 'granted') {
        // Re-confirm with the server once a day (keys rotate, devices change hands).
        if (Date.now() - Number(get(SYNCED) || 0) > 86400000) sync().then(paintControls).catch(function () {});
        return;
      }
      if (st !== 'off' && st !== 'needs_install') return;
      if (Date.now() - Number(get(ASKED) || 0) < 7 * 86400000) return;
      if (!document.querySelector('.sg-tabs')) return;            // app screens only
      setTimeout(function () {
        if (document.querySelector('.qg-rv-ov, .qg-tip-ov.open, .qg-lang-ask')) return;
        set(ASKED, String(Date.now()));
        if (st === 'needs_install') showInstallHelp(); else showAsk();
      }, 6000);
    }, 500);
  }

  window.QG_enablePush = enable;
  window.QG_disablePush = disable;
  window.QG_pushState = state;
  window.requestQuickGigsNotifications = enable;   // old name, kept for callers
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
