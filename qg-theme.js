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

  try {
    var light = !isDarkTheme();
    var body = document.body;
    if (body) {
      if (body.classList.contains('theme-posttask')) {
        body.className = (light ? 'light' : 'dark') + ' theme-posttask';
      } else {
        body.className = light ? 'light' : '';
      }
    }
  } catch (e) {}

  window.QG_isDarkTheme = isDarkTheme;
  window.QG_setThemeDark = setThemePref;
  window.QG_getThemePref = getThemePref;

  window.QG_applyTheme = function (isDark, modeBtnId, posttaskStyle) {
    setThemePref(!!isDark);
    var body = document.body;
    if (posttaskStyle) {
      body.className = (isDark ? 'dark' : 'light') + ' theme-posttask';
    } else {
      body.className = isDark ? '' : 'light';
    }
    var btn = modeBtnId ? document.getElementById(modeBtnId) : null;
    if (btn) btn.textContent = isDark ? '☀️ Light' : '🌙 Dark';
  };
})();
