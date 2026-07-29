/* QuickGigs — big-tech UX patterns (vanilla). Additive; does not change auth/query logic. */
(function () {
  'use strict';

  var PAGE = (window.location.pathname || '').split('/').pop() || '';
  var IS_DESKTOP = window.matchMedia('(pointer: fine) and (min-width: 900px)').matches;
  var gChord = null;
  var gChordTimer = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function readTasksCacheItems() {
    try {
      var raw = sessionStorage.getItem('qg-tasks-cache') || sessionStorage.getItem('qg-tasks-cache-v1');
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.items) ? parsed.items : []);
    } catch (e) { return []; }
  }

  function taskIdOf(t) {
    return t && (t.task_id != null ? t.task_id : (t.TASK_ID != null ? t.TASK_ID : t.id));
  }
  function taskTitleOf(t) {
    return (t && (t.title || t.TITLE)) || 'Task';
  }
  function taskCatOf(t) {
    return (t && (t.category || t.CATEGORY)) || '';
  }
  function taskLocOf(t) {
    return (t && (t.location || t.LOCATION)) || '';
  }
  function taskCreatedOf(t) {
    return t && (t.created_at || t.CREATED_AT || '');
  }

  /* ── Micro confirmation ── */
  window.qgMicroConfirm = function (el) {
    if (!el || !el.getBoundingClientRect) return;
    var r = el.getBoundingClientRect();
    var node = document.createElement('div');
    node.className = 'qg-micro-check';
    node.setAttribute('aria-hidden', 'true');
    node.textContent = '✓';
    node.style.left = (r.left + r.width / 2 - 14 + window.scrollX) + 'px';
    node.style.top = (r.top + r.height / 2 - 14 + window.scrollY) + 'px';
    document.body.appendChild(node);
    setTimeout(function () { node.remove(); }, 750);
  };

  /* ── Undo toast (5s) ── */
  var undoState = null;
  function ensureUndoToast() {
    var el = document.getElementById('qgUndoToast');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'qgUndoToast';
    el.className = 'qg-undo-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<span class="qg-undo-msg"></span><span class="qg-undo-count"></span><button type="button" id="qgUndoBtn">Undo</button>';
    document.body.appendChild(el);
    document.getElementById('qgUndoBtn').onclick = function () {
      if (!undoState) return;
      clearInterval(undoState.timer);
      if (typeof undoState.onUndo === 'function') undoState.onUndo();
      el.classList.remove('show');
      undoState = null;
    };
    return el;
  }

  window.qgUndoAction = function (message, executeFn, onUndo) {
    var el = ensureUndoToast();
    if (undoState) {
      clearInterval(undoState.timer);
      try { if (typeof undoState.execute === 'function') undoState.execute(); } catch (e) {}
    }
    var left = 5;
    el.querySelector('.qg-undo-msg').textContent = message;
    el.querySelector('.qg-undo-count').textContent = left + 's';
    el.classList.add('show');
    undoState = {
      execute: executeFn,
      onUndo: onUndo,
      timer: setInterval(function () {
        left -= 1;
        el.querySelector('.qg-undo-count').textContent = left + 's';
        if (left <= 0) {
          clearInterval(undoState.timer);
          el.classList.remove('show');
          var fn = undoState.execute;
          undoState = null;
          try { if (typeof fn === 'function') fn(); } catch (err) {
            console.warn('Undo action failed:', err);
            if (typeof showToast === 'function') showToast('Action failed — try again', '#ef4444');
          }
        }
      }, 1000)
    };
  };

  /* ── Session keep-alive modal ── */
  function showSessionModal() {
    if (document.getElementById('qgSessionOverlay')) {
      document.getElementById('qgSessionOverlay').classList.add('open');
      return;
    }
    var o = document.createElement('div');
    o.id = 'qgSessionOverlay';
    o.className = 'qg-session-overlay open';
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-modal', 'true');
    o.setAttribute('aria-labelledby', 'qgSessionTitle');
    o.innerHTML =
      '<div class="qg-session-card">' +
      '<h2 id="qgSessionTitle">Your session needs a refresh</h2>' +
      '<p>For your security, please log in again to continue using QuickGigs.</p>' +
      '<button type="button" id="qgSessionLogin">Log in again</button>' +
      '</div>';
    document.body.appendChild(o);
    document.getElementById('qgSessionLogin').onclick = function () {
      window.location.href = 'login.html';
    };
  }

  if (typeof window.fetch === 'function' && !window.__qgFetchWrapped) {
    window.__qgFetchWrapped = true;
    var _fetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      return _fetch(input, init).then(function (res) {
        try {
          var url = typeof input === 'string' ? input : (input && input.url) || '';
          if ((res.status === 401 || res.status === 403) && /supabase\.co|\/rest\/v1\//i.test(url)) {
            if (window._currentUser) showSessionModal();
          }
        } catch (e) {}
        return res;
      });
    };
  }
  window.qgShowSessionModal = showSessionModal;

  /* ── Command search ── */
  function openCommandSearch() {
    var overlay = document.getElementById('qgCmdOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'qgCmdOverlay';
      overlay.className = 'qg-cmd-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'Search tasks');
      overlay.innerHTML =
        '<div class="qg-cmd-box">' +
        '<input class="qg-cmd-input" id="qgCmdInput" type="search" placeholder="Search tasks, categories, locations…" autocomplete="off" enterkeyhint="search">' +
        '<div class="qg-cmd-hint">Type to search · Enter to open · Esc to close</div>' +
        '<div class="qg-cmd-results" id="qgCmdResults"></div>' +
        '</div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeCommandSearch();
      });
      document.getElementById('qgCmdInput').addEventListener('input', renderCmdResults);
      document.getElementById('qgCmdInput').addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); closeCommandSearch(); }
        if (e.key === 'Enter') {
          var active = document.querySelector('.qg-cmd-item.active') || document.querySelector('.qg-cmd-item');
          if (active) { e.preventDefault(); active.click(); }
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          var items = Array.prototype.slice.call(document.querySelectorAll('.qg-cmd-item'));
          if (!items.length) return;
          var idx = items.findIndex(function (n) { return n.classList.contains('active'); });
          items.forEach(function (n) { n.classList.remove('active'); });
          if (e.key === 'ArrowDown') idx = Math.min(items.length - 1, idx + 1);
          else idx = Math.max(0, idx <= 0 ? 0 : idx - 1);
          items[idx].classList.add('active');
          items[idx].scrollIntoView({ block: 'nearest' });
        }
      });
    }
    overlay.classList.add('open');
    var input = document.getElementById('qgCmdInput');
    input.value = '';
    renderCmdResults();
    setTimeout(function () { input.focus(); }, 30);
  }

  function closeCommandSearch() {
    var overlay = document.getElementById('qgCmdOverlay');
    if (overlay) overlay.classList.remove('open');
  }

  function renderCmdResults() {
    var q = ((document.getElementById('qgCmdInput') || {}).value || '').trim().toLowerCase();
    var host = document.getElementById('qgCmdResults');
    if (!host) return;
    var tasks = readTasksCacheItems();
    if (!q) {
      host.innerHTML = '<div class="qg-cmd-hint" style="padding:12px">Start typing a title, category, or city…</div>';
      return;
    }
    var titles = [];
    var cats = [];
    var locs = [];
    tasks.forEach(function (t) {
      var id = taskIdOf(t);
      if (id == null) return;
      var title = String(taskTitleOf(t));
      var cat = String(taskCatOf(t));
      var loc = String(taskLocOf(t));
      var href = 'browsetask.html?task=' + encodeURIComponent(String(id));
      if (title.toLowerCase().indexOf(q) >= 0) titles.push({ title: title, sub: loc || cat, href: href });
      else if (cat.toLowerCase().indexOf(q) >= 0) cats.push({ title: title, sub: cat, href: href });
      else if (loc.toLowerCase().indexOf(q) >= 0) locs.push({ title: title, sub: loc, href: href });
    });
    function block(label, rows) {
      if (!rows.length) return '';
      return '<div class="qg-cmd-group">' + esc(label) + '</div>' + rows.slice(0, 8).map(function (r, i) {
        return '<button type="button" class="qg-cmd-item' + (i === 0 && label === 'Titles' ? ' active' : '') + '" data-href="' + esc(r.href) + '">' +
          '<div class="qg-cmd-item-title">' + esc(r.title) + '</div>' +
          '<div class="qg-cmd-item-sub">' + esc(r.sub) + '</div></button>';
      }).join('');
    }
    var html = block('Titles', titles) + block('Categories', cats) + block('Locations', locs);
    host.innerHTML = html || '<div class="qg-cmd-hint" style="padding:12px">No matches in cached tasks</div>';
    host.querySelectorAll('.qg-cmd-item').forEach(function (btn) {
      btn.onclick = function () {
        window.location.href = btn.getAttribute('data-href');
      };
    });
  }

  function injectSearchButton() {
    if (PAGE !== 'dashboard.html' && PAGE !== 'browsetask.html' && PAGE !== 'mytasks.html') return;
    if (document.querySelector('.qg-nav-search-btn')) return;
    var right = document.querySelector('.nav-right, .nav .nav-right');
    var nav = document.querySelector('nav.nav, .nav');
    var host = right || nav;
    if (!host) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'qg-nav-search-btn';
    btn.setAttribute('aria-label', 'Search tasks');
    btn.title = 'Search (/)';
    btn.textContent = '⌕';
    btn.onclick = openCommandSearch;
    if (right) host.insertBefore(btn, host.firstChild);
    else host.appendChild(btn);
  }

  /* ── Keyboard shortcuts (desktop) ── */
  function openShortcutsHelp() {
    if (!IS_DESKTOP) return;
    var o = document.getElementById('qgShortcutsOverlay');
    if (!o) {
      o = document.createElement('div');
      o.id = 'qgShortcutsOverlay';
      o.className = 'qg-shortcuts-overlay';
      o.setAttribute('role', 'dialog');
      o.setAttribute('aria-modal', 'true');
      o.innerHTML =
        '<div class="qg-shortcuts-card">' +
        '<h2>Keyboard shortcuts</h2>' +
        '<div class="qg-shortcut-row"><span>Search</span><kbd>/</kbd></div>' +
        '<div class="qg-shortcut-row"><span>Dashboard</span><kbd>g</kbd> then <kbd>d</kbd></div>' +
        '<div class="qg-shortcut-row"><span>Browse</span><kbd>g</kbd> then <kbd>b</kbd></div>' +
        '<div class="qg-shortcut-row"><span>My Tasks</span><kbd>g</kbd> then <kbd>m</kbd></div>' +
        '<div class="qg-shortcut-row"><span>Close modal</span><kbd>Esc</kbd></div>' +
        '<div class="qg-shortcut-row"><span>This help</span><kbd>?</kbd></div>' +
        '</div>';
      o.addEventListener('click', function (e) { if (e.target === o) o.classList.remove('open'); });
      document.body.appendChild(o);
    }
    o.classList.add('open');
  }

  function onGlobalKeydown(e) {
    var tag = (e.target && e.target.tagName) || '';
    var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable);

    if (e.key === 'Escape') {
      closeCommandSearch();
      var sh = document.getElementById('qgShortcutsOverlay');
      if (sh) sh.classList.remove('open');
      document.querySelectorAll('.modal-overlay.open, .confirm-overlay.open').forEach(function (m) {
        m.classList.remove('open');
      });
      return;
    }

    if (!IS_DESKTOP || typing) return;

    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      openCommandSearch();
      return;
    }
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault();
      openShortcutsHelp();
      return;
    }
    if (e.key === 'g' || e.key === 'G') {
      gChord = 'g';
      clearTimeout(gChordTimer);
      gChordTimer = setTimeout(function () { gChord = null; }, 1200);
      return;
    }
    if (gChord === 'g') {
      gChord = null;
      clearTimeout(gChordTimer);
      var k = (e.key || '').toLowerCase();
      if (k === 'd') { e.preventDefault(); window.location.href = 'dashboard.html'; }
      else if (k === 'b') { e.preventDefault(); window.location.href = 'browsetask.html'; }
      else if (k === 'm') { e.preventDefault(); window.location.href = 'mytasks.html'; }
    }
  }

  /* ── Timeline HTML helper ── */
  window.qgTaskTimelineHtml = function (status) {
    var st = String(status || 'open').toLowerCase();
    var steps = ['Posted', 'Applicants', 'Accepted', 'In progress', 'Completed'];
    var idx = 0;
    if (st === 'open') idx = 1;
    else if (st === 'assigned' || st === 'accepted') idx = 2;
    else if (st === 'in_progress' || st === 'in-progress') idx = 3;
    else if (st === 'completed' || st === 'done') idx = 4;
    else if (st === 'cancelled' || st === 'expired') idx = 0;
    var html = '<div class="qg-timeline" aria-label="Task progress">';
    for (var i = 0; i < steps.length; i++) {
      var cls = i < idx ? 'done' : (i === idx ? 'current' : '');
      html += '<div class="qg-tl-step ' + cls + '">' + steps[i] + '</div>';
    }
    html += '</div>';
    return html;
  };

  /* ── Posttask progress + category budget guidance ── */
  var CAT_BUDGET = {
    errands: [25, 60], home: [50, 180], tutoring: [30, 80], beauty: [40, 150],
    moving: [60, 250], cooking: [40, 120], tech: [40, 150], care: [25, 80],
    gardening: [40, 140], events: [50, 200], trades: [60, 250], other: [30, 100]
  };

  function initPostProgress() {
    if (PAGE !== 'posttask.html') return;
    var form = document.getElementById('formContent');
    if (!form || document.querySelector('.qg-post-progress')) return;
    var bar = document.createElement('div');
    bar.className = 'qg-post-progress';
    bar.setAttribute('aria-label', 'Posting progress');
    bar.innerHTML =
      '<div class="qg-post-step" data-step="0">Details</div>' +
      '<div class="qg-post-step" data-step="1">Budget</div>' +
      '<div class="qg-post-step" data-step="2">Location</div>' +
      '<div class="qg-post-step" data-step="3">Review</div>';
    var pill = form.querySelector('.step-pill');
    if (pill) pill.parentNode.insertBefore(bar, pill.nextSibling);
    else form.insertBefore(bar, form.firstChild);

    // Mark sections for scroll tracking
    var titleSec = document.getElementById('taskTitle') && document.getElementById('taskTitle').closest('.section, .field');
    var budgetSec = document.getElementById('taskBudget') && document.getElementById('taskBudget').closest('.section, .field, .field-row');
    var locSec = document.getElementById('taskLocation') && document.getElementById('taskLocation').closest('.section, .field, .field-row');
    if (titleSec) titleSec.setAttribute('data-qg-step', '0');
    if (budgetSec) budgetSec.setAttribute('data-qg-step', '1');
    if (locSec) locSec.setAttribute('data-qg-step', '2');

    function refreshSteps() {
      var title = (document.getElementById('taskTitle') || {}).value || '';
      var budget = parseFloat((document.getElementById('taskBudget') || {}).value || '');
      var loc = (document.getElementById('taskLocation') || {}).value || '';
      var done = [!!title.trim(), !isNaN(budget) && budget >= 20, !!loc.trim(), false];
      done[3] = done[0] && done[1] && done[2];
      var current = 0;
      if (done[0]) current = 1;
      if (done[1]) current = 2;
      if (done[2]) current = 3;
      bar.querySelectorAll('.qg-post-step').forEach(function (el) {
        var i = Number(el.getAttribute('data-step'));
        el.classList.remove('done', 'current');
        if (done[i] && i < current) el.classList.add('done');
        else if (i === current) el.classList.add('current');
        else if (done[i]) el.classList.add('done');
      });
    }

    ['taskTitle', 'taskDesc', 'taskBudget', 'taskLocation'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', refreshSteps);
    });
    document.addEventListener('click', function (e) {
      if (e.target.closest('.cat-chip, .mode-card')) setTimeout(refreshSteps, 50);
    });
    window.addEventListener('scroll', function () {
      // highlight by focus/scroll position
      var focusEl = document.activeElement;
      var stepEl = focusEl && focusEl.closest && focusEl.closest('[data-qg-step]');
      if (stepEl) {
        var s = Number(stepEl.getAttribute('data-qg-step'));
        bar.querySelectorAll('.qg-post-step').forEach(function (el) {
          var i = Number(el.getAttribute('data-step'));
          if (i === s) el.classList.add('current');
        });
      }
      refreshSteps();
    }, { passive: true });
    refreshSteps();

    // Category budget guidance under budget field
    var budgetField = document.getElementById('taskBudget');
    if (budgetField) {
      var guide = document.createElement('p');
      guide.className = 'qg-budget-guide';
      guide.id = 'qgBudgetGuide';
      guide.textContent = 'Suggestion — pick a category to see typical budgets.';
      var host = budgetField.closest('.field') || budgetField.parentNode;
      host.appendChild(guide);
    }

    var _selectCat = window.selectCat;
    if (typeof _selectCat === 'function') {
      window.selectCat = function (el) {
        _selectCat(el);
        updateBudgetGuide();
        refreshSteps();
      };
    }
    document.addEventListener('click', function (e) {
      if (e.target.closest('.cat-chip')) setTimeout(updateBudgetGuide, 30);
    });
  }

  function updateBudgetGuide() {
    var guide = document.getElementById('qgBudgetGuide');
    if (!guide) return;
    var selected = document.querySelector('.cat-chip.selected');
    var slug = '';
    if (typeof window.selectedCat === 'string') slug = window.selectedCat;
    if (!slug && selected) {
      var label = selected.textContent.replace(/[^\w\s]/g, '').trim().toLowerCase();
      slug = label.split(/\s+/)[0];
    }
    var range = CAT_BUDGET[slug] || CAT_BUDGET.other;
    var city = (window.getUserCityLabel && window.getUserCityLabel()) || 'Calgary';
    // User asked CalgaryEdmonton style label
    guide.innerHTML = 'Typical <strong>Calgary / Edmonton</strong> budgets for this category: <strong>$' +
      range[0] + '–$' + range[1] + '</strong> <span style="opacity:0.7">(suggestion only)</span>';
    void city;
  }

  /* ── Derived notifications + localStorage read state ── */
  function readNotifRead() {
    try {
      var raw = localStorage.getItem('qg-notif-read');
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function writeNotifRead(arr) {
    try { localStorage.setItem('qg-notif-read', JSON.stringify(arr.slice(-200))); } catch (e) {}
  }

  function buildDerivedNotifications() {
    var uid = window._currentUser && window._currentUser.uid;
    if (!uid) return [];
    var tasks = readTasksCacheItems();
    var apps = [];
    try {
      var raw = sessionStorage.getItem('qg-apps-cache-v1');
      if (raw) {
        var p = JSON.parse(raw);
        apps = Array.isArray(p) ? p : (p && p.items) || [];
      }
    } catch (e) {}
    var read = readNotifRead();
    var out = [];
    var myTaskIds = {};
    tasks.forEach(function (t) {
      if (String(t.posted_by || t.POSTED_BY || '') !== String(uid)) return;
      var id = taskIdOf(t);
      if (id != null) myTaskIds[String(id)] = t;
    });
    apps.forEach(function (a) {
      var tid = String(a.task_id || a.TASK_ID || '');
      var st = String(a.status || a.STATUS || 'pending').toLowerCase();
      var aid = String(a.app_id || a.APP_ID || a.id || (tid + ':' + (a.worker_id || '')));
      if (myTaskIds[tid] && st === 'pending') {
        out.push({
          id: 'app-recv-' + aid,
          title: 'New applicant',
          body: 'Someone applied to “' + taskTitleOf(myTaskIds[tid]) + '”',
          created_at: a.created_at || a.CREATED_AT || taskCreatedOf(myTaskIds[tid]),
          link: 'mytasks.html?tab=posted&expand=' + encodeURIComponent(tid),
          read_at: read.indexOf('app-recv-' + aid) >= 0 ? '1' : null
        });
      }
      if (String(a.worker_id || a.WORKER_ID || '') === String(uid) && st === 'accepted') {
        out.push({
          id: 'app-acc-' + aid,
          title: 'Application accepted',
          body: 'You were accepted — open My Jobs to continue',
          created_at: a.updated_at || a.created_at || a.CREATED_AT,
          link: 'mytasks.html?tab=applied',
          read_at: read.indexOf('app-acc-' + aid) >= 0 ? '1' : null
        });
      }
    });
    return out.sort(function (a, b) {
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    }).slice(0, 20);
  }

  function enhanceBellWithDerived() {
    // Patch refresh if present: merge derived + persist local read ids
    var tries = 0;
    var t = setInterval(function () {
      tries += 1;
      if (typeof window.QG_refreshNotifications === 'function' || tries > 25) {
        clearInterval(t);
      }
      // Hook mark-all via localStorage when derived items used
      document.addEventListener('click', function (e) {
        if (e.target && e.target.id === 'qgBellMarkAll') {
          var derived = buildDerivedNotifications();
          var read = readNotifRead();
          derived.forEach(function (n) {
            if (read.indexOf(n.id) < 0) read.push(n.id);
          });
          writeNotifRead(read);
        }
        var item = e.target && e.target.closest && e.target.closest('.qg-bell-item');
        if (item) {
          var nid = item.getAttribute('data-nid');
          if (nid && String(nid).indexOf('app-') === 0) {
            var read2 = readNotifRead();
            if (read2.indexOf(nid) < 0) {
              read2.push(nid);
              writeNotifRead(read2);
            }
          }
        }
      }, true);
    }, 400);
  }

  /* ── Profile page: other-user sticky invite only.
     Completion % lives in profileCompletion.js + #profileCompleteCard — do NOT
     inject a second card (old equal-weight 20% checks used wrong DOM selectors). */
  function initProfileCompleteness() {
    if (PAGE !== 'profile.html') return;
    var params = new URLSearchParams(window.location.search);
    var viewUser = params.get('user');
    var self = window._currentUser && window._currentUser.uid;
    if (viewUser && self && String(viewUser) !== String(self)) {
      document.body.classList.add('qg-other-profile');
      if (!document.querySelector('.qg-sticky-invite')) {
        var bar = document.createElement('div');
        bar.className = 'qg-sticky-invite';
        bar.innerHTML = '<a href="mytasks.html?tab=posted">Invite to a task</a>';
        document.body.appendChild(bar);
      }
    }
    // Remove any legacy injected card from older builds
    var legacy = document.getElementById('qgCompleteCard');
    if (legacy && legacy.parentNode) legacy.parentNode.removeChild(legacy);
  }

  /* ── Dashboard activity + contextual greeting helpers ── */
  window.qgBuildActivityFeed = function (opts) {
    opts = opts || {};
    var userId = opts.userId;
    var tasks = opts.tasks || [];
    var apps = opts.apps || [];
    var reviews = opts.reviews || [];
    var events = [];
    var ago = typeof window.timeAgo === 'function' ? window.timeAgo : (typeof formatRelativeTime === 'function' ? formatRelativeTime : function () { return ''; });

    tasks.forEach(function (t) {
      if (String(t.posted_by || t.POSTED_BY || '') !== String(userId)) return;
      var st = String(t.status || t.STATUS || '').toLowerCase();
      var title = taskTitleOf(t);
      var created = taskCreatedOf(t);
      events.push({ at: created, icon: 'clipboard', text: 'You posted “' + title + '”' });
      if (st === 'in_progress' || st === 'completed') {
        events.push({ at: t.updated_at || created, icon: 'handshake', text: 'Task accepted — “' + title + '”' });
      }
      if (st === 'completed') {
        events.push({ at: t.completed_at || t.updated_at || created, icon: 'checkCircle', text: 'Completed “' + title + '”' });
      }
    });
    apps.forEach(function (a) {
      var tid = a.task_id || a.TASK_ID;
      var st = String(a.status || a.STATUS || 'pending').toLowerCase();
      var created = a.created_at || a.CREATED_AT;
      if (String(a.worker_id || a.WORKER_ID || '') === String(userId)) {
        events.push({ at: created, icon: 'inbox', text: 'You applied to a task' });
        if (st === 'accepted') events.push({ at: a.updated_at || created, icon: 'party', text: 'Your application was accepted' });
      } else {
        var mine = tasks.some(function (t) {
          return String(taskIdOf(t)) === String(tid) && String(t.posted_by || t.POSTED_BY || '') === String(userId);
        });
        if (mine) events.push({ at: created, icon: 'users', text: 'New application received' });
      }
    });
    (reviews || []).forEach(function (r) {
      if (String(r.reviewee_id || r.REVIEWE_ID || r.reviewee || '') !== String(userId)) return;
      events.push({
        at: r.created_at || r.CREATED_AT,
        icon: 'star',
        text: 'You received a review' + (r.rating || r.RATING ? ' (' + (r.rating || r.RATING) + '★)' : '')
      });
    });

    events = events.filter(function (e) { return e.at; }).sort(function (a, b) {
      return new Date(b.at) - new Date(a.at);
    }).slice(0, 8);

    if (!events.length) {
      return '<div class="qg-activity-card"><div class="qg-activity-title">Recent activity</div>' +
        '<div class="qg-activity-text" style="opacity:0.6">No activity yet — post a task or apply to get started.</div></div>';
    }
    return '<div class="qg-activity-card"><div class="qg-activity-title">Recent activity</div>' +
      events.map(function (e) {
        var ico = typeof window.qgIcon === 'function' ? window.qgIcon(e.icon, { size: 16 }) : '';
        return '<div class="qg-activity-row"><div class="qg-activity-ico" aria-hidden="true">' + ico + '</div>' +
          '<div><div class="qg-activity-text">' + esc(e.text) + '</div>' +
          '<div class="qg-activity-time" title="' + esc(new Date(e.at).toLocaleString('en-CA')) + '">' + esc(ago(e.at) || '') + '</div></div></div>';
      }).join('') + '</div>';
  };

  window.qgContextualGreetingLine = function (opts) {
    opts = opts || {};
    var pending = Number(opts.pendingApplications || 0);
    var inProgress = Number(opts.inProgress || 0);
    if (pending > 0) return 'You have ' + pending + ' application' + (pending === 1 ? '' : 's') + ' waiting';
    if (inProgress > 0) return 'You have a task in progress';
    return 'Ready to get something done today?';
  };

  /* ── Confirm modal: block Enter on destructive ── */
  function hardenDestructiveConfirms() {
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var open = document.querySelector('.confirm-overlay.open');
      if (!open) return;
      var ok = open.querySelector('.confirm-ok');
      if (ok && (ok.classList.contains('is-danger') || /cancel|decline|withdraw|delete|remove/i.test(ok.textContent || ''))) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }

  /* ── New pill helper for browse ── */
  window.qgIsNewTask = function (createdAt) {
    if (!createdAt) return false;
    var t = typeof window.parseQgTimestamp === 'function'
      ? window.parseQgTimestamp(createdAt)
      : new Date(createdAt).getTime();
    if (isNaN(t)) return false;
    return (Date.now() - t) < 24 * 60 * 60 * 1000;
  };
  window.qgNewPillHtml = function (createdAt) {
    return window.qgIsNewTask(createdAt) ? '<span class="qg-new-pill">New</span>' : '';
  };

  /* ── Optimistic saving indicator ── */
  window.qgSetSaving = function (el, on) {
    if (!el) return;
    var tip = el.parentNode && el.parentNode.querySelector('.qg-saving-dot');
    if (on) {
      if (!tip) {
        tip = document.createElement('span');
        tip.className = 'qg-saving-dot';
        tip.textContent = 'Saving…';
        el.insertAdjacentElement('afterend', tip);
      }
      tip.style.display = '';
      el.dataset.qgPrevText = el.textContent;
    } else if (tip) tip.remove();
  };

  document.addEventListener('DOMContentLoaded', function () {
    injectSearchButton();
    initPostProgress();
    enhanceBellWithDerived();
    hardenDestructiveConfirms();
    document.addEventListener('keydown', onGlobalKeydown);
    // Profile completeness waits for auth
    var waits = 0;
    var timer = setInterval(function () {
      waits += 1;
      if (window._currentUser || waits > 20) {
        clearInterval(timer);
        initProfileCompleteness();
      }
    }, 400);
  });

  window.qgOpenCommandSearch = openCommandSearch;
  window.qgCloseCommandSearch = closeCommandSearch;
})();
