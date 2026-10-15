/* SwiftGigs — tasker earnings wallet.
   Balances and withdrawals come from the request-payout function.
   This file never writes a balance and never decides whether a payout succeeded. */
(function () {
  var step = 'home';
  var snap = null;
  var chosenAccount = '';
  var amountRaw = '';
  var busy = false;

  function esc(s) {
    return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(cents) {
    var n = Number(cents) || 0;
    var sign = n < 0 ? '-' : '';
    var abs = Math.abs(n);
    var dollars = Math.floor(abs / 100);
    var frac = String(abs % 100).padStart(2, '0');
    return sign + '$' + dollars + '.' + frac;
  }
  function centsFromInput(raw) {
    var s = String(raw || '').trim();
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
    var parts = s.split('.');
    var frac = parts[1] || '';
    while (frac.length < 2) frac += '0';
    var cents = parseInt(parts[0], 10) * 100 + parseInt(frac, 10);
    return isFinite(cents) ? cents : null;
  }
  function toast(msg, ok) {
    if (typeof showToast === 'function') showToast(msg, ok === false ? '#ef4444' : undefined);
  }
  function endpoint() {
    var c = window.QG_CONFIG || {};
    return c.walletUrl || 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/request-payout';
  }
  async function callWallet(body) {
    if (typeof callVerifiedFunction !== 'function') {
      return { ok: false, error: 'function_not_configured', failure_reason: 'Payments are still loading. Try again in a moment.' };
    }
    var user = typeof getCurrentUser === 'function' ? getCurrentUser() : window._currentUser;
    return await callVerifiedFunction(endpoint(), body, user);
  }
  function statusLabel(status) {
    if (status === 'processing') return 'Processing';
    if (status === 'completed') return 'Completed';
    if (status === 'failed') return 'Failed';
    return 'Pending';
  }
  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function activeAccounts() {
    return (snap && snap.accounts || []).filter(function (a) { return a.status === 'active'; });
  }

  function banner() {
    if (!snap) return '';
    var lines = [];
    if (snap.guardian_payout) {
      lines.push('Payouts for this account go to the approved guardian. A parent finishes Stripe from their consent link.');
    } else if (!snap.live_payouts_ready) {
      lines.push('Test mode. Withdrawals are checked against your gigs, but real money is not sent to a bank yet.');
      (snap.live_requirements || []).forEach(function (line) { lines.push(line); });
    } else {
      lines.push('Stripe Connect is ready. A withdrawal sends a test-mode payout until the live Stripe key is turned on.');
    }
    return '<div class="sg-wallet-note">' + lines.map(function (line) { return '<p>' + esc(line) + '</p>'; }).join('') + '</div>';
  }

  function homeHtml() {
    var gigs = (snap.gigs || []).map(function (g) {
      var held = g.bucket === 'pending';
      return '<div class="sg-act"><span><b>' + esc(g.title || 'Gig') + '</b><span>' +
        esc(held ? 'In escrow — not withdrawable' : 'Released') +
        '</span></span><span class="sg-money">' + esc(money(g.cents)) + '</span></div>';
    }).join('');
    var banks = activeAccounts().map(function (a) {
      var tag = a.source === 'test' ? 'Test bank' : 'Stripe';
      return '<div class="sg-act"><span><b>' + esc(a.bank_name) + ' ···' + esc(a.last4) + '</b><span>' +
        esc(tag) + '</span></span><button type="button" class="sg-btn sg-btn-quiet" data-wallet-remove="' +
        esc(a.account_id) + '">Remove</button></div>';
    }).join('');
    var history = (snap.payouts || []).map(function (p) {
      var why = p.status === 'failed' && p.failure_reason
        ? '<span>' + esc(p.failure_reason) + '</span>' : '';
      var note = p.note ? '<span>' + esc(p.note) + '</span>' : '';
      var removed = p.account_removed && (p.status === 'pending' || p.status === 'processing')
        ? '<span>This bank was removed after the payout was sent. The payout still uses the account it was sent to.</span>' : '';
      var retry = p.status === 'failed'
        ? '<button type="button" class="sg-btn sg-btn-quiet" data-wallet-retry="' + esc(p.payout_id) + '">Retry</button>' : '';
      return '<div class="sg-act"><span><b>' + esc(money(p.amount_cents)) + ' · ' + esc(statusLabel(p.status)) +
        '</b><span>' + esc([when(p.created_at), p.destination_label].filter(Boolean).join(' · ')) + '</span>' +
        why + note + removed + '</span>' + retry + '</div>';
    }).join('');
    return banner() +
      '<div class="sg-wallet">' +
        '<div class="sg-card sg-wallet-fig"><small>Available</small><b class="sg-money">' + esc(money(snap.available_cents)) + '</b></div>' +
        '<div class="sg-card sg-wallet-fig"><small>Pending</small><b class="sg-money">' + esc(money(snap.pending_cents)) + '</b></div>' +
        '<div class="sg-card sg-wallet-fig"><small>Total earned</small><b class="sg-money">' + esc(money(snap.earned_cents)) + '</b></div>' +
      '</div>' +
      '<p class="sg-wallet-note">Available is your share of gigs whose escrow has been released. Pending is still held and cannot be withdrawn. The minimum withdrawal is ' + esc(money(snap.minimum_cents || 2000)) + '.</p>' +
      '<div class="sg-sheet-foot"><button type="button" class="sg-btn teal" id="sgWalletWithdraw"' +
        (snap.guardian_payout ? ' disabled' : '') + '>Withdraw</button></div>' +
      (gigs ? '<div class="sg-sheet-sec">Gig ledger</div>' + gigs : '<p class="sg-wallet-note">No gig earnings yet.</p>') +
      '<div class="sg-sheet-sec">Bank accounts</div>' +
      (banks || '<p class="sg-wallet-note">No bank on file yet.</p>') +
      '<div class="sg-sheet-foot">' +
        (snap.test_mode && !snap.guardian_payout ? '<button type="button" class="sg-btn sg-btn-quiet" id="sgWalletTestBank">Add test bank</button>' : '') +
        '<button type="button" class="sg-btn teal" id="sgWalletConnect">Set up Stripe</button></div>' +
      '<div class="sg-sheet-sec">Payout history</div>' +
      (history || '<p class="sg-wallet-note">No withdrawals yet.</p>');
  }

  function amountHtml() {
    return '<p class="sg-wallet-note">Available ' + esc(money(snap.available_cents)) + '. Minimum ' + esc(money(snap.minimum_cents || 2000)) + '. Held escrow is not included.</p>' +
      '<label class="sg-input"><span class="cur">$</span><input id="sgWalletAmount" inputmode="decimal" autocomplete="off" placeholder="0.00" value="' + esc(amountRaw) + '"></label>' +
      '<div class="sg-sheet-foot"><button type="button" class="sg-btn sg-btn-quiet" data-wallet-step="home">Back</button>' +
      '<button type="button" class="sg-btn teal" id="sgWalletAmountNext">Continue</button></div>';
  }

  function bankHtml() {
    var rows = activeAccounts().map(function (a) {
      var on = chosenAccount === String(a.account_id);
      return '<button type="button" class="sg-set is-row' + (on ? ' on' : '') + '" data-wallet-bank="' + esc(a.account_id) + '"><span>' +
        esc(a.bank_name) + ' ···' + esc(a.last4) + '<small>' + esc(a.source === 'test' ? 'Test bank — no real transfer' : 'Stripe bank') +
        '</small></span></button>';
    }).join('');
    return '<div class="sg-sheet-sec">Pay into</div>' +
      (rows || '<p class="sg-wallet-note">Add a bank first. A test bank lets you try the flow. A Stripe bank is required before real money can move.</p>') +
      '<div class="sg-sheet-foot"><button type="button" class="sg-btn sg-btn-quiet" data-wallet-step="amount">Back</button>' +
      '<button type="button" class="sg-btn teal" id="sgWalletBankNext">Continue</button></div>';
  }

  function confirmHtml() {
    var cents = centsFromInput(amountRaw);
    var bank = activeAccounts().filter(function (a) { return String(a.account_id) === chosenAccount; })[0];
    var dest = bank ? (bank.bank_name + ' ···' + bank.last4) : 'No bank selected';
    return '<div class="sg-card sg-wallet-fig"><small>Withdraw</small><b class="sg-money">' + esc(money(cents)) + '</b></div>' +
      '<p class="sg-wallet-note">To ' + esc(dest) + '. Available after this would be ' + esc(money((snap.available_cents || 0) - (cents || 0))) + ' if the payout is accepted.</p>' +
      banner() +
      '<div class="sg-sheet-foot"><button type="button" class="sg-btn sg-btn-quiet" data-wallet-step="bank">Back</button>' +
      '<button type="button" class="sg-btn teal" id="sgWalletConfirm">Confirm withdrawal</button></div>';
  }

  function paint(root) {
    if (!root) return;
    if (!snap) {
      root.innerHTML = '<p class="sg-wallet-note">Loading your earnings…</p>';
      return;
    }
    if (step === 'amount') root.innerHTML = amountHtml();
    else if (step === 'bank') root.innerHTML = bankHtml();
    else if (step === 'confirm') root.innerHTML = confirmHtml();
    else root.innerHTML = homeHtml();
    bind(root);
  }

  function bind(root) {
    root.querySelectorAll('[data-wallet-step]').forEach(function (btn) {
      btn.onclick = function () { step = btn.getAttribute('data-wallet-step'); paint(root); };
    });
    var amount = root.querySelector('#sgWalletAmount');
    if (amount) amount.addEventListener('input', function () { amountRaw = amount.value; });
    var withdraw = root.querySelector('#sgWalletWithdraw');
    if (withdraw) withdraw.onclick = function () { step = 'amount'; paint(root); };
    var nextAmount = root.querySelector('#sgWalletAmountNext');
    if (nextAmount) nextAmount.onclick = function () {
      var cents = centsFromInput(amountRaw);
      var min = snap.minimum_cents || 2000;
      if (cents == null || cents <= 0) { toast('Enter an amount greater than $0.', false); return; }
      if (cents < min) { toast('The minimum withdrawal is ' + money(min) + '.', false); return; }
      if (cents > Number(snap.available_cents || 0)) {
        toast('That amount is higher than your available balance. Held escrow cannot be withdrawn.', false);
        return;
      }
      step = 'bank';
      paint(root);
    };
    root.querySelectorAll('[data-wallet-bank]').forEach(function (btn) {
      btn.onclick = function () { chosenAccount = btn.getAttribute('data-wallet-bank'); paint(root); };
    });
    var nextBank = root.querySelector('#sgWalletBankNext');
    if (nextBank) nextBank.onclick = function () {
      if (!chosenAccount) { toast('Choose a bank account.', false); return; }
      step = 'confirm';
      paint(root);
    };
    var confirm = root.querySelector('#sgWalletConfirm');
    if (confirm) confirm.onclick = function () { submitWithdraw(root, confirm); };
    var add = root.querySelector('#sgWalletTestBank');
    if (add) add.onclick = function () { run(root, { action: 'add_test_bank' }, 'Test bank added'); };
    var connect = root.querySelector('#sgWalletConnect');
    if (connect) connect.onclick = function () { startConnect(connect); };
    root.querySelectorAll('[data-wallet-remove]').forEach(function (btn) {
      btn.onclick = function () {
        if (!window.confirm('Remove this bank? A payout already in progress keeps the account it was sent to.')) return;
        run(root, { action: 'remove_bank', account_id: btn.getAttribute('data-wallet-remove') }, 'Bank removed');
      };
    });
    root.querySelectorAll('[data-wallet-retry]').forEach(function (btn) {
      btn.onclick = function () {
        run(root, {
          action: 'retry',
          payout_id: btn.getAttribute('data-wallet-retry'),
          idempotency_key: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now())
        }, 'Retry sent');
      };
    });
  }

  async function startConnect(btn) {
    var user = typeof getCurrentUser === 'function' ? getCurrentUser() : window._currentUser;
    if (!user || typeof window.QG_startConnectOnboarding !== 'function') {
      toast('Stripe setup is still loading. Try again in a moment.', false);
      return;
    }
    btn.disabled = true;
    var result = await window.QG_startConnectOnboarding(user.uid, user.email || '');
    if (result && result.ok && result.url) { window.location.href = result.url; return; }
    btn.disabled = false;
    toast((result && (result.message || result.failure_reason || result.error)) || 'Could not open Stripe setup.', false);
  }

  async function run(root, body, okMsg) {
    if (busy) return;
    busy = true;
    var result;
    try { result = await callWallet(body); }
    catch (e) { result = { ok: false, failure_reason: 'Could not reach payouts. Try again.' }; }
    busy = false;
    if (result && result.available_cents != null) snap = result;
    if (result && result.warning) toast(result.warning, false);
    else if (!result || result.ok === false) toast((result && (result.failure_reason || result.details || result.error)) || 'Could not update payouts.', false);
    else toast(okMsg);
    step = 'home';
    paint(root);
  }

  async function submitWithdraw(root, btn) {
    if (busy) return;
    var cents = centsFromInput(amountRaw);
    if (cents == null) { toast('Enter an amount greater than $0.', false); return; }
    busy = true;
    btn.disabled = true;
    var result;
    try {
      result = await callWallet({
        action: 'withdraw',
        amount_cents: cents,
        account_id: chosenAccount,
        idempotency_key: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now())
      });
    } catch (e) {
      result = { ok: false, failure_reason: 'Could not reach payouts. Try again.' };
    }
    busy = false;
    if (result && result.available_cents != null) snap = result;
    if (!result || result.ok === false) {
      toast((result && (result.failure_reason || result.details || result.error)) || 'Withdrawal was not sent.', false);
    } else if (result.payout && result.payout.mode === 'test_ledger') {
      toast('Test withdrawal recorded. No money was sent to a bank.');
    } else {
      toast('Withdrawal sent.');
    }
    amountRaw = '';
    step = 'home';
    paint(root);
  }

  window.QG_renderWallet = async function (root, user) {
    if (!root) return;
    if (!user) {
      root.innerHTML = '<p class="sg-wallet-note">Sign in to see your earnings.</p>';
      return;
    }
    step = 'home';
    paint(root);
    var result;
    try { result = await callWallet({ action: 'snapshot' }); }
    catch (e) { result = { ok: false, failure_reason: 'Could not load earnings.' }; }
    if (!result || result.ok === false || result.available_cents == null) {
      root.innerHTML = '<p class="sg-wallet-note">' + esc((result && (result.failure_reason || result.error)) || 'Could not load earnings.') + '</p>';
      return;
    }
    snap = result;
    paint(root);
  };
})();
