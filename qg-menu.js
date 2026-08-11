/* QuickGigs — hamburger slide-out menu (app + public pages) */
(function () {
  var SKIP = { login: 1, signup: 1, 'parent-consent': 1, 'admin-login': 1 };
  var APP = {
    dashboard: 1, browsetask: 1, posttask: 1, mytasks: 1, messages: 1,
    chat: 1, profile: 1, workers: 1, categories: 1, feedback: 1, review: 1, admin: 1
  };

  var overlay;
  var drawer;
  var menuBtn;
  var open = false;

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
    return !SKIP[pageKey()];
  }

  function isAppPage() {
    return !!APP[pageKey()];
  }

  function loadCss() {
    if (document.getElementById('qg-menu-css')) return;
    injectCriticalCss();
    var link = document.createElement('link');
    link.id = 'qg-menu-css';
    link.rel = 'stylesheet';
    link.href = 'qg-menu.css?v=5';
    document.head.appendChild(link);
  }

  function ensureNavRight(nav) {
    var right = nav.querySelector('.nav-right');
    if (right) return right;
    right = document.createElement('div');
    right.className = 'nav-right';
    var loose = nav.querySelectorAll(':scope > .mode-btn, :scope > .mode-toggle, :scope > .nav-icon');
    loose.forEach(function (el) { right.appendChild(el); });
    nav.appendChild(right);
    return right;
  }

  function createMenuButton() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'qg-menu-btn';
    btn.id = 'qgMenuBtn';
    btn.setAttribute('aria-label', 'Open menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'qgMenuDrawer');
    btn.innerHTML = '<span></span><span></span><span></span>';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleMenu();
    });
    return btn;
  }

  function injectTrigger() {
    var nav = document.querySelector('.nav');
    if (nav) {
      var right = ensureNavRight(nav);
      if (!right.querySelector('#qgMenuBtn')) {
        menuBtn = createMenuButton();
        right.insertBefore(menuBtn, right.firstChild);
      } else {
        menuBtn = right.querySelector('#qgMenuBtn');
      }
      return;
    }

    if (pageKey() === 'index' && !document.getElementById('qgMenuBtn')) {
      var wrap = document.createElement('div');
      wrap.className = 'qg-menu-fab-wrap';
      menuBtn = createMenuButton();
      wrap.appendChild(menuBtn);
      document.body.appendChild(wrap);
    }
  }

  function roleLabel() {
    if (typeof getMode === 'function') return getMode() === 'tasker' ? 'Tasker' : 'Poster';
    if (typeof isWorkerMode === 'function' && isWorkerMode()) return 'Tasker';
    if (typeof isPosterMode === 'function' && isPosterMode()) return 'Poster';
    var mode = localStorage.getItem('qg-mode') || localStorage.getItem('qg-session-mode') || localStorage.getItem('qg-role');
    return (mode === 'worker' || mode === 'tasker') ? 'Tasker' : 'Poster';
  }

  function themeLabel() {
    var isDark = !document.body.classList.contains('light');
    return isDark ? '☀️ Light mode' : '🌙 Dark mode';
  }

  function appMenuSections() {
    var worker = typeof isWorkerMode === 'function' && isWorkerMode();
    var mode = worker ? 'worker' : 'poster';
    var access = typeof window.QG_getRoleAccess === 'function' ? window.QG_getRoleAccess() : null;
    var targetMode = worker ? 'poster' : 'tasker';
    var hasTarget = !access || (targetMode === 'poster' ? access.is_poster : access.is_tasker);
    var canOfferTarget = !(access && access.is_teen && targetMode === 'poster');
    var sections = [];

    var accountItems = [
      { type: 'link', href: 'profile.html', icon: 'users', label: 'Profile' }
    ];
    if (canOfferTarget) {
      accountItems.push({
        type: 'action',
        action: 'switchMode',
        icon: hasTarget
          ? (worker ? 'briefcase' : 'zap')
          : (worker ? 'clipboard' : 'briefcase'),
        label: hasTarget
          ? (worker ? 'Switch to Poster' : 'Switch to Tasker')
          : (worker ? 'Become a Poster' : 'Start finding work')
      });
    }
    sections.push({
      label: 'Account',
      items: accountItems
    });

    var goItems = [
      { type: 'link', href: 'dashboard.html', icon: 'home', label: 'Home' },
      worker
        ? { type: 'link', href: 'browsetask.html', icon: 'search', label: 'Browse tasks' }
        : { type: 'link', href: 'posttask.html', icon: 'plus', label: 'Post a task' },
      { type: 'link', href: 'mytasks.html', icon: 'clipboard', label: worker ? 'My jobs' : 'My tasks' },
      { type: 'link', href: 'messages.html', icon: 'message', label: 'Messages' }
    ];
    if (worker) goItems.push({ type: 'link', href: 'categories.html', icon: 'folder', label: 'Categories' });
    else goItems.push({ type: 'link', href: 'workers.html', icon: 'users', label: 'Find taskers' });
    sections.push({
      label: 'Go to',
      items: goItems
    });

    sections.push({
      label: 'Help',
      items: [
        { type: 'link', href: 'how-it-works.html', icon: 'sparkles', label: 'How it works' },
        { type: 'link', href: 'faq.html', icon: 'helpCircle', label: 'FAQ' },
        { type: 'link', href: 'safety.html', icon: 'alert', label: 'Safety' },
        { type: 'link', href: 'guidelines.html', icon: 'list', label: 'Guidelines' },
        { type: 'link', href: 'feedback.html', icon: 'bug', label: 'Beta feedback' }
      ]
    });

    var settings = [
      { type: 'action', action: 'theme', icon: 'eye', label: themeLabel() }
    ];
    if (typeof window.promptQuickGigsInstall === 'function') {
      settings.push({ type: 'action', action: 'install', icon: 'smartphone', label: 'Add to Home Screen' });
    }
    sections.push({ label: 'Settings', items: settings });

    sections.push({
      label: '',
      items: [{ type: 'action', action: 'logout', icon: 'x', label: 'Log out', danger: true }]
    });

    return sections;
  }

  function publicMenuSections() {
    var sections = [
      {
        label: 'Get started',
        items: [
          { type: 'link', href: 'signup.html?role=poster', icon: 'clipboard', label: 'Sign up — post tasks' },
          { type: 'link', href: 'signup.html?role=worker', icon: 'briefcase', label: 'Sign up — earn as tasker' },
          { type: 'link', href: 'login.html', icon: 'lock', label: 'Log in' }
        ]
      },
      {
        label: 'Learn',
        items: [
          { type: 'link', href: 'how-it-works.html', icon: 'sparkles', label: 'How it works' },
          { type: 'link', href: 'faq.html', icon: 'helpCircle', label: 'FAQ' },
          { type: 'link', href: 'safety.html', icon: 'alert', label: 'Safety' },
          { type: 'link', href: 'guidelines.html', icon: 'list', label: 'Guidelines' },
          { type: 'link', href: 'dispute-resolution.html', icon: 'alert', label: 'Disputes' }
        ]
      },
      {
        label: 'Legal',
        items: [
          { type: 'link', href: 'terms.html', icon: 'clipboard', label: 'Terms of Service' },
          { type: 'link', href: 'privacy.html', icon: 'lock', label: 'Privacy Policy' }
        ]
      },
      {
        label: 'Settings',
        items: [{ type: 'action', action: 'theme', icon: 'eye', label: themeLabel() }]
      }
    ];

    if (localStorage.getItem('qg-mode') || localStorage.getItem('qg-role') || localStorage.getItem('qg-session-mode')) {
      sections[0].items.unshift({
        type: 'link',
        href: 'dashboard.html',
        icon: 'home',
        label: 'Go to dashboard'
      });
    }

    return sections;
  }

  function renderMenuIcon(name) {
    if (typeof qgIcon === 'function' && name) return qgIcon(name, { size: 18 });
    return '';
  }

  function renderSections(sections) {
    var worker = typeof isWorkerMode === 'function' && isWorkerMode();
    return sections.map(function (section) {
      var label = section.label
        ? '<div class="qg-menu-section-label">' + section.label + '</div>'
        : '';
      var links = section.items.map(function (item) {
        var cls = item.danger ? ' danger' : '';
        if (item.action === 'switchMode') {
          cls += worker ? ' qg-menu-switch-poster' : ' qg-menu-switch-tasker';
        }
        var ico = '<span class="ico qg-menu-ico-chip" aria-hidden="true">' + renderMenuIcon(item.icon) + '</span>';
        if (item.type === 'link') {
          return '<a class="qg-menu-link' + cls + '" href="' + item.href + '">' +
            ico +
            '<span>' + item.label + '</span></a>';
        }
        return '<button type="button" class="qg-menu-action' + cls + '" data-qg-action="' + item.action + '">' +
          ico +
          '<span>' + item.label + '</span></button>';
      }).join('');
      return '<div class="qg-menu-section">' + label + links + '</div>';
    }).join('');
  }

  function buildDrawer() {
    if (document.getElementById('qgMenuOverlay')) {
      overlay = document.getElementById('qgMenuOverlay');
      drawer = document.getElementById('qgMenuDrawer');
      return;
    }

    overlay = document.createElement('div');
    overlay.id = 'qgMenuOverlay';
    overlay.className = 'qg-menu-overlay';
    overlay.setAttribute('aria-hidden', 'true');

    var sections = isAppPage() ? appMenuSections() : publicMenuSections();
    var subtitle = isAppPage() ? roleLabel() + ' mode' : 'Canada-wide tasks';

    overlay.innerHTML =
      '<div id="qgMenuDrawer" class="qg-menu-drawer" role="dialog" aria-modal="true" aria-label="Menu">' +
        '<div class="qg-menu-head">' +
          '<div class="qg-menu-brand">' +
            '<span class="qg-menu-title">QuickGigs</span>' +
            '<span class="qg-menu-role">' + subtitle + '</span>' +
          '</div>' +
          '<button type="button" class="qg-menu-close" id="qgMenuClose" aria-label="Close menu">×</button>' +
        '</div>' +
        '<nav class="qg-menu-body" id="qgMenuBody">' + renderSections(sections) + '</nav>' +
      '</div>';

    document.body.appendChild(overlay);
    drawer = document.getElementById('qgMenuDrawer');

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeMenu();
    });
    document.getElementById('qgMenuClose').addEventListener('click', closeMenu);

    drawer.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-qg-action]');
      if (!btn) return;
      handleAction(btn.getAttribute('data-qg-action'));
    });
  }

  function refreshDrawerContent() {
    if (!drawer) return;
    var body = document.getElementById('qgMenuBody');
    if (!body) return;
    var sections = isAppPage() ? appMenuSections() : publicMenuSections();
    body.innerHTML = renderSections(sections);
    var roleEl = overlay.querySelector('.qg-menu-role');
    if (roleEl) roleEl.textContent = isAppPage() ? roleLabel() + ' mode' : 'Canada-wide tasks';
  }

  function handleAction(action) {
    closeMenu();
    if (action === 'theme') {
      if (typeof window.toggleTheme === 'function') window.toggleTheme();
      else if (typeof window.toggleMode === 'function') window.toggleMode();
      return;
    }
    if (action === 'switchMode' && typeof window.switchRoleMode === 'function') {
      window.switchRoleMode();
      return;
    }
    if (action === 'install' && typeof window.promptQuickGigsInstall === 'function') {
      window.promptQuickGigsInstall();
      return;
    }
    if (action === 'logout') {
      // CRITICAL: never navigate to login alone — that left Firebase Auth B
      // signed in (qg-menu.js previously fell through when doLogout missing).
      if (typeof window.qgLogout === 'function') {
        window.qgLogout(window._auth);
        return;
      }
      if (typeof window.clearQgUserScopedStorage === 'function') {
        window.clearQgUserScopedStorage();
      } else {
        try { sessionStorage.clear(); } catch (e) {}
      }
      var auth = window._auth;
      var goLogin = function () { window.location.href = 'login.html'; };
      if (auth && typeof auth.signOut === 'function') {
        auth.signOut().then(goLogin).catch(goLogin);
      } else {
        goLogin();
      }
    }
  }

  document.addEventListener('qg-role-access-changed', function () {
    if (overlay && overlay.classList.contains('open')) refreshContent();
  });

  function openMenu() {
    if (open) return;
    buildDrawer();
    refreshDrawerContent();
    open = true;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('qg-menu-open');
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'true');
    var closeBtn = document.getElementById('qgMenuClose');
    if (closeBtn) closeBtn.focus();
  }

  function closeMenu() {
    if (!open || !overlay) return;
    open = false;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('qg-menu-open');
    if (menuBtn) {
      menuBtn.setAttribute('aria-expanded', 'false');
      menuBtn.focus();
    }
  }

  function toggleMenu() {
    if (open) closeMenu();
    else openMenu();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && open) closeMenu();
  }

  function init() {
    if (window.__qgMenuInit) return;
    if (!shouldInit()) return;
    window.__qgMenuInit = true;
    loadCss();
    injectTrigger();
    document.body.classList.add('qg-has-menu');
    document.addEventListener('keydown', onKeyDown);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.QG_openMenu = openMenu;
  window.QG_closeMenu = closeMenu;
})();
