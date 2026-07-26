/* QuickGigs — in-app notification bell */
(function () {
  var SKIP = { login: 1, signup: 1, 'parent-consent': 1, admin: 1 };
  var APP = {
    dashboard: 1, browsetask: 1, posttask: 1, mytasks: 1, messages: 1,
    chat: 1, profile: 1, workers: 1, categories: 1, feedback: 1, review: 1
  };

  var overlay;
  var panelBody;
  var bellBtn;
  var bellDot;
  var open = false;
  var pollTimer;
  var authTimer;
  var notifications = [];

  function injectCriticalCss() {
    if (document.getElementById('qg-overlay-critical')) return;
    var style = document.createElement('style');
    style.id = 'qg-overlay-critical';
    style.textContent =
      '.qg-menu-overlay:not(.open),.qg-bell-overlay:not(.open){position:fixed!important;inset:0!important;opacity:0!important;visibility:hidden!important;pointer-events:none!important;}' +
      '.qg-menu-overlay:not(.open) .qg-menu-drawer,.qg-bell-overlay:not(.open) .qg-bell-panel{transform:translateX(100%)!important;}';
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
    link.href = 'qg-bell.css?v=2';
    document.head.appendChild(link);
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
    bellBtn.innerHTML = '🔔<span class="qg-bell-dot" id="qgBellDot" hidden aria-hidden="true"></span>';
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
      return;
    }
    overlay = document.createElement('div');
    overlay.id = 'qgBellOverlay';
    overlay.className = 'qg-bell-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML =
      '<div class="qg-bell-panel" role="dialog" aria-label="Notifications">' +
        '<div class="qg-bell-head">' +
          '<span class="qg-bell-title">Notifications</span>' +
          '<div style="display:flex;align-items:center;gap:4px">' +
            '<button type="button" class="qg-bell-mark-all" id="qgBellMarkAll">Mark all read</button>' +
            '<button type="button" class="qg-bell-close" id="qgBellClose" aria-label="Close">×</button>' +
          '</div>' +
        '</div>' +
        '<div class="qg-bell-body" id="qgBellBody"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    panelBody = document.getElementById('qgBellBody');
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeBellPanel();
    });
    document.getElementById('qgBellClose').addEventListener('click', closeBellPanel);
    document.getElementById('qgBellMarkAll').addEventListener('click', markAllRead);
  }

  function formatTime(iso) {
    if (!iso) return '';
    if (typeof formatRelativeTime === 'function') {
      try {
        return formatRelativeTime(iso);
      } catch (e) {}
    }
    var diff = Date.now() - new Date(iso).getTime();
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.floor(hrs / 24) + 'd ago';
  }

  function updateBadge(count) {
    if (!bellDot) return;
    if (!count) {
      bellDot.hidden = true;
      bellDot.classList.remove('has-count');
      bellDot.textContent = '';
      return;
    }
    bellDot.hidden = false;
    bellDot.classList.add('has-count');
    bellDot.textContent = count > 9 ? '9+' : String(count);
  }

  function renderList() {
    if (!panelBody) return;
    if (!notifications.length) {
      panelBody.innerHTML = '<div class="qg-bell-empty">🔔 No notifications yet.<br>Applies, hires, messages, and completions show up here.</div>';
      return;
    }
    panelBody.innerHTML = notifications.map(function (n) {
      var unread = !n.read_at;
      var link = n.link || (n.payload && n.payload.link) || '';
      var id = n.notification_id || n.id || '';
      return '<button type="button" class="qg-bell-item' + (unread ? ' unread' : '') + '" data-nid="' + String(id).replace(/"/g, '') + '" data-link="' + String(link).replace(/"/g, '&quot;') + '">' +
        '<div class="qg-bell-item-title">' + escapeHtml(n.title || 'Notification') + '</div>' +
        '<div class="qg-bell-item-body">' + escapeHtml(n.body || '') + '</div>' +
        '<div class="qg-bell-item-time">' + escapeHtml(formatTime(n.created_at)) + '</div>' +
      '</button>';
    }).join('');

    panelBody.querySelectorAll('.qg-bell-item').forEach(function (el) {
      el.addEventListener('click', function () {
        openNotification(el.getAttribute('data-nid'), el.getAttribute('data-link'));
      });
    });
  }

  function escapeHtml(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function openNotification(id, link) {
    if (id && typeof markNotificationRead === 'function' && String(id).indexOf('app-') !== 0) {
      await markNotificationRead(id);
    }
    if (id) {
      try {
        var read = readLocalNotifRead();
        if (read.indexOf(String(id)) < 0) {
          read.push(String(id));
          localStorage.setItem('qg-notif-read', JSON.stringify(read.slice(-200)));
        }
      } catch (e) {}
    }
    closeBellPanel();
    await refreshNotifications();
    if (link) {
      window.location.href = link;
    }
  }

  async function markAllRead() {
    var uid = window._currentUser && window._currentUser.uid;
    if (uid && typeof markAllNotificationsRead === 'function') {
      await markAllNotificationsRead(uid);
    }
    try {
      var read = readLocalNotifRead();
      notifications.forEach(function (n) {
        var id = String(n.id || '');
        if (id && read.indexOf(id) < 0) read.push(id);
      });
      localStorage.setItem('qg-notif-read', JSON.stringify(read.slice(-200)));
    } catch (e) {}
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
            title: 'New applicant',
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
            title: 'Application accepted',
            body: 'You were accepted — open My Jobs to continue',
            created_at: a.updated_at || a.created_at || a.CREATED_AT || new Date().toISOString(),
            link: 'mytasks.html?tab=applied&mode=worker',
            read_at: read.indexOf(id2) >= 0 ? new Date().toISOString() : null
          });
        }
      });
    } catch (e) {}
    return out;
  }

  async function refreshNotifications() {
    var uid = window._currentUser && window._currentUser.uid;
    if (!uid) return;
    try {
      var server = [];
      if (typeof fetchUserNotifications === 'function') {
        server = await fetchUserNotifications(uid, 40);
      }
      if (!Array.isArray(server)) server = [];
      var derived = derivedFromCache(uid);
      var seen = {};
      notifications = server.concat(derived).filter(function (n) {
        var id = String(n.id || n.notification_id || '');
        if (!id || seen[id]) return false;
        seen[id] = true;
        return true;
      }).sort(function (a, b) {
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      }).slice(0, 40);
      var unread = notifications.filter(function (n) { return !n.read_at; }).length;
      updateBadge(unread);
      if (open) renderList();
    } catch (err) {
      console.warn('Bell refresh failed:', err);
    }
  }

  function openBellPanel() {
    if (open) return;
    buildPanel();
    open = true;
    renderList();
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('qg-bell-open');
    if (bellBtn) bellBtn.setAttribute('aria-expanded', 'true');
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
      return;
    }
  }

  function init() {
    if (window.__qgBellInit || !shouldInit()) return;
    window.__qgBellInit = true;
    loadCss();
    injectBell();
    document.addEventListener('keydown', onKeyDown);
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
