/* QuickGigs — Stripe Embedded Checkout (modal, Apple Pay via Stripe) */
(function () {
  var _stripePromise = null;
  var _checkoutInstance = null;
  var _overlayEl = null;
  var _payOpenTaskId = '';
  var _payOpenPromise = null;
  var _checkoutDoneKeys = {};

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
            '<div class="qg-stripe-fee" id="qgStripeFee" style="display:none;font-size:11px;line-height:1.45;margin-top:6px;opacity:0.85"></div>' +
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
      loading.className = 'qg-stripe-panel qg-stripe-loading-state';
      loading.innerHTML =
        '<div class="qg-stripe-spinner"></div>' +
        '<div class="qg-stripe-status-title">' + escHtml(message || 'Loading…') + '</div>' +
        '<div class="qg-stripe-status-msg">Secure checkout powered by Stripe</div>';
    }
    if (mount) {
      mount.style.display = 'none';
      mount.innerHTML = '';
    }
  }

  function formatPayError(err) {
    if (err == null || err === '') return 'Could not start checkout';
    if (typeof err === 'string') {
      if (err === '[object Object]') return 'Payment could not start — try Message or refresh the page';
      if (err === 'already_paid') return 'This task is already paid — opening chat…';
      if (err === 'poster_payment_verification_required') {
        return 'Add and verify a payment method before paying for this task.';
      }
      if (err === 'poster_role_required') {
        return 'Enable Poster mode before paying for this task.';
      }
      if (err === 'poster_identity_mismatch' || err === 'not_task_poster') {
        return 'Only the authenticated task poster can pay for this task.';
      }
      if (err === 'stripe_not_configured') {
        return 'Stripe secret not set in Supabase — redeploy create-checkout (see STRIPE-SETUP.md)';
      }
      if (err === 'supabase_service_role_not_configured') {
        return 'Payments server not configured — set SUPABASE_SERVICE_ROLE_KEY on create-checkout Edge Function';
      }
      if (err === 'stripe_session_failed' || err === 'checkout_failed' || err === 'payment_row_failed') {
        return 'Payment server error — refresh and try again. If it keeps failing, redeploy create-checkout.';
      }
      if (err === 'task_lookup_failed' || err === 'application_lookup_failed') {
        return 'Could not load task data — refresh My Tasks and try again';
      }
      if (err === 'invalid_amount' || err === 'amount_below_minimum') {
        return 'Task amount must be at least $0.50 CAD before paying';
      }
      if (err === 'task_not_in_progress') return 'Task must be in progress before paying.';
      if (err === 'no_accepted_worker') return 'Accept a tasker first, then pay.';
      if (err === 'cannot_pay_self') {
        return 'You cannot pay on your own task. Use a second account as the tasker, cancel this task, and repost.';
      }
      return err;
    }
    if (err instanceof Error && err.message) return formatPayError(err.message);
    if (typeof err === 'object') {
      if (typeof err.message === 'string' && err.message) return formatPayError(err.message);
      if (err.error != null && err.error !== err) return formatPayError(err.error);
      if (typeof err.code === 'string' && err.code) return formatPayError(err.code);
      if (typeof err.code === 'number' && err.details) return formatPayError(String(err.details));
      if (typeof err.details === 'string' && err.details) return formatPayError(err.details);
      try {
        var raw = JSON.stringify(err);
        if (raw && raw !== '{}') return raw.length > 180 ? raw.substring(0, 180) + '…' : raw;
      } catch (e) { /* fall through */ }
    }
    return String(err);
  }

  function errorMentionsAlreadyPaid(val) {
    if (val == null) return false;
    if (typeof val === 'string') return val.toLowerCase().indexOf('already_paid') >= 0;
    if (typeof val === 'object') {
      if (errorMentionsAlreadyPaid(val.error)) return true;
      if (errorMentionsAlreadyPaid(val.message)) return true;
      if (errorMentionsAlreadyPaid(val.code)) return true;
    }
    return false;
  }

  function extractPayErrorCode(result) {
    if (!result) return '';
    if (errorMentionsAlreadyPaid(result)) return 'already_paid';
    if (errorMentionsAlreadyPaid(result.error)) return 'already_paid';
    var err = result.error;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      if (typeof err.code === 'string') return err.code;
      if (typeof err.error === 'string') return err.error;
      if (typeof err.message === 'string') return err.message;
      if (err.error && typeof err.error === 'object') return extractPayErrorCode({ error: err.error });
    }
    if (typeof result.message === 'string') return result.message;
    return '';
  }

  function isAlreadyPaidError(result) {
    if (!result) return false;
    var code = extractPayErrorCode(result).toLowerCase();
    // confirm-checkout also returns 409 for payment_not_complete — that is NOT already paid
    if (code === 'payment_not_complete' || code.indexOf('payment_not_complete') >= 0) return false;
    if (code === 'already_paid' || code.indexOf('already_paid') >= 0) return true;
    if (errorMentionsAlreadyPaid(result) || errorMentionsAlreadyPaid(result.error)) return true;
    if ((result.status === 409 || result.httpStatus === 409) && code.indexOf('already') >= 0) return true;
    return false;
  }

  function escHtml(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function payErrorTitle(err) {
    var code = formatPayError(extractPayErrorCode({ error: err }) || err).toLowerCase();
    if (code.indexOf('already_paid') >= 0) return 'Already paid';
    if (code.indexOf('stripe_not_configured') >= 0) return 'Payments not set up';
    if (code.indexOf('not_task_poster') >= 0) return 'Not allowed';
    if (code.indexOf('cannot_pay_self') >= 0) return 'Use two accounts';
    if (code.indexOf('no_accepted_worker') >= 0) return 'Accept a tasker first';
    if (code.indexOf('task_not_in_progress') >= 0) return 'Task not ready';
    return 'Payment couldn\u2019t start';
  }

  function setModalPanel(kind, title, message, buttonsHtml) {
    var loading = document.getElementById('qgStripeLoading');
    var mount = document.getElementById('qg-stripe-checkout-mount');
    if (mount) {
      mount.style.display = 'none';
      mount.innerHTML = '';
    }
    if (!loading) return;
    loading.style.display = 'flex';
    loading.className = 'qg-stripe-panel qg-stripe-' + kind;
    loading.innerHTML =
      '<div class="qg-stripe-status-icon" aria-hidden="true">' +
        (kind === 'success' ? '\u2713' : kind === 'error' ? '!' : '\u2026') +
      '</div>' +
      '<div class="qg-stripe-status-title">' + escHtml(title) + '</div>' +
      '<div class="qg-stripe-status-msg">' + escHtml(message) + '</div>' +
      (buttonsHtml || '');
  }

  function checkoutErrorText(result) {
    if (!result) return 'Could not start checkout';
    var code = extractPayErrorCode(result);
    var details = result.details || (result.error && typeof result.error === 'object' ? result.error.details : '');
    if (typeof details === 'object') details = formatPayError(details);
    var text = formatPayError(code || result.error || result.message || 'Could not start checkout');
    if (details && String(details).indexOf('[object Object]') < 0 && text.indexOf(String(details)) < 0) {
      text += ' (' + String(details).substring(0, 120) + ')';
    }
    if (result.httpStatus === 502 || result.httpStatus === 500) {
      console.error('Checkout failed:', result);
    }
    return text;
  }

  function setModalError(message) {
    setModalPanel(
      'error',
      payErrorTitle(message),
      formatPayError(message),
      '<button type="button" class="qg-stripe-action-btn qg-stripe-action-secondary" onclick="window.QG_closePayModal&&window.QG_closePayModal()">Close</button>'
    );
  }

  function setModalCheckoutError(taskId, posterId, options, result) {
    var text = checkoutErrorText(result);
    var retryBtn = taskId
      ? '<button type="button" class="qg-stripe-action-btn" id="qgStripeRetryPayBtn">Try again</button>'
      : '';
    setModalPanel(
      'error',
      payErrorTitle(extractPayErrorCode(result) || result && result.error),
      text,
      retryBtn +
      '<button type="button" class="qg-stripe-action-btn qg-stripe-action-secondary" onclick="window.QG_closePayModal&&window.QG_closePayModal()">Close</button>'
    );
    var retry = document.getElementById('qgStripeRetryPayBtn');
    if (retry) {
      retry.onclick = function () {
        retry.disabled = true;
        retry.textContent = 'Retrying…';
        openPayModal(taskId, posterId, options).finally(function () {
          retry.disabled = false;
          retry.textContent = 'Try again';
        });
      };
    }
  }

  function setModalAlreadyPaid(taskId, options) {
    options = options || {};
    var titleEl = document.getElementById('qgStripeTitle');
    var subEl = document.getElementById('qgStripeSub');
    if (titleEl) titleEl.textContent = 'Payment complete';
    if (subEl) subEl.textContent = 'This task is already paid — chat is unlocked';
    setModalPanel(
      'success',
      'Already paid',
      'Your payment went through. Tap below to open chat with your tasker.',
      '<button type="button" class="qg-stripe-action-btn" id="qgStripeOpenChatBtn">Open chat</button>' +
      '<button type="button" class="qg-stripe-action-btn qg-stripe-action-secondary" onclick="window.QG_closePayModal&&window.QG_closePayModal()">Stay here</button>'
    );
      var openBtn = document.getElementById('qgStripeOpenChatBtn');
    if (openBtn) {
      openBtn.onclick = function () {
        openBtn.disabled = true;
        openBtn.textContent = 'Opening…';
        goToChatAfterPayment(taskId, '', options);
      };
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
    var url = fnUrl(
      'createCheckoutUrl',
      'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/create-checkout'
    );
    if (typeof callVerifiedFunction === 'function') {
      var verified = await callVerifiedFunction(url, {
        task_id: String(taskId),
        poster_id: String(posterId),
        return_page: returnPage || 'chat',
        return_conv: returnConv || ''
      });
      if (verified.ok == null) verified.ok = verified.success === true;
      return verified;
    }
    if (typeof getSupabaseHeaders !== 'function') {
      return { ok: false, error: 'Database not loaded' };
    }
    var headers = await getSupabaseHeaders();
    var res = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        task_id: String(taskId),
        poster_id: String(posterId),
        return_page: returnPage || 'chat',
        return_conv: returnConv || ''
      })
    });
    var data = {};
    try { data = await res.json(); } catch (e) { data = { ok: false, error: 'Invalid response' }; }
    if (!res.ok && data.ok !== false) data.ok = false;
    data.httpStatus = res.status;
    if (typeof data.error === 'object' && data.error) {
      if (typeof data.error.message === 'string') data.message = data.message || data.error.message;
      if (typeof data.error.details === 'string') data.details = data.details || data.error.details;
    }
    if (typeof data.details === 'string' && data.details && !data.message) data.message = data.details;
    if (typeof data.error === 'object') data.error = extractPayErrorCode({ error: data.error }) || data.message || 'checkout_failed';
    if (data.error === '[object Object]') data.error = data.details || data.message || 'checkout_failed';
    if (!data.error && data.message) data.error = data.message;
    return data;
  }

  async function startConnectOnboarding(workerId, email) {
    if (typeof callVerifiedFunction === 'function') {
      var verified = await callVerifiedFunction(
        fnUrl('connectLinkUrl', 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/create-connect-link'),
        { worker_id: String(workerId), email: email || '' }
      );
      if (verified.ok == null) verified.ok = verified.success === true;
      return verified;
    }
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
    var limit = maxMs || 4000;
    while (Date.now() - start < limit) {
      try {
        var row = await getPaymentByTask(taskId);
        var st = row && String(row.status || '').toLowerCase();
        if (st && ['held', 'completed', 'paid'].indexOf(st) >= 0) return true;
      } catch (e) {}
      await new Promise(function (r) { setTimeout(r, 200); });
    }
    return false;
  }

  function buildChatPayReturnUrl(taskId, sessionId, convId) {
    if (convId) {
      var convQs = 'conv=' + encodeURIComponent(String(convId));
      if (sessionId) {
        convQs += '&paid=1&session_id=' + encodeURIComponent(String(sessionId));
      }
      return 'chat.html?' + convQs;
    }
    var qs = 'paid=1&task=' + encodeURIComponent(String(taskId || ''));
    if (sessionId) qs += '&session_id=' + encodeURIComponent(String(sessionId));
    return 'chat.html?' + qs;
  }

  async function attachReturnConv(taskId, posterId, options) {
    if (!options || options.returnConv) return;
    if (typeof getTaskById !== 'function' || typeof getApplicationsByTask !== 'function' ||
        typeof getConversationForTask !== 'function') return;
    try {
      var apps = await getApplicationsByTask(taskId);
      var accepted = (apps || []).find(function (a) {
        return String(a.status || a.STATUS || '').toLowerCase() === 'accepted';
      });
      if (!accepted) return;
      var workerId = accepted.worker_id || accepted.WORKER_ID;
      var conv = await getConversationForTask(taskId, posterId, workerId);
      if (conv && conv.conv_id) {
        options.returnConv = String(conv.conv_id);
        markJustPaidConv(taskId, conv.conv_id);
      }
    } catch (e) {
      console.warn('attachReturnConv failed:', e);
    }
  }

  function markJustPaidConv(taskId, convId) {
    if (!convId) return;
    try {
      sessionStorage.setItem('qg-just-paid-conv', String(convId) + '|' + Date.now());
      if (taskId) sessionStorage.setItem('qg-task-conv-' + String(taskId), String(convId));
    } catch (e) {}
  }

  function readCachedTaskConv(taskId) {
    if (!taskId) return '';
    try { return sessionStorage.getItem('qg-task-conv-' + String(taskId)) || ''; } catch (e) { return ''; }
  }

  async function goToChatAfterPayment(taskId, sessionId, options) {
    options = options || {};
    taskId = String(taskId || '');
    sessionId = String(sessionId || '');
    closePayModal();
    if (typeof window.qgShowGlobalLoading === 'function') {
      window.qgShowGlobalLoading('Opening chat…');
    }

    if (!options.returnConv && taskId) {
      options.returnConv = readCachedTaskConv(taskId);
    }

    if (options.returnConv) {
      markJustPaidConv(taskId, options.returnConv);
      window.location.replace(buildChatPayReturnUrl(taskId, sessionId, options.returnConv));
      return true;
    }

    if (taskId) {
      window.location.replace(buildChatPayReturnUrl(taskId, sessionId));
      return true;
    }
    if (typeof window.qgHideGlobalLoading === 'function') window.qgHideGlobalLoading();
    return false;
  }

  async function navigateToChatForTask(taskId, sessionId, opts) {
    opts = opts || {};
    if (!taskId) return false;

    if (typeof getTaskById === 'function') {
      try {
        var taskQuick = await getTaskById(taskId);
        if (taskQuick) {
          var posterQuick = taskQuick.posted_by || taskQuick.POSTED_BY;
          var appsQuick = typeof getApplicationsByTask === 'function' ? await getApplicationsByTask(taskId) : [];
          var acceptedQuick = (appsQuick || []).find(function (a) {
            return String(a.status || a.STATUS || '').toLowerCase() === 'accepted';
          });
          if (acceptedQuick && typeof getConversationForTask === 'function') {
            var workerQuick = acceptedQuick.worker_id || acceptedQuick.WORKER_ID;
            var convQuick = await getConversationForTask(taskId, posterQuick, workerQuick);
            if (convQuick && convQuick.conv_id) {
              if (!opts.skipLoading) closePayModal();
              if (!opts.skipLoading && typeof window.qgShowGlobalLoading === 'function') {
                window.qgShowGlobalLoading('Opening chat…');
              }
              window.location.replace(buildChatPayReturnUrl(taskId, sessionId || '', convQuick.conv_id));
              return true;
            }
          }
        }
      } catch (e) {
        console.warn('navigateToChatForTask quick conv failed:', e);
      }
    }

    if (typeof ensureChatReadyForTask === 'function' && window._currentUser) {
      try {
        var ready = await ensureChatReadyForTask(taskId, window._currentUser.uid, {
          sessionId: sessionId || ''
        });
        var readyConv = ready && ready.conv_id;
        if (ready.ok && readyConv) {
          if (!opts.skipLoading) closePayModal();
          if (!opts.skipLoading && typeof window.qgShowGlobalLoading === 'function') {
            window.qgShowGlobalLoading('Opening chat…');
          }
          window.location.replace('chat.html?conv=' + encodeURIComponent(String(readyConv)));
          return true;
        }
        if (readyConv && ready.error === 'not_paid') {
          if (!opts.skipLoading) closePayModal();
          if (!opts.skipLoading && typeof window.qgShowGlobalLoading === 'function') {
            window.qgShowGlobalLoading('Opening chat…');
          }
          window.location.replace('chat.html?conv=' + encodeURIComponent(String(readyConv)));
          return true;
        }
      } catch (e) {
        console.warn('navigateToChatForTask ensureChatReady failed:', e);
      }
    }
    if (typeof getTaskById !== 'function') return false;
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
        if (!opts.skipLoading) closePayModal();
        if (!opts.skipLoading && typeof window.qgShowGlobalLoading === 'function') {
          window.qgShowGlobalLoading('Opening chat…');
        }
        window.location.replace('chat.html?conv=' + encodeURIComponent(String(conv.conv_id)));
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
    if (!taskId || !window._currentUser) return false;
    if (typeof ensureChatReadyForTask === 'function') {
      var ready = await ensureChatReadyForTask(taskId, window._currentUser.uid);
      return !!(ready && ready.ok);
    }
    if (typeof getTaskById !== 'function' || typeof unlockChatForTask !== 'function') return false;
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
    if (typeof showToast === 'function') {
      showToast('Payment confirmed — opening chat', '#4ade80');
    }
    goToChatAfterPayment(taskId, '', options);
    tryUnlockChatAfterPayment(taskId).catch(function () {});
    if (typeof window.QG_refreshPaymentState === 'function') {
      window.QG_refreshPaymentState(taskId);
    }
    if (typeof loadData === 'function') loadData();
    return { ok: true, already_paid: true };
  }

  async function taskHasHeldPayment(taskId, opts) {
    if (!taskId || typeof getPaymentByTask !== 'function') return false;
    opts = opts || {};
    try {
      var row = await getPaymentByTask(taskId, {
        posterId: opts.posterId || '',
        workerId: opts.workerId || '',
        actorId: opts.posterId || opts.actorId || '',
        actorRole: 'poster'
      });
      var st = row && String(row.status || '').toLowerCase();
      return st === 'held' || st === 'paid' || st === 'completed';
    } catch (e) {
      return false;
    }
  }

  function confirmAndUnlockTask(taskId, sessionId, options) {
    options = options || {};
    taskId = String(taskId || '');
    sessionId = String(sessionId || '');
    var lockKey = taskId + '|' + (sessionId || 'done');
    if (_checkoutDoneKeys[lockKey]) return;
    _checkoutDoneKeys[lockKey] = true;

    destroyCheckout();
    closePayModal();
    if (typeof window.qgShowGlobalLoading === 'function') {
      window.qgShowGlobalLoading('Opening chat…');
    }

    if (sessionId) {
      confirmCheckoutSession(sessionId).catch(function (e) {
        console.warn('confirmCheckoutSession background:', e);
      });
    }
    if (taskId) {
      tryUnlockChatAfterPayment(taskId).catch(function () {});
      if (typeof window.QG_refreshPaymentState === 'function') {
        window.QG_refreshPaymentState(taskId);
      }
    }

    goToChatAfterPayment(taskId, sessionId, options);
  }

  async function syncPaymentFromServer(posterId, options) {
    options = options || {};
    if (!posterId || typeof getSupabaseHeaders !== 'function') {
      return { ok: false, error: 'missing_poster_or_auth' };
    }
    var url = fnUrl(
      'syncPaymentUrl',
      'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/sync-payment'
    );
    try {
      var headers = await getSupabaseHeaders();
      var res = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          poster_id: String(posterId),
          actor_id: String(posterId),
          task_id: options.taskId ? String(options.taskId) : '',
          worker_id: options.workerId ? String(options.workerId) : ''
        })
      });
      var data = {};
      try { data = await res.json(); } catch (e) { data = { ok: false, error: 'Invalid response' }; }
      if (!res.ok && data.ok !== false) data.ok = false;
      data.httpStatus = res.status;
      return data;
    } catch (err) {
      console.warn('syncPaymentFromServer failed:', err);
      return { ok: false, error: String(err) };
    }
  }

  async function syncPendingPaymentsForPoster(userId, options) {
    options = options || {};
    if (!userId) return;
    if (syncPendingPaymentsForPoster._running) return syncPendingPaymentsForPoster._running;
    syncPendingPaymentsForPoster._running = (async function () {
      try {
        // Server recovery: pending rows + Stripe session list for this poster
        var serverSync = await syncPaymentFromServer(userId, {
          taskId: options.taskId || '',
          workerId: options.workerId || ''
        });
        if (serverSync && serverSync.ok) return serverSync;

        if (typeof getPaymentsForUser !== 'function') return serverSync;
        var rows = await getPaymentsForUser(userId, 'poster');
        var pending = (rows || []).filter(function (p) {
          var st = String(p.status || '').toLowerCase();
          return st === 'pending';
        }).slice(0, 5);
        var seenTasks = {};
        for (var i = 0; i < pending.length; i++) {
          var tid = String(pending[i].task_id || '');
          if (tid && seenTasks[tid]) continue;
          seenTasks[tid] = true;
          var sid = String(pending[i].stripe_id || '');
          // Only checkout sessions can be confirmed; pi_ ids are already captured
          if (!sid || sid.indexOf('cs_') !== 0) continue;
          var confirmed = await confirmCheckoutSession(sid);
          if (confirmed && confirmed.ok === false && confirmed.error === 'payment_not_complete') {
            console.warn('Pending session not paid yet:', sid);
          }
        }
        return serverSync;
      } catch (e) {
        console.warn('syncPendingPaymentsForPoster failed:', e);
        return { ok: false, error: String(e) };
      } finally {
        syncPendingPaymentsForPoster._running = null;
      }
    })();
    return syncPendingPaymentsForPoster._running;
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
    if (sessionStorage.getItem(handledKey) === 'done') return false;
    try { sessionStorage.setItem('qg-payment-tab', 'inprogress'); } catch (e) {}

    if (typeof activeTab !== 'undefined') activeTab = 'inprogress';
    // Payment is a poster action — do not silently rewrite global mode here

    if (sessionId) {
      confirmCheckoutSession(sessionId).catch(function () {});
    }
    if (taskId) {
      tryUnlockChatAfterPayment(taskId).catch(function () {});
      if (typeof window.QG_refreshPaymentState === 'function') {
        window.QG_refreshPaymentState(taskId);
      }
    }

    cleanPaymentReturnParams();

    if (taskId && typeof navigateToChatForTask === 'function') {
      var nav = typeof withTimeout === 'function'
        ? await withTimeout(navigateToChatForTask(taskId, sessionId), 2500, false)
        : await navigateToChatForTask(taskId, sessionId);
      if (nav) {
        sessionStorage.setItem(handledKey, 'done');
        return true;
      }
      window.location.replace(buildChatPayReturnUrl(taskId, sessionId));
      sessionStorage.setItem(handledKey, 'done');
      return true;
    }

    sessionStorage.setItem(handledKey, 'done');
    if (typeof renderTab === 'function') renderTab();
    return true;
  }

  async function openPayModalInner(taskId, posterId, options) {
    options = options || {};
    taskId = String(taskId || '');
    posterId = String(posterId || '');

    if (!paymentsLive()) {
      if (typeof qgNotify === 'function') {
        qgNotify('Payments not configured — see STRIPE-SETUP.md', '#f59e0b');
      } else if (typeof showToast === 'function') {
        showToast('Payments not configured — see STRIPE-SETUP.md', '#f59e0b');
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
    var feeEl = document.getElementById('qgStripeFee');
    if (titleEl) titleEl.textContent = options.title || 'Pay to unlock chat';
    if (subEl) subEl.textContent = options.subtitle || 'Pay once to unlock chat · held in escrow until the job is done';
    if (amountEl) {
      if (options.amount != null && options.amount !== '') {
        amountEl.textContent = '$' + Number(options.amount).toFixed(2) + ' CAD';
        amountEl.style.display = 'block';
        if (feeEl && typeof formatFeeCommitmentLine === 'function') {
          feeEl.style.display = 'block';
          var feeOpts = options.feeOpts || {};
          if (!feeOpts.task && options.task) feeOpts.task = options.task;
          if (typeof feeOptsFromTask === 'function' && feeOpts.task && feeOpts.isRecurring == null) {
            feeOpts = Object.assign({}, feeOptsFromTask(feeOpts.task), feeOpts);
          }
          // FUTURE: per-period Stripe billing for recurring jobs hooks in after accept —
          // this modal is display-only while Stripe checkout may be disconnected.
          feeEl.textContent = formatFeeCommitmentLine(options.amount, feeOpts) + ' CAD';
        }
      } else {
        amountEl.textContent = '';
        amountEl.style.display = 'none';
        if (feeEl) { feeEl.style.display = 'none'; feeEl.textContent = ''; }
      }
    }

    destroyCheckout();
    setModalLoading('Opening secure checkout…');
    _overlayEl.classList.add('open');
    document.body.style.overflow = 'hidden';

    var workerHint = options.workerId || '';
    if (!workerHint && typeof findAcceptedApplication === 'function') {
      try {
        var acc = findAcceptedApplication(taskId);
        if (acc && typeof getField === 'function') workerHint = String(getField(acc, 'WORKER_ID') || '');
        else if (acc) workerHint = String(acc.worker_id || acc.WORKER_ID || '');
      } catch (e) {}
    }
    if (await taskHasHeldPayment(taskId, { posterId: posterId, workerId: workerHint })) {
      setModalAlreadyPaid(taskId, options);
      return { ok: true, already_paid: true };
    }

    var convAttach = attachReturnConv(taskId, posterId, options);
    if (typeof window.QG_syncPendingPayments === 'function') {
      if (typeof withTimeout === 'function') {
        withTimeout(window.QG_syncPendingPayments(posterId), 1500, null);
      }
    }

    var result = await startCheckout(taskId, posterId, options.returnPage || 'mytasks', options.returnConv || '');
    await convAttach;

    if (!result.ok) {
      if (isAlreadyPaidError(result)) {
        setModalAlreadyPaid(taskId, options);
        return { ok: true, already_paid: true };
      }
      setModalCheckoutError(taskId, posterId, options, result);
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
        if (feeEl && typeof formatFeeCommitmentLine === 'function') {
          feeEl.style.display = 'block';
          var feeOpts2 = options.feeOpts || {};
          if (!feeOpts2.task && options.task) feeOpts2.task = options.task;
          if (typeof feeOptsFromTask === 'function' && feeOpts2.task && feeOpts2.isRecurring == null) {
            feeOpts2 = Object.assign({}, feeOptsFromTask(feeOpts2.task), feeOpts2);
          }
          feeEl.textContent = formatFeeCommitmentLine(result.amount, feeOpts2) + ' CAD';
        }
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
      setModalCheckoutError(taskId, posterId, options, { error: err });
      return { ok: false, error: formatPayError(err) };
    }
  }

  async function openPayModal(taskId, posterId, options) {
    taskId = String(taskId || '');
    posterId = String(posterId || '');

    if (_payOpenTaskId === taskId && _overlayEl && _overlayEl.classList.contains('open')) {
      return { ok: true, already_open: true };
    }
    if (_payOpenPromise && _payOpenTaskId === taskId) {
      return _payOpenPromise;
    }

    _payOpenTaskId = taskId;
    _payOpenPromise = openPayModalInner(taskId, posterId, options).finally(function () {
      if (_payOpenTaskId === taskId) _payOpenTaskId = '';
      _payOpenPromise = null;
    });
    return _payOpenPromise;
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
        var workerId = '';
        try {
          if (typeof findAcceptedApplication === 'function') {
            var app = findAcceptedApplication(syncTaskId);
            if (app && typeof getField === 'function') workerId = String(getField(app, 'WORKER_ID') || '');
            else if (app) workerId = String(app.worker_id || app.WORKER_ID || '');
          }
        } catch (e) {}
        var serverResult = null;
        if (typeof window.QG_syncPayment === 'function') {
          serverResult = await window.QG_syncPayment(syncUserId, {
            taskId: syncTaskId,
            workerId: workerId
          });
        } else if (typeof window.QG_syncPendingPayments === 'function') {
          serverResult = await window.QG_syncPendingPayments(syncUserId, {
            taskId: syncTaskId,
            workerId: workerId
          });
        }
        if (typeof window.QG_refreshPaymentState === 'function') {
          await window.QG_refreshPaymentState(syncTaskId);
        }
        // Alias recovered UUID payment onto this UI task id
        if (serverResult && serverResult.ok && serverResult.payment && typeof indexPaymentRow === 'function') {
          indexPaymentRow(serverResult.payment, [syncTaskId, String(serverResult.task_id || '')]);
        }
        var synced = (typeof isTaskPaid === 'function' && isTaskPaid(syncTaskId)) ||
          !!(serverResult && serverResult.ok);
        if (typeof activeTab !== 'undefined') activeTab = 'inprogress';
        if (typeof syncTabButtons === 'function') syncTabButtons();
        if (typeof renderTab === 'function') renderTab();
        else if (typeof loadData === 'function') await loadData();
        if (typeof showToast === 'function') {
          if (synced) {
            showToast('Payment found — chat unlocked. Tap Message', '#4ade80');
          } else {
            var detail = (serverResult && serverResult.error) ? String(serverResult.error) : 'no_paid_session_found';
            showToast(
              'No paid Stripe checkout found — check Stripe Dashboard before paying again (' + detail + ')',
              '#f59e0b'
            );
          }
        }
        syncBtn.disabled = false;
        syncBtn.textContent = '↻ Sync payment';
      })();
      return;
    }
    var btn = e.target.closest('[data-pay-task]');
    if (!btn || btn.disabled) return;
    e.preventDefault();
    var taskId = btn.getAttribute('data-pay-task');
    var userId = window._currentUser && window._currentUser.uid;
    if (!taskId || !userId) return;
    var returnPage = btn.getAttribute('data-pay-return') || 'mytasks';
    var returnConv = btn.getAttribute('data-pay-conv') || '';
    var amount = btn.getAttribute('data-pay-amount');
    var title = btn.getAttribute('data-pay-title');
    var prevLabel = btn.textContent;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = 'Opening…';
    openPayModal(taskId, userId, {
      returnPage: returnPage,
      returnConv: returnConv,
      amount: amount,
      title: title || undefined
    }).finally(function () {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.textContent = prevLabel;
    });
  });

  async function syncConnectStatus(workerId) {
    if (!workerId) return { ok: false };
    var url = fnUrl(
      'syncConnectUrl',
      'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/sync-connect-status'
    );
    try {
      if (typeof callVerifiedFunction === 'function') {
        var verified = await callVerifiedFunction(url, { worker_id: String(workerId) });
        if (verified.ok == null) verified.ok = verified.success === true;
        return verified;
      }
      if (typeof getSupabaseHeaders !== 'function') return { ok: false };
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
  window.QG_syncPayment = syncPaymentFromServer;

  async function syncChatUnlock(convId, actorId) {
    if (typeof syncConversationUnlock === 'function') {
      return await syncConversationUnlock(convId, actorId);
    }
    return { ok: false, error: 'sync_not_available' };
  }
  window.QG_syncChatUnlock = syncChatUnlock;
  window.QG_navigateToChatForTask = navigateToChatForTask;
  window.QG_goToChatAfterPayment = goToChatAfterPayment;
  window.QG_buildChatPayReturnUrl = buildChatPayReturnUrl;
  window.QG_markJustPaidConv = markJustPaidConv;
  window.QG_readCachedTaskConv = readCachedTaskConv;
  window.QG_formatPayError = formatPayError;
})();
