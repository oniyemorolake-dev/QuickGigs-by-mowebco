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
    var path = (window.location.pathname || '').toLowerCase();
    var page = path.split('/').pop() || '';
    if (page === 'browsetask.html' || page === 'browsetask') return 'worker';
    if (page === 'posttask.html' || page === 'posttask') return 'poster';
    return getSessionMode();
  }

  function applyNavBrand() {
    /* Role text comes from CSS (html[data-qg-mode]) — ensure brand wrapper exists */
    document.querySelectorAll('.nav').forEach(function (nav) {
      var logo = nav.querySelector(':scope > .nav-logo');
      if (logo && !logo.closest('.nav-brand')) {
        var wrap = document.createElement('div');
        wrap.className = 'nav-brand';
        logo.parentNode.insertBefore(wrap, logo);
        wrap.appendChild(logo);
        var role = document.createElement('span');
        role.className = 'nav-role';
        role.setAttribute('aria-label', getThemeMode() === 'worker' ? 'Tasker mode' : 'Poster mode');
        wrap.appendChild(role);
      }
    });
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
      return '<a class="' + cls + '" href="' + item.href + '">' +
        '<span class="tab-icon">' + item.icon + '</span>' +
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
    var hasPosted = !!options.hasPosted;
    var hasApps = !!options.hasApps;

    var postedEl = document.getElementById('tabPosted');
    var appliedEl = document.getElementById('tabApplied');
    if (postedEl) postedEl.style.display = (!isWorker || hasPosted) ? '' : 'none';
    if (appliedEl) appliedEl.style.display = (isWorker || hasApps) ? '' : 'none';

    var titleEl = document.querySelector('.nav-title');
    if (titleEl) titleEl.textContent = isWorker ? 'My Jobs' : 'My Tasks';
  }

  window.getSessionMode = getSessionMode;
  window.setSessionMode = setSessionMode;
  window.isWorkerMode = isWorkerMode;
  window.isPosterMode = isPosterMode;
  window.switchRoleMode = switchRoleMode;
  window.renderQuickGigsTabBar = renderQuickGigsTabBar;
  window.applyMyTasksTabsForMode = applyMyTasksTabsForMode;
  window.applyRoleTheme = applyRoleTheme;
  window.applyNavBrand = applyNavBrand;
  window.getThemeMode = getThemeMode;
  initRoleThemeEarly();
})();
