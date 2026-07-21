/* QuickGigs — Stripe client helpers (Checkout + Connect onboarding) */
(function () {
  function cfg() {
    return window.QG_CONFIG || {};
  }

  function fnUrl(key, fallback) {
    return cfg()[key] || fallback;
  }

  async function startCheckout(taskId, posterId) {
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
      body: JSON.stringify({ task_id: String(taskId), poster_id: String(posterId) })
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

  function paymentsLive() {
    var c = cfg();
    return !!(c.paymentsEnabled && c.stripePublishableKey);
  }

  window.QG_paymentsLive = paymentsLive;
  window.QG_startCheckout = startCheckout;
  window.QG_startConnectOnboarding = startConnectOnboarding;
})();
