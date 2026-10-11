// QuickGigs — light/dark theme (qg-theme). Role mode uses qg-mode separately.
(function () {
  /** Ensure design tokens load on every page that includes this file. */
  function ensureTokensStylesheet() {
    try {
      if (document.getElementById('qg-tokens-css') || document.querySelector('link[href*="qg-tokens.css"]')) return;
      var link = document.createElement('link');
      link.id = 'qg-tokens-css';
      link.rel = 'stylesheet';
      link.href = 'qg-tokens.css?v=20260811light1';
      var head = document.head || document.getElementsByTagName('head')[0];
      if (!head) return;
      head.appendChild(link);
    } catch (e) {}
  }
  ensureTokensStylesheet();

  /* App screens already ship system-ui as fallback. Load DM Sans + Playfair
     after first paint so Google Fonts never block the stylesheet waterfall.
     Only pages that use sg-app.css (the rebuilt screens) opt in. */
  function ensureAppFonts() {
    try {
      if (document.getElementById('qg-app-fonts')) return;
      if (!document.querySelector('link[href*="sg-app.css"]')) return;
      if (!document.querySelector('link[rel="preconnect"][href*="fonts.gstatic"]')) {
        var pre = document.createElement('link');
        pre.rel = 'preconnect';
        pre.href = 'https://fonts.gstatic.com';
        pre.crossOrigin = 'anonymous';
        document.head.appendChild(pre);
      }
      var link = document.createElement('link');
      link.id = 'qg-app-fonts';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&family=Playfair+Display:ital,wght@1,700&display=swap';
      link.media = 'print';
      link.onload = function () { link.media = 'all'; };
      document.head.appendChild(link);
    } catch (e) {}
  }
  ensureAppFonts();

  function migrateThemeFromLegacy() {
    try {
      var theme = localStorage.getItem('qg-theme');
      if (theme === 'light' || theme === 'dark') return theme;
      var legacy = localStorage.getItem('qg-mode');
      if (legacy === 'light' || legacy === 'dark') {
        localStorage.setItem('qg-theme', legacy);
        // Free qg-mode for poster/tasker — restore from session keys if present
        var role = localStorage.getItem('qg-session-mode') || localStorage.getItem('qg-role');
        if (role === 'worker' || role === 'tasker') localStorage.setItem('qg-mode', 'tasker');
        else if (role === 'poster') localStorage.setItem('qg-mode', 'poster');
        else localStorage.removeItem('qg-mode');
        return legacy;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function getThemePref() {
    try {
      var t = localStorage.getItem('qg-theme');
      if (t === 'light' || t === 'dark') return t;
      var migrated = migrateThemeFromLegacy();
      if (migrated) return migrated;
      return 'dark';
    } catch (e) {
      return 'dark';
    }
  }

  function isDarkTheme() {
    return getThemePref() !== 'light';
  }

  function setThemePref(isDark) {
    try {
      localStorage.setItem('qg-theme', isDark ? 'dark' : 'light');
    } catch (e) {}
  }

  /** Apply without wiping role/page classes (never assign body.className wholesale). */
  function paintTheme(isDark) {
    var light = !isDark;
    try {
      document.documentElement.classList.toggle('light', light);
      document.documentElement.classList.toggle('dark', !light);
      document.documentElement.setAttribute('data-qg-theme', light ? 'light' : 'dark');
    } catch (eHtml) {}

    var body = document.body;
    if (!body) return;

    if (body.classList.contains('theme-posttask')) {
      body.classList.toggle('light', light);
      body.classList.toggle('dark', !light);
    } else {
      body.classList.toggle('light', light);
      body.classList.remove('dark');
    }
  }

  // Early paint — works in <head> before <body> exists (html.light / data-qg-theme)
  try {
    paintTheme(isDarkTheme());
  } catch (e) {}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      paintTheme(isDarkTheme());
    });
  }

  window.QG_isDarkTheme = isDarkTheme;
  window.QG_setThemeDark = setThemePref;
  window.QG_getThemePref = getThemePref;
  window.QG_paintTheme = paintTheme;

  window.QG_applyTheme = function (isDark, modeBtnId, posttaskStyle) {
    setThemePref(!!isDark);
    var body = document.body;
    if (body && posttaskStyle) {
      body.classList.add('theme-posttask');
    } else if (body) {
      body.classList.remove('theme-posttask');
    }
    paintTheme(!!isDark);
    var btn = modeBtnId ? document.getElementById(modeBtnId) : null;
    if (btn) btn.textContent = isDark ? '☀️ Light' : '🌙 Dark';
  };
})();
