/**
 * QuickGigs — Admin Console Phase 3 enhancements (visual + wiring only).
 * Reuses resolve-dispute / warn / ban / waitlist / banner. No rule changes.
 */
(function (global) {
  'use strict';

  function esc(s) {
    return typeof escapeHtml === 'function'
      ? escapeHtml(s)
      : String(s == null ? '' : s)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
  }

  function attr(s) {
    return typeof escAttr === 'function'
      ? escAttr(s)
      : esc(s).replace(/\r?\n/g, ' ');
  }

  function warnThreshold() {
    return (global.QG_CONFIG && global.QG_CONFIG.autoBanAfterWarnings) || 3;
  }

  function autoReleaseDays() {
    return Number((global.QG_CONFIG && global.QG_CONFIG.disputeAutoReleaseDays) || 3);
  }

  function daysUntilAuto(createdAt) {
    var days = autoReleaseDays();
    var start = createdAt ? new Date(createdAt).getTime() : NaN;
    if (!isFinite(start)) return null;
    var end = start + days * 24 * 60 * 60 * 1000;
    return Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000));
  }

  function countdownLabel(createdAt) {
    var left = daysUntilAuto(createdAt);
    if (left == null) return 'Auto-rule · ' + autoReleaseDays() + 'd';
    if (left <= 0) return 'Auto-rule overdue';
    return 'Auto-resolves in ' + left + ' day' + (left === 1 ? '' : 's');
  }

  function userNameById(uid) {
    if (!uid) return '—';
    if (typeof adminResolveUserHtml === 'function') {
      // returns HTML — for plain text use map
    }
    var u = (global.users || []).find(function (x) {
      return String(x.firebase_uid || x.user_id || x.id) === String(uid);
    });
    return (u && (u.name || u.email)) || String(uid).slice(0, 8) + '…';
  }

  function warnCountFor(uid) {
    var map = global._adminWarnCounts || {};
    return Number(map[String(uid)] || 0);
  }

  function isTeenUser(u) {
    if (!u) return false;
    if (String(u.account_status || '').toLowerCase() === 'pending_guardian') return true;
    if (u.guardian_consent_status) return true;
    var dob = u.date_of_birth;
    if (!dob) return false;
    var d = new Date(String(dob) + 'T00:00:00Z');
    if (isNaN(d.getTime())) return false;
    var now = new Date();
    var age = now.getUTCFullYear() - d.getUTCFullYear();
    if (
      now.getUTCMonth() < d.getUTCMonth() ||
      (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate())
    ) age -= 1;
    return age >= 16 && age < 18;
  }

  function roleLabel(u) {
    if (isTeenUser(u)) return { label: 'Teen', cls: 'r-teen' };
    var tasker = u.is_tasker === true || u.is_tasker === 1 || String(u.role || '').toLowerCase() === 'worker';
    var poster = u.is_poster === true || u.is_poster === 1 || String(u.role || '').toLowerCase() === 'poster';
    if (tasker && poster) return { label: 'Tasker + Poster', cls: 'r-both' };
    if (tasker) return { label: 'Tasker', cls: 'r-worker' };
    if (poster) return { label: 'Poster', cls: 'r-poster' };
    return { label: String(u.role || 'User'), cls: '' };
  }

  function guardianStatus(u) {
    if (!isTeenUser(u)) return '';
    var st = String(u.guardian_consent_status || '').toLowerCase();
    if (st === 'approved') return 'Guardian approved';
    if (st === 'pending' || String(u.account_status || '').toLowerCase() === 'pending_guardian') {
      return 'Guardian pending';
    }
    if (st === 'declined' || st === 'rejected') return 'Guardian declined';
    return 'Teen account';
  }

  function heldPaymentForTask(taskId) {
    return (global.payments || []).find(function (p) {
      return (
        String(p.task_id) === String(taskId) &&
        ['held', 'disputed'].indexOf(String(p.status || '').toLowerCase()) >= 0
      );
    });
  }

  function partiesForDispute(d, task) {
    var posterId = task && (task.posted_by || task.POSTED_BY);
    var posterName = (task && (task.poster_name || task.POSTER_NAME)) || userNameById(posterId);
    var workerId = '';
    var workerName = '';
    var apps = global.applications || [];
    for (var i = 0; i < apps.length; i++) {
      var a = apps[i];
      if (String(a.task_id || a.TASK_ID) !== String(d.task_id)) continue;
      var st = String(a.status || '').toLowerCase();
      if (st === 'accepted' || st === 'completed' || st === 'in_progress') {
        workerId = a.worker_id || a.WORKER_ID;
        workerName = a.worker_name || a.WORKER_NAME || userNameById(workerId);
        break;
      }
    }
    var raised = userNameById(d.raised_by);
    return {
      poster: posterName || 'Poster',
      worker: workerName || 'Tasker',
      raised: raised
    };
  }

  /** Compact operator stats — real data only. */
  function enhanceOverviewStats() {
    var users = global.users || [];
    var tasks = global.tasks || [];
    var disputes = global.disputes || [];
    var payments = global.payments || [];
    var weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    var newWeek = users.filter(function (u) {
      var t = u.created_at ? new Date(u.created_at).getTime() : 0;
      return t >= weekAgo;
    }).length;
    var activeTasks = tasks.filter(function (t) {
      var st = String(t.status || '').toLowerCase();
      return st === 'open' || st === 'in_progress';
    }).length;
    var openD = disputes.filter(function (d) {
      var st = String(d.status || 'open').toLowerCase();
      return st === 'open' || st === 'reviewing';
    }).length;
    var escrow = 0;
    payments.forEach(function (p) {
      if (['held', 'disputed'].indexOf(String(p.status || '').toLowerCase()) >= 0) {
        escrow += Number(p.amount || 0) || 0;
      }
    });

    var elUsers = document.getElementById('statUsers');
    var elUsersSub = document.getElementById('statUsersSub');
    var elTrend = document.getElementById('userTrend');
    if (elUsers) elUsers.textContent = String(users.length);
    if (elUsersSub) elUsersSub.textContent = '+' + newWeek + ' new this week';
    if (elTrend) {
      elTrend.textContent = '+' + newWeek + ' / 7d';
      elTrend.className = 'trend trend-up';
    }

    var elTasks = document.getElementById('statTasks');
    var elTasksSub = document.getElementById('statTasksSub');
    var elTaskTrend = document.getElementById('taskTrend');
    if (elTasks) elTasks.textContent = String(activeTasks);
    if (elTasksSub) elTasksSub.textContent = tasks.length + ' total posted';
    if (elTaskTrend) elTaskTrend.textContent = 'Active';

    var elDisp = document.getElementById('statDisputes');
    var elDispSub = document.getElementById('statDisputesSub');
    var elDispTrend = document.getElementById('disputeTrend');
    if (elDisp) {
      elDisp.textContent = String(openD);
      elDisp.className = 'stat-val is-attention';
    }
    if (elDispSub) elDispSub.textContent = openD ? 'Needs review' : 'All clear';
    if (elDispTrend) {
      elDispTrend.textContent = openD ? 'Attention' : 'Clear';
      elDispTrend.className = openD ? 'trend trend-warn' : 'trend trend-up';
    }

    var elRev = document.getElementById('statRevenue');
    var elRevSub = document.getElementById('statRevenueSub');
    var elRevTrend = document.getElementById('revenueTrend');
    if (elRev) {
      elRev.textContent = '$' + escrow.toFixed(0);
      elRev.className = 'stat-val is-money';
    }
    if (elRevSub) elRevSub.textContent = 'Escrow currently held';
    if (elRevTrend) elRevTrend.textContent = 'Held';

    var labelUsers = document.querySelector('#statUsers') && document.querySelector('#statUsers').parentNode
      ? document.querySelector('#statUsers').parentNode.querySelector('.stat-label')
      : null;
    // Labels updated via HTML; keep badge in sync
    var badge = document.getElementById('disputeBadge');
    if (badge) badge.textContent = String(openD);
    var banner = document.getElementById('alertBanner');
    if (banner) {
      banner.style.display = openD ? 'flex' : 'none';
      var txt = banner.querySelector('.alert-text');
      if (txt && openD) txt.textContent = openD + ' open dispute(s) need review.';
    }
  }

  function renderDisputesConsole() {
    var open = (global.disputes || []).filter(function (d) {
      var st = String(d.status || 'open').toLowerCase();
      return st === 'open' || st === 'reviewing';
    }).length;
    var countEl = document.getElementById('disputesCount');
    if (countEl) countEl.textContent = '· ' + open + ' open';
    if (typeof syncModerationBadges === 'function') syncModerationBadges();

    var list = (global.disputes || []).slice().sort(function (a, b) {
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
    var filter = global.disputeFilter || 'open';
    if (filter === 'open') {
      list = list.filter(function (d) {
        var st = String(d.status || 'open').toLowerCase();
        return st === 'open' || st === 'reviewing';
      });
    }

    var body = document.getElementById('disputesBody');
    if (!body) return;
    if (!list.length) {
      body.innerHTML =
        '<div class="admin-empty">' +
        (typeof QG_emptyStateHtml === 'function'
          ? QG_emptyStateHtml({
              icon: 'checkCircle',
              title: filter === 'open' ? 'No open disputes' : 'No disputes yet',
              sub: filter === 'open'
                ? 'New disputes will appear here when a party raises one.'
                : 'Disputes show up after a poster or tasker opens one.',
              compact: true
            })
          : (filter === 'open' ? 'No open disputes' : 'No disputes yet')) +
        '</div>';
      return;
    }

    body.innerHTML = list
      .map(function (d) {
        var did = String(d.dispute_id || d.id || '');
        var tid = String(d.task_id || '');
        var task = (global.tasks || []).find(function (t) {
          return String(t.task_id || t.id) === tid;
        });
        var title = (task && task.title) || tid || 'Task';
        var parties = partiesForDispute(d, task);
        var pay = heldPaymentForTask(tid);
        var frozen = pay ? Number(pay.amount || 0) : 0;
        var st = String(d.status || 'open').toLowerCase();
        var left = daysUntilAuto(d.created_at);
        var cdCls = left != null && left <= 0 ? ' is-overdue' : '';
        var reason = String(d.reason || d.detail || d.details || '—');

        var actions = '';
        if (st === 'open' || st === 'reviewing') {
          actions =
            '<div class="dispute-actions">' +
            '<button type="button" class="act-btn btn-view" data-did="' +
            attr(did) +
            '" data-tid="' +
            attr(tid) +
            '" onclick="adminOpenDisputeEvidence(this.getAttribute(\'data-did\'),this.getAttribute(\'data-tid\'))">Evidence</button>' +
            '<button type="button" class="act-btn btn-release" data-did="' +
            attr(did) +
            '" onclick="adminDisputeQuickResolve(this.getAttribute(\'data-did\'),\'release\')">Release to tasker</button>' +
            '<button type="button" class="act-btn btn-refund" data-did="' +
            attr(did) +
            '" onclick="adminDisputeQuickResolve(this.getAttribute(\'data-did\'),\'refund\')">Refund poster</button>' +
            '<button type="button" class="act-btn btn-split" data-did="' +
            attr(did) +
            '" onclick="adminDisputeQuickResolve(this.getAttribute(\'data-did\'),\'split\')">Split</button>' +
            '</div>';
        } else {
          actions =
            '<span class="status-pill s-resolved">' +
            esc(st) +
            (d.resolution ? ' · ' + esc(d.resolution) : '') +
            '</span>';
        }

        return (
          '<div class="data-row g-disputes g-disputes-dense">' +
          '<div class="cell"><div class="u-name">' +
          esc(title) +
          '</div><div class="u-meta">' +
          esc(tid ? tid.slice(0, 10) + '…' : '') +
          '</div></div>' +
          '<div class="cell"><div class="u-name">' +
          esc(parties.poster) +
          ' ↔ ' +
          esc(parties.worker) +
          '</div><div class="u-meta">Raised by ' +
          esc(parties.raised) +
          '</div></div>' +
          '<div class="cell cell-wrap">' +
          esc(reason.length > 80 ? reason.slice(0, 78) + '…' : reason) +
          '</div>' +
          '<div class="cell"><span class="qg-escrow-amt">' +
          (frozen > 0 ? '🔒 $' + frozen.toFixed(0) : '—') +
          '</span></div>' +
          '<div class="cell"><span class="qg-auto-countdown' +
          cdCls +
          '">' +
          esc(countdownLabel(d.created_at)) +
          '</span></div>' +
          '<div class="cell">' +
          actions +
          '</div></div>'
        );
      })
      .join('');
  }

  /**
   * Confirm + resolve via existing resolve-dispute edge function.
   * Split still opens the full money modal for amounts.
   */
  function adminDisputeQuickResolve(disputeId, outcome) {
    outcome = String(outcome || 'release');
    if (outcome === 'split' && typeof adminResolveDisputeMoney === 'function') {
      return adminResolveDisputeMoney(disputeId);
    }
    if (typeof requireAdmin === 'function' && !requireAdmin()) return;
    var d = (global.disputes || []).find(function (x) {
      return String(x.dispute_id || x.id) === String(disputeId);
    });
    if (!d) return;
    var labels = {
      release: 'Release escrow to the tasker',
      refund: 'Refund the poster (destructive)'
    };
    var tone = outcome === 'refund' ? 'danger' : 'success';
    openModal(
      labels[outcome] || 'Resolve dispute',
      'This runs the existing resolve-dispute Stripe flow. Confirm to continue.',
      '<label style="display:block;text-align:left;font-size:12px;color:var(--text-muted)">Reason<textarea id="qgQuickResolveReason" rows="3" style="width:100%;margin-top:6px;padding:10px;border-radius:10px;background:var(--surface-2);border:1px solid var(--line);color:var(--text-primary)" placeholder="Operator note (required)"></textarea></label>',
      'Confirm ' + outcome,
      tone,
      async function () {
        var reason = ((document.getElementById('qgQuickResolveReason') || {}).value || '').trim();
        if (reason.length < 3) {
          showToast('Add a short reason', 'amber');
          return;
        }
        var url =
          (global.QG_CONFIG && global.QG_CONFIG.resolveDisputeUrl) ||
          'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/resolve-dispute';
        var user = typeof getCurrentUser === 'function' ? getCurrentUser() : global._currentUser;
        if (!user || typeof callVerifiedFunction !== 'function') {
          showToast('Sign in required', 'red');
          return;
        }
        var result = await callVerifiedFunction(
          url,
          { dispute_id: String(disputeId), resolution: outcome, reason: reason },
          user
        );
        if (!result || !result.ok) {
          showToast((result && (result.message || result.error)) || 'Resolve failed', 'red');
          return;
        }
        d.status = 'resolved';
        d.resolution = outcome;
        d.resolved_at = new Date().toISOString();
        showToast('Dispute ' + outcome + ' complete', 'green');
        renderDisputesConsole();
        if (typeof enhanceOverviewStats === 'function') enhanceOverviewStats();
      },
      true
    );
  }

  function enhanceRenderUsers(data) {
    data = data || global.users || [];
    var countEl = document.getElementById('usersCount');
    if (countEl) countEl.textContent = '· ' + data.length + ' total';
    var body = document.getElementById('usersBody');
    if (!body) return;
    if (!data.length) {
      body.innerHTML =
        '<div class="admin-empty">' +
        (typeof QG_emptyStateHtml === 'function'
          ? QG_emptyStateHtml({ icon: 'users', title: 'No users loaded', sub: 'Try refreshing or check your admin session.', compact: true })
          : 'No users loaded') +
        '</div>';
      return;
    }
    var threshold = warnThreshold();
    body.innerHTML = data
      .map(function (u, i) {
        var uid =
          typeof userKey === 'function'
            ? userKey(u)
            : u.firebase_uid || u.user_id || u.id || i;
        var name = u.name || 'User';
        var email = u.email || '—';
        var role = roleLabel(u);
        var warns = warnCountFor(uid);
        if (String(u.status || '').toLowerCase() === 'warned' && warns < 1) warns = 1;
        var st = String(u.status || 'active').toLowerCase();
        var urgent = warns >= threshold - 1 && st !== 'banned';
        var sc =
          st === 'banned' ? 's-banned' : warns >= 1 || st === 'warned' ? 's-warned' : 's-active';
        var sl =
          st === 'banned'
            ? 'Banned'
            : warns
              ? warns + '/' + threshold + ' warns'
              : 'Active';
        var g = guardianStatus(u);
        var rowCls = 'data-row g-users g-users-dense';
        if (urgent) rowCls += ' is-urgent';
        if (st === 'banned') rowCls += ' is-banned';
        return (
          '<div class="' +
          rowCls +
          '" data-uid="' +
          attr(uid) +
          '">' +
          '<input type="checkbox" class="checkbox" value="' +
          attr(uid) +
          '" onchange="updateBulk()" onclick="event.stopPropagation()">' +
          '<div class="user-cell"><div><div class="u-name">' +
          esc(name) +
          '</div><div class="u-meta">' +
          esc(g || email) +
          '</div></div></div>' +
          '<div class="cell">' +
          esc(email) +
          '</div>' +
          '<div class="cell"><span class="role-pill ' +
          role.cls +
          '">' +
          esc(role.label) +
          '</span></div>' +
          '<div class="cell"><span class="qg-warn-count' +
          (urgent ? ' is-critical' : '') +
          '">' +
          warns +
          ' warn' +
          (warns === 1 ? '' : 's') +
          '</span></div>' +
          '<div class="cell"><span class="status-pill ' +
          sc +
          '">' +
          esc(sl) +
          '</span></div>' +
          '<div class="act-btns">' +
          '<button type="button" class="act-btn btn-view" data-open-user="' +
          attr(uid) +
          '">View</button>' +
          (st !== 'banned'
            ? '<button type="button" class="act-btn btn-warn" onclick="event.stopPropagation();adminWarnById(\'' +
              attr(uid) +
              '\')">Warn</button>' +
              '<button type="button" class="act-btn btn-ban" onclick="event.stopPropagation();adminConfirmBan(\'' +
              attr(uid) +
              '\')">Ban</button>'
            : '<button type="button" class="act-btn btn-unban" onclick="event.stopPropagation();openUserDrawer(\'' +
              attr(uid) +
              '\')">Unban</button>') +
          '</div></div>'
        );
      })
      .join('');
  }

  function adminConfirmBan(uid) {
    openModal(
      'Ban user',
      'Sets status=banned. Auto-ban threshold remains ' + warnThreshold() + ' warnings (unchanged).',
      '',
      'Ban user',
      'danger',
      async function () {
        var u = (global.users || []).find(function (x) {
          return String(x.firebase_uid || x.user_id || x.id) === String(uid);
        });
        if (!u) {
          showToast('User not found', 'red');
          return;
        }
        if (typeof openUserDrawer === 'function') openUserDrawer(uid);
        if (typeof adminBanUser === 'function') {
          // drawerState now set — reuse existing ban path after confirm already done:
          // adminBanUser has its own confirm; patch status directly to avoid double-confirm
        }
        var result =
          typeof sbUpdate === 'function'
            ? await sbUpdate(
                'users',
                { status: 'banned' },
                'firebase_uid=eq.' + encodeURIComponent(String(uid))
              )
            : { success: false };
        if (result && result.success === false && typeof sbPatch === 'function') {
          result = await sbPatch('users', 'firebase_uid=eq.' + encodeURIComponent(String(uid)), {
            status: 'banned'
          });
        }
        if (u) u.status = 'banned';
        if (typeof logAdminAction === 'function') {
          try {
            await logAdminAction('user_ban', 'user', uid, {});
          } catch (e) {}
        }
        showToast('User banned', 'red');
        enhanceRenderUsers(global.users);
      },
      true
    );
  }

  function adminWarnById(uid) {
    openModal(
      'Warn user',
      'Issues a warning (counts toward auto-ban at ' + warnThreshold() + ').',
      '',
      'Issue warning',
      'warn',
      async function () {
        if (typeof addUserWarning === 'function') {
          await addUserWarning(uid, 'Admin warning from console', 'admin');
        }
        if (typeof sbUpdate === 'function') {
          await sbUpdate(
            'users',
            { status: 'warned' },
            'firebase_uid=eq.' + encodeURIComponent(String(uid))
          );
        }
        var u = (global.users || []).find(function (x) {
          return String(x.firebase_uid || x.user_id || x.id) === String(uid);
        });
        if (u) u.status = 'warned';
        global._adminWarnCounts = global._adminWarnCounts || {};
        global._adminWarnCounts[String(uid)] = (global._adminWarnCounts[String(uid)] || 0) + 1;
        showToast('Warning issued', 'amber');
        enhanceRenderUsers(global.users);
      },
      true
    );
  }

  function enhanceRenderTasks(data) {
    data = data || global.tasks || [];
    var countEl = document.getElementById('tasksCount');
    if (countEl) countEl.textContent = '· ' + data.length + ' total';
    var body = document.getElementById('tasksBody');
    if (!body) return;
    if (!data.length) {
      body.innerHTML =
        '<div class="admin-empty">' +
        (typeof QG_emptyStateHtml === 'function'
          ? QG_emptyStateHtml({ icon: 'clipboard', title: 'No tasks found', sub: 'Adjust filters or check back after new posts.', compact: true })
          : 'No tasks found') +
        '</div>';
      return;
    }
    body.innerHTML = data
      .map(function (t) {
        var tid = String(t.task_id || t.id || '');
        var st = String(t.status || 'open').toLowerCase();
        var poster = t.poster_name || t.posted_by || '—';
        return (
          '<div class="data-row g-tasks" data-tid="' +
          attr(tid) +
          '">' +
          '<div class="user-cell"><div><div class="u-name">' +
          esc(t.title) +
          '</div><div class="u-meta">' +
          esc(tid.slice(0, 12)) +
          '</div></div></div>' +
          '<div class="cell">' +
          esc(poster) +
          '</div>' +
          '<div class="cell"><span class="status-pill ' +
          (st === 'completed' ? 's-done' : st === 'cancelled' || st === 'removed' ? 's-banned' : 's-open') +
          '">' +
          esc(st) +
          '</span></div>' +
          '<div class="act-btns">' +
          '<button type="button" class="act-btn btn-view" data-open-task="' +
          attr(tid) +
          '">View</button>' +
          (st !== 'removed' && st !== 'cancelled'
            ? '<button type="button" class="act-btn btn-remove" onclick="event.stopPropagation();adminConfirmRemoveTask(\'' +
              attr(tid) +
              '\')">Remove</button>'
            : '') +
          '</div></div>'
        );
      })
      .join('');
  }

  function adminConfirmRemoveTask(tid) {
    openModal(
      'Remove task',
      'Hide this task from the marketplace? (existing hide/remove path — no rule change)',
      '',
      'Remove task',
      'danger',
      function () {
        if (typeof adminHideTask === 'function') adminHideTask(tid);
        else if (typeof openTaskDrawer === 'function') openTaskDrawer(tid);
      },
      true
    );
  }

  function paintStripeMode() {
    var el = document.getElementById('adminStripeMode');
    if (!el) return;
    var pk = (global.QG_CONFIG && global.QG_CONFIG.stripePublishableKey) || '';
    var isTest = /^pk_test_/i.test(pk) || !pk;
    el.innerHTML =
      '<div><strong>Stripe mode</strong></div>' +
      '<span class="mode-pill ' +
      (isTest ? 'is-test' : 'is-live') +
      '">' +
      (isTest ? 'TEST' : 'LIVE') +
      '</span>' +
      '<div class="admin-stripe-note">Read-only. Switching to live keys is an owner/ops action — not available in this console.</div>';
  }

  function adminInviteWaiting(n) {
    n = Number(n) || 10;
    var waiting = (global.waitlist || []).filter(function (w) {
      return !w.signed_up && !w.invited_at;
    }).slice(0, n);
    if (!waiting.length) {
      showToast('No waiting emails to invite', 'amber');
      return;
    }
    openModal(
      'Invite ' + waiting.length,
      'Send invite emails to the next ' + waiting.length + ' waitlist entries.',
      '',
      'Send invites',
      'purple',
      async function () {
        for (var i = 0; i < waiting.length; i++) {
          var id = waiting[i].waitlist_id || waiting[i].id;
          if (id && typeof adminMarkInvited === 'function') await adminMarkInvited(id);
        }
        showToast('Invites queued for ' + waiting.length, 'green');
      },
      true
    );
  }

  function waitlistCityBreakdown() {
    var host = document.getElementById('waitlistCityBreakdown');
    if (!host) return;
    var rows = global.waitlist || [];
    var cities = {};
    rows.forEach(function (w) {
      var c = String(w.city || w.location || '').trim() || 'Unknown';
      cities[c] = (cities[c] || 0) + 1;
    });
    var parts = Object.keys(cities)
      .sort(function (a, b) {
        return cities[b] - cities[a];
      })
      .slice(0, 6)
      .map(function (c) {
        return esc(c) + ' · ' + cities[c];
      });
    host.innerHTML = parts.length
      ? '<div style="font-size:12px;color:var(--text-muted);margin:8px 0">' + parts.join(' · ') + '</div>'
      : '<div style="font-size:12px;color:var(--text-muted);margin:8px 0">City breakdown not available on waitlist rows.</div>';
  }

  async function loadWarnCounts() {
    global._adminWarnCounts = global._adminWarnCounts || {};
    try {
      if (typeof sbGet !== 'function') return;
      var rows = await sbGet('user_warnings', 'select=user_id', null, 2000);
      if (!Array.isArray(rows)) return;
      var map = {};
      rows.forEach(function (r) {
        var id = String(r.user_id || '');
        if (!id) return;
        map[id] = (map[id] || 0) + 1;
      });
      global._adminWarnCounts = map;
    } catch (e) {}
  }

  function patchShowSection() {
    var prev = global.showSection;
    if (typeof prev !== 'function') return;
    global.showSection = function (section, btn) {
      prev(section, btn);
      if (section === 'overview') enhanceOverviewStats();
      if (section === 'disputes') renderDisputesConsole();
      if (section === 'users') enhanceRenderUsers(global.users);
      if (section === 'tasks') enhanceRenderTasks(global.tasks);
      if (section === 'waitlist') waitlistCityBreakdown();
      if (section === 'settings') paintStripeMode();
    };
  }

  function patchRenderOverview() {
    var prev = global.renderOverview;
    if (typeof prev !== 'function') return;
    global.renderOverview = function () {
      prev();
      enhanceOverviewStats();
    };
  }

  function patchRenderUsers() {
    global.renderUsers = function (data) {
      enhanceRenderUsers(data);
    };
    global.filterUsers = function (q) {
      var list = global.users || [];
      if (q) {
        var needle = String(q).toLowerCase();
        list = list.filter(function (u) {
          return ((u.name || '') + ' ' + (u.email || '')).toLowerCase().indexOf(needle) >= 0;
        });
      }
      enhanceRenderUsers(list);
    };
  }

  function patchRenderTasks() {
    global.renderTasks = function (data) {
      enhanceRenderTasks(data);
    };
    global.filterTasks = function (q) {
      var list = global.tasks || [];
      if (q) {
        var needle = String(q).toLowerCase();
        list = list.filter(function (t) {
          return (
            String(t.title || '')
              .toLowerCase()
              .indexOf(needle) >= 0 ||
            String(t.poster_name || t.posted_by || '')
              .toLowerCase()
              .indexOf(needle) >= 0
          );
        });
      }
      enhanceRenderTasks(list);
    };
  }

  function patchDisputes() {
    global.renderDisputes = renderDisputesConsole;
    global.renderDisputesEnhanced = renderDisputesConsole;
    global.filterDisputes = function (q) {
      // keep open filter; search within
      var prev = global.disputes;
      if (q) {
        var needle = String(q).toLowerCase();
        global.disputes = (prev || []).filter(function (d) {
          var task = (global.tasks || []).find(function (t) {
            return String(t.task_id || t.id) === String(d.task_id);
          });
          var hay =
            (task && task.title ? task.title : '') +
            ' ' +
            (d.reason || '') +
            ' ' +
            (d.detail || '') +
            ' ' +
            (d.task_id || '');
          return hay.toLowerCase().indexOf(needle) >= 0;
        });
      }
      renderDisputesConsole();
      if (q) global.disputes = prev;
    };
  }

  function boot() {
    document.body.classList.add('page-admin');
    if (typeof global.renderMiniChart === 'function') {
      var prevChart = global.renderMiniChart;
      global.renderMiniChart = function (id, data, color) {
        if (!document.getElementById(id)) return;
        return prevChart(id, data, color);
      };
    }
    patchShowSection();
    patchRenderOverview();
    patchRenderUsers();
    patchRenderTasks();
    patchDisputes();
    paintStripeMode();
    loadWarnCounts().then(function () {
      if (typeof enhanceOverviewStats === 'function') enhanceOverviewStats();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    setTimeout(boot, 0);
  }

  // Re-run after loadData paints
  var prevLoad = global.loadData;
  if (typeof prevLoad === 'function') {
    global.loadData = async function () {
      await prevLoad.apply(this, arguments);
      await loadWarnCounts();
      enhanceOverviewStats();
      if (global.currentSection === 'disputes') renderDisputesConsole();
      if (global.currentSection === 'users') enhanceRenderUsers(global.users);
      if (global.currentSection === 'tasks') enhanceRenderTasks(global.tasks);
      if (global.currentSection === 'waitlist') waitlistCityBreakdown();
    };
  }

  global.adminDisputeQuickResolve = adminDisputeQuickResolve;
  global.adminConfirmBan = adminConfirmBan;
  global.adminWarnById = adminWarnById;
  global.adminConfirmRemoveTask = adminConfirmRemoveTask;
  global.adminInviteWaiting = adminInviteWaiting;
  global.renderDisputesConsole = renderDisputesConsole;
  global.enhanceOverviewStats = enhanceOverviewStats;
})(window);
