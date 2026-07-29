// QuickGigs — light/dark theme (qg-theme). Role mode uses qg-mode separately.
(function () {
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
