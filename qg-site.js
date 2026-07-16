/* QuickGigs — shared footer, loading, empty states, back nav */
(function () {
  var FOOTER_LINKS =
    '<a href="how-it-works.html">How it works</a> · ' +
    '<a href="faq.html">FAQ</a> · ' +
    '<a href="safety.html">Safety</a> · ' +
    '<a href="guidelines.html">Guidelines</a> · ' +
    '<a href="dispute-resolution.html">Disputes</a> · ' +
    '<a href="terms.html">Terms</a> · ' +
    '<a href="privacy.html">Privacy</a> · ' +
    '<a href="feedback.html">Feedback</a>';

  window.renderQuickGigsFooter = function (containerId) {
    var el = document.getElementById(containerId || 'siteFooter');
    if (!el) return;
    el.innerHTML = FOOTER_LINKS;
    el.classList.add('site-footer');
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
  };

  window.qgHideGlobalLoading = function () {
    var el = document.getElementById('qgGlobalLoading');
    if (el) el.classList.remove('show');
  };

  window.initTrustPageTheme = function () {
    var isDark = localStorage.getItem('qg-mode') !== 'light';
    document.body.classList.toggle('light', !isDark);
    var btn = document.getElementById('modeBtn');
    if (btn) btn.textContent = isDark ? '☀️ Light' : '🌙 Dark';
    window.toggleTheme = function () {
      isDark = !isDark;
      localStorage.setItem('qg-mode', isDark ? 'dark' : 'light');
      document.body.classList.toggle('light', !isDark);
      if (btn) btn.textContent = isDark ? '☀️ Light' : '🌙 Dark';
    };
  };

  (function loadAnalytics() {
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
  })();

  (function loadMenu() {
    if (document.getElementById('qg-menu-loader')) return;
    var s = document.createElement('script');
    s.id = 'qg-menu-loader';
    s.src = 'qg-menu.js?v=2';
    s.defer = true;
    document.head.appendChild(s);
  })();

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
  });
})();
