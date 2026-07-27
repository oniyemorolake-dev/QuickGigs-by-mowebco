/* QuickGigs — set mode + nav role label before paint (no URL/page forced flips) */
(function () {
  function normalizeRoleMode(m) {
    if (m === 'worker' || m === 'tasker') return 'tasker';
    if (m === 'poster') return 'poster';
    return null;
  }

  function migrateRoleIntoQgMode() {
    try {
      var raw = localStorage.getItem('qg-mode');
      // Theme leftover — qg-theme.js migrates this; treat as unset for role
      if (raw === 'light' || raw === 'dark') raw = null;
      var normalized = normalizeRoleMode(raw);
      if (normalized) return normalized;
      var old = localStorage.getItem('qg-session-mode') || localStorage.getItem('qg-role');
      normalized = normalizeRoleMode(old) || 'poster';
      localStorage.setItem('qg-mode', normalized);
      return normalized;
    } catch (e) {
      return 'poster';
    }
  }

  function getMode() {
    try {
      var raw = localStorage.getItem('qg-mode');
      if (raw === 'light' || raw === 'dark') return migrateRoleIntoQgMode();
      var n = normalizeRoleMode(raw);
      if (n) return n;
      return migrateRoleIntoQgMode();
    } catch (e) {
      return 'poster';
    }
  }

  function setMode(m) {
    var mode = normalizeRoleMode(m) || 'poster';
    try {
      localStorage.setItem('qg-mode', mode);
      // Keep legacy keys in sync for older code paths (worker = tasker)
      localStorage.setItem('qg-session-mode', mode === 'tasker' ? 'worker' : 'poster');
      localStorage.setItem('qg-role', mode === 'tasker' ? 'worker' : 'poster');
    } catch (e) {}
    return mode;
  }

  function roleLabel(mode) {
    return (mode || getMode()) === 'tasker' ? 'TASKER' : 'POSTER';
  }

  // CSS still uses worker|poster on data-qg-mode
  function cssMode(mode) {
    return (mode || getMode()) === 'tasker' ? 'worker' : 'poster';
  }

  var mode = getMode();
  document.documentElement.setAttribute('data-qg-mode', cssMode(mode));

  function applyRoleLabels() {
    document.querySelectorAll('.nav-role').forEach(function (el) {
      el.textContent = roleLabel(getMode());
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyRoleLabels);
  } else {
    applyRoleLabels();
  }

  window.getMode = getMode;
  window.setMode = setMode;
  window.QG_getBrandMode = function () { return cssMode(getMode()); };
  window.QG_applyRoleLabels = applyRoleLabels;

  if (!document.querySelector('link[href*="qg-chrome.css"]')) {
    var chrome = document.createElement('link');
    chrome.rel = 'stylesheet';
    chrome.href = 'qg-chrome.css?v=1';
    document.head.appendChild(chrome);
  }

  if (!document.getElementById('qg-light-nav-css')) {
    var link = document.createElement('link');
    link.id = 'qg-light-nav-css';
    link.rel = 'stylesheet';
    link.href = 'qg-light-nav.css';
    document.head.appendChild(link);
  }

  if (!document.getElementById('qg-analytics-loader') && !document.querySelector('script[src*="qg-analytics"]')) {
    var cfgScript = document.querySelector('script[src*="qg-config.js"]');
    function loadGa() {
      var ga = document.createElement('script');
      ga.id = 'qg-analytics-loader';
      ga.src = 'qg-analytics.js?v=1';
      ga.async = true;
      document.head.appendChild(ga);
    }
    if (cfgScript) loadGa();
    else {
      var cfg = document.createElement('script');
      cfg.src = 'qg-config.js';
      cfg.onload = loadGa;
      document.head.appendChild(cfg);
    }
  }
})();
