// QuickGigs — role-based navigation (poster vs worker)
(function () {
  var NAV = {
    poster: [
      { id: 'home', href: 'dashboard.html?mode=poster', icon: '🏠', label: 'Home' },
      { id: 'post', href: 'posttask.html', icon: '➕', label: 'Post' },
      { id: 'tasks', href: 'mytasks.html?tab=posted', icon: '📋', label: 'My Tasks' },
      { id: 'messages', href: 'messages.html', icon: '💬', label: 'Messages' }
    ],
    worker: [
      { id: 'home', href: 'dashboard.html?mode=worker', icon: '🏠', label: 'Home' },
      { id: 'browse', href: 'browsetask.html', icon: '🔍', label: 'Browse' },
      { id: 'jobs', href: 'mytasks.html?tab=applied', icon: '💼', label: 'My Jobs' },
      { id: 'messages', href: 'messages.html', icon: '💬', label: 'Messages' }
    ]
  };

  function normalizeMode(mode) {
    return mode === 'worker' ? 'worker' : 'poster';
  }

  function getSessionMode() {
    var params = new URLSearchParams(window.location.search);
    var fromUrl = params.get('mode');
    if (fromUrl) return normalizeMode(fromUrl);
    var stored = localStorage.getItem('qg-session-mode') || localStorage.getItem('qg-role');
    return normalizeMode(stored);
  }

  function setSessionMode(mode) {
    mode = normalizeMode(mode);
    localStorage.setItem('qg-session-mode', mode);
    return mode;
  }

  function isWorkerMode() {
    return getSessionMode() === 'worker';
  }

  function isPosterMode() {
    return !isWorkerMode();
  }

  function switchRoleMode() {
    var next = isWorkerMode() ? 'poster' : 'worker';
    setSessionMode(next);
    window.location.href = 'dashboard.html?mode=' + next;
  }

  function getThemeMode() {
    if (typeof window.QG_getBrandMode === 'function') return window.QG_getBrandMode();
    var path = (window.location.pathname || '').toLowerCase();
    var page = path.split('/').pop() || '';
    if (page === 'browsetask.html' || page === 'browsetask') return 'worker';
    if (page === 'posttask.html' || page === 'posttask') return 'poster';
    return getSessionMode();
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
      var label = getThemeMode() === 'worker' ? 'TASKER' : 'POSTER';
      document.querySelectorAll('.nav-role').forEach(function (el) { el.textContent = label; });
    }
  }

  function applyRoleTheme() {
    var mode = getThemeMode();
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
      return '<a class="' + cls + '" href="' + item.href + '" aria-label="' + item.label + '">' +
        '<span class="tab-icon" aria-hidden="true">' + item.icon + '</span>' +
        '<span class="tab-lbl">' + item.label + '</span></a>';
    }).join('');
    applyRoleTheme();
  }

  function initRoleThemeEarly() {
    applyRoleTheme();
  }

  function applyMyTasksTabsForMode(options) {
    options = options || {};
    var isWorker = isWorkerMode();

    var postedEl = document.getElementById('tabPosted');
    var appliedEl = document.getElementById('tabApplied');
    // Poster = post & hire only. Tasker = apply & work only.
    if (postedEl) postedEl.style.display = isWorker ? 'none' : '';
    if (appliedEl) appliedEl.style.display = isWorker ? '' : 'none';

    var titleEl = document.querySelector('.nav-title');
    if (titleEl) titleEl.textContent = isWorker ? 'My Jobs' : 'My Tasks';
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
    var targetMode = opts.targetMode === 'poster' ? 'poster' : 'worker';
    var label = targetMode === 'worker' ? 'Tasker' : 'Poster';
    return '<div class="empty-state" style="text-align:center;padding:48px 20px">' +
      '<div class="empty-icon">' + (opts.icon || '🔄') + '</div>' +
      '<div class="empty-title">' + (opts.title || ('Switch to ' + label + ' mode')) + '</div>' +
      '<div class="empty-sub">' + (opts.sub || '') + '</div>' +
      '<button type="button" class="empty-btn" onclick="typeof switchRoleMode===\'function\'&&switchRoleMode()">Switch to ' + label + ' mode</button>' +
      '</div>';
  }

  window.getSessionMode = getSessionMode;
  window.setSessionMode = setSessionMode;
  window.isWorkerMode = isWorkerMode;
  window.isPosterMode = isPosterMode;
  window.switchRoleMode = switchRoleMode;
  window.renderQuickGigsTabBar = renderQuickGigsTabBar;
  window.applyMyTasksTabsForMode = applyMyTasksTabsForMode;
  window.defaultMyTasksTab = defaultMyTasksTab;
  window.normalizeMyTasksTab = normalizeMyTasksTab;
  window.roleGateHtml = roleGateHtml;
  window.applyRoleTheme = applyRoleTheme;
  window.applyNavBrand = applyNavBrand;
  window.getThemeMode = getThemeMode;
  initRoleThemeEarly();

  var mobileScript = document.createElement('script');
  mobileScript.src = 'qg-mobile.js';
  mobileScript.defer = true;
  document.head.appendChild(mobileScript);

  var menuScript = document.createElement('script');
  menuScript.src = 'qg-menu.js?v=3';
  menuScript.defer = true;
  document.head.appendChild(menuScript);

  var bellScript = document.createElement('script');
  bellScript.src = 'qg-bell.js?v=2';
  bellScript.defer = true;
  document.head.appendChild(bellScript);

  var announceScript = document.createElement('script');
  announceScript.src = 'qg-announcement.js?v=5';
  announceScript.defer = true;
  document.head.appendChild(announceScript);
})();
