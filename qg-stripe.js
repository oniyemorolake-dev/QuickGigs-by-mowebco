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

  function formatPayError(err) {
    if (err == null || err === '') return 'Could not start checkout';
    if (typeof err === 'string') {
      if (err === 'already_paid') return 'This task is already paid.';
      if (err === 'stripe_not_configured') {
        return 'Stripe secret not set in Supabase — redeploy create-checkout (see STRIPE-SETUP.md)';
      }
      if (err === 'task_not_in_progress') return 'Task must be in progress before paying.';
      if (err === 'no_accepted_worker') return 'Accept a tasker first, then pay.';
      if (err === 'not_task_poster') return 'Only the poster can pay for this task.';
      if (err === 'cannot_pay_self') {
        return 'You cannot pay on your own task. Use a second account as the tasker, cancel this task, and repost.';
      }
      return err;
    }
    if (typeof err === 'object') {
      if (typeof err.message === 'string' && err.message) return err.message;
      if (typeof err.error === 'string' && err.error) return formatPayError(err.error);
      if (typeof err.code === 'string' && err.code) return formatPayError(err.code);
      try { return JSON.stringify(err); } catch (e) { /* fall through */ }
    }
    return String(err);
  }

  function extractPayErrorCode(result) {
    if (!result) return '';
    var err = result.error;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      if (typeof err.code === 'string') return err.code;
      if (typeof err.error === 'string') return err.error;
      if (typeof err.message === 'string') return err.message;
    }
    if (typeof result.message === 'string') return result.message;
    return '';
  }

  function isAlreadyPaidError(result) {
    var code = extractPayErrorCode(result).toLowerCase();
    return code === 'already_paid' || code.indexOf('already_paid') >= 0;
  }

  function setModalError(message) {
    var loading = document.getElementById('qgStripeLoading');
    if (loading) {
      loading.style.display = 'flex';
      loading.className = 'qg-stripe-error';
      loading.innerHTML = formatPayError(message) + '<br><br><button type="button" class="qg-stripe-close" style="width:auto;height:auto;border-radius:10px;padding:10px 16px;margin-top:8px" onclick="window.QG_closePayModal&&window.QG_closePayModal()">Close</button>';
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
    if (!data.error && data.message) data.error = data.message;
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

  async function confirmCheckoutSession(sessionId) {
    if (!sessionId || typeof getSupabaseHeaders !== 'function') return { ok: false };
    var url = fnUrl(
      'confirmCheckoutUrl',
      'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/confirm-checkout'
    );
    try {
      var headers = await getSupabaseHeaders();
      var res = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ session_id: String(sessionId) })
      });
      var data = {};
      try { data = await res.json(); } catch (e) { data = { ok: false }; }
      return data;
    } catch (err) {
      console.warn('confirmCheckoutSession failed:', err);
      return { ok: false, error: String(err) };
    }
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
      await new Promise(function (r) { setTimeout(r, 400); });
    }
    return false;
  }

  async function navigateToChatForTask(taskId) {
    if (!taskId || typeof getTaskById !== 'function') return false;
    try {
      var task = await getTaskById(taskId);
      if (!task) return false;
      var posterId = task.posted_by || task.POSTED_BY;
      var apps = typeof getApplicationsByTask === 'function' ? await getApplicationsByTask(taskId) : [];
      var accepted = (apps || []).find(function (a) {
        return String(a.status || a.STATUS || '').toLowerCase() === 'accepted';
      });
      if (!accepted) return false;
      var workerId = accepted.worker_id || accepted.WORKER_ID;
      if (typeof getConversationForTask !== 'function') return false;
      var conv = await getConversationForTask(taskId, posterId, workerId);
      if (conv && conv.conv_id) {
        closePayModal();
        window.location.href = 'chat.html?conv=' + encodeURIComponent(String(conv.conv_id));
        return true;
      }
    } catch (e) {
      console.warn('navigateToChatForTask failed:', e);
    }
    return false;
  }

  async function isSelfPayTask(taskId, posterId) {
    if (!taskId || !posterId || typeof getApplicationsByTask !== 'function') return false;
    try {
      var apps = await getApplicationsByTask(taskId);
      var accepted = (apps || []).find(function (a) {
        return String(a.status || a.STATUS || '').toLowerCase() === 'accepted';
      });
      if (!accepted) return false;
      var workerId = accepted.worker_id || accepted.WORKER_ID;
      return workerId && String(workerId) === String(posterId);
    } catch (e) {
      return false;
    }
  }

  async function tryUnlockChatAfterPayment(taskId) {
    if (!taskId || typeof getTaskById !== 'function' || typeof unlockChatForTask !== 'function') return false;
    if (!window._currentUser) return false;
    try {
      var task = await getTaskById(taskId);
      if (!task) return false;
      var posterId = task.posted_by || task.POSTED_BY;
      if (String(posterId) !== String(window._currentUser.uid)) return false;
      var apps = typeof getApplicationsByTask === 'function' ? await getApplicationsByTask(taskId) : [];
      var accepted = (apps || []).find(function (a) {
        return String(a.status || a.STATUS || '').toLowerCase() === 'accepted';
      });
      if (!accepted) return false;
      var workerId = accepted.worker_id || accepted.WORKER_ID;
      var unlock = await unlockChatForTask(taskId, posterId, workerId);
      return !!(unlock && unlock.success);
    } catch (e) {
      console.warn('Post-payment chat unlock skipped:', e);
      return false;
    }
  }

  async function finishAlreadyPaid(taskId, options) {
    options = options || {};
    closePayModal();
    await tryUnlockChatAfterPayment(taskId);
    if (typeof window.QG_refreshPaymentState === 'function') {
      await window.QG_refreshPaymentState(taskId);
    }
    if (typeof showToast === 'function') {
      showToast('Payment confirmed — opening chat', '#4ade80');
    }
    if (options.returnPage === 'chat' && options.returnConv) {
      window.location.href = 'chat.html?conv=' + encodeURIComponent(String(options.returnConv));
      return { ok: true, already_paid: true };
    }
    if (await navigateToChatForTask(taskId)) {
      return { ok: true, already_paid: true };
    }
    if (typeof loadData === 'function') loadData();
    return { ok: true, already_paid: true };
  }

  async function taskHasHeldPayment(taskId) {
    if (!taskId || typeof getPaymentByTask !== 'function') return false;
    try {
      var row = await getPaymentByTask(taskId);
      var st = row && String(row.status || '').toLowerCase();
      return st === 'held' || st === 'paid' || st === 'completed';
    } catch (e) {
      return false;
    }
  }

  async function confirmAndUnlockTask(taskId, sessionId, options) {
    options = options || {};
    if (sessionId) {
      await confirmCheckoutSession(sessionId);
    }
    if (taskId) {
      await waitForPaymentHeld(taskId, sessionId ? 8000 : 4000);
      await tryUnlockChatAfterPayment(taskId);
      if (typeof window.QG_refreshPaymentState === 'function') {
        await window.QG_refreshPaymentState(taskId);
      }
    }
    closePayModal();
    if (typeof showToast === 'function') {
      showToast('Payment accepted — opening chat', '#4ade80');
    }
    if (options.returnPage === 'chat' && options.returnConv) {
      window.location.href = 'chat.html?conv=' + encodeURIComponent(String(options.returnConv));
      return;
    }
    if (await navigateToChatForTask(taskId)) return;
    if (typeof loadData === 'function') loadData();
    if (typeof renderTab === 'function') renderTab();
  }

  async function syncPendingPaymentsForPoster(userId) {
    if (!userId || typeof getPaymentsForUser !== 'function') return;
    try {
      var rows = await getPaymentsForUser(userId, 'poster');
      var pending = (rows || []).filter(function (p) {
        var st = String(p.status || '').toLowerCase();
        var sid = String(p.stripe_id || '');
        return st === 'pending' && sid.indexOf('cs_') === 0;
      });
      for (var i = 0; i < pending.length; i++) {
        var sid = String(pending[i].stripe_id || '');
        if (!sid) continue;
        await confirmCheckoutSession(sid);
        var tid = pending[i].task_id;
        if (tid) await tryUnlockChatAfterPayment(tid);
      }
    } catch (e) {
      console.warn('syncPendingPaymentsForPoster failed:', e);
    }
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
    var sessionId = params.get('session_id') || '';
    var handledKey = 'qg-paid-' + taskId + '-' + (sessionId || '1');
    if (sessionStorage.getItem(handledKey) === '1') return false;
    sessionStorage.setItem(handledKey, '1');
    try { sessionStorage.setItem('qg-payment-tab', 'inprogress'); } catch (e) {}

    if (typeof activeTab !== 'undefined') activeTab = 'inprogress';
    if (typeof setSessionMode === 'function') setSessionMode('poster');

    if (sessionId) {
      await confirmCheckoutSession(sessionId);
    }

    var paid = taskId ? await waitForPaymentHeld(taskId, sessionId ? 6000 : 12000) : false;
    if (paid && taskId) await tryUnlockChatAfterPayment(taskId);

    if (typeof window.QG_refreshPaymentState === 'function') {
      await window.QG_refreshPaymentState(taskId);
    }

    if (typeof showToast === 'function') {
      showToast(
        paid ? 'Payment accepted — chat is open' : 'Payment processing — tap Message again in a moment',
        paid ? '#4ade80' : '#f59e0b'
      );
    }

    cleanPaymentReturnParams();
    if (typeof renderTab === 'function') renderTab();
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

    if (await isSelfPayTask(taskId, posterId)) {
      if (typeof showToast === 'function') {
        showToast('Use a second account as tasker — cancel this task and repost', '#ef4444');
      }
      return { ok: false, error: 'cannot_pay_self' };
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

    if (await taskHasHeldPayment(taskId)) {
      return await finishAlreadyPaid(taskId, options);
    }

    destroyCheckout();
    setModalLoading('Opening secure checkout…');
    _overlayEl.classList.add('open');
    document.body.style.overflow = 'hidden';

    var result = await startCheckout(taskId, posterId, options.returnPage || 'mytasks', options.returnConv || '');

    if (!result.ok) {
      if (isAlreadyPaidError(result)) {
        return await finishAlreadyPaid(taskId, options);
      }
      setModalError(result.error || extractPayErrorCode(result) || 'Could not start checkout');
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
      var checkoutOpts = {
        clientSecret: result.client_secret,
        onComplete: function () {
          confirmAndUnlockTask(taskId, result.session_id || '', options);
        }
      };
      _checkoutInstance = await stripe.initEmbeddedCheckout(checkoutOpts);
      _checkoutInstance.mount('#qg-stripe-checkout-mount');
      return { ok: true };
    } catch (err) {
      console.error('Embedded checkout failed:', err);
      setModalError(err);
      return { ok: false, error: formatPayError(err) };
    }
  }

  document.addEventListener('click', function (e) {
    var syncBtn = e.target.closest('[data-sync-pay-task]');
    if (syncBtn) {
      e.preventDefault();
      var syncTaskId = syncBtn.getAttribute('data-sync-pay-task');
      var syncUserId = window._currentUser && window._currentUser.uid;
      if (!syncTaskId || !syncUserId) return;
      syncBtn.disabled = true;
      syncBtn.textContent = 'Syncing…';
      (async function () {
        if (typeof window.QG_syncPendingPayments === 'function') {
          await window.QG_syncPendingPayments(syncUserId);
        }
        if (typeof window.QG_refreshPaymentState === 'function') {
          await window.QG_refreshPaymentState(syncTaskId);
        }
        if (typeof loadData === 'function') await loadData();
        if (typeof showToast === 'function') {
          var synced = typeof isTaskPaid === 'function' && isTaskPaid(syncTaskId);
          showToast(
            synced ? 'Payment synced — tap Message' : 'No completed payment found — use a second tasker account',
            synced ? '#4ade80' : '#f59e0b'
          );
        }
      })();
      return;
    }
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

  async function syncConnectStatus(workerId) {
    if (!workerId || typeof getSupabaseHeaders !== 'function') return { ok: false };
    var url = fnUrl(
      'syncConnectUrl',
      'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/sync-connect-status'
    );
    try {
      var headers = await getSupabaseHeaders();
      var res = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ worker_id: String(workerId) })
      });
      var data = {};
      try { data = await res.json(); } catch (e) { data = { ok: false }; }
      return data;
    } catch (err) {
      console.warn('syncConnectStatus failed:', err);
      return { ok: false, error: String(err) };
    }
  }

  window.QG_paymentsLive = paymentsLive;
  window.QG_startCheckout = startCheckout;
  window.QG_startConnectOnboarding = startConnectOnboarding;
  window.QG_openPayModal = openPayModal;
  window.QG_closePayModal = closePayModal;
  window.QG_handlePaymentReturn = handlePaymentReturnFromUrl;
  window.QG_waitForPaymentHeld = waitForPaymentHeld;
  window.QG_confirmCheckoutSession = confirmCheckoutSession;
  window.QG_syncConnectStatus = syncConnectStatus;
  window.QG_syncPendingPayments = syncPendingPaymentsForPoster;
})();
