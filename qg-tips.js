/* SwiftGigs tips — a poster's thank-you after a finished gig.
   100% of a tip goes to the tasker. The server decides who the tasker is and
   what was actually charged; this file only collects the amount and shows the
   Stripe payment form. */
(function () {
  'use strict';

  var TIP_URL = 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/tip';
  var PRESETS = [200, 500, 1000, 2000];
  var MIN = 200, MAX = 20000;
  var overlay = null, checkout = null, stripePromise = null;

  function url() { return (window.QG_CONFIG && window.QG_CONFIG.tipUrl) || TIP_URL; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function dollars(cents) {
    var n = (Number(cents) || 0) / 100;
    return '$' + (n % 1 === 0 ? n.toFixed(0) : n.toFixed(2));
  }
  function call(body) {
    if (typeof callVerifiedFunction !== 'function') return Promise.resolve({ success: false, error: 'not_ready' });
    return callVerifiedFunction(url(), body);
  }
  function loadStripe() {
    if (window.Stripe) return Promise.resolve(window.Stripe);
    if (stripePromise) return stripePromise;
    stripePromise = new Promise(function (resolve, reject) {
      var s = document.querySelector('script[src*="js.stripe.com/v3"]');
      if (!s) {
        s = document.createElement('script');
        s.src = 'https://js.stripe.com/v3/';
        s.async = true;
        document.head.appendChild(s);
      }
      s.addEventListener('load', function () { resolve(window.Stripe); });
      s.addEventListener('error', function () { stripePromise = null; reject(new Error('Could not load Stripe')); });
      if (window.Stripe) resolve(window.Stripe);
    });
    return stripePromise;
  }

  function ensureDom() {
    if (overlay) return overlay;
    var style = document.createElement('style');
    style.textContent =
      '.qg-tip-ov{position:fixed;inset:0;z-index:12000;background:rgba(0,0,0,.5);display:none;align-items:flex-end;justify-content:center;}' +
      '.qg-tip-ov.open{display:flex;}' +
      '.qg-tip-sheet{width:100%;max-width:480px;max-height:92vh;overflow:auto;background:var(--surface,#fff);color:var(--text,#111);border-radius:20px 20px 0 0;padding:20px 18px calc(20px + env(safe-area-inset-bottom));box-sizing:border-box;}' +
      '.qg-tip-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:4px;}' +
      '.qg-tip-head h2{flex:1;margin:0;font-size:19px;font-weight:700;}' +
      '.qg-tip-x{border:0;background:none;color:var(--text-muted,#666);font:inherit;font-size:14px;font-weight:600;padding:4px;cursor:pointer;}' +
      '.qg-tip-sub{margin:0 0 16px;font-size:13.5px;color:var(--text-muted,#666);line-height:1.45;}' +
      '.qg-tip-chips{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}' +
      '.qg-tip-chip{height:48px;border-radius:12px;border:1px solid var(--border,#ddd);background:transparent;color:var(--text,#111);font:inherit;font-size:16px;font-weight:700;cursor:pointer;}' +
      '.qg-tip-chip.on{border-color:var(--teal,#0d9488);background:var(--teal,#0d9488);color:#fff;}' +
      '.qg-tip-custom{display:flex;align-items:center;gap:8px;margin-top:10px;border:1px solid var(--border,#ddd);border-radius:12px;padding:0 14px;}' +
      '.qg-tip-custom span{font-weight:700;color:var(--text-muted,#666);}' +
      '.qg-tip-custom input{flex:1;min-width:0;height:48px;border:0;background:transparent;color:var(--text,#111);font:inherit;font-size:16px;outline:none;}' +
      '.qg-tip-go{width:100%;height:50px;margin-top:14px;border:0;border-radius:14px;background:var(--teal,#0d9488);color:#fff;font:inherit;font-size:16px;font-weight:700;cursor:pointer;}' +
      '.qg-tip-go:disabled{opacity:.5;cursor:default;}' +
      '.qg-tip-err{min-height:18px;margin:8px 0 0;font-size:13px;color:var(--danger,#c0392b);}' +
      '.qg-tip-done{text-align:center;padding:18px 0 6px;}' +
      '.qg-tip-done b{display:block;font-size:26px;font-weight:700;color:var(--green,#16a34a);margin-bottom:6px;}';
    document.head.appendChild(style);
    overlay = document.createElement('div');
    overlay.className = 'qg-tip-ov';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Add a tip');
    overlay.innerHTML = '<div class="qg-tip-sheet" id="qgTipSheet"></div>';
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    return overlay;
  }
  function close() {
    if (checkout) { try { checkout.destroy(); } catch (e) {} checkout = null; }
    if (overlay) overlay.classList.remove('open');
    document.body.style.overflow = '';
  }
  function head(title) {
    return '<div class="qg-tip-head"><h2>' + esc(title) + '</h2><button type="button" class="qg-tip-x" data-tip-close>Close</button></div>';
  }

  function open(taskId, opts) {
    opts = opts || {};
    ensureDom();
    var sheet = document.getElementById('qgTipSheet');
    var cents = 500;
    var who = opts.taskerName ? opts.taskerName : 'your tasker';
    sheet.innerHTML = head('Add a tip') +
      '<p class="qg-tip-sub">A thank-you for ' + esc(who) + (opts.title ? ' on "' + esc(opts.title) + '"' : '') +
        '. All of it goes to them. SwiftGigs takes nothing from tips.</p>' +
      '<div class="qg-tip-chips">' + PRESETS.map(function (c) {
        return '<button type="button" class="qg-tip-chip' + (c === cents ? ' on' : '') + '" data-tip-amt="' + c + '">' + dollars(c) + '</button>';
      }).join('') + '</div>' +
      '<label class="qg-tip-custom"><span>$</span><input id="qgTipCustom" type="text" inputmode="decimal" autocomplete="off" placeholder="Other amount" aria-label="Other tip amount in dollars"></label>' +
      '<button type="button" class="qg-tip-go" id="qgTipGo">Tip ' + dollars(cents) + '</button>' +
      '<p class="qg-tip-err" id="qgTipErr" role="alert"></p>';
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';

    var go = document.getElementById('qgTipGo');
    var err = document.getElementById('qgTipErr');
    var custom = document.getElementById('qgTipCustom');
    function paint() {
      sheet.querySelectorAll('[data-tip-amt]').forEach(function (b) {
        b.classList.toggle('on', !custom.value && Number(b.getAttribute('data-tip-amt')) === cents);
      });
      var ok = cents >= MIN && cents <= MAX;
      go.disabled = !ok;
      go.textContent = ok ? 'Tip ' + dollars(cents) : 'Tip';
      err.textContent = (!ok && custom.value) ? 'A tip can be between ' + dollars(MIN) + ' and ' + dollars(MAX) + '.' : '';
    }
    sheet.onclick = function (e) {
      if (e.target.closest('[data-tip-close]')) { close(); return; }
      var chip = e.target.closest('[data-tip-amt]');
      if (chip) { custom.value = ''; cents = Number(chip.getAttribute('data-tip-amt')); paint(); }
    };
    custom.oninput = function () {
      var v = custom.value.replace(/[^0-9.]/g, '');
      if (v !== custom.value) custom.value = v;
      var n = Math.round(parseFloat(v) * 100);
      cents = v && isFinite(n) ? n : 0;
      if (!v) cents = 500;
      paint();
    };
    go.onclick = async function () {
      go.disabled = true;
      go.textContent = 'One moment…';
      err.textContent = '';
      var res = await call({ action: 'create', task_id: String(taskId), amount_cents: cents });
      if (!res || !res.success || !res.client_secret) {
        err.textContent = (res && res.message) || 'Could not start the tip. Try again.';
        paint();
        return;
      }
      try {
        var Stripe = await loadStripe();
        var key = window.QG_CONFIG && window.QG_CONFIG.stripePublishableKey;
        var stripe = Stripe(key);
        sheet.innerHTML = head('Tip ' + dollars(cents)) +
          '<p class="qg-tip-sub">All of it goes to ' + esc(who) + '.</p><div id="qgTipMount"></div>';
        sheet.onclick = function (e) { if (e.target.closest('[data-tip-close]')) close(); };
        checkout = await stripe.initEmbeddedCheckout({
          clientSecret: res.client_secret,
          onComplete: function () { finish(res.tip_id, cents, who, opts); }
        });
        checkout.mount('#qgTipMount');
      } catch (e2) {
        sheet.innerHTML = head('Add a tip') + '<p class="qg-tip-err">The payment form did not load. Check your connection and try again.</p>';
        sheet.onclick = function (e) { if (e.target.closest('[data-tip-close]')) close(); };
      }
    };
  }

  async function finish(tipId, cents, who, opts) {
    var sheet = document.getElementById('qgTipSheet');
    if (checkout) { try { checkout.destroy(); } catch (e) {} checkout = null; }
    sheet.innerHTML = head('Tip sent') + '<div class="qg-tip-done"><b>' + dollars(cents) + '</b>Sending to ' + esc(who) + '…</div>';
    sheet.onclick = function (e) { if (e.target.closest('[data-tip-close]')) close(); };
    var res = await call({ action: 'confirm', tip_id: tipId });
    var status = res && res.status;
    var line = status === 'paid' ? esc(who) + ' has it now. Thank you for tipping.'
      : status === 'collected' ? 'Payment received. It reaches ' + esc(who) + ' as soon as their payout account is ready.'
      : 'Payment received. It will reach ' + esc(who) + ' shortly.';
    sheet.innerHTML = head('Tip sent') + '<div class="qg-tip-done"><b>' + dollars(cents) + '</b>' + line + '</div>' +
      '<button type="button" class="qg-tip-go" data-tip-close>Done</button>';
    if (typeof opts.onDone === 'function') { try { opts.onDone({ tip_id: tipId, amount_cents: cents, status: status }); } catch (e) {} }
  }

  /** Tips on these gigs for the signed-in person, grouped by gig id. */
  async function load(taskIds) {
    var ids = (taskIds || []).map(String).filter(Boolean).slice(0, 60);
    if (!ids.length) return {};
    var res = await call({ action: 'list', task_ids: ids });
    var map = {};
    ((res && res.tips) || []).forEach(function (t) {
      var k = String(t.task_id);
      (map[k] || (map[k] = [])).push(t);
    });
    return map;
  }

  window.QG_openTip = open;
  window.QG_closeTip = close;
  window.QG_loadTips = load;
  window.QG_tipDollars = dollars;
})();
