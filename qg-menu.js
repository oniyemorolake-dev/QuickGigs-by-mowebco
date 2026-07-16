/* QuickGigs — hamburger slide-out menu (app + public pages) */
(function () {
  var SKIP = { login: 1, signup: 1, 'parent-consent': 1 };
  var APP = {
    dashboard: 1, browsetask: 1, posttask: 1, mytasks: 1, messages: 1,
    chat: 1, profile: 1, workers: 1, categories: 1, feedback: 1, review: 1, admin: 1
  };

  var overlay;
  var drawer;
  var menuBtn;
  var open = false;

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
    var link = document.createElement('link');
    link.id = 'qg-menu-css';
    link.rel = 'stylesheet';
    link.href = 'qg-menu.css?v=2';
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
    if (typeof isWorkerMode === 'function' && isWorkerMode()) return 'Tasker';
    if (typeof isPosterMode === 'function' && isPosterMode()) return 'Poster';
    var mode = localStorage.getItem('qg-session-mode') || localStorage.getItem('qg-role');
    return mode === 'worker' ? 'Tasker' : 'Poster';
  }

  function themeLabel() {
    var isDark = !document.body.classList.contains('light');
    return isDark ? '☀️ Light mode' : '🌙 Dark mode';
  }

  function appMenuSections() {
    var worker = typeof isWorkerMode === 'function' && isWorkerMode();
    var mode = worker ? 'worker' : 'poster';
    var sections = [];

    sections.push({
      label: 'Account',
      items: [
        { type: 'link', href: 'profile.html', icon: '👤', label: 'Profile' },
        { type: 'action', action: 'switchMode', icon: '🔄', label: worker ? 'Switch to Poster' : 'Switch to Tasker' }
      ]
    });

    sections.push({
      label: 'Go to',
      items: [
        { type: 'link', href: 'dashboard.html?mode=' + mode, icon: '🏠', label: 'Home' },
        worker
          ? { type: 'link', href: 'browsetask.html', icon: '🔍', label: 'Browse tasks' }
          : { type: 'link', href: 'posttask.html', icon: '➕', label: 'Post a task' },
        { type: 'link', href: 'mytasks.html', icon: '📋', label: worker ? 'My jobs' : 'My tasks' },
        { type: 'link', href: 'messages.html', icon: '💬', label: 'Messages' },
        { type: 'link', href: 'workers.html', icon: '👥', label: 'Find taskers' },
        { type: 'link', href: 'categories.html', icon: '🏷️', label: 'Categories' }
      ]
    });

    sections.push({
      label: 'Help',
      items: [
        { type: 'link', href: 'how-it-works.html', icon: '✨', label: 'How it works' },
        { type: 'link', href: 'faq.html', icon: '❓', label: 'FAQ' },
        { type: 'link', href: 'safety.html', icon: '🛡️', label: 'Safety' },
        { type: 'link', href: 'guidelines.html', icon: '📜', label: 'Guidelines' },
        { type: 'link', href: 'feedback.html', icon: '🐛', label: 'Beta feedback' }
      ]
    });

    var settings = [
      { type: 'action', action: 'theme', icon: '🎨', label: themeLabel() }
    ];
    if (typeof window.promptQuickGigsInstall === 'function') {
      settings.push({ type: 'action', action: 'install', icon: '📲', label: 'Add to Home Screen' });
    }
    sections.push({ label: 'Settings', items: settings });

    sections.push({
      label: '',
      items: [{ type: 'action', action: 'logout', icon: '🚪', label: 'Log out', danger: true }]
    });

    return sections;
  }

  function publicMenuSections() {
    var sections = [
      {
        label: 'Get started',
        items: [
          { type: 'link', href: 'signup.html?role=poster', icon: '📝', label: 'Sign up — post tasks' },
          { type: 'link', href: 'signup.html?role=worker', icon: '💼', label: 'Sign up — earn as tasker' },
          { type: 'link', href: 'login.html', icon: '🔑', label: 'Log in' }
        ]
      },
      {
        label: 'Learn',
        items: [
          { type: 'link', href: 'how-it-works.html', icon: '✨', label: 'How it works' },
          { type: 'link', href: 'faq.html', icon: '❓', label: 'FAQ' },
          { type: 'link', href: 'safety.html', icon: '🛡️', label: 'Safety' },
          { type: 'link', href: 'guidelines.html', icon: '📜', label: 'Guidelines' },
          { type: 'link', href: 'dispute-resolution.html', icon: '⚖️', label: 'Disputes' }
        ]
      },
      {
        label: 'Legal',
        items: [
          { type: 'link', href: 'terms.html', icon: '📄', label: 'Terms of Service' },
          { type: 'link', href: 'privacy.html', icon: '🔒', label: 'Privacy Policy' }
        ]
      },
      {
        label: 'Settings',
        items: [{ type: 'action', action: 'theme', icon: '🎨', label: themeLabel() }]
      }
    ];

    if (localStorage.getItem('qg-role') || localStorage.getItem('qg-session-mode')) {
      var m = localStorage.getItem('qg-session-mode') || localStorage.getItem('qg-role') || 'poster';
      sections[0].items.unshift({
        type: 'link',
        href: 'dashboard.html?mode=' + (m === 'worker' ? 'worker' : 'poster'),
        icon: '🏠',
        label: 'Go to dashboard'
      });
    }

    return sections;
  }

  function renderSections(sections) {
    return sections.map(function (section) {
      var label = section.label
        ? '<div class="qg-menu-section-label">' + section.label + '</div>'
        : '';
      var links = section.items.map(function (item) {
        var cls = item.danger ? ' danger' : '';
        if (item.type === 'link') {
          return '<a class="qg-menu-link' + cls + '" href="' + item.href + '">' +
            '<span class="ico" aria-hidden="true">' + item.icon + '</span>' +
            '<span>' + item.label + '</span></a>';
        }
        return '<button type="button" class="qg-menu-action' + cls + '" data-qg-action="' + item.action + '">' +
          '<span class="ico" aria-hidden="true">' + item.icon + '</span>' +
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
      if (typeof window.doLogout === 'function') window.doLogout();
      else window.location.href = 'login.html';
    }
  }

  function openMenu() {
    if (open) return;
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
    if (!open) return;
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
    buildDrawer();
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
