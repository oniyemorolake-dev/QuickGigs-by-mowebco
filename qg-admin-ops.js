/* SwiftGigs Admin — Launch control.
 * One screen for running a tester round: what needs attention, invite a
 * tester, how far each tester got, and the last 24 hours of failed calls.
 * Reads the data admin.html already loads (window.users, window.payments …);
 * only the invite, refund and release buttons write anything.
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function f(row, key) {
    if (!row) return '';
    if (row[key] != null) return row[key];
    var up = key.toUpperCase();
    return row[up] != null ? row[up] : '';
  }
  function lower(v) { return String(v || '').toLowerCase(); }
  function ms(v) { var t = Date.parse(v || ''); return isNaN(t) ? 0 : t; }
  function ago(v) {
    var t = ms(v);
    if (!t) return '';
    var mins = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    var hrs = Math.round(mins / 60);
    if (hrs < 48) return hrs + ' h ago';
    return Math.round(hrs / 24) + ' days ago';
  }
  function money(v) {
    var n = Number(v);
    return isFinite(n) ? '$' + n.toFixed(2) : '';
  }
  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'green');
  }
  function taskById(id) {
    id = String(id || '');
    return (window.tasks || []).find(function (t) { return String(f(t, 'task_id')) === id; }) || null;
  }
  function userByUid(uid) {
    uid = String(uid || '');
    return (window.users || []).find(function (u) { return String(f(u, 'firebase_uid')) === uid; }) || null;
  }
  function personName(uid) {
    var u = userByUid(uid);
    return u ? (f(u, 'name') || f(u, 'email') || 'Unknown') : 'Unknown';
  }

  /* ── 1. Needs attention ─────────────────────────────────────────────── */
  function attentionItems() {
    var items = [];
    var payments = window.payments || [];
    var apps = window.applications || [];
    var now = Date.now();

    payments.forEach(function (p) {
      var st = lower(f(p, 'status'));
      var task = taskById(f(p, 'task_id'));
      var title = task ? f(task, 'title') : 'Gig no longer exists';
      var base = {
        taskId: String(f(p, 'task_id')),
        posterId: String(f(p, 'poster_id')),
        workerId: String(f(p, 'worker_id')),
        when: f(p, 'created_at')
      };
      if (st === 'held') {
        var done = task && lower(f(task, 'status')) === 'completed';
        var old = now - ms(f(p, 'created_at')) > 7 * 86400000;
        if (done || old || !task) {
          items.push(Object.assign({
            kind: 'stuck',
            tone: 's-open',
            label: 'Stuck payment',
            text: money(f(p, 'amount')) + ' held for "' + title + '"' +
              (done ? ', gig is marked complete but the tasker was not paid'
                : (!task ? ', the gig was deleted' : ', held for over a week')),
            who: personName(base.posterId) + ' paid, ' + personName(base.workerId) + ' is owed'
          }, base));
        }
      } else if (st === 'disputed') {
        items.push(Object.assign({
          kind: 'dispute',
          tone: 's-open',
          label: 'Disputed payment',
          text: money(f(p, 'amount')) + ' frozen for "' + title + '"',
          who: 'Resolve it in Disputes'
        }, base));
      }
    });

    (window.disputes || []).forEach(function (d) {
      if (lower(f(d, 'status')) !== 'open') return;
      var hasPay = payments.some(function (p) {
        return String(f(p, 'task_id')) === String(f(d, 'task_id')) && lower(f(p, 'status')) === 'disputed';
      });
      if (hasPay) return; // already listed as a disputed payment
      var t = taskById(f(d, 'task_id'));
      items.push({
        kind: 'dispute', tone: 's-open', label: 'Open dispute',
        text: 'On "' + (t ? f(t, 'title') : 'a gig') + '"',
        who: f(d, 'reason') || '', when: f(d, 'created_at')
      });
    });

    apps.forEach(function (a) {
      if (lower(f(a, 'status')) !== 'accepted') return;
      var tid = String(f(a, 'task_id'));
      var paid = payments.some(function (p) { return String(f(p, 'task_id')) === tid; });
      if (paid) return;
      var since = f(a, 'updated_at') || f(a, 'created_at');
      if (now - ms(since) < 3600000) return; // give the poster an hour to pay
      var t = taskById(tid);
      items.push({
        kind: 'unpaid', tone: 's-progress', label: 'Accepted, not paid',
        text: '"' + (t ? f(t, 'title') : 'A gig') + '" has an accepted tasker but no payment',
        who: (t ? personName(f(t, 'posted_by')) : 'Poster') + ' has not paid for ' + personName(f(a, 'worker_id')),
        when: since
      });
    });

    (window.notificationQueue || []).forEach(function (n) {
      var err = String(f(n, 'error_message') || '');
      if (!err || err === 'expired_before_sender_existed') return;
      if (now - ms(f(n, 'created_at')) > 3 * 86400000) return;
      items.push({
        kind: 'email', tone: 's-progress', label: 'Email not delivered',
        text: emailTypeWords(f(n, 'type')) + ' to ' + (f(n, 'email') || 'a user'),
        who: emailErrorWords(err), when: f(n, 'created_at')
      });
    });

    (window.users || []).forEach(function (u) {
      if (lower(f(u, 'account_status')) !== 'pending_guardian') return;
      if (now - ms(f(u, 'created_at')) < 3 * 86400000) return;
      items.push({
        kind: 'guardian', tone: 's-posted', label: 'Waiting on a parent',
        text: (f(u, 'name') || 'A teen') + ' signed up but their parent has not approved',
        who: 'Guardian email: ' + (f(u, 'guardian_email') || 'none on file'), when: f(u, 'created_at')
      });
    });

    return items;
  }

  function emailTypeWords(type) {
    var map = {
      waitlist_invite: 'Invite', waitlist_reminder: 'Invite reminder',
      application_received: 'New application notice', application_accepted: 'Accepted notice',
      new_message: 'New message notice', task_completed: 'Gig complete notice',
      guardian_consent: 'Parent approval request', counter_offer_received: 'Counter-offer notice'
    };
    return map[String(type || '')] || 'Email';
  }
  function emailErrorWords(err) {
    if (/resend_not_configured/.test(err)) return 'The email service key is missing on the server';
    if (/missing|not_found|requires_email/.test(err)) return 'No email address on file for that person';
    return 'The email service refused it: ' + err.slice(0, 120);
  }

  function renderAttention() {
    var host = document.getElementById('opsAttention');
    if (!host) return;
    var items = attentionItems();
    var count = document.getElementById('opsAttentionCount');
    if (count) count.textContent = items.length ? '· ' + items.length : '· all clear';
    var badge = document.getElementById('opsBadge');
    if (badge) { badge.textContent = String(items.length); badge.style.display = items.length ? '' : 'none'; }
    if (!items.length) {
      host.innerHTML = '<div class="ops-empty">Nothing needs you right now. Stuck payments, open disputes, unpaid accepted gigs and failed emails show up here.</div>';
      return;
    }
    host.innerHTML = items.map(function (it, i) {
      var actions = '';
      if (it.kind === 'stuck') {
        actions = '<button type="button" class="act-btn btn-view" data-ops-release="' + i + '">Pay the tasker</button>' +
          '<button type="button" class="act-btn btn-warn" data-ops-refund="' + i + '">Refund the poster</button>';
      } else if (it.kind === 'dispute') {
        actions = '<button type="button" class="act-btn btn-view" data-ops-goto="disputes">Open Disputes</button>';
      }
      return '<div class="ops-row">' +
        '<div class="ops-row-main">' +
          '<span class="status-pill ' + it.tone + '">' + esc(it.label) + '</span>' +
          '<div class="ops-row-text">' + esc(it.text) + '</div>' +
          '<div class="ops-row-sub">' + esc(it.who || '') + (it.when ? ' · ' + esc(ago(it.when)) : '') + '</div>' +
        '</div>' +
        '<div class="act-btns">' + actions + '</div>' +
      '</div>';
    }).join('');

    host.querySelectorAll('[data-ops-release]').forEach(function (b) {
      b.onclick = function () { moneyAction(items[Number(b.getAttribute('data-ops-release'))], 'release', b); };
    });
    host.querySelectorAll('[data-ops-refund]').forEach(function (b) {
      b.onclick = function () { moneyAction(items[Number(b.getAttribute('data-ops-refund'))], 'refund', b); };
    });
    host.querySelectorAll('[data-ops-goto]').forEach(function (b) {
      b.onclick = function () { if (typeof window.showSection === 'function') window.showSection(b.getAttribute('data-ops-goto'), null); };
    });
  }

  /* ── 4. One-tap fixes ───────────────────────────────────────────────── */
  async function moneyAction(item, kind, btn) {
    if (!item || !item.taskId) return;
    var cfg = window.QG_CONFIG || {};
    var base = 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/';
    var url = kind === 'release'
      ? (cfg.releasePayoutUrl || base + 'release-payout')
      : (cfg.refundPaymentUrl || base + 'refund-payment');
    var question = kind === 'release'
      ? 'Pay the tasker now?\n\n' + item.text + '\n\nThis sends the tasker their share and cannot be undone.'
      : 'Refund the poster now?\n\n' + item.text + '\n\nThis returns the full amount to the poster and cannot be undone.';
    if (!window.confirm(question)) return;
    if (typeof window.callVerifiedFunction !== 'function') { toast('Admin connection is not ready. Reload the page.', 'red'); return; }
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Working…';
    var res = await window.callVerifiedFunction(url, {
      task_id: item.taskId, poster_id: item.posterId, worker_id: item.workerId
    });
    btn.disabled = false;
    btn.textContent = label;
    if (res && (res.ok || res.success) && !res.skipped) {
      toast(kind === 'release' ? 'Tasker paid' : 'Poster refunded', 'green');
      if (typeof window.loadData === 'function') { await window.loadData(); }
      renderAll();
    } else {
      var why = (res && (res.message || res.reason || res.error)) || 'unknown error';
      toast('Could not ' + (kind === 'release' ? 'pay the tasker' : 'refund') + ': ' + why, 'red');
    }
  }

  /* ── 1b. Invite a tester ────────────────────────────────────────────── */
  async function sendInvite() {
    var emailEl = document.getElementById('opsInviteEmail');
    var nameEl = document.getElementById('opsInviteName');
    var btn = document.getElementById('opsInviteBtn');
    var email = String(emailEl.value || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('Enter a valid email address', 'red'); emailEl.focus(); return; }
    if (typeof window.callAdminConsole !== 'function') { toast('Admin connection is not ready. Reload the page.', 'red'); return; }
    btn.disabled = true;
    btn.textContent = 'Sending…';
    var res = await window.callAdminConsole('waitlist_invite', { email: email, name: String(nameEl.value || '').trim() });
    btn.disabled = false;
    btn.textContent = 'Send invite';
    if (!res || !res.success) {
      toast('Could not invite: ' + ((res && res.error) || 'unknown error'), 'red');
      return;
    }
    var list = window.waitlist || (window.waitlist = []);
    var idx = list.findIndex(function (w) { return lower(f(w, 'email')) === email; });
    if (res.row) { if (idx >= 0) list[idx] = res.row; else list.unshift(res.row); }
    emailEl.value = '';
    nameEl.value = '';
    toast(res.email_queued === false
      ? email + ' can sign up now, but the invite email did not queue'
      : 'Invite sent to ' + email, res.email_queued === false ? 'amber' : 'green');
    renderTesters();
  }

  /* ── 3. Testers ─────────────────────────────────────────────────────── */
  var STAGES = ['Invited', 'Signed up', 'Email confirmed', 'Payouts ready', 'First gig', 'Finished a gig'];

  function testerRows() {
    var users = window.users || [];
    var tasks = window.tasks || [];
    var apps = window.applications || [];
    return (window.waitlist || []).filter(function (w) { return f(w, 'invited_at'); }).map(function (w) {
      var email = lower(f(w, 'email'));
      var u = users.find(function (x) { return lower(f(x, 'email')) === email; }) || null;
      var uid = u ? String(f(u, 'firebase_uid')) : '';
      var posted = uid ? tasks.filter(function (t) { return String(f(t, 'posted_by')) === uid; }) : [];
      var applied = uid ? apps.filter(function (a) { return String(f(a, 'worker_id')) === uid; }) : [];
      var finished = posted.some(function (t) { return lower(f(t, 'status')) === 'completed'; }) ||
        applied.some(function (a) { return lower(f(a, 'status')) === 'completed'; });
      var truthy = function (v) { return v === true || v === 'true' || v === 1; };
      var stage = 0;
      if (u) stage = 1;
      if (u && truthy(f(u, 'email_verified'))) stage = 2;
      if (u && stage === 2 && (truthy(f(u, 'stripe_payouts_enabled')) || truthy(f(u, 'poster_verified')))) stage = 3;
      if (u && (posted.length || applied.length)) stage = Math.max(stage, 4);
      if (finished) stage = 5;
      return {
        email: f(w, 'email'), name: (u && f(u, 'name')) || f(w, 'name') || '',
        invited: f(w, 'invited_at'), stage: stage,
        detail: u ? (posted.length + ' posted, ' + applied.length + ' applied') : 'Has not signed up yet'
      };
    }).sort(function (a, b) { return ms(b.invited) - ms(a.invited); });
  }

  function renderTesters() {
    var host = document.getElementById('opsTesters');
    if (!host) return;
    var rows = testerRows();
    var count = document.getElementById('opsTesterCount');
    if (count) count.textContent = '· ' + rows.length;
    if (!rows.length) {
      host.innerHTML = '<div class="ops-empty">No one invited yet. Invite your first tester with the box on this page.</div>';
      return;
    }
    host.innerHTML = rows.map(function (r) {
      var dots = STAGES.map(function (label, i) {
        return '<span class="ops-step' + (i <= r.stage ? ' is-on' : '') + '" title="' + esc(label) + '"></span>';
      }).join('');
      return '<div class="ops-row">' +
        '<div class="ops-row-main">' +
          '<div class="ops-row-text">' + esc(r.name || r.email) + '</div>' +
          '<div class="ops-row-sub">' + esc(r.name ? r.email + ' · ' : '') + 'invited ' + esc(ago(r.invited)) + ' · ' + esc(r.detail) + '</div>' +
        '</div>' +
        '<div class="ops-progress"><div class="ops-steps">' + dots + '</div>' +
          '<span class="ops-stage">' + esc(STAGES[r.stage]) + '</span></div>' +
      '</div>';
    }).join('');
  }

  /* ── 5. Error feed ──────────────────────────────────────────────────── */
  var FN_WORDS = {
    'register-account': 'Sign-up', 'email-code': 'Email confirmation', 'role-verification': 'Verification',
    'role-access': 'Switching role', 'create-connect-link': 'Payout setup', 'sync-connect-status': 'Payout status check',
    'post-task': 'Posting a gig', 'submit-application': 'Applying to a gig', 'my-applications': 'Loading applications',
    'create-checkout': 'Paying for a gig', 'create-escrow-intent': 'Paying for a gig', 'confirm-checkout': 'Confirming payment',
    'sync-payment': 'Payment check', 'complete-task': 'Marking a gig complete', 'release-payout': 'Paying the tasker',
    'refund-payment': 'Refund', 'request-payout': 'Cash-out request', 'secure-messaging': 'Messages',
    'raise-dispute': 'Opening a dispute', 'task-evidence': 'Gig photos', 'guardian-consent': 'Parent approval',
    'teen-safety': 'Teen safety check', 'geocode-canada': 'Address lookup', 'admin-console': 'Admin console',
    'page-error': 'Screen error'
  };
  function errorWords(e) {
    var code = String(f(e, 'code') || '');
    var status = Number(f(e, 'status')) || 0;
    var map = {
      firebase_auth_required: 'Their sign-in had expired',
      unauthorized: 'Their sign-in was rejected',
      forbidden: 'They are not allowed to do that',
      not_authorized: 'They are not allowed to do that',
      signups_closed: 'Tried to sign up without an invite',
      account_already_registered: 'Tried to sign up twice',
      worker_payout_setup_required: 'Tried to apply before setting up payouts',
      guardian_payout_setup_required: 'Teen applied before a parent set up payouts',
      minor_requires_guardian_payout: 'Teen tried to set up their own payouts',
      stripe_account_create_failed: 'Stripe could not create a payout account',
      stripe_account_link_failed: 'Stripe could not open payout setup',
      user_not_found: 'Signed in but never finished their profile',
      live_keys_blocked: 'Blocked because Stripe is in test mode',
      completion_is_server_managed: 'Gig could not be completed from the app'
    };
    if (map[code]) return map[code];
    if (f(e, 'fn') === 'page-error') return 'A screen broke: ' + (f(e, 'message') || 'code error');
    if (code === 'timeout') return 'The server took too long to answer';
    if (status === 0) return 'Could not reach the server (their connection, or an outage)';
    if (status === 429) return 'They were doing it too fast and got rate-limited';
    if (status >= 500) return 'Server error' + (code ? ' (' + code + ')' : '');
    return f(e, 'message') || code || ('Refused with code ' + status);
  }

  /* What to do about each kind of failure, in plain words. */
  function errorFix(e) {
    var code = String(f(e, 'code') || '');
    var fn = String(f(e, 'fn') || '');
    var status = Number(f(e, 'status')) || 0;
    var fixes = {
      timeout: 'The server took over 30 seconds. If it repeats for the same action, that function is slow or down: check its logs in Supabase.',
      network_error: 'Usually the person\'s own connection. Worry only if several people get it in the same few minutes.',
      firebase_auth_required: 'Nothing to fix. They need to sign in again.',
      unauthorized: 'Nothing to fix unless it repeats for one person. Ask them to sign out and back in.',
      not_authorized: 'Normal: someone tapped a button that is not theirs to use.',
      forbidden: 'Normal: someone without access tried an admin or restricted page.',
      signups_closed: 'Someone without an invite tried to sign up. Invite them above if you want them in.',
      worker_payout_setup_required: 'Normal: they need to finish payout setup in Profile first.',
      guardian_payout_setup_required: 'The teen\'s parent has not finished payout setup. Resend the parent email from Users.',
      stripe_account_create_failed: 'Stripe refused the payout account. Open Stripe, Connect, and look at the latest failed request.',
      stripe_account_link_failed: 'Stripe could not open payout setup. Check the Stripe dashboard for an outage or a restricted account.',
      user_not_found: 'They signed in but their profile row is missing. Ask them to sign up again with the same email.',
      task_not_found: 'The gig was deleted or the link is old. Nothing to fix unless it is a live gig.',
      task_not_open: 'Normal: the gig was already taken or closed.',
      already_applied: 'Normal: they had already applied.',
      accepted_task_relationship_required: 'Normal: chat opens only after the poster accepts and pays.',
      service_role_missing: 'A server secret is missing. In Supabase, Edge Functions, Secrets, check SUPABASE_SERVICE_ROLE_KEY.',
      live_keys_blocked: 'Expected while Stripe is in test mode.'
    };
    if (fixes[code]) return fixes[code];
    if (fn === 'page-error') return 'A screen hit a code error. Copy the message and page name below to Claude or Cursor to get it fixed.';
    if (status === 0) return fixes.network_error;
    if (status === 429) return 'Rate limit. Fine unless a real person is being blocked from normal use.';
    if (status >= 500) return 'A server function crashed. Open Supabase, Edge Functions, ' + (fn || 'the function') + ', Logs, and copy the red line to Claude or Cursor.';
    if (status === 401 || status === 403) return 'A permission refusal. Normal unless the same person keeps hitting it.';
    return 'Refused request. Usually a normal rule doing its job; look closer only if it repeats.';
  }
  function isSerious(e) {
    var status = Number(f(e, 'status')) || 0;
    var code = String(f(e, 'code') || '');
    return status >= 500 || code === 'timeout' || f(e, 'fn') === 'page-error' ||
      /^stripe_|service_role_missing/.test(code);
  }

  var errWindowH = 24;
  var errOnlySerious = false;
  function allErrors() {
    var h = window.adminHealth;
    return (h && Array.isArray(h.errors) && h.errors.length) ? h.errors : (window.errorLog || []);
  }

  function renderErrors() {
    var host = document.getElementById('opsErrors');
    if (!host) return;
    var cutoff = Date.now() - errWindowH * 3600000;
    var rows = allErrors().filter(function (e) {
      return ms(f(e, 'created_at')) >= cutoff && (!errOnlySerious || isSerious(e));
    });
    var groups = {};
    rows.forEach(function (e) {
      var key = f(e, 'fn') + '|' + f(e, 'code') + '|' + f(e, 'status');
      var g = groups[key] || (groups[key] = { sample: e, n: 0, last: 0, people: {}, rows: [] });
      g.n++;
      g.rows.push(e);
      g.last = Math.max(g.last, ms(f(e, 'created_at')));
      if (f(e, 'user_id')) g.people[f(e, 'user_id')] = true;
    });
    var list = Object.keys(groups).map(function (k) { return groups[k]; })
      .sort(function (a, b) { return (isSerious(b.sample) - isSerious(a.sample)) || (b.last - a.last); });
    var label = errWindowH === 24 ? '24 h' : '7 days';
    var count = document.getElementById('opsErrorCount');
    if (count) count.textContent = rows.length ? '· ' + rows.length + ' in ' + label : '· none in ' + label;
    document.querySelectorAll('[data-err-window]').forEach(function (b) {
      b.classList.toggle('is-on', Number(b.getAttribute('data-err-window')) === errWindowH);
    });
    var ser = document.getElementById('opsErrSerious');
    if (ser) ser.classList.toggle('is-on', errOnlySerious);
    if (!list.length) {
      host.innerHTML = '<div class="ops-empty">No ' + (errOnlySerious ? 'serious ' : '') + 'failed actions in the last ' + label + '.</div>';
      return;
    }
    host.innerHTML = list.map(function (g) {
      var e = g.sample;
      var people = Object.keys(g.people).length;
      var serious = isSerious(e);
      var detail = g.rows.slice(0, 12).map(function (r) {
        var who = f(r, 'user_name') || (f(r, 'user_id') ? 'user ' + String(f(r, 'user_id')).slice(0, 6) : 'not signed in');
        var when = new Date(ms(f(r, 'created_at'))).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        return '<div class="ops-err-line">' + esc(when) + ' · ' + esc(who) + ' · ' + esc(f(r, 'page') || '') +
          (f(r, 'message') ? '<br><span class="ops-err-msg">' + esc(f(r, 'message')) + '</span>' : '') + '</div>';
      }).join('') + (g.rows.length > 12 ? '<div class="ops-err-line">and ' + (g.rows.length - 12) + ' more</div>' : '');
      return '<details class="ops-err">' +
        '<summary class="ops-row"><div class="ops-row-main">' +
          '<span class="status-pill ' + (serious ? 's-open' : 's-posted') + '">' + esc(FN_WORDS[f(e, 'fn')] || f(e, 'fn')) + '</span>' +
          '<div class="ops-row-text">' + esc(errorWords(e)) + '</div>' +
          '<div class="ops-row-sub">' + g.n + (g.n === 1 ? ' time' : ' times') +
            (people ? ' · ' + people + (people === 1 ? ' person' : ' people') : '') +
            ' · last ' + esc(ago(new Date(g.last).toISOString())) +
            ' · ' + (serious ? 'needs a look' : 'usually normal') + '</div>' +
        '</div><span class="ops-err-more">Details</span></summary>' +
        '<div class="ops-err-body"><div class="ops-err-fix"><b>What to do:</b> ' + esc(errorFix(e)) + '</div>' +
          '<div class="ops-err-code">' + esc(f(e, 'fn')) + ' · ' + esc(f(e, 'code') || 'no code') + ' · HTTP ' + esc(String(f(e, 'status'))) + '</div>' +
          detail + '</div>' +
      '</details>';
    }).join('');
  }

  /* ── 6. System health ───────────────────────────────────────────────── */
  var JOB_WORDS = {
    'swiftgigs-send-queued-emails': 'Email sender',
    'swiftgigs-admin-alert-check': 'Alert emails to you',
    'quickgigs-daily-account-graduation': 'Teen turns 18 job'
  };
  async function loadHealth() {
    try {
      var user = window._currentUser;
      if (!user || typeof user.getIdToken !== 'function') return;
      var token = await user.getIdToken(false);
      var base = window.SUPABASE_URL || 'https://nuyfqsxstsrbloztzgau.supabase.co';
      var res = await fetch(base + '/rest/v1/rpc/qg_admin_health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': window.SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + token },
        body: '{}'
      });
      if (!res.ok) { window.adminHealthError = 'HTTP ' + res.status; return; }
      window.adminHealth = await res.json();
      window.adminHealthError = '';
    } catch (e) {
      window.adminHealthError = String((e && e.message) || e);
    }
  }
  function healthChecks() {
    var h = window.adminHealth;
    if (!h) return null;
    var out = [];
    var errs = (h.errors || []).filter(function (e) { return ms(f(e, 'created_at')) >= Date.now() - 3600000; });
    var seriousNow = errs.filter(isSerious).length;
    out.push({ ok: seriousNow === 0, name: 'App errors',
      text: seriousNow ? seriousNow + ' serious in the last hour. See Failed actions below.' : 'No serious errors in the last hour' + (errs.length ? ' (' + errs.length + ' minor)' : '') });
    (h.jobs || []).forEach(function (j) {
      var name = JOB_WORDS[j.name] || j.name;
      var never = !j.last_run;
      var failed = j.last_status === 'failed';
      var stale = j.name === 'swiftgigs-send-queued-emails' && j.last_run && (Date.now() - ms(j.last_run)) > 5 * 60000;
      var ok = j.active && !failed && !stale;
      var text = !j.active ? 'Switched off'
        : never ? 'Has not run yet'
        : failed ? 'Last run failed ' + ago(j.last_run) + (j.name === 'quickgigs-daily-account-graduation' ? '. Its web address and secret were never saved. Only matters once teen accounts turn 18.' : '. ' + String(j.last_message || '').slice(0, 120))
        : stale ? 'Has not run for ' + ago(j.last_run).replace(' ago', '') + '. Emails are not going out.'
        : 'Working, last ran ' + ago(j.last_run);
      out.push({ ok: ok, name: name, text: text });
    });
    var em = h.emails || {};
    var waitingLong = em.waiting > 0 && em.oldest_waiting && (Date.now() - ms(em.oldest_waiting)) > 10 * 60000;
    out.push({ ok: !waitingLong && !em.failed_3d, name: 'Emails',
      text: (em.failed_3d ? em.failed_3d + ' failed in 3 days. ' : '') +
        (waitingLong ? em.waiting + ' stuck waiting since ' + ago(em.oldest_waiting) + '. ' : '') +
        (em.sent_24h || 0) + ' sent in 24 h' });
    var mo = h.money || {};
    out.push({ ok: !mo.unpaid_after_complete, name: 'Payments',
      text: mo.unpaid_after_complete
        ? mo.unpaid_after_complete + ' finished gig' + (mo.unpaid_after_complete === 1 ? '' : 's') + ' where the tasker is not paid yet. Use Pay the tasker above.'
        : (mo.held || 0) + ' held in escrow, none overdue' });
    var ac = h.activity || {};
    out.push({ ok: true, name: 'Last 24 hours',
      text: (ac.signups_24h || 0) + ' sign-ups · ' + (ac.gigs_24h || 0) + ' gigs posted · ' + (ac.applications_24h || 0) + ' applications' });
    return out;
  }
  function renderHealth() {
    var host = document.getElementById('opsHealth');
    if (!host) return;
    var checks = healthChecks();
    var count = document.getElementById('opsHealthCount');
    if (!checks) {
      host.innerHTML = '<div class="ops-empty">' + (window.adminHealthError
        ? 'Could not load the health check (' + esc(window.adminHealthError) + '). Tap Refresh.'
        : 'Checking…') + '</div>';
      if (count) count.textContent = '';
      return;
    }
    var bad = checks.filter(function (c) { return !c.ok; }).length;
    if (count) count.textContent = bad ? '· ' + bad + ' to look at' : '· all working';
    host.innerHTML = checks.map(function (c) {
      return '<div class="ops-row"><div class="ops-row-main">' +
        '<div class="ops-row-text"><span class="ops-dot ' + (c.ok ? 'is-ok' : 'is-bad') + '"></span>' + esc(c.name) + '</div>' +
        '<div class="ops-row-sub">' + esc(c.text) + '</div></div></div>';
    }).join('') + '<div class="ops-empty">Checked ' + esc(ago(window.adminHealth.checked_at)) +
      '. You also get an email when errors spike, emails stop sending, or a tasker is left unpaid.</div>';
    // Health problems count toward the nav badge too.
    var badge = document.getElementById('opsBadge');
    if (badge) {
      var total = attentionItems().length + bad;
      badge.textContent = String(total);
      badge.style.display = total ? '' : 'none';
    }
  }

  function renderAll() {
    renderAttention();
    renderTesters();
    renderErrors();
    renderHealth();
  }
  var healthLoading = null;
  function refreshHealth() {
    if (healthLoading) return healthLoading;
    healthLoading = loadHealth().then(function () { healthLoading = null; renderErrors(); renderHealth(); });
    return healthLoading;
  }
  window.QG_renderOps = renderAll;

  /* ── Wiring ─────────────────────────────────────────────────────────── */
  function wire() {
    var btn = document.getElementById('opsInviteBtn');
    if (btn) btn.onclick = sendInvite;
    var emailEl = document.getElementById('opsInviteEmail');
    if (emailEl) emailEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') sendInvite(); });
    var refresh = document.getElementById('opsRefresh');
    if (refresh) refresh.onclick = async function () {
      refresh.disabled = true;
      if (typeof window.loadData === 'function') await window.loadData();
      await refreshHealth();
      refresh.disabled = false;
      renderAll();
    };
    document.addEventListener('click', function (e) {
      var w = e.target.closest('[data-err-window]');
      if (w) { errWindowH = Number(w.getAttribute('data-err-window')) || 24; renderErrors(); return; }
      if (e.target.closest('#opsErrSerious')) { errOnlySerious = !errOnlySerious; renderErrors(); }
    });
    // Keep the health check fresh while the console is open.
    setInterval(function () { if (!document.hidden) refreshHealth(); }, 120000);

    var prev = window.showSection;
    window.showSection = function (section, navBtn) {
      if (typeof prev === 'function') prev(section, navBtn);
      if (section === 'ops') {
        var title = document.getElementById('pageTitle');
        if (title) title.textContent = 'Launch control';
        renderAll();
      }
    };
    // The badge should be right even before the section is opened.
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if ((window.users && window.users.length) || tries > 40) {
        clearInterval(timer);
        renderAll();
        refreshHealth();
      }
    }, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
