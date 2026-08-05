(function () {
  'use strict';

  var cached = null;
  var pending = null;

  function endpoint() {
    return window.QG_CONFIG && window.QG_CONFIG.roleVerificationUrl;
  }

  function modeAccent(role) {
    return role === 'poster'
      ? { from: '#0f766e', to: '#2dd4bf', soft: 'rgba(45,212,191,.18)', text: '#2dd4bf' }
      : { from: '#6b3fa0', to: '#9b6fc4', soft: 'rgba(155,111,196,.2)', text: '#c8a8e9' };
  }

  function posterPmEnabled() {
    var c = window.QG_CONFIG || {};
    // Poster payment-method verification reuses existing Stripe Setup flow.
    // Independent of escrow paymentsEnabled.
    if (c.posterPaymentVerificationEnabled === false) return false;
    return !!(c.roleVerificationUrl && c.stripePublishableKey);
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

  function currentReturnPath() {
    try {
      var page = String(window.location.pathname || '').split('/').pop() || '';
      if (/^(posttask|profile|dashboard|mytasks)\.html$/i.test(page)) return page.toLowerCase();
    } catch (_e) {}
    return 'profile.html';
  }

  function rememberPosterReturnPath(path) {
    try {
      localStorage.setItem('qg-verification-return-path', path);
      if (path === 'posttask.html') {
        localStorage.setItem('qg-resume-post-after-verification', '1');
      }
    } catch (_e) {}
  }

  async function start(role) {
    if (role === 'poster') {
      if (!posterPmEnabled()) {
        return { ok: false, error: 'stripe_not_configured', message: 'Stripe payment verification is not configured.' };
      }
      var returnPath = currentReturnPath();
      rememberPosterReturnPath(returnPath);
      var posterResult = await request('start_poster', { return_path: returnPath });
      if (posterResult && posterResult.url) {
        window.location.href = posterResult.url;
        return posterResult;
      }
      return publish(posterResult);
    }
    var taskerResult = await request('start_tasker');
    publish(taskerResult);
    if (taskerResult && taskerResult.already_verified) return taskerResult;
    openEmailLaunchPanel(taskerResult || {});
    return taskerResult;
  }

  async function syncFirebaseEmail() {
    try {
      if (window.auth && window.auth.currentUser) {
        await window.auth.currentUser.reload();
        if (!window.auth.currentUser.emailVerified && typeof window.auth.currentUser.sendEmailVerification === 'function') {
          await window.auth.currentUser.sendEmailVerification();
          return { ok: true, sent: true, message: 'Check your inbox and confirm your email, then tap Refresh status.' };
        }
      }
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : 'email_send_failed' };
    }
    return await request('sync_tasker_contacts').then(publish);
  }

  function ensureStyles() {
    if (document.getElementById('qgVerificationStyles')) return;
    var style = document.createElement('style');
    style.id = 'qgVerificationStyles';
    style.textContent =
      '.qg-verify-overlay{position:fixed;inset:0;z-index:3000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(4,0,14,.82);backdrop-filter:blur(10px)}' +
      '.qg-verify-card{width:min(460px,100%);padding:24px;border-radius:22px;background:linear-gradient(145deg,#0b1220,#151b2e);border:1px solid rgba(200,168,233,.28);box-shadow:0 28px 80px rgba(0,0,0,.5);color:#fff;font-family:Poppins,sans-serif}' +
      '.qg-verify-icon{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;margin-bottom:14px}' +
      '.qg-verify-card h2{font-size:20px;line-height:1.25;margin:0 0 8px;font-weight:600}.qg-verify-card p{font-size:13px;line-height:1.6;color:rgba(255,255,255,.68);margin:0}' +
      '.qg-verify-note{margin-top:13px!important;padding:11px;border-radius:12px;background:rgba(255,255,255,.05);font-size:11px!important}' +
      '.qg-verify-steps{display:grid;gap:10px;margin-top:16px}' +
      '.qg-verify-step{padding:12px;border-radius:14px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03)}' +
      '.qg-verify-step strong{display:block;font-size:12px;margin-bottom:6px}' +
      '.qg-verify-step-actions{display:flex;gap:8px;flex-wrap:wrap}' +
      '.qg-verify-mini{flex:1;min-width:120px;padding:10px;border:0;border-radius:10px;color:#fff;font:600 12px Poppins,sans-serif;cursor:pointer}' +
      '.qg-verify-actions{display:grid;gap:9px;margin-top:18px}.qg-verify-primary,.qg-verify-later{padding:12px;border-radius:12px;font:600 13px Poppins,sans-serif;cursor:pointer}' +
      '.qg-verify-primary{border:0;color:#fff}.qg-verify-later{border:1px solid rgba(200,168,233,.25);background:transparent;color:rgba(255,255,255,.68)}' +
      '.qg-verify-primary:disabled,.qg-verify-mini:disabled{opacity:.6}.qg-verify-status{font-size:11px;margin-top:6px;color:rgba(255,255,255,.55)}' +
      '.qg-verify-card.is-poster{border-color:rgba(45,212,191,.35)}.qg-verify-card.is-tasker{border-color:rgba(155,111,196,.35)}' +
      'body.light .qg-verify-card{background:#fff;color:#211033}body.light .qg-verify-card p,.qg-verify-status{color:#6b6580}body.light .qg-verify-later{color:#6b6580;border-color:#ddd3ef}';
    document.head.appendChild(style);
  }

  function openPrompt(role, opts) {
    opts = opts || {};
    ensureStyles();
    var old = document.getElementById('qgVerificationOverlay');
    if (old) old.remove();
    var isPoster = role === 'poster';
    var accent = modeAccent(role);
    var overlay = document.createElement('div');
    overlay.id = 'qgVerificationOverlay';
    overlay.className = 'qg-verify-overlay';
    overlay.innerHTML =
      '<div class="qg-verify-card ' + (isPoster ? 'is-poster' : 'is-tasker') + '" role="dialog" aria-modal="true" aria-labelledby="qgVerifyTitle">' +
        '<div class="qg-verify-icon" style="background:' + accent.soft + ';color:' + accent.text + '" aria-hidden="true">' + (isPoster ? '💳' : '✉️') + '</div>' +
        '<h2 id="qgVerifyTitle">' + (isPoster ? 'Add a payment method to post' : 'Verify your email to start working') + '</h2>' +
        '<p>' + (isPoster
          ? 'You can keep drafting your task. A verified payment method is required only when you publish.'
          : 'You can browse gigs and edit your profile. Confirm your email before applying or accepting work.') + '</p>' +
        '<p class="qg-verify-note">' + (isPoster
          ? 'Uses your existing Stripe Setup flow (test keys until launch). You will not be charged during verification.'
          : 'Phone verification and hard ID checks are reserved for later. Teen applications still need guardian approval.') + '</p>' +
        '<div class="qg-verify-actions">' +
          '<button type="button" class="qg-verify-primary" id="qgVerifyStart" style="background:linear-gradient(135deg,' + accent.from + ',' + accent.to + ')">' +
            (isPoster ? 'Add payment method' : 'Continue verification') +
          '</button>' +
          '<button type="button" class="qg-verify-later" id="qgVerifyLater">' + (opts.laterLabel || 'Not now') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#qgVerifyLater').onclick = function () { overlay.remove(); };
    overlay.onclick = function (event) { if (event.target === overlay) overlay.remove(); };
    overlay.querySelector('#qgVerifyStart').onclick = async function () {
      var button = this;
      button.disabled = true;
      button.textContent = isPoster ? 'Opening Stripe…' : 'Opening…';
      var result = await start(role);
      if (isPoster) {
        if (!result || (!result.url && !result.already_verified)) {
          button.disabled = false;
          button.textContent = 'Add payment method';
          if (result && result.message) button.title = result.message;
        } else if (result.already_verified) {
          await load(true);
          overlay.remove();
          if (typeof opts.onVerified === 'function') opts.onVerified();
        }
      } else {
        overlay.remove();
        if (result && result.already_verified && typeof opts.onVerified === 'function') opts.onVerified();
      }
    };
  }

  function openEmailLaunchPanel(state) {
    ensureStyles();
    var old = document.getElementById('qgVerificationOverlay');
    if (old) old.remove();
    var accent = modeAccent('tasker');
    var emailOk = !!(state && state.email_verified);
    var overlay = document.createElement('div');
    overlay.id = 'qgVerificationOverlay';
    overlay.className = 'qg-verify-overlay';
    overlay.innerHTML =
      '<div class="qg-verify-card is-tasker" role="dialog" aria-modal="true" aria-labelledby="qgVerifyEmailTitle">' +
        '<div class="qg-verify-icon" style="background:' + accent.soft + ';color:' + accent.text + '" aria-hidden="true">✉️</div>' +
        '<h2 id="qgVerifyEmailTitle">Verify your email to start working</h2>' +
        '<p>Confirm the email on your account. Teens still need guardian approval before applications go live.</p>' +
        '<div class="qg-verify-steps">' +
          '<div class="qg-verify-step">' +
            '<strong>Email confirmation ' + (emailOk ? '✓' : '') + '</strong>' +
            '<div class="qg-verify-step-actions">' +
              '<button type="button" class="qg-verify-mini" id="qgVerifyEmailBtn" style="background:linear-gradient(135deg,' + accent.from + ',' + accent.to + ')">' +
                (emailOk ? 'Email confirmed' : 'Send confirmation email') +
              '</button>' +
              '<button type="button" class="qg-verify-mini" id="qgVerifyEmailRefresh" style="background:linear-gradient(135deg,' + accent.from + ',' + accent.to + ')">Refresh status</button>' +
            '</div>' +
            '<div class="qg-verify-status" id="qgVerifyEmailStatus"></div>' +
          '</div>' +
        '</div>' +
        '<p class="qg-verify-note">Later: phone (Firebase Phone Auth) and hard ID check can be required without rebuilding this gate. Care categories are already flagged.</p>' +
        '<div class="qg-verify-actions">' +
          '<button type="button" class="qg-verify-primary" id="qgVerifyDone" style="background:linear-gradient(135deg,' + accent.from + ',' + accent.to + ')">Done</button>' +
          '<button type="button" class="qg-verify-later" id="qgVerifyLaterEmail">Close</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    function setStatus(msg) {
      var el = document.getElementById('qgVerifyEmailStatus');
      if (el) el.textContent = msg || '';
    }

    overlay.querySelector('#qgVerifyLaterEmail').onclick = function () { overlay.remove(); };
    overlay.querySelector('#qgVerifyDone').onclick = async function () {
      var latest = await load(true);
      if (latest && latest.tasker_verified) overlay.remove();
      else setStatus('Confirm your email, then tap Refresh status.');
    };
    overlay.onclick = function (event) { if (event.target === overlay) overlay.remove(); };

    var emailBtn = overlay.querySelector('#qgVerifyEmailBtn');
    var refreshBtn = overlay.querySelector('#qgVerifyEmailRefresh');
    if (emailBtn && !emailOk) {
      emailBtn.onclick = async function () {
        emailBtn.disabled = true;
        setStatus('Sending…');
        var res = await syncFirebaseEmail();
        if (res && res.sent) setStatus(res.message || 'Verification email sent.');
        else if (res && (res.email_verified || res.tasker_verified)) {
          setStatus('Email confirmed ✓');
          emailBtn.textContent = 'Email confirmed';
          if (res.tasker_verified) overlay.remove();
        } else {
          setStatus((res && (res.message || res.error)) || 'Could not send email. Try again.');
          emailBtn.disabled = false;
        }
      };
    }
    if (refreshBtn) {
      refreshBtn.onclick = async function () {
        refreshBtn.disabled = true;
        setStatus('Checking…');
        try {
          if (window.auth && window.auth.currentUser) await window.auth.currentUser.reload();
        } catch (_e) {}
        var res = await request('sync_tasker_contacts').then(publish);
        if (res && (res.email_verified || res.tasker_verified)) {
          setStatus('Email confirmed ✓');
          if (emailBtn) emailBtn.textContent = 'Email confirmed';
          if (res.tasker_verified) overlay.remove();
        } else {
          setStatus('Not confirmed yet — open the link in your inbox, then refresh.');
        }
        refreshBtn.disabled = false;
      };
    }
  }

  function hideVerificationPrompt() {
    var overlay = document.getElementById('qgVerificationOverlay');
    if (overlay) overlay.remove();
  }

  function resumePostDraftIfNeeded(fresh) {
    if (!fresh || fresh.poster_verified !== true) return false;
    var resume = false;
    try {
      resume = localStorage.getItem('qg-resume-post-after-verification') === '1';
      localStorage.removeItem('qg-resume-post-after-verification');
    } catch (_e) {}
    if (!resume) return false;
    var onPost = /posttask\.html$/i.test(String(window.location.pathname || ''));
    if (!onPost) {
      // Stripe may still land on profile if the Edge Function return_path is not deployed yet.
      window.location.replace('posttask.html?verified_payment=1');
      return true;
    }
    return false;
  }

  async function syncReturn() {
    var params = new URLSearchParams(window.location.search);
    var cancelled = params.get('verification_cancelled') === '1';
    var role = params.get('verification');
    if (cancelled) {
      if (window.history && window.history.replaceState) {
        params.delete('verification_return');
        params.delete('verification_cancelled');
        params.delete('session_id');
        params.delete('verification');
        var cancelNext = window.location.pathname + (params.toString() ? '?' + params.toString() : '') + window.location.hash;
        window.history.replaceState({}, '', cancelNext);
      }
      // Keep prompts / Publish disabled — verification did not succeed.
      return { ok: false, cancelled: true, poster_verified: false };
    }
    if (params.get('verification_return') !== '1') return null;
    var result;
    if (role === 'poster') {
      result = await request('sync_poster', { session_id: params.get('session_id') || '' });
    } else if (role === 'tasker_id') {
      result = await request('sync_tasker_id_check');
    } else if (role === 'tasker') {
      result = await request('sync_tasker_contacts');
    } else {
      return null;
    }
    publish(result);
    if (window._currentUser && typeof window.invalidateUserProfileCache === 'function') {
      window.invalidateUserProfileCache(window._currentUser.uid);
    }
    // Re-read authoritative status from the server — do not trust a stale client cache.
    var fresh = await load(true);
    if (window.history && window.history.replaceState) {
      params.delete('verification_return');
      params.delete('verification_cancelled');
      params.delete('session_id');
      params.delete('verification');
      var next = window.location.pathname + (params.toString() ? '?' + params.toString() : '') + window.location.hash;
      window.history.replaceState({}, '', next);
    }
    if (role === 'poster') {
      if (fresh && fresh.poster_verified === true) {
        hideVerificationPrompt();
        if (resumePostDraftIfNeeded(fresh)) return fresh;
        window.dispatchEvent(new CustomEvent('qg-poster-payment-verified', { detail: fresh }));
      }
      // Failed / still pending: leave prompt + Publish gate as-is.
    }
    return fresh || result;
  }

  window.QG_loadVerification = load;
  window.QG_isRoleVerified = verified;
  window.QG_startRoleVerification = start;
  window.QG_openVerificationPrompt = openPrompt;
  window.QG_openEmailLaunchVerification = openEmailLaunchPanel;
  window.QG_syncVerificationReturn = syncReturn;
  window.QG_syncTaskerContacts = function () { return request('sync_tasker_contacts').then(publish); };
  window.QG_posterPaymentVerificationEnabled = posterPmEnabled;
  window.QG_hideVerificationPrompt = hideVerificationPrompt;
})();
