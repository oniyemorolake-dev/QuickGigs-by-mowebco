/* SwiftGigs — shared footer, loading, empty states, back nav */
(function () {
  window.renderQuickGigsFooter = function (containerId) {
    var el = document.getElementById(containerId || 'siteFooter');
    if (!el) return;
    el.classList.add('site-footer', 'qg-trust-footer');
    el.innerHTML =
      '<div class="qg-foot-brand">SwiftGigs</div>' +
      '<div class="qg-foot-co">A MoTechCo company © 2026</div>' +
      '<div class="qg-foot-links">' +
      '<a href="terms.html">Terms</a> · ' +
      '<a href="privacy.html">Privacy</a> · ' +
      '<a href="feedback.html">Feedback</a>' +
      '</div>' +
      '<div class="qg-foot-email"><a href="mailto:mowebsiteco@gmail.com">mowebsiteco@gmail.com</a></div>';
  };

  window.qgLoadingHtml = function (msg) {
    return '<div class="qg-empty-illus"><span class="ico spin">⏳</span><div class="tit">' +
      (msg || 'Loading…') + '</div></div>';
  };

  window.qgEmptyHtml = function (emoji, title, sub, btnHref, btnLabel) {
    var btn = btnHref
      ? '<a class="btn" href="' + btnHref + '">' + (btnLabel || 'Get started') + '</a>'
      : '';
    return '<div class="qg-empty-illus"><span class="ico">' + (emoji || '🔍') + '</span>' +
      '<div class="tit">' + (title || 'Nothing here yet') + '</div>' +
      '<div class="sub">' + (sub || '') + '</div>' + btn + '</div>';
  };

  var _qgLoadingTimer = null;
  window.qgShowGlobalLoading = function (msg) {
    var el = document.getElementById('qgGlobalLoading');
    if (!el) {
      el = document.createElement('div');
      el.id = 'qgGlobalLoading';
      el.className = 'qg-global-loading';
      el.innerHTML = '<div class="spin">⏳</div><div class="txt" id="qgGlobalLoadingTxt">Loading…</div>';
      document.body.appendChild(el);
    }
    var t = document.getElementById('qgGlobalLoadingTxt');
    if (t) t.textContent = msg || 'Loading…';
    el.classList.add('show');
    // Never leave a full-screen blocker stuck (breaks all My Tasks buttons)
    if (_qgLoadingTimer) clearTimeout(_qgLoadingTimer);
    _qgLoadingTimer = setTimeout(function () {
      window.qgHideGlobalLoading();
    }, 8000);
  };

  window.qgHideGlobalLoading = function () {
    if (_qgLoadingTimer) {
      clearTimeout(_qgLoadingTimer);
      _qgLoadingTimer = null;
    }
    var el = document.getElementById('qgGlobalLoading');
    if (el) el.classList.remove('show');
  };

  window.initTrustPageTheme = function () {
    var isDark = typeof QG_isDarkTheme === 'function'
      ? QG_isDarkTheme()
      : (localStorage.getItem('qg-theme') !== 'light');
    document.body.classList.toggle('light', !isDark);
    var btn = document.getElementById('modeBtn');
    if (btn) btn.textContent = isDark ? 'Light' : 'Dark';
    window.toggleTheme = function () {
      isDark = !isDark;
      if (typeof QG_setThemeDark === 'function') QG_setThemeDark(isDark);
      else localStorage.setItem('qg-theme', isDark ? 'dark' : 'light');
      if (typeof QG_paintTheme === 'function') QG_paintTheme(isDark);
      else document.body.classList.toggle('light', !isDark);
      if (btn) btn.textContent = isDark ? 'Light' : 'Dark';
    };
  };

  function whenIdle(fn) {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 1800 });
    else setTimeout(fn, 1);
  }

  function loadAnalytics() {
    if (document.getElementById('qg-analytics-loader')) return;
    if (!document.querySelector('script[src*="qg-config.js"]')) {
      var cfg = document.createElement('script');
      cfg.src = 'qg-config.js';
      document.head.appendChild(cfg);
    }
    var s = document.createElement('script');
    s.id = 'qg-analytics-loader';
    s.src = 'qg-analytics.js?v=1';
    s.defer = true;
    document.head.appendChild(s);
  }

  function loadMenu() {
    if (document.getElementById('qg-menu-loader')) return;
    if (!document.getElementById('qg-overlay-critical')) {
      var critical = document.createElement('style');
      critical.id = 'qg-overlay-critical';
      critical.textContent =
        '.qg-menu-overlay:not(.open),.qg-bell-overlay:not(.open){position:fixed!important;inset:0!important;opacity:0!important;visibility:hidden!important;pointer-events:none!important;}' +
        '.qg-menu-overlay:not(.open) .qg-menu-drawer,.qg-bell-overlay:not(.open) .qg-bell-panel{transform:translateX(100%)!important;}';
      document.head.appendChild(critical);
    }
    var s = document.createElement('script');
    s.id = 'qg-menu-loader';
    s.src = 'qg-menu.js?v=d12e08d-1787871217';
    s.defer = true;
    document.head.appendChild(s);
  }

  whenIdle(loadAnalytics);
  whenIdle(loadMenu);

  document.addEventListener('DOMContentLoaded', function () {
    if (document.getElementById('siteFooter')) renderQuickGigsFooter('siteFooter');
    document.querySelectorAll('.faq-q').forEach(function (q) {
      q.onclick = function () { q.closest('.faq-item').classList.toggle('open'); };
    });
    document.querySelectorAll('[data-guidelines-tab]').forEach(function (btn) {
      btn.onclick = function () {
        var tab = btn.getAttribute('data-guidelines-tab');
        document.querySelectorAll('[data-guidelines-tab]').forEach(function (b) { b.classList.remove('active'); });
        document.querySelectorAll('[data-guidelines-panel]').forEach(function (p) { p.classList.remove('active'); });
        btn.classList.add('active');
        var panel = document.querySelector('[data-guidelines-panel="' + tab + '"]');
        if (panel) panel.classList.add('active');
      };
    });
    initTrustPageTheme();
    paintLandingSignedInMode();
  });
  paintLandingSignedInMode();
})();

