/* QuickGigs — set mode + nav role label before paint */
(function () {
  function getMode() {
    var p = new URLSearchParams(window.location.search);
    var fromUrl = p.get('mode');
    if (fromUrl === 'worker' || fromUrl === 'poster') return fromUrl;
    var path = (window.location.pathname || '').toLowerCase();
    var page = path.split('/').pop() || '';
    if (page === 'browsetask.html' || page === 'browsetask') return 'worker';
    if (page === 'posttask.html' || page === 'posttask') return 'poster';
    if (page === 'workers.html' || page === 'workers') return 'poster';
    var stored = localStorage.getItem('qg-session-mode') || localStorage.getItem('qg-role');
    return stored === 'worker' ? 'worker' : 'poster';
  }

  function roleLabel(mode) {
    return mode === 'worker' ? 'TASKER' : 'POSTER';
  }

  var mode = getMode();
  document.documentElement.setAttribute('data-qg-mode', mode);

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

  window.QG_getBrandMode = getMode;
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
