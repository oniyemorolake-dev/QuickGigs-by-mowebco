/* QuickGigs — in-app notifications panel (opens from shell bell) */
(function () {
  var SKIP = { login: 1, signup: 1, 'parent-consent': 1, admin: 1, 'admin-login': 1 };
  var APP = {
    dashboard: 1, browsetask: 1, posttask: 1, mytasks: 1, messages: 1,
    chat: 1, profile: 1, workers: 1, categories: 1, feedback: 1, review: 1,
    'guardian-portal': 1, payment: 1
  };

  /** Poster-first vs tasker-first for mode-aware sort (cross-mode still shown). */
  var TYPE_MODE = {
    application_received: 'poster',
    counter_offer_reply: 'poster',
    task_removed_admin: 'poster',
    application_accepted: 'tasker',
    counter_offer_received: 'tasker',
    new_gig_match: 'tasker',
    task_removed_applicant: 'tasker',
    task_funded: 'tasker',
    chat_unlocked: 'tasker',
    new_message: 'both',
    task_completed: 'both',
    counter_offer_accepted: 'both',
    guardian_pending: 'both',
    guardian_approved: 'both',
    guardian_consent: 'both',
    waitlist_invite: 'both',
    waitlist_reminder: 'both',
    system: 'both'
  };

  var TYPE_META = {
    application_received: { icon: 'users', title: 'New application', tone: '' },
    application_accepted: { icon: 'handshake', title: 'Application accepted', tone: '' },
    task_funded: { icon: 'lock', title: 'Chat unlocked', tone: 'money' },
    chat_unlocked: { icon: 'message', title: 'Chat unlocked', tone: 'money' },
    new_message: { icon: 'message', title: 'New message', tone: '' },
    counter_offer_received: { icon: 'repeat', title: 'Counter-offer', tone: 'attention' },
    counter_offer_reply: { icon: 'repeat', title: 'Counter-offer reply', tone: 'attention' },
    counter_offer_accepted: { icon: 'checkCircle', title: 'Price agreed', tone: 'money' },
    task_completed: { icon: 'dollar', title: 'Task complete', tone: 'money' },
    guardian_pending: { icon: 'users', title: 'Guardian approval needed', tone: 'attention' },
    guardian_approved: { icon: 'checkCircle', title: 'Guardian approved', tone: '' },
    guardian_consent: { icon: 'users', title: 'Guardian approval needed', tone: 'attention' },
    waitlist_invite: { icon: 'sparkles', title: 'You\'re invited', tone: '' },
    waitlist_reminder: { icon: 'bell', title: 'Invite reminder', tone: '' },
    new_gig_match: { icon: 'mapPin', title: 'New gig near you', tone: '' },
    task_removed_admin: { icon: 'alert', title: 'Task removed', tone: 'attention' },
    task_removed_applicant: { icon: 'alert', title: 'Task removed', tone: 'attention' },
    system: { icon: 'bell', title: 'QuickGigs', tone: '' }
  };

  var DEFAULT_LINK = {
    application_received: 'mytasks.html?tab=posted',
    application_accepted: 'mytasks.html?tab=inprogress',
    task_funded: 'messages.html',
    chat_unlocked: 'messages.html',
    new_message: 'messages.html',
    counter_offer_received: 'mytasks.html?tab=applied',
    counter_offer_reply: 'mytasks.html?tab=posted',
    counter_offer_accepted: 'mytasks.html',
    task_completed: 'mytasks.html?tab=completed',
    guardian_pending: 'dashboard.html',
    guardian_approved: 'dashboard.html',
    guardian_consent: 'guardian-portal.html',
    waitlist_invite: 'signup.html',
    waitlist_reminder: 'signup.html',
    new_gig_match: 'browsetask.html',
    task_removed_admin: 'mytasks.html?tab=posted',
    task_removed_applicant: 'browsetask.html',
    system: 'dashboard.html'
  };

  var overlay;
  var panelBody;
  var markAllBtn;
  var bellBtn;
  var bellDot;
  var open = false;
  var loading = false;
  var pollTimer;
  var authTimer;
  var notifications = [];

  function injectCriticalCss() {
    if (document.getElementById('qg-overlay-critical')) return;
    var style = document.createElement('style');
    style.id = 'qg-overlay-critical';
    style.textContent =
      '.qg-menu-overlay:not(.open),.qg-bell-overlay:not(.open){position:fixed!important;inset:0!important;opacity:0!important;visibility:hidden!important;pointer-events:none!important;}' +
      '.qg-menu-overlay:not(.open) .qg-menu-drawer,.qg-bell-overlay:not(.open) .qg-bell-panel{transform:translateX(100%)!important;}' +
      '@media (min-width:768px){.qg-bell-overlay:not(.open) .qg-bell-panel{transform:translateY(-8px)!important;opacity:0!important;}}';
    document.head.appendChild(style);
  }

  injectCriticalCss();

  function pageKey() {
    var path = (window.location.pathname || '').split('/').pop() || 'index.html';
    return path.replace(/\.html$/i, '') || 'index';
  }

  function shouldInit() {
    return APP[pageKey()] && !SKIP[pageKey()];
  }

  function loadCss() {
    if (document.getElementById('qg-bell-css')) return;
    injectCriticalCss();
    var link = document.createElement('link');
    link.id = 'qg-bell-css';
    link.rel = 'stylesheet';
    link.href = 'qg-bell.css?v=20260811notif1';
    document.head.appendChild(link);
  }

  function ico(name, size) {
    if (typeof window.qgIcon === 'function') return window.qgIcon(name, { size: size || 18 });
    return '';
  }

  function escapeHtml(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function stripEmojiTitle(s) {
    return String(s || '')
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
      .replace(/[\u2600-\u27BF]/g, '')
      .replace(/^[^\w$£€#]+/, '')
      .trim();
  }

  function currentMode() {
    if (typeof window.getMode === 'function') {
      var m = window.getMode();
      return m === 'poster' ? 'poster' : 'tasker';
    }
    var stored = localStorage.getItem('qg-mode');
    return stored === 'poster' ? 'poster' : 'tasker';
  }

  function notifType(n) {
    return String((n && (n.type || (n.payload && n.payload.type))) || '').toLowerCase();
  }

  function notifMode(n) {
    var t = notifType(n);
    if (TYPE_MODE[t]) return TYPE_MODE[t];
    var link = String((n && (n.link || (n.payload && n.payload.link))) || '');
    if (/tab=posted|mode=poster/i.test(link)) return 'poster';
    if (/tab=applied|tab=inprogress|mode=worker|browsetask/i.test(link)) return 'tasker';
    if (/guardian/i.test(link) || /guardian/.test(t)) return 'both';
    return 'both';
  }

  function resolveLink(n) {
    var raw = (n && (n.link || (n.payload && n.payload.link))) || '';
    var t = notifType(n);
    if (!raw && DEFAULT_LINK[t]) raw = DEFAULT_LINK[t];
    if (!raw) return '';
    // Prefer same-origin relative paths
    try {
      if (/^https?:\/\//i.test(raw)) {
        var u = new URL(raw);
        if (u.hostname.indexOf('quickgigs') >= 0 || u.hostname === location.hostname) {
          raw = u.pathname.replace(/^\//, '') + u.search + u.hash;
        }
      }
    } catch (e) {}
    return typeof safeUrl === 'function' ? safeUrl(raw) : raw;
  }

  function displayTitle(n) {
    var t = notifType(n);
    var meta = TYPE_META[t];
    if (meta && meta.title) return meta.title;
    var raw = stripEmojiTitle(n && n.title);
    return raw || 'Notification';
  }

  function displayBody(n) {
    var body = String((n && n.body) || '').trim();
    // Privacy: never surface emails / phone-like strings from payload dumps
    body = body.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '');
    body = body.replace(/\+?\d[\d\s().-]{8,}\d/g, '');
    return body.trim();
  }

  function ensureNavRight() {
    var nav = document.querySelector('.nav');
    if (!nav) return null;
    var right = nav.querySelector('.nav-right');
    if (!right) {
      right = document.createElement('div');
      right.className = 'nav-right';
      nav.querySelectorAll(':scope > .mode-btn, :scope > .mode-toggle, :scope > .nav-icon').forEach(function (el) {
        right.appendChild(el);
      });
      nav.appendChild(right);
    }
    return right;
  }

  function injectBell() {
    var right = ensureNavRight();
    if (!right || right.querySelector('#qgBellBtn')) {
      bellBtn = document.getElementById('qgBellBtn');
      bellDot = document.getElementById('qgBellDot');
      return;
    }
    right.querySelectorAll('.nav-icon').forEach(function (el) {
      if ((el.textContent || '').indexOf('🔔') >= 0) el.classList.add('qg-bell-hidden');
    });
    bellBtn = document.createElement('button');
    bellBtn.type = 'button';
    bellBtn.className = 'qg-bell-btn';
    bellBtn.id = 'qgBellBtn';
    bellBtn.setAttribute('aria-label', 'Notifications');
    bellBtn.setAttribute('aria-expanded', 'false');
    bellBtn.setAttribute('aria-haspopup', 'dialog');
    bellBtn.innerHTML = ico('bell', 20) +
      '<span class="qg-bell-dot" id="qgBellDot" hidden aria-hidden="true"></span>';
    bellBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleBellPanel();
    });
    var menuBtn = right.querySelector('#qgMenuBtn');
    if (menuBtn) right.insertBefore(bellBtn, menuBtn);
    else right.insertBefore(bellBtn, right.firstChild);
    bellDot = document.getElementById('qgBellDot');
  }

  function buildPanel() {
    if (document.getElementById('qgBellOverlay')) {
      overlay = document.getElementById('qgBellOverlay');
      panelBody = document.getElementById('qgBellBody');
      markAllBtn = document.getElementById('qgBellMarkAll');
      return;
    }
    overlay = document.createElement('div');
    overlay.id = 'qgBellOverlay';
    overlay.className = 'qg-bell-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML =
      '<div class="qg-bell-panel" role="dialog" aria-modal="true" aria-label="Notifications">' +
        '<div class="qg-bell-head">' +
          '<span class="qg-bell-title">Notifications</span>' +
          '<div class="qg-bell-head-actions">' +
            '<button type="button" class="qg-bell-mark-all" id="qgBellMarkAll">Mark all read</button>' +
            '<button type="button" class="qg-bell-close" id="qgBellClose" aria-label="Close">×</button>' +
          '</div>' +
        '</div>' +
        '<div class="qg-bell-body" id="qgBellBody"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    panelBody = document.getElementById('qgBellBody');
    markAllBtn = document.getElementById('qgBellMarkAll');
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeBellPanel();
    });
    document.getElementById('qgBellClose').addEventListener('click', closeBellPanel);
    markAllBtn.addEventListener('click', markAllRead);
  }

  function positionDesktopPanel() {
    if (!overlay || !bellBtn || window.matchMedia('(max-width: 767px)').matches) {
      if (overlay) {
        overlay.style.removeProperty('--qg-bell-top');
        overlay.style.removeProperty('--qg-bell-right');
      }
      return;
    }
    var rect = bellBtn.getBoundingClientRect();
    var top = Math.round(rect.bottom + 8);
    var right = Math.max(12, Math.round(window.innerWidth - rect.right));
    overlay.style.setProperty('--qg-bell-top', top + 'px');
    overlay.style.setProperty('--qg-bell-right', right + 'px');
  }

  function formatTime(iso) {
    if (!iso) return '';
    if (typeof timeAgo === 'function') {
      try { return timeAgo(iso); } catch (e) {}
    }
    if (typeof formatRelativeTime === 'function') {
      try { return formatRelativeTime(iso); } catch (e2) {}
    }
    try {
      var d = new Date(iso);
      if (!isNaN(d.getTime())) {
        var sec = Math.round((Date.now() - d.getTime()) / 1000);
        if (sec < 60) return 'Just now';
        if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
        if (sec < 86400) return Math.floor(sec / 3600) + 'h ago';
        if (sec < 604800) return Math.floor(sec / 86400) + 'd ago';
      }
    } catch (e3) {}
    return '';
  }

  function updateBadge(count) {
    if (!bellDot) return;
    if (!count) {
      bellDot.hidden = true;
      bellDot.classList.remove('has-count');
      bellDot.textContent = '';
      if (bellBtn) bellBtn.setAttribute('aria-label', 'Notifications');
      return;
    }
    bellDot.hidden = false;
    bellDot.classList.add('has-count');
    bellDot.textContent = count > 9 ? '9+' : String(count);
    if (bellBtn) {
      bellBtn.setAttribute('aria-label', 'Notifications, ' + count + ' unread');
    }
  }

  function renderSkeleton() {
    if (!panelBody) return;
    var rows = '';
    for (var i = 0; i < 5; i++) {
      rows +=
        '<div class="qg-bell-skel" aria-hidden="true">' +
          '<div class="qg-bell-skel-ico"></div>' +
          '<div class="qg-bell-skel-lines">' +
            '<div class="qg-bell-skel-line"></div>' +
            '<div class="qg-bell-skel-line short"></div>' +
          '</div>' +
        '</div>';
    }
    panelBody.innerHTML = '<div role="status" aria-live="polite" aria-label="Loading notifications">' + rows + '</div>';
  }

  function renderEmpty() {
    panelBody.innerHTML =
      '<div class="qg-bell-empty">' +
        '<div class="qg-bell-empty-icon">' + ico('checkCircle', 24) + '</div>' +
        '<div class="qg-bell-empty-title">You\'re all caught up</div>' +
        '<div class="qg-bell-empty-sub">New applications, messages, and payouts will show up here.</div>' +
      '</div>';
  }

  function renderList() {
    if (!panelBody) return;
    if (loading && !notifications.length) {
      renderSkeleton();
      return;
    }
    if (!notifications.length) {
      renderEmpty();
      if (markAllBtn) markAllBtn.disabled = true;
      return;
    }
    var mode = currentMode();
    var unreadCount = notifications.filter(function (n) { return !n.read_at; }).length;
    if (markAllBtn) markAllBtn.disabled = unreadCount === 0;

    panelBody.innerHTML = notifications.map(function (n) {
      var unread = !n.read_at;
      var t = notifType(n);
      var meta = TYPE_META[t] || { icon: 'bell', tone: '' };
      var nMode = notifMode(n);
      var otherMode = nMode !== 'both' && nMode !== mode;
      var link = resolveLink(n);
      var id = n.notification_id || n.id || '';
      var attr = typeof escAttr === 'function' ? escAttr : escapeHtml;
      var toneClass = meta.tone === 'money' ? ' is-money' : (meta.tone === 'attention' ? ' is-attention' : '');
      var modeChip = otherMode
        ? '<div class="qg-bell-mode-chip">' + (nMode === 'poster' ? 'Poster' : 'Tasker') + '</div>'
        : '';
      return (
        '<button type="button" class="qg-bell-item' +
          (unread ? ' is-unread' : ' is-read') +
          (otherMode ? ' is-other-mode' : '') +
          '" data-nid="' + attr(String(id)) + '" data-link="' + attr(link) + '" data-type="' + attr(t) + '">' +
          '<span class="qg-bell-item-ico' + toneClass + '" aria-hidden="true">' + ico(meta.icon, 18) + '</span>' +
          '<span class="qg-bell-item-main">' +
            '<span class="qg-bell-item-top">' +
              '<span class="qg-bell-item-title">' + escapeHtml(displayTitle(n)) + '</span>' +
              (unread ? '<span class="qg-bell-unread-dot" aria-hidden="true"></span>' : '') +
            '</span>' +
            (displayBody(n) ? '<span class="qg-bell-item-body">' + escapeHtml(displayBody(n)) + '</span>' : '') +
            '<span class="qg-bell-item-time">' + escapeHtml(formatTime(n.created_at)) + '</span>' +
            modeChip +
          '</span>' +
        '</button>'
      );
    }).join('');

    panelBody.querySelectorAll('.qg-bell-item').forEach(function (el) {
      el.addEventListener('click', function () {
        openNotification(el.getAttribute('data-nid'), el.getAttribute('data-link'));
      });
    });
  }

  async function openNotification(id, link) {
    if (id && typeof markNotificationRead === 'function' && String(id).indexOf('app-') !== 0) {
      try { await markNotificationRead(id); } catch (e) {}
    }
    if (id) {
      try {
        var read = readLocalNotifRead();
        if (read.indexOf(String(id)) < 0) {
          read.push(String(id));
          localStorage.setItem('qg-notif-read', JSON.stringify(read.slice(-200)));
        }
      } catch (e2) {}
      notifications.forEach(function (n) {
        var nid = String(n.notification_id || n.id || '');
        if (nid === String(id)) n.read_at = n.read_at || new Date().toISOString();
      });
      updateBadge(notifications.filter(function (n) { return !n.read_at; }).length);
    }
    closeBellPanel();
    var dest = typeof safeUrl === 'function' ? safeUrl(link) : (link || '');
    if (dest) {
      window.location.href = dest;
      return;
    }
    await refreshNotifications();
  }

  async function markAllRead() {
    var uid = window._currentUser && window._currentUser.uid;
    if (uid && typeof markAllNotificationsRead === 'function') {
      try { await markAllNotificationsRead(uid); } catch (e) {}
    }
    try {
      var read = readLocalNotifRead();
      notifications.forEach(function (n) {
        var id = String(n.notification_id || n.id || '');
        if (id && read.indexOf(id) < 0) read.push(id);
        n.read_at = n.read_at || new Date().toISOString();
      });
      localStorage.setItem('qg-notif-read', JSON.stringify(read.slice(-200)));
    } catch (e2) {}
    updateBadge(0);
    if (open) renderList();
    await refreshNotifications();
  }

  function readLocalNotifRead() {
    try {
      var raw = localStorage.getItem('qg-notif-read');
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function derivedFromCache(uid) {
    var out = [];
    try {
      var tasksRaw = sessionStorage.getItem('qg-tasks-cache') || sessionStorage.getItem('qg-tasks-cache-v1');
      var appsRaw = sessionStorage.getItem('qg-apps-cache-v1');
      var tasks = [];
      var apps = [];
      if (tasksRaw) {
        var tp = JSON.parse(tasksRaw);
        tasks = Array.isArray(tp) ? tp : (tp && tp.items) || [];
      }
      if (appsRaw) {
        var ap = JSON.parse(appsRaw);
        apps = Array.isArray(ap) ? ap : (ap && ap.items) || [];
      }
      var read = readLocalNotifRead();
      var myIds = {};
      tasks.forEach(function (t) {
        if (String(t.posted_by || t.POSTED_BY || '') !== String(uid)) return;
        var id = t.task_id != null ? t.task_id : (t.TASK_ID != null ? t.TASK_ID : t.id);
        if (id != null) myIds[String(id)] = t.title || t.TITLE || 'your task';
      });
      apps.forEach(function (a) {
        var tid = String(a.task_id || a.TASK_ID || '');
        var st = String(a.status || a.STATUS || 'pending').toLowerCase();
        var aid = String(a.app_id || a.APP_ID || a.id || tid + ':' + (a.worker_id || ''));
        if (myIds[tid] && st === 'pending') {
          var id1 = 'app-recv-' + aid;
          out.push({
            id: id1,
            type: 'application_received',
            title: 'New application',
            body: 'Someone applied to “' + myIds[tid] + '”',
            created_at: a.created_at || a.CREATED_AT || new Date().toISOString(),
            link: 'mytasks.html?tab=posted&expand=' + encodeURIComponent(tid),
            read_at: read.indexOf(id1) >= 0 ? new Date().toISOString() : null
          });
        }
        if (String(a.worker_id || a.WORKER_ID || '') === String(uid) && st === 'accepted') {
          var id2 = 'app-acc-' + aid;
          out.push({
            id: id2,
            type: 'application_accepted',
            title: 'Application accepted',
            body: 'You were accepted — open My Gigs to continue',
            created_at: a.updated_at || a.created_at || a.CREATED_AT || new Date().toISOString(),
            link: 'mytasks.html?tab=inprogress',
            read_at: read.indexOf(id2) >= 0 ? new Date().toISOString() : null
          });
        }
      });
    } catch (e) {}
    return out;
  }

  function sortNotifications(list) {
    var mode = currentMode();
    return list.slice().sort(function (a, b) {
      var ma = notifMode(a);
      var mb = notifMode(b);
      var score = function (m) {
        if (m === mode) return 0;
        if (m === 'both') return 1;
        return 2;
      };
      var sa = score(ma);
      var sb = score(mb);
      if (sa !== sb) return sa - sb;
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
  }

  async function refreshNotifications() {
    var uid = window._currentUser && window._currentUser.uid;
    if (!uid) return;
    var wasEmpty = !notifications.length;
    if (open && wasEmpty) {
      loading = true;
      renderSkeleton();
    }
    try {
      var server = [];
      if (typeof fetchUserNotifications === 'function') {
        server = await fetchUserNotifications(uid, 40);
      }
      if (!Array.isArray(server)) server = [];
      var derived = derivedFromCache(uid);
      var seen = {};
      var merged = server.concat(derived).filter(function (n) {
        var id = String(n.notification_id || n.id || '');
        if (!id || seen[id]) return false;
        seen[id] = true;
        return true;
      });
      notifications = sortNotifications(merged).slice(0, 40);
      var unread = notifications.filter(function (n) { return !n.read_at; }).length;
      updateBadge(unread);
      loading = false;
      if (open) renderList();
    } catch (err) {
      console.warn('Bell refresh failed:', err);
      loading = false;
      if (open && !notifications.length) {
        panelBody.innerHTML =
          '<div class="qg-bell-empty">' +
            '<div class="qg-bell-empty-icon">' + ico('alert', 24) + '</div>' +
            '<div class="qg-bell-empty-title">Couldn\'t load notifications</div>' +
            '<div class="qg-bell-empty-sub">Check your connection and try again.</div>' +
          '</div>';
      }
    }
  }

  function openBellPanel() {
    if (open) return;
    buildPanel();
    open = true;
    positionDesktopPanel();
    if (!notifications.length) {
      loading = true;
      renderSkeleton();
    } else {
      renderList();
    }
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('qg-bell-open');
    if (bellBtn) bellBtn.setAttribute('aria-expanded', 'true');
    refreshNotifications();
  }

  function closeBellPanel() {
    if (!open || !overlay) return;
    open = false;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('qg-bell-open');
    if (bellBtn) {
      bellBtn.setAttribute('aria-expanded', 'false');
      bellBtn.focus();
    }
  }

  function toggleBellPanel() {
    if (open) closeBellPanel();
    else openBellPanel();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && open) closeBellPanel();
  }

  function startPolling() {
    if (pollTimer) return;
    refreshNotifications();
    pollTimer = setInterval(refreshNotifications, 45000);
  }

  function waitForAuth() {
    if (window._currentUser && window._currentUser.uid) {
      clearInterval(authTimer);
      startPolling();
    }
  }

  function init() {
    if (window.__qgBellInit || !shouldInit()) return;
    window.__qgBellInit = true;
    loadCss();
    injectBell();
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', function () {
      if (open) positionDesktopPanel();
    });
    document.addEventListener('qg-mode-changed', function () {
      if (open) renderList();
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && window._currentUser) refreshNotifications();
    });
    waitForAuth();
    authTimer = setInterval(function () {
      waitForAuth();
      if (window._currentUser && window._currentUser.uid && !pollTimer) startPolling();
    }, 2000);
    window.QG_refreshNotifications = refreshNotifications;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
