/* QuickGigs — admin power features (additive; keeps Firebase gate + session timeout) */
(function () {
  'use strict';

  // Contact / off-platform / banned phrases for task moderation
  var FLAGGED_WORDS = [
    'whatsapp', 'text me', 'call me', 'my number', 'phone number', 'email me',
    'venmo', 'paypal', 'e-transfer', 'etransfer', 'cashapp', 'outside the app',
    'off platform', 'off-platform', 'dm me', 'instagram', 'telegram', 'signal',
    'escort', 'adult only', 'no id required'
  ];

  var SETTINGS_KEY = 'qg-admin-settings';
  var NOTES_KEY = 'qg-admin-notes';
  var WAITLIST_KEY = 'qg-waitlist';
  var AUDIT_KEY = 'qg-admin-audit';
  var ANNOUNCE_KEY = 'qg-admin-announce';

  var selectedRowIndex = -1;
  var selectedRowKind = null; // 'users' | 'tasks' | 'moderation'

  function esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function midnightLocal() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function dayKey(date) {
    var d = new Date(date);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  /* ── ADMIN-TODO: move notes to Supabase admin_notes / notes column ── */
  function getLocalNotes(id) {
    var all = readJson(NOTES_KEY, {});
    return all[String(id)] || '';
  }

  function setLocalNotes(id, text) {
    var all = readJson(NOTES_KEY, {});
    all[String(id)] = text;
    writeJson(NOTES_KEY, all);
  }

  /* ── Audit (local accountability) ── */
  function appendAudit(action, target) {
    var log = readJson(AUDIT_KEY, []);
    log.unshift({
      action: String(action || ''),
      target: String(target || ''),
      timestamp: new Date().toISOString()
    });
    if (log.length > 500) log = log.slice(0, 500);
    writeJson(AUDIT_KEY, log);
    if (typeof window.renderAuditLog === 'function' && window.currentSection === 'audit') {
      window.renderAuditLog();
    }
  }

  window.appendAdminAudit = appendAudit;

  /* ── Platform settings (local until settings table exists) ── */
  // ADMIN-TODO: persist to Supabase platform_settings row
  function getPlatformSettings() {
    return Object.assign({
      minTaskBudget: 20,
      maxPostsPerDay: 10,
      signupsPaused: false,
      maintenanceMode: false
    }, readJson(SETTINGS_KEY, {}));
  }

  function savePlatformSettings(patch) {
    var next = Object.assign(getPlatformSettings(), patch || {});
    writeJson(SETTINGS_KEY, next);
    return next;
  }

  function taskMatchesFlag(t) {
    var hay = ((t.title || '') + ' ' + (t.description || t.DESCRIPTION || '')).toLowerCase();
    for (var i = 0; i < FLAGGED_WORDS.length; i++) {
      if (hay.indexOf(FLAGGED_WORDS[i]) >= 0) return FLAGGED_WORDS[i];
    }
    return '';
  }

  function getReviewsForUid(uid) {
    var list = window.reviews || [];
    return list.filter(function (r) {
      return String(r.reviewee_id || r.REVIEWEE_ID || '') === String(uid);
    });
  }

  /* ── Enhance user drawer after open ── */
  var _openUserDrawer = window.openUserDrawer;
  window.openUserDrawer = async function (key) {
    if (typeof _openUserDrawer === 'function') await _openUserDrawer(key);
    enhanceUserDrawer(key);
  };

  function enhanceUserDrawer(key) {
    var u = typeof findUser === 'function' ? findUser(key) : null;
    if (!u) return;
    var uid = typeof userKey === 'function' ? userKey(u) : (u.firebase_uid || u.user_id || '');
    var body = document.getElementById('adminDrawerBody');
    if (!body) return;

    // Rename profile link
    body.querySelectorAll('a.admin-drawer-btn').forEach(function (a) {
      if ((a.getAttribute('href') || '').indexOf('profile.html') >= 0) {
        a.textContent = 'View public profile';
      }
    });

    var tasks = (window.tasks || []).filter(function (t) {
      return String(t.posted_by || t.POSTED_BY || '') === String(uid);
    });
    var apps = (window.applications || []).filter(function (a) {
      return String(a.worker_id || a.WORKER_ID || '') === String(uid);
    });
    var revs = getReviewsForUid(uid);

    var extra = document.getElementById('admPowerUserExtra');
    if (extra) extra.remove();
    var wrap = document.createElement('div');
    wrap.id = 'admPowerUserExtra';
    wrap.innerHTML =
      '<div class="admin-drawer-section"><div class="admin-drawer-section-title">Tasks posted (' + tasks.length + ')</div>' +
        (tasks.length ? tasks.slice(0, 20).map(function (t) {
          return '<div class="admin-applicant-row"><span>' + esc(t.title || 'Task') +
            ' · $' + (t.budget || 0) + '</span><span class="status-pill s-posted">' + esc(t.status || 'open') + '</span></div>';
        }).join('') : '<div style="font-size:12px;color:rgba(255,255,255,0.35)">No tasks posted.</div>') +
      '</div>' +
      '<div class="admin-drawer-section"><div class="admin-drawer-section-title">Applications (' + apps.length + ')</div>' +
        (apps.length ? apps.slice(0, 20).map(function (a) {
          return '<div class="admin-applicant-row"><span>Task ' + esc(String(a.task_id || a.TASK_ID || '').slice(0, 8)) +
            (a.price || a.PRICE ? ' · $' + (a.price || a.PRICE) : '') +
            '</span><span class="status-pill s-progress">' + esc(a.status || a.STATUS || 'pending') + '</span></div>';
        }).join('') : '<div style="font-size:12px;color:rgba(255,255,255,0.35)">No applications.</div>') +
      '</div>' +
      '<div class="admin-drawer-section"><div class="admin-drawer-section-title">Reviews received (' + revs.length + ')</div>' +
        (revs.length ? revs.slice(0, 15).map(function (r) {
          return '<div class="admin-note-item">★ ' + esc(String(r.rating || '')) + ' — ' +
            esc((r.review_comment || r.REVIEW_COMMENT || '').slice(0, 120) || 'No comment') + '</div>';
        }).join('') : '<div style="font-size:12px;color:rgba(255,255,255,0.35)">No reviews yet.</div>') +
      '</div>' +
      '<div class="admin-drawer-section"><div class="admin-drawer-section-title">Admin notes (local)</div>' +
        '<p style="font-size:10px;color:rgba(255,255,255,0.3);margin-bottom:6px">ADMIN-TODO: sync to Supabase notes column</p>' +
        '<div class="admin-field"><textarea id="admLocalNote" placeholder="Private admin notes for this user">' +
          esc(getLocalNotes('user:' + uid)) + '</textarea></div>' +
        '<button type="button" class="admin-drawer-btn ghost" id="admSaveLocalNote">Save notes</button>' +
      '</div>' +
      '<div class="admin-drawer-section"><div class="admin-drawer-section-title">Message</div>' +
        '<div class="admin-drawer-actions">' +
          '<a class="admin-drawer-btn ghost" href="mailto:' + encodeURIComponent(u.email || '') + '">Email user</a>' +
          (u.firebase_uid
            ? '<a class="admin-drawer-btn primary" href="profile.html?user=' + encodeURIComponent(u.firebase_uid) + '" target="_blank" rel="noopener">View public profile</a>'
            : '') +
        '</div>' +
      '</div>';
    body.appendChild(wrap);
    var saveBtn = document.getElementById('admSaveLocalNote');
    if (saveBtn) {
      saveBtn.onclick = function () {
        var ta = document.getElementById('admLocalNote');
        setLocalNotes('user:' + uid, ta ? ta.value : '');
        if (typeof showToast === 'function') showToast('Notes saved locally', 'green');
      };
    }
  }

  /* ── Dispute notes enhancement ── */
  var _viewDispute = window.viewDispute;
  window.viewDispute = function (id) {
    var d = (window.disputes || []).find(function (x) {
      return String(x.dispute_id || x.id) === String(id);
    });
    if (!d && typeof _viewDispute === 'function') return _viewDispute(id);
    if (!d) return;
    var did = String(d.dispute_id || d.id);
    var note = getLocalNotes('dispute:' + did);
    if (typeof openModal === 'function') {
      openModal(
        'Dispute — ' + (d.task_title || d.task_id || 'Task'),
        'Review and add internal notes. Resolve when ready.',
        '<div style="display:grid;gap:12px">' +
          '<div><div class="modal-label">Opened by</div><div class="modal-value">' + esc(d.opened_by_email || d.raised_by || d.opened_by || d.opened_by_id || '—') + '</div></div>' +
          '<div><div class="modal-label">Reason</div><div class="modal-value">' + esc(d.reason || '—') + '</div></div>' +
          '<div><div class="modal-label">Details</div><div class="modal-value">' + esc(d.detail || d.details || '—') + '</div></div>' +
          '<div><div class="modal-label">Status</div><div class="modal-value">' + esc(d.status || 'open') + '</div></div>' +
          '<div class="admin-field"><label>Admin notes (local)</label><textarea id="admDisputeNote">' + esc(note) + '</textarea></div>' +
          '<p style="font-size:10px;color:var(--text-faint)">ADMIN-TODO: store dispute notes in Supabase</p>' +
        '</div>',
        'Save notes',
        'purple',
        function () {
          var ta = document.getElementById('admDisputeNote');
          setLocalNotes('dispute:' + did, ta ? ta.value : '');
          if (typeof showToast === 'function') showToast('Dispute notes saved', 'green');
        },
        false
      );
    }
  };

  /* ── Wrap audit on key actions ── */
  ['adminWarnUser', 'adminBanUser', 'adminUnbanUser', 'adminRemoveTask'].forEach(function (name) {
    var orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = async function () {
      var targetEl = document.querySelector('.admin-drawer-sub') || document.querySelector('.admin-drawer-title');
      var target = targetEl ? targetEl.textContent : 'admin-action';
      var result = await orig.apply(this, arguments);
      appendAudit(name.replace(/^admin/, '').replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, ''), target);
      return result;
    };
  });

  var _resolveDispute = window.resolveDispute;
  if (typeof _resolveDispute === 'function') {
    window.resolveDispute = async function (id) {
      await _resolveDispute(id);
      appendAudit('resolve_dispute', String(id));
    };
  }

  /* ── Today snapshot ── */
  window.renderTodaySnapshot = function () {
    var el = document.getElementById('todaySnapshot');
    if (!el) return;
    var start = midnightLocal().getTime();
    var users = window.users || [];
    var tasks = window.tasks || [];
    var apps = window.applications || [];
    var disputes = window.disputes || [];
    function sinceMidnight(iso) {
      if (!iso) return false;
      return new Date(iso).getTime() >= start;
    }
    var s = users.filter(function (u) { return sinceMidnight(u.created_at); }).length;
    var t = tasks.filter(function (x) { return sinceMidnight(x.created_at); }).length;
    var a = apps.filter(function (x) { return sinceMidnight(x.created_at); }).length;
    var d = disputes.filter(function (x) { return sinceMidnight(x.created_at) && (x.status || 'open') === 'open'; }).length;
    el.innerHTML =
      '<div class="today-chip"><div class="today-val">' + s + '</div><div class="today-lbl">Signups today</div></div>' +
      '<div class="today-chip"><div class="today-val">' + t + '</div><div class="today-lbl">Tasks posted</div></div>' +
      '<div class="today-chip"><div class="today-val">' + a + '</div><div class="today-lbl">Applications</div></div>' +
      '<div class="today-chip"><div class="today-val">' + d + '</div><div class="today-lbl">Disputes opened</div></div>';
  };

  /* ── Cohort / activation ── */
  window.renderCohortChart = function () {
    var host = document.getElementById('cohortChart');
    var actEl = document.getElementById('activationRate');
    if (!host) return;
    var users = window.users || [];
    var days = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      days.push(dayKey(d));
    }
    var counts = days.map(function (key) {
      return users.filter(function (u) {
        return u.created_at && dayKey(u.created_at) === key;
      }).length;
    });
    var max = Math.max.apply(null, counts.concat([1]));
    host.innerHTML = counts.map(function (c, idx) {
      var h = Math.max(8, Math.round((c / max) * 100));
      return '<div class="cohort-col" title="' + days[idx] + ': ' + c + '">' +
        '<div class="cohort-bar" style="height:' + h + '%"></div>' +
        '<div class="cohort-lbl">' + days[idx].slice(5) + '</div></div>';
    }).join('');

    var posters = {};
    (window.tasks || []).forEach(function (t) {
      var id = String(t.posted_by || t.POSTED_BY || '');
      if (id) posters[id] = true;
    });
    var appliers = {};
    (window.applications || []).forEach(function (a) {
      var id = String(a.worker_id || a.WORKER_ID || '');
      if (id) appliers[id] = true;
    });
    var activated = users.filter(function (u) {
      var uid = typeof userKey === 'function' ? userKey(u) : (u.firebase_uid || u.user_id);
      return posters[String(uid)] || appliers[String(uid)];
    }).length;
    var rate = users.length ? Math.round((activated / users.length) * 100) : 0;
    if (actEl) actEl.textContent = rate + '% activation · ' + activated + ' of ' + users.length + ' users posted or applied';
  };

  /* ── Moderation queue ── */
  function contentModerationReports() {
    function isContentMod(r) {
      if (!r) return false;
      var reason = String(r.reason || '');
      if (reason.indexOf('content_moderation') === 0) return true;
      var raw = r.detail != null ? r.detail : r.details;
      if (raw && typeof raw === 'object') {
        return !!(raw.content_moderation || (raw.flags && raw.flags.length));
      }
      var s = String(raw || '');
      if (s.indexOf('content_moderation') >= 0) return true;
      try {
        var d = JSON.parse(s);
        return !!(d && (d.content_moderation || (d.flags && d.flags.length)));
      } catch (e) { return false; }
    }
    var fromDb = (window.reports || []).filter(isContentMod);
    var fromLocal = [];
    try {
      fromLocal = (JSON.parse(localStorage.getItem('qg-moderation-queue') || '[]') || []).map(function (row, i) {
        return {
          report_id: 'local-' + i,
          reason: row.reason || 'content_moderation',
          target_type: row.source || 'content',
          target_id: row.target_id || '',
          reporter_id: row.user_id || '',
          detail: JSON.stringify(Object.assign({ content_moderation: true }, row)),
          created_at: row.at,
          status: 'open',
          _local: true
        };
      });
    } catch (e) {}
    return fromDb.concat(fromLocal);
  }

  window.renderModerationQueue = function () {
    var body = document.getElementById('moderationBody');
    var countEl = document.getElementById('moderationCount');
    if (!body) return;
    var cutoff = Date.now() - 24 * 60 * 60 * 1000;
    var recent = (window.tasks || []).filter(function (t) {
      return t.created_at && new Date(t.created_at).getTime() >= cutoff;
    });
    var flagged = (window.tasks || []).filter(function (t) { return !!taskMatchesFlag(t); });
    // Flagged first, then recent non-flagged
    var seen = {};
    var list = [];
    flagged.forEach(function (t) {
      var id = String(t.task_id || t.id);
      if (!seen[id]) { seen[id] = true; list.push(Object.assign({}, t, { _flag: taskMatchesFlag(t), _priority: 1 })); }
    });
    recent.forEach(function (t) {
      var id = String(t.task_id || t.id);
      if (!seen[id]) { seen[id] = true; list.push(Object.assign({}, t, { _flag: '', _priority: 0 })); }
    });
    list.sort(function (a, b) { return (b._priority - a._priority) || (new Date(b.created_at) - new Date(a.created_at)); });

    var modHits = contentModerationReports().sort(function (a, b) {
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    }).slice(0, 40);

    if (countEl) countEl.textContent = '· ' + list.length + ' tasks · ' + modHits.length + ' content flags';
    if (!list.length && !modHits.length) {
      body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-faint);font-size:13px">No new or flagged tasks in the last 24 hours</div>';
      return;
    }

    var hitsHtml = '';
    if (modHits.length) {
      hitsHtml = '<div style="padding:12px 16px 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-faint)">Content moderation blocks (first-pass)</div>' +
        modHits.map(function (r) {
          var flags = '';
          var preview = '';
          try {
            var d = typeof r.detail === 'string' ? JSON.parse(r.detail) : (r.detail || {});
            if (Array.isArray(d.flags) && d.flags.length) flags = d.flags.join(',');
            preview = d.preview || d.body || '';
          } catch (e) { preview = String(r.detail || r.details || '').slice(0, 80); }
          if (!flags) {
            var reason = String(r.reason || '');
            flags = reason.indexOf('content_moderation:') === 0
              ? reason.slice('content_moderation:'.length)
              : (reason === 'inappropriate' ? 'inappropriate' : 'flagged');
          }
          return '<div class="data-row g-tasks mod-row is-flagged" data-row-kind="moderation" data-row-id="' + esc(String(r.report_id || '')) + '">' +
            '<div></div>' +
            '<div class="user-cell"><div><div class="u-name">Blocked ' + esc(r.target_type || 'content') +
            ' <span class="mod-flag">⚑ ' + esc(flags) + '</span></div>' +
            '<div class="u-meta">' + esc(r.reporter_id || 'user') + ' · ' +
            (r.created_at ? new Date(r.created_at).toLocaleString('en-CA') : '') +
            (preview ? ' · “' + esc(String(preview).slice(0, 60)) + '”' : '') +
            '</div></div></div>' +
            '<div class="cell">' + esc(r.target_id || '—') + '</div>' +
            '<div class="cell">—</div>' +
            '<div class="cell">' + esc(r.target_type || '—') + '</div>' +
            '<div class="cell"><span class="status-pill s-posted">' + esc(r.status || 'open') + '</span></div>' +
            '<div class="act-btns"></div></div>';
        }).join('');
    }

    body.innerHTML = hitsHtml + list.map(function (t) {
      var tid = String(t.task_id || t.id || '');
      var flag = t._flag ? '<span class="mod-flag">⚑ ' + esc(t._flag) + '</span>' : '';
      var posterMeta = typeof adminResolveUserHtml === 'function'
        ? adminResolveUserHtml(t.posted_by || t.POSTED_BY, t.poster_name)
        : esc(t.poster_name || t.posted_by || '');
      var money = typeof adminFormatMoney === 'function'
        ? adminFormatMoney(t.budget)
        : ('$' + Number(t.budget || 0).toFixed(2));
      return '<div class="data-row g-tasks mod-row' + (t._flag ? ' is-flagged' : '') + '" data-row-kind="moderation" data-row-id="' + esc(tid) + '" onclick="openTaskDrawer(\'' + tid.replace(/'/g, '') + '\')">' +
        '<div></div>' +
        '<div class="user-cell"><div style="min-width:0"><div class="u-name">' + esc(t.title || 'Task') + ' ' + flag + '</div>' +
        '<div class="u-meta">' + posterMeta + ' · ' +
        (t.created_at ? new Date(t.created_at).toLocaleString('en-CA') : '') + '</div></div></div>' +
        '<div class="cell">' + esc(t.location || '—') + '</div>' +
        '<div class="cell cell-num">' + money + '</div>' +
        '<div class="cell">' + esc(t.category || '—') + '</div>' +
        '<div class="cell-pill"><span class="status-pill s-posted">' + esc(t.status || 'open') + '</span></div>' +
        '<div class="act-btns" onclick="event.stopPropagation()">' +
          '<button type="button" class="act-btn btn-resolve" onclick="adminApproveTask(\'' + tid.replace(/'/g, '') + '\')">Approve</button>' +
          '<button type="button" class="act-btn btn-remove" onclick="adminModRemoveTask(\'' + tid.replace(/'/g, '') + '\')">Remove</button>' +
        '</div></div>';
    }).join('');
  };

  window.adminApproveTask = async function (tid) {
    // Visibility approve = ensure status open
    if (typeof sbUpdate === 'function') {
      await sbUpdate('tasks', { status: 'open' }, 'task_id=eq.' + encodeURIComponent(tid));
    }
    var t = (window.tasks || []).find(function (x) { return String(x.task_id || x.id) === tid; });
    if (t) t.status = 'open';
    appendAudit('approve_task', tid);
    if (typeof showToast === 'function') showToast('Task approved (open)', 'green');
    renderModerationQueue();
  };

  window.adminModRemoveTask = async function (tid) {
    // Prefer soft hide; hard delete stays behind the task ⋯ menu
    if (typeof adminHideTask === 'function') await adminHideTask(tid);
    else if (typeof adminRemoveTask === 'function') await adminRemoveTask();
    appendAudit('remove_task', tid);
    renderModerationQueue();
  };

  /* ── Waitlist local paste + copy not-signed-up ── */
  window.adminSaveLocalWaitlist = function () {
    var box = document.getElementById('waitlistImport');
    if (!box) return;
    var lines = (box.value || '').split(/[\n,;]+/).map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
    var emails = [];
    lines.forEach(function (line) {
      var m = line.match(/[\w.+-]+@[\w.-]+\.\w+/);
      if (m) emails.push(m[0]);
    });
    emails = emails.filter(function (e, i) { return emails.indexOf(e) === i; });
    writeJson(WAITLIST_KEY, emails);
    // Also try Supabase import if available
    if (typeof adminImportWaitlist === 'function') adminImportWaitlist();
    renderLocalWaitlistCrossref();
    if (typeof showToast === 'function') showToast('Waitlist saved (' + emails.length + ')', 'green');
  };

  window.renderLocalWaitlistCrossref = function () {
    var el = document.getElementById('waitlistCrossref');
    if (!el) return;
    var emails = readJson(WAITLIST_KEY, []);
    var userEmails = {};
    (window.users || []).forEach(function (u) {
      if (u.email) userEmails[String(u.email).toLowerCase()] = true;
    });
    var signed = emails.filter(function (e) { return userEmails[e]; });
    var pending = emails.filter(function (e) { return !userEmails[e]; });
    el.className = 'stats-grid';
    function xrefCard(opts) {
      if (typeof adminStatCardHtml === 'function') return adminStatCardHtml(opts);
      if (opts.actionHtml) {
        return '<div class="stat-card is-action">' + opts.actionHtml + '</div>';
      }
      return '<div class="stat-card"><div class="stat-accent ' + (opts.accent || '') + '"></div>' +
        '<div class="stat-val ' + (opts.valClass || '') + '">' + opts.val + '</div>' +
        '<div class="stat-label">' + (opts.label || '') + '</div>' +
        (opts.sub ? '<div class="stat-sub">' + opts.sub + '</div>' : '') + '</div>';
    }
    el.innerHTML = [
      xrefCard({ val: emails.length, label: 'Local list', sub: 'Saved in this browser', accent: 'accent-purple', valClass: 'c-purple' }),
      xrefCard({ val: signed.length, label: 'Signed up', sub: 'Matched to users', accent: 'accent-green', valClass: 'c-green' }),
      xrefCard({ val: pending.length, label: 'Not yet', sub: 'Still waiting', accent: 'accent-amber', valClass: 'c-amber' }),
      xrefCard({
        actionHtml: '<button type="button" class="action-pill pill-export" onclick="adminCopyPendingWaitlist()">Copy not-yet emails</button>'
      })
    ].join('');
    window._pendingWaitlistEmails = pending;
  };

  window.adminCopyPendingWaitlist = function () {
    var pending = window._pendingWaitlistEmails || [];
    var text = pending.join('\n');
    if (!text) {
      if (typeof showToast === 'function') showToast('Everyone on the list has signed up', 'green');
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        if (typeof showToast === 'function') showToast('Copied ' + pending.length + ' emails', 'green');
      });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      if (typeof showToast === 'function') showToast('Copied ' + pending.length + ' emails', 'green');
    }
  };

  /* ── Announcement local mirror ── */
  // ADMIN-TODO: already writes platform_banner when table exists; local mirror for offline
  window.adminSaveAnnounceLocal = function () {
    var payload = {
      message: (document.getElementById('bannerMessage') && document.getElementById('bannerMessage').value) || '',
      link: (document.getElementById('bannerLink') && document.getElementById('bannerLink').value) || '',
      active: !!(document.getElementById('bannerActive') && document.getElementById('bannerActive').checked),
      enabled: !!(document.getElementById('bannerActive') && document.getElementById('bannerActive').checked)
    };
    writeJson(ANNOUNCE_KEY, payload);
  };

  var _saveBanner = window.adminSaveBanner;
  if (typeof _saveBanner === 'function') {
    window.adminSaveBanner = async function () {
      adminSaveAnnounceLocal();
      await _saveBanner();
      appendAudit('banner_update', 'platform');
    };
  }

  /* ── Platform controls UI ── */
  window.loadPlatformControls = function () {
    var s = getPlatformSettings();
    var minEl = document.getElementById('ctlMinBudget');
    var maxEl = document.getElementById('ctlMaxPosts');
    var signupEl = document.getElementById('ctlSignupsPaused');
    var maintEl = document.getElementById('ctlMaintenance');
    if (minEl) minEl.value = s.minTaskBudget;
    if (maxEl) maxEl.value = s.maxPostsPerDay;
    if (signupEl) signupEl.checked = !!s.signupsPaused;
    if (maintEl) maintEl.checked = !!s.maintenanceMode;
  };

  window.adminSavePlatformControls = function () {
    var next = savePlatformSettings({
      minTaskBudget: Math.max(0, Math.round(Number(document.getElementById('ctlMinBudget').value) || 20)),
      maxPostsPerDay: Math.max(1, Math.round(Number(document.getElementById('ctlMaxPosts').value) || 10))
    });
    // ADMIN-TODO: write to Supabase platform_settings
    appendAudit('settings_update', JSON.stringify(next));
    if (typeof showToast === 'function') showToast('Platform controls saved', 'green');
  };

  window.adminToggleDanger = function (key) {
    var typed = prompt('Type CONFIRM to apply this change:');
    if (typed !== 'CONFIRM') {
      if (typeof showToast === 'function') showToast('Cancelled — type CONFIRM to apply', 'amber');
      loadPlatformControls();
      return;
    }
    var patch = {};
    if (key === 'signupsPaused') {
      patch.signupsPaused = !!(document.getElementById('ctlSignupsPaused') && document.getElementById('ctlSignupsPaused').checked);
    }
    if (key === 'maintenanceMode') {
      patch.maintenanceMode = !!(document.getElementById('ctlMaintenance') && document.getElementById('ctlMaintenance').checked);
    }
    savePlatformSettings(patch);
    appendAudit('danger_' + key, JSON.stringify(patch));
    if (typeof showToast === 'function') showToast('Danger setting applied', 'red');
  };

  /* ── Command bar / ── */
  function ensureCommandBar() {
    if (document.getElementById('adminCommandBar')) return;
    var root = document.createElement('div');
    root.id = 'adminCommandBar';
    root.className = 'admin-cmd-overlay';
    root.hidden = true;
    root.innerHTML =
      '<div class="admin-cmd-panel" role="dialog" aria-label="Admin command search">' +
        '<input class="admin-cmd-input" id="adminCmdInput" type="search" placeholder="Search users or tasks…" autocomplete="off">' +
        '<div class="admin-cmd-results" id="adminCmdResults"></div>' +
        '<div class="admin-cmd-hint">↑↓ navigate · Enter open · Esc close</div>' +
      '</div>';
    document.body.appendChild(root);
    root.addEventListener('click', function (e) {
      if (e.target === root) closeCommandBar();
    });
    document.getElementById('adminCmdInput').addEventListener('input', function () {
      runCommandSearch(this.value);
    });
    document.getElementById('adminCmdInput').addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); closeCommandBar(); }
      if (e.key === 'Enter') {
        var first = document.querySelector('#adminCmdResults .admin-cmd-item');
        if (first) first.click();
      }
    });
  }

  function openCommandBar() {
    ensureCommandBar();
    var root = document.getElementById('adminCommandBar');
    root.hidden = false;
    root.classList.add('open');
    var input = document.getElementById('adminCmdInput');
    input.value = '';
    document.getElementById('adminCmdResults').innerHTML = '';
    setTimeout(function () { input.focus(); }, 30);
  }

  function closeCommandBar() {
    var root = document.getElementById('adminCommandBar');
    if (!root) return;
    root.classList.remove('open');
    root.hidden = true;
  }

  function runCommandSearch(q) {
    q = String(q || '').trim().toLowerCase();
    var host = document.getElementById('adminCmdResults');
    if (!host) return;
    if (!q) { host.innerHTML = ''; return; }
    var hits = [];
    (window.users || []).forEach(function (u) {
      var hay = ((u.name || '') + ' ' + (u.email || '')).toLowerCase();
      if (hay.indexOf(q) >= 0) {
        hits.push({
          kind: 'user',
          label: (u.name || 'User') + ' · ' + (u.email || ''),
          id: typeof userKey === 'function' ? userKey(u) : (u.firebase_uid || u.user_id)
        });
      }
    });
    (window.tasks || []).forEach(function (t) {
      if (String(t.title || '').toLowerCase().indexOf(q) >= 0) {
        hits.push({
          kind: 'task',
          label: (t.title || 'Task') + ' · $' + (t.budget || 0),
          id: String(t.task_id || t.id)
        });
      }
    });
    hits = hits.slice(0, 12);
    host.innerHTML = hits.length ? hits.map(function (h) {
      return '<button type="button" class="admin-cmd-item" data-kind="' + h.kind + '" data-id="' + esc(h.id) + '">' +
        '<span class="admin-cmd-kind">' + h.kind + '</span>' + esc(h.label) + '</button>';
    }).join('') : '<div class="admin-cmd-empty">No matches</div>';
    host.querySelectorAll('.admin-cmd-item').forEach(function (btn) {
      btn.onclick = function () {
        var kind = btn.getAttribute('data-kind');
        var id = btn.getAttribute('data-id');
        closeCommandBar();
        if (kind === 'user') {
          if (typeof showSection === 'function') showSection('users', document.querySelector('[onclick*="users"]'));
          openUserDrawer(id);
        } else {
          if (typeof showSection === 'function') showSection('tasks', document.querySelector('[onclick*="\'tasks\'"]'));
          openTaskDrawer(id);
        }
      };
    });
  }

  /* ── Exports ── */
  var _exportCSV = window.exportCSV;
  window.exportCSV = function (type) {
    if (type === 'disputes') {
      var rows = (window.disputes || []).map(function (d) {
        return [d.dispute_id || d.id, d.task_id, d.task_title, d.reason, d.status, d.opened_by_email || d.raised_by || d.opened_by || d.opened_by_id, d.detail || d.details || '', d.created_at]
          .map(function (v) {
            var s = String(v == null ? '' : v);
            return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
          }).join(',');
      });
      rows.unshift(['ID', 'Task ID', 'Title', 'Reason', 'Status', 'Opened by', 'Details', 'Created'].join(','));
      downloadCsv(rows.join('\n'), 'quickgigs-disputes.csv');
      return;
    }
    if (type === 'audit') {
      var log = readJson(AUDIT_KEY, []);
      var rows2 = log.map(function (a) {
        return [a.timestamp, a.action, a.target].map(function (v) {
          var s = String(v == null ? '' : v);
          return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        }).join(',');
      });
      rows2.unshift(['Timestamp', 'Action', 'Target'].join(','));
      downloadCsv(rows2.join('\n'), 'quickgigs-admin-audit.csv');
      return;
    }
    if (typeof _exportCSV === 'function') _exportCSV(type);
  };

  function downloadCsv(text, filename) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    if (typeof showToast === 'function') showToast('Exported ' + filename, 'green');
  }

  window.adminFullBackup = async function () {
    if (typeof showToast === 'function') showToast('Starting full backup…', 'amber');
    var types = ['users', 'tasks', 'applications', 'reviews'];
    for (var i = 0; i < types.length; i++) {
      await exportBackupType(types[i]);
      await new Promise(function (r) { setTimeout(r, 400); });
    }
    appendAudit('full_backup', 'all');
    if (typeof showToast === 'function') showToast('Full backup downloaded', 'green');
  };

  async function exportBackupType(type) {
    var rows = [];
    if (type === 'users') {
      rows = (window.users || []).map(function (u) {
        return [u.name, u.email, u.role, u.status, u.firebase_uid, u.created_at].join(',');
      });
      rows.unshift('Name,Email,Role,Status,UID,Joined');
    } else if (type === 'tasks') {
      rows = (window.tasks || []).map(function (t) {
        return [t.task_id || t.id, t.title, t.posted_by, t.budget, t.status, t.created_at].join(',');
      });
      rows.unshift('ID,Title,Poster,Budget,Status,Created');
    } else if (type === 'applications') {
      rows = (window.applications || []).map(function (a) {
        return [a.app_id || a.id, a.task_id, a.worker_id, a.status, a.price, a.created_at].join(',');
      });
      rows.unshift('ID,Task,Worker,Status,Price,Created');
    } else if (type === 'reviews') {
      var revs = window.reviews || [];
      if (!revs.length && typeof sbGet === 'function') {
        revs = await sbGet('reviews', null, 'created_at.desc', 500);
        window.reviews = revs || [];
      }
      rows = (window.reviews || []).map(function (r) {
        return [r.review_id, r.task_id, r.reviewer_id, r.reviewee_id, r.rating, r.created_at].join(',');
      });
      rows.unshift('ID,Task,Reviewer,Reviewee,Rating,Created');
    }
    downloadCsv(rows.join('\n'), 'quickgigs-backup-' + type + '.csv');
  }

  window.renderAuditLog = function () {
    var el = document.getElementById('auditBody');
    var countEl = document.getElementById('auditCount');
    if (!el) return;
    var log = readJson(AUDIT_KEY, []);
    if (countEl) countEl.textContent = '· ' + log.length + ' events';
    if (!log.length) {
      el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-faint);font-size:13px">No local audit events yet — warn, ban, and moderation actions appear here.</div>';
      return;
    }
    el.innerHTML = log.map(function (a) {
      return '<div class="sec-item"><span class="sec-type sec-signup">' + esc(a.action) + '</span>' +
        '<div class="sec-text">' + esc(a.target) + '</div>' +
        '<div class="sec-time">' + (a.timestamp ? new Date(a.timestamp).toLocaleString('en-CA') : '') + '</div></div>';
    }).join('');
  };

  /* ── Keyboard j/k + / ── */
  function getSelectableRows() {
    var section = window.currentSection;
    var sel = '';
    if (section === 'users') { selectedRowKind = 'users'; sel = '#usersBody .data-row'; }
    else if (section === 'tasks') { selectedRowKind = 'tasks'; sel = '#tasksBody .data-row'; }
    else if (section === 'moderation') { selectedRowKind = 'moderation'; sel = '#moderationBody .data-row'; }
    else return [];
    return Array.prototype.slice.call(document.querySelectorAll(sel));
  }

  function highlightSelected() {
    var rows = getSelectableRows();
    rows.forEach(function (r, i) {
      r.classList.toggle('is-kbd-selected', i === selectedRowIndex);
    });
    if (selectedRowIndex >= 0 && rows[selectedRowIndex]) {
      rows[selectedRowIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  document.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable)) {
      return;
    }
    if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      openCommandBar();
      return;
    }
    if (e.key === 'Escape') {
      closeCommandBar();
      if (typeof closeAdminDrawer === 'function') closeAdminDrawer();
      return;
    }
    if (e.key === 'j' || e.key === 'k') {
      var rows = getSelectableRows();
      if (!rows.length) return;
      e.preventDefault();
      if (selectedRowIndex < 0) selectedRowIndex = 0;
      else if (e.key === 'j') selectedRowIndex = Math.min(rows.length - 1, selectedRowIndex + 1);
      else selectedRowIndex = Math.max(0, selectedRowIndex - 1);
      highlightSelected();
      return;
    }
    if (e.key === 'Enter' && selectedRowIndex >= 0) {
      var rows2 = getSelectableRows();
      var row = rows2[selectedRowIndex];
      if (row) {
        e.preventDefault();
        row.click();
      }
    }
  });

  /* ── Mobile hamburger ── */
  window.toggleAdminSidebar = function () {
    document.body.classList.toggle('admin-nav-open');
  };

  /* ── Hook showSection / overview ── */
  var _showSection = window.showSection;
  window.showSection = function (section, btn) {
    selectedRowIndex = -1;
    document.body.classList.remove('admin-nav-open');
    if (typeof _showSection === 'function') _showSection(section, btn);
    var titles = {
      moderation: 'Task moderation',
      audit: 'Audit log'
    };
    if (titles[section]) {
      var titleEl = document.getElementById('pageTitle');
      if (titleEl) titleEl.textContent = titles[section];
    }
    if (section === 'moderation') renderModerationQueue();
    if (section === 'audit') renderAuditLog();
    if (section === 'waitlist') {
      renderLocalWaitlistCrossref();
      var box = document.getElementById('waitlistImport');
      var saved = readJson(WAITLIST_KEY, []);
      if (box && !box.value && saved.length) box.value = saved.join('\n');
    }
    if (section === 'settings') {
      loadPlatformControls();
    }
    if (section === 'overview') {
      renderTodaySnapshot();
      renderCohortChart();
    }
  };

  var _renderOverview = window.renderOverview;
  window.renderOverview = function () {
    if (typeof _renderOverview === 'function') _renderOverview();
    renderTodaySnapshot();
    renderCohortChart();
  };

  // Prefetch reviews for drawer
  async function prefetchReviews() {
    if (window.reviews && window.reviews.length) return;
    if (typeof sbGet !== 'function') return;
    try {
      var rows = await sbGet('reviews', null, 'created_at.desc', 300);
      window.reviews = Array.isArray(rows) ? rows : [];
    } catch (e) {
      window.reviews = [];
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    ensureCommandBar();
    prefetchReviews();
  });

  // Also run after admin init
  setTimeout(function () {
    ensureCommandBar();
    prefetchReviews();
    if (window.currentSection === 'overview') {
      renderTodaySnapshot();
      renderCohortChart();
    }
  }, 1500);
})();
