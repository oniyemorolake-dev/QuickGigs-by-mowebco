// QuickGigs — role-based navigation (poster vs tasker). Canonical mode: localStorage qg-mode.
(function () {
  var NAV = {
    poster: [
      { id: 'home', href: 'dashboard.html', icon: '🏠', label: 'Home' },
      { id: 'post', href: 'posttask.html', icon: '➕', label: 'Post' },
      { id: 'tasks', href: 'mytasks.html?tab=posted', icon: '📋', label: 'My Tasks' },
      { id: 'messages', href: 'messages.html', icon: '💬', label: 'Messages' }
    ],
    worker: [
      { id: 'home', href: 'dashboard.html', icon: '🏠', label: 'Home' },
      { id: 'browse', href: 'browsetask.html', icon: '🔍', label: 'Browse' },
      { id: 'jobs', href: 'mytasks.html?tab=applied', icon: '💼', label: 'My Jobs' },
      { id: 'messages', href: 'messages.html', icon: '💬', label: 'Messages' }
    ]
  };

  function normalizeMode(mode) {
    if (mode === 'worker' || mode === 'tasker') return 'tasker';
    return 'poster';
  }

  /** Canonical role mode: 'poster' | 'tasker' — only default lives here */
  function getMode() {
    try {
      var raw = localStorage.getItem('qg-mode');
      if (raw === 'light' || raw === 'dark') {
        try {
          if (!localStorage.getItem('qg-theme')) localStorage.setItem('qg-theme', raw);
        } catch (e1) {}
        raw = null;
      }
      if (raw === 'tasker' || raw === 'worker') return 'tasker';
      if (raw === 'poster') return 'poster';
      var legacy = localStorage.getItem('qg-session-mode') || localStorage.getItem('qg-role');
      var migrated = normalizeMode(legacy);
      try { localStorage.setItem('qg-mode', migrated); } catch (e2) {}
      return migrated;
    } catch (e) {
      return 'poster';
    }
  }

  function setMode(m) {
    var mode = normalizeMode(m);
    try {
      localStorage.setItem('qg-mode', mode);
      localStorage.setItem('qg-session-mode', mode === 'tasker' ? 'worker' : 'poster');
      localStorage.setItem('qg-role', mode === 'tasker' ? 'worker' : 'poster');
    } catch (e) {}
    return mode;
  }

  // Legacy API — do not read URL (that was resetting mode on navigation)
  function getSessionMode() {
    return getMode() === 'tasker' ? 'worker' : 'poster';
  }

  function setSessionMode(mode) {
    setMode(mode);
    return getSessionMode();
  }

  function isWorkerMode() {
    return getMode() === 'tasker';
  }

  function isPosterMode() {
    return getMode() === 'poster';
  }

  function cssMode() {
    return isWorkerMode() ? 'worker' : 'poster';
  }

  function switchRoleMode() {
    var next = isWorkerMode() ? 'poster' : 'tasker';
    setMode(next);
    applyRoleTheme();
    document.dispatchEvent(new CustomEvent('qg-mode-changed', { detail: { mode: next } }));
    if (typeof window.onQuickGigsModeChange === 'function') {
      try { window.onQuickGigsModeChange(next); return; } catch (e) {}
    }
    // Stay on the same page — re-render via reload (no dashboard redirect)
    window.location.reload();
  }

  function getThemeMode() {
    // Visual chrome follows stored role only — never invent mode from page path
    return cssMode();
  }

  function applyNavBrand() {
    document.querySelectorAll('.nav').forEach(function (nav) {
      var logo = nav.querySelector(':scope > .nav-logo');
      if (logo && !logo.closest('.nav-brand')) {
        var wrap = document.createElement('div');
        wrap.className = 'nav-brand';
        logo.parentNode.insertBefore(wrap, logo);
        wrap.appendChild(logo);
        var role = document.createElement('span');
        role.className = 'nav-role';
        wrap.appendChild(role);
      }
    });
    if (typeof window.QG_applyRoleLabels === 'function') window.QG_applyRoleLabels();
    else {
      var label = isWorkerMode() ? 'TASKER' : 'POSTER';
      document.querySelectorAll('.nav-role').forEach(function (el) { el.textContent = label; });
    }
    document.querySelectorAll('[data-qg-mode-tag]').forEach(function (el) {
      el.textContent = isWorkerMode() ? '🛠 Tasker mode' : '📋 Poster mode';
      el.classList.toggle('tag-worker', isWorkerMode());
      el.classList.toggle('tag-poster', !isWorkerMode());
    });
  }

  function applyRoleTheme() {
    var mode = cssMode();
    document.body.classList.toggle('qg-mode-worker', mode === 'worker');
    document.body.classList.toggle('qg-mode-poster', mode === 'poster');
    document.documentElement.setAttribute('data-qg-mode', mode);
    applyNavBrand();
  }

  function renderQuickGigsTabBar(activeId) {
    var bar = document.getElementById('qgTabBar');
    if (!bar) return;
    var mode = getSessionMode();
    var items = NAV[mode] || NAV.poster;
    bar.innerHTML = items.map(function (item) {
      var cls = item.id === activeId ? 'tab-item active' : 'tab-item';
      var unreadBadge = item.id === 'messages'
        ? '<span class="tab-unread-badge" id="qgMsgUnreadBadge" aria-hidden="true"></span>'
        : '';
      return '<a class="' + cls + '" href="' + item.href + '" aria-label="' + item.label + '">' +
        '<span class="tab-icon" aria-hidden="true">' + item.icon + '</span>' +
        unreadBadge +
        '<span class="tab-lbl">' + item.label + '</span></a>';
    }).join('');
    applyRoleTheme();
    refreshMessagesUnreadBadge();
  }

  function refreshMessagesUnreadBadge() {
    var badge = document.getElementById('qgMsgUnreadBadge');
    var link = badge && badge.closest('.tab-item');
    if (!badge || !link) return;
    var user = window._currentUser;
    if (!user || typeof getConversationsForUser !== 'function') return;
    getConversationsForUser(user.uid).then(function (rows) {
      var tasker = isWorkerMode();
      var n = 0;
      (rows || []).forEach(function (conv) {
        var iAmPoster = String(conv.poster_id) === String(user.uid);
        if (tasker && iAmPoster) return;
        if (!tasker && !iAmPoster) return;
        var lastRead = iAmPoster ? conv.poster_last_read_at : conv.worker_last_read_at;
        if (!lastRead || (conv.last_message_at && new Date(conv.last_message_at) > new Date(lastRead))) n += 1;
      });
      if (n > 0) {
        badge.textContent = n > 99 ? '99+' : String(n);
        link.classList.add('has-unread');
        link.setAttribute('aria-label', 'Messages, ' + n + ' unread');
      } else {
        badge.textContent = '';
        link.classList.remove('has-unread');
        link.setAttribute('aria-label', 'Messages');
      }
    }).catch(function () {});
  }

  function initRoleThemeEarly() {
    applyRoleTheme();
  }

  function applyMyTasksTabsForMode(options) {
    options = options || {};
    var isWorker = isWorkerMode();

    document.documentElement.setAttribute('data-qg-mode', isWorker ? 'worker' : 'poster');

    var postedEl = document.getElementById('tabPosted');
    var appliedEl = document.getElementById('tabApplied');
    if (postedEl) {
      postedEl.hidden = isWorker;
      postedEl.style.display = isWorker ? 'none' : '';
    }
    if (appliedEl) {
      appliedEl.hidden = !isWorker;
      appliedEl.style.display = isWorker ? '' : 'none';
    }

    var titleEl = document.querySelector('.nav-title');
    if (titleEl) titleEl.textContent = isWorker ? 'My gigs' : 'My posted tasks';
  }

  function defaultMyTasksTab() {
    return isWorkerMode() ? 'applied' : 'posted';
  }

  function normalizeMyTasksTab(tab) {
    var allowed = isWorkerMode()
      ? { applied: 1, inprogress: 1, completed: 1 }
      : { posted: 1, inprogress: 1, completed: 1 };
    return allowed[tab] ? tab : defaultMyTasksTab();
  }

  function roleGateHtml(opts) {
    opts = opts || {};
    var targetMode = opts.targetMode === 'poster' ? 'poster' : 'tasker';
    var label = targetMode === 'tasker' ? 'Tasker' : 'Poster';
    return '<div class="empty-state" style="text-align:center;padding:48px 20px">' +
      '<div class="empty-icon">' + (opts.icon || '🔄') + '</div>' +
      '<div class="empty-title">' + (opts.title || ('Switch to ' + label + ' mode')) + '</div>' +
      '<div class="empty-sub">' + (opts.sub || '') + '</div>' +
      '<button type="button" class="empty-btn" onclick="typeof switchRoleMode===\'function\'&&switchRoleMode()">Switch to ' + label + ' mode</button>' +
      '</div>';
  }

  window.getMode = getMode;
  window.setMode = setMode;
  window.getSessionMode = getSessionMode;
  window.setSessionMode = setSessionMode;
  window.isWorkerMode = isWorkerMode;
  window.isPosterMode = isPosterMode;
  window.switchRoleMode = switchRoleMode;
  window.renderQuickGigsTabBar = renderQuickGigsTabBar;
  window.refreshMessagesUnreadBadge = refreshMessagesUnreadBadge;
  window.applyMyTasksTabsForMode = applyMyTasksTabsForMode;
  window.defaultMyTasksTab = defaultMyTasksTab;
  window.normalizeMyTasksTab = normalizeMyTasksTab;
  window.roleGateHtml = roleGateHtml;
  window.applyRoleTheme = applyRoleTheme;
  window.applyNavBrand = applyNavBrand;
  window.getThemeMode = getThemeMode;
  initRoleThemeEarly();

  var mobileScript = document.createElement('script');
  mobileScript.src = 'qg-mobile.js?v=20260726n';
  mobileScript.defer = true;
  document.head.appendChild(mobileScript);

  var menuScript = document.createElement('script');
  menuScript.src = 'qg-menu.js?v=4';
  menuScript.defer = true;
  document.head.appendChild(menuScript);

  var bellScript = document.createElement('script');
  bellScript.src = 'qg-bell.js?v=3';
  bellScript.defer = true;
  document.head.appendChild(bellScript);

  var announceScript = document.createElement('script');
  announceScript.src = 'qg-announcement.js?v=5';
  announceScript.defer = true;
  document.head.appendChild(announceScript);
})();
