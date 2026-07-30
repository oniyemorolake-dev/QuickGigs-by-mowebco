(function () {
  'use strict';

  var cached = null;
  var pending = null;

  function endpoint() {
    return window.QG_CONFIG && window.QG_CONFIG.roleVerificationUrl;
  }

  async function request(action, extra) {
    if (!endpoint() || typeof callVerifiedFunction !== 'function') {
      return { ok: false, success: false, error: 'verification_unavailable' };
    }
    return await callVerifiedFunction(endpoint(), Object.assign({ action: action }, extra || {}));
  }

  function publish(result) {
    if (!result || result.ok === false || result.success === false) return result;
    cached = Object.assign({}, cached || {}, result);
    window.QG_verificationState = cached;
    window.dispatchEvent(new CustomEvent('qg-verification-ready', { detail: cached }));
    return cached;
  }

  async function load(force) {
    if (cached && !force) return cached;
    if (pending && !force) return pending;
    pending = request('status').then(publish).finally(function () { pending = null; });
    return pending;
  }

  function verified(role) {
    return !!(cached && cached[role === 'poster' ? 'poster_verified' : 'tasker_verified']);
  }

  async function start(role) {
    var result = await request(role === 'poster' ? 'start_poster' : 'start_tasker');
    if (result && result.url) {
      window.location.href = result.url;
      return result;
    }
    publish(result);
    if (result && result.ok !== false && window.history && window.history.replaceState) {
      params.delete('verification_return');
      params.delete('verification_cancelled');
      params.delete('session_id');
      var next = window.location.pathname + (params.toString() ? '?' + params.toString() : '') + window.location.hash;
      window.history.replaceState({}, '', next);
    }
    return result;
  }

  function ensureStyles() {
    if (document.getElementById('qgVerificationStyles')) return;
    var style = document.createElement('style');
    style.id = 'qgVerificationStyles';
    style.textContent =
      '.qg-verify-overlay{position:fixed;inset:0;z-index:3000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(4,0,14,.8);backdrop-filter:blur(10px)}' +
      '.qg-verify-card{width:min(440px,100%);padding:24px;border-radius:22px;background:linear-gradient(145deg,#17082d,#251146);border:1px solid rgba(200,168,233,.3);box-shadow:0 28px 80px rgba(0,0,0,.48);color:#fff;font-family:Poppins,sans-serif}' +
      '.qg-verify-icon{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;background:rgba(155,111,196,.2);color:#c8a8e9;margin-bottom:14px}' +
      '.qg-verify-card h2{font-size:21px;line-height:1.25;margin:0 0 8px}.qg-verify-card p{font-size:13px;line-height:1.6;color:rgba(255,255,255,.68);margin:0}' +
      '.qg-verify-note{margin-top:13px!important;padding:11px;border-radius:12px;background:rgba(255,255,255,.05);font-size:11px!important}' +
      '.qg-verify-actions{display:grid;gap:9px;margin-top:18px}.qg-verify-primary,.qg-verify-later{padding:12px;border-radius:12px;font:600 13px Poppins,sans-serif;cursor:pointer}' +
      '.qg-verify-primary{border:0;color:#fff;background:linear-gradient(135deg,#6b3fa0,#9b6fc4)}.qg-verify-later{border:1px solid rgba(200,168,233,.25);background:transparent;color:rgba(255,255,255,.68)}' +
      '.qg-verify-primary:disabled{opacity:.6}body.light .qg-verify-card{background:#fff;color:#211033}body.light .qg-verify-card p{color:#6b6580}body.light .qg-verify-later{color:#6b6580;border-color:#ddd3ef}';
    document.head.appendChild(style);
  }

  function openPrompt(role, opts) {
    opts = opts || {};
    ensureStyles();
    var old = document.getElementById('qgVerificationOverlay');
    if (old) old.remove();
    var isPoster = role === 'poster';
    var overlay = document.createElement('div');
    overlay.id = 'qgVerificationOverlay';
    overlay.className = 'qg-verify-overlay';
    overlay.innerHTML =
      '<div class="qg-verify-card" role="dialog" aria-modal="true" aria-labelledby="qgVerifyTitle">' +
        '<div class="qg-verify-icon" aria-hidden="true">' + (isPoster ? '💳' : '🪪') + '</div>' +
        '<h2 id="qgVerifyTitle">' + (isPoster ? 'Add a payment method to post' : 'Verify your identity to start working') + '</h2>' +
        '<p>' + (isPoster
          ? 'You can keep drafting your task. A verified payment method is required only when you publish.'
          : 'You can browse gigs and finish your profile now. A secure ID and selfie check is required before applying or accepting work.') + '</p>' +
        '<p class="qg-verify-note">' + (isPoster
          ? 'Your card is verified securely by Stripe. You will not be charged during verification.'
          : 'QuickGigs receives the verification result, not your raw identity document. Guardian approval still applies to teen applications.') + '</p>' +
        '<div class="qg-verify-actions">' +
          '<button type="button" class="qg-verify-primary" id="qgVerifyStart">' + (isPoster ? 'Add payment method' : 'Start identity check') + '</button>' +
          '<button type="button" class="qg-verify-later" id="qgVerifyLater">' + (opts.laterLabel || 'Not now') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#qgVerifyLater').onclick = function () { overlay.remove(); };
    overlay.onclick = function (event) { if (event.target === overlay) overlay.remove(); };
    overlay.querySelector('#qgVerifyStart').onclick = async function () {
      var button = this;
      button.disabled = true;
      button.textContent = 'Opening secure verification…';
      var result = await start(role);
      if (!result || (!result.url && !result.already_verified)) {
        button.disabled = false;
        button.textContent = isPoster ? 'Add payment method' : 'Start identity check';
      } else if (result.already_verified) {
        await load(true);
        overlay.remove();
        if (typeof opts.onVerified === 'function') opts.onVerified();
      }
    };
  }

  async function syncReturn() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('verification_return') !== '1') return null;
    var role = params.get('verification');
    var result;
    if (role === 'poster') {
      result = await request('sync_poster', { session_id: params.get('session_id') || '' });
    } else if (role === 'tasker') {
      result = await request('sync_tasker');
    } else {
      return null;
    }
    publish(result);
    return result;
  }

  window.QG_loadVerification = load;
  window.QG_isRoleVerified = verified;
  window.QG_startRoleVerification = start;
  window.QG_openVerificationPrompt = openPrompt;
  window.QG_syncVerificationReturn = syncReturn;
})();
