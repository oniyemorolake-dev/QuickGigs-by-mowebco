/* QuickGigs — Stripe Embedded Checkout (modal, Apple Pay via Stripe) */
(function () {
  var _stripePromise = null;
  var _checkoutInstance = null;
  var _overlayEl = null;

  function cfg() {
    return window.QG_CONFIG || {};
  }

  function fnUrl(key, fallback) {
    return cfg()[key] || fallback;
  }

  function paymentsLive() {
    var c = cfg();
    return !!(c.paymentsEnabled && c.stripePublishableKey);
  }

  function loadStripeJs() {
    if (window.Stripe) return Promise.resolve(window.Stripe);
    if (_stripePromise) return _stripePromise;
    _stripePromise = new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[src*="js.stripe.com/v3"]');
      if (existing) {
        existing.addEventListener('load', function () { resolve(window.Stripe); });
        existing.addEventListener('error', reject);
        if (window.Stripe) resolve(window.Stripe);
        return;
      }
      var s = document.createElement('script');
      s.src = 'https://js.stripe.com/v3/';
      s.async = true;
      s.onload = function () { resolve(window.Stripe); };
      s.onerror = function () { reject(new Error('Could not load Stripe.js')); };
      document.head.appendChild(s);
    });
    return _stripePromise;
  }

  function ensurePayModalDom() {
    if (_overlayEl) return _overlayEl;
    var overlay = document.createElement('div');
    overlay.id = 'qg-stripe-overlay';
    overlay.className = 'qg-stripe-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML =
      '<div class="qg-stripe-sheet">' +
        '<div class="qg-stripe-head">' +
          '<div class="qg-stripe-head-text">' +
            '<div class="qg-stripe-title" id="qgStripeTitle">Pay to unlock chat</div>' +
            '<div class="qg-stripe-sub" id="qgStripeSub">Secure payment · held in escrow until job is done</div>' +
            '<div class="qg-stripe-amount" id="qgStripeAmount"></div>' +
          '</div>' +
          '<button type="button" class="qg-stripe-close" id="qgStripeClose" aria-label="Close">×</button>' +
        '</div>' +
        '<div class="qg-stripe-body" id="qgStripeBody">' +
          '<div class="qg-stripe-loading" id="qgStripeLoading">' +
            '<div class="qg-stripe-spinner"></div>Opening secure checkout…' +
          '</div>' +
          '<div id="qg-stripe-checkout-mount" style="display:none"></div>' +
        '</div>' +
        '<div class="qg-stripe-foot">Apple Pay &amp; Google Pay appear when available · Powered by Stripe</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closePayModal();
    });
    overlay.querySelector('#qgStripeClose').addEventListener('click', closePayModal);
    _overlayEl = overlay;
    return overlay;
  }

  function setModalLoading(message) {
    var loading = document.getElementById('qgStripeLoading');
    var mount = document.getElementById('qg-stripe-checkout-mount');
    if (loading) {
      loading.style.display = 'flex';
      loading.innerHTML = '<div class="qg-stripe-spinner"></div>' + (message || 'Loading…');
    }
    if (mount) {
      mount.style.display = 'none';
      mount.innerHTML = '';
    }
  }

  function setModalError(message) {
    var loading = document.getElementById('qgStripeLoading');
    if (loading) {
      loading.style.display = 'flex';
      loading.className = 'qg-stripe-error';
      loading.innerHTML = message + '<br><br><button type="button" class="qg-stripe-close" style="width:auto;height:auto;border-radius:10px;padding:10px 16px;margin-top:8px" onclick="window.QG_closePayModal&&window.QG_closePayModal()">Close</button>';
    }
  }

  function destroyCheckout() {
    if (_checkoutInstance && typeof _checkoutInstance.destroy === 'function') {
      try { _checkoutInstance.destroy(); } catch (e) {}
    }
    _checkoutInstance = null;
    var mount = document.getElementById('qg-stripe-checkout-mount');
    if (mount) mount.innerHTML = '';
  }

  function closePayModal() {
    destroyCheckout();
    if (_overlayEl) _overlayEl.classList.remove('open');
    document.body.style.overflow = '';
  }

  async function startCheckout(taskId, posterId, returnPage, returnConv) {
    if (typeof getSupabaseHeaders !== 'function') {
      return { ok: false, error: 'Database not loaded' };
    }
    var url = fnUrl(
      'createCheckoutUrl',
      'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/create-checkout'
    );
    var headers = await getSupabaseHeaders();
    var res = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        task_id: String(taskId),
        poster_id: String(posterId),
        return_page: returnPage || 'payment',
        return_conv: returnConv || ''
      })
    });
    var data = {};
    try { data = await res.json(); } catch (e) { data = { ok: false, error: 'Invalid response' }; }
    if (!res.ok && data.ok !== false) data.ok = false;
    return data;
  }

  async function startConnectOnboarding(workerId, email) {
    if (typeof getSupabaseHeaders !== 'function') {
      return { ok: false, error: 'Database not loaded' };
    }
    var url = fnUrl(
      'connectLinkUrl',
      'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/create-connect-link'
    );
    var headers = await getSupabaseHeaders();
    var res = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ worker_id: String(workerId), email: email || '' })
    });
    var data = {};
    try { data = await res.json(); } catch (e) { data = { ok: false, error: 'Invalid response' }; }
    if (!res.ok && data.ok !== false) data.ok = false;
    return data;
  }

  async function waitForPaymentHeld(taskId, maxMs) {
    if (typeof getPaymentByTask !== 'function') return false;
    var start = Date.now();
    var limit = maxMs || 12000;
    while (Date.now() - start < limit) {
      try {
        var row = await getPaymentByTask(taskId);
        var st = row && String(row.status || '').toLowerCase();
        if (st && ['held', 'completed', 'paid'].indexOf(st) >= 0) return true;
      } catch (e) {}
      await new Promise(function (r) { setTimeout(r, 1200); });
    }
    return false;
  }

  function cleanPaymentReturnParams() {
    if (!window.history || !window.history.replaceState) return;
    var url = new URL(window.location.href);
    if (!url.searchParams.get('paid') && !url.searchParams.get('session_id')) return;
    url.searchParams.delete('paid');
    url.searchParams.delete('session_id');
    window.history.replaceState({}, '', url.pathname + url.search);
  }

  async function handlePaymentReturnFromUrl() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('paid') !== '1') return false;
    var taskId = params.get('task') || '';
    if (taskId) await waitForPaymentHeld(taskId, 15000);
    if (typeof showToast === 'function') {
      showToast('Payment received — chat unlocked!', '#4ade80');
    }
    cleanPaymentReturnParams();
    if (typeof loadData === 'function') loadData();
    return true;
  }

  async function openPayModal(taskId, posterId, options) {
    options = options || {};
    taskId = String(taskId || '');
    posterId = String(posterId || '');

    if (!paymentsLive()) {
      if (typeof showToast === 'function') {
        showToast('Payments not configured — see STRIPE-SETUP.md', '#f59e0b');
      } else {
        alert('Payments not configured — see STRIPE-SETUP.md');
      }
      return { ok: false, error: 'payments_not_live' };
    }

    if (!taskId || !posterId) {
      return { ok: false, error: 'missing_task_or_poster' };
    }

    ensurePayModalDom();
    var titleEl = document.getElementById('qgStripeTitle');
    var subEl = document.getElementById('qgStripeSub');
    var amountEl = document.getElementById('qgStripeAmount');
    if (titleEl) titleEl.textContent = options.title || 'Pay to unlock chat';
    if (subEl) subEl.textContent = options.subtitle || 'Secure payment · held in escrow until job is done';
    if (amountEl) {
      if (options.amount != null && options.amount !== '') {
        amountEl.textContent = '$' + Number(options.amount).toFixed(2) + ' CAD';
        amountEl.style.display = 'block';
      } else {
        amountEl.textContent = '';
        amountEl.style.display = 'none';
      }
    }

    destroyCheckout();
    setModalLoading('Opening secure checkout…');
    _overlayEl.classList.add('open');
    document.body.style.overflow = 'hidden';

    var result = await startCheckout(taskId, posterId, options.returnPage || 'mytasks', options.returnConv || '');

    if (!result.ok) {
      var err = result.error || 'Could not start checkout';
      if (err === 'stripe_not_configured') err = 'Stripe secret not set in Supabase — redeploy create-checkout (see STRIPE-SETUP.md)';
      if (err === 'already_paid') {
        closePayModal();
        if (typeof showToast === 'function') showToast('Already paid — chat is unlocked', '#4ade80');
        if (typeof loadData === 'function') loadData();
        return result;
      }
      setModalError(err);
      return result;
    }

    if (result.url && !result.client_secret) {
      closePayModal();
      window.location.href = result.url;
      return result;
    }

    if (!result.client_secret) {
      setModalError('Checkout session missing — redeploy create-checkout Edge Function');
      return result;
    }

    try {
      var StripeFactory = await loadStripeJs();
      var stripe = StripeFactory(cfg().stripePublishableKey);
      var loading = document.getElementById('qgStripeLoading');
      var mount = document.getElementById('qg-stripe-checkout-mount');
      if (loading) loading.style.display = 'none';
      if (mount) mount.style.display = 'block';
      if (amountEl && result.amount != null && !options.amount) {
        amountEl.textContent = '$' + Number(result.amount).toFixed(2) + ' CAD';
        amountEl.style.display = 'block';
      }
      _checkoutInstance = await stripe.initEmbeddedCheckout({
        clientSecret: result.client_secret
      });
      _checkoutInstance.mount('#qg-stripe-checkout-mount');
      return { ok: true };
    } catch (err) {
      console.error('Embedded checkout failed:', err);
      setModalError(String(err && err.message ? err.message : err));
      return { ok: false, error: String(err) };
    }
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-pay-task]');
    if (!btn) return;
    e.preventDefault();
    var taskId = btn.getAttribute('data-pay-task');
    var userId = window._currentUser && window._currentUser.uid;
    if (!taskId || !userId) return;
    var returnPage = btn.getAttribute('data-pay-return') || 'mytasks';
    var returnConv = btn.getAttribute('data-pay-conv') || '';
    var amount = btn.getAttribute('data-pay-amount');
    var title = btn.getAttribute('data-pay-title');
    openPayModal(taskId, userId, {
      returnPage: returnPage,
      returnConv: returnConv,
      amount: amount,
      title: title || undefined
    });
  });

  window.QG_paymentsLive = paymentsLive;
  window.QG_startCheckout = startCheckout;
  window.QG_startConnectOnboarding = startConnectOnboarding;
  window.QG_openPayModal = openPayModal;
  window.QG_closePayModal = closePayModal;
  window.QG_handlePaymentReturn = handlePaymentReturnFromUrl;
  window.QG_waitForPaymentHeld = waitForPaymentHeld;
})();