/* Landing nav: when signed in, show the stored Poster/Tasker role — not both
   generic "Continue as poster / Continue as tasker" chips. index.html owns the
   auth text swap; this only restyles after that fires. */
function paintLandingSignedInMode() {
  var posterNav = document.getElementById('qgNavPoster');
  var taskerNav = document.getElementById('qgNavTasker');
  if (!posterNav || !taskerNav || !document.body || !document.body.classList.contains('page-landing')) return;

  function readMode() {
    if (typeof getMode === 'function') return getMode() === 'tasker' ? 'tasker' : 'poster';
    try {
      var raw = localStorage.getItem('qg-mode') || '';
      if (raw === 'tasker' || raw === 'worker') return 'tasker';
      var legacy = localStorage.getItem('qg-session-mode') || localStorage.getItem('qg-role') || '';
      if (legacy === 'worker' || legacy === 'tasker') return 'tasker';
    } catch (e) {}
    return 'poster';
  }

  function signedInFrom(el) {
    var href = (el && el.getAttribute('href')) || '';
    if (/dashboard\.html/i.test(href)) return true;
    return /continue as|signed in/i.test((el && el.textContent) || '');
  }

  var heroPoster = document.getElementById('qgHeroPoster');
  var heroTasker = document.getElementById('qgHeroTasker');
  var heroLine = document.getElementById('qgHeroLogin');
  var signedIn = signedInFrom(posterNav) || signedInFrom(taskerNav) ||
    signedInFrom(heroPoster) || signedInFrom(heroTasker) || signedInFrom(heroLine);

  document.body.classList.toggle('qg-landing-in', signedIn);
  document.body.classList.toggle('qg-landing-mode-tasker', signedIn && readMode() === 'tasker');
  document.body.classList.toggle('qg-landing-mode-poster', signedIn && readMode() === 'poster');

  function mark(el, current, currentText, otherText) {
    if (!el) return;
    el.classList.toggle('is-current', signedIn && current);
    el.classList.toggle('is-other', signedIn && !current);
    if (!signedIn) return;
    var next = current ? currentText : otherText;
    if (el.textContent !== next) el.textContent = next;
  }

  if (!signedIn) {
    posterNav.classList.remove('is-current', 'is-other');
    taskerNav.classList.remove('is-current', 'is-other');
    if (heroPoster) heroPoster.classList.remove('is-current', 'is-other');
    if (heroTasker) heroTasker.classList.remove('is-current', 'is-other');
    return;
  }

  var mode = readMode();
  mark(posterNav, mode === 'poster', 'Continue as Poster', 'Switch to Poster');
  mark(taskerNav, mode === 'tasker', 'Continue as Tasker', 'Switch to Tasker');
  mark(heroPoster, mode === 'poster', 'Continue as a Poster', 'Switch to Poster');
  mark(heroTasker, mode === 'tasker', 'Continue as a Tasker', 'Switch to Tasker');
}

(function watchLandingSignedInMode() {
  if (!document.getElementById('qgNavPoster')) return;
  var painting = false;
  var timer = null;
  function run() {
    if (painting || timer) return;
    timer = setTimeout(function () {
      timer = null;
      painting = true;
      try { paintLandingSignedInMode(); } finally { painting = false; }
    }, 40);
  }
  var root = document.querySelector('.qg-topnav') || document.body;
  var obs = new MutationObserver(run);
  obs.observe(root, { childList: true, characterData: true, subtree: true });
  var hero = document.getElementById('qgHeroLogin');
  if (hero && hero !== root) obs.observe(hero, { childList: true, characterData: true, subtree: true });
})();
