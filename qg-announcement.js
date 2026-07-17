/* QuickGigs — platform announcement banner (admin-controlled) */
(function () {
  var SKIP = { login: 1, signup: 1, 'parent-consent': 1, admin: 1, index: 1, terms: 1, privacy: 1 };

  function pageKey() {
    var path = (window.location.pathname || '').split('/').pop() || 'index.html';
    return path.replace(/\.html$/i, '') || 'index';
  }

  function loadCss() {
    if (document.getElementById('qg-announce-css')) return;
    var link = document.createElement('link');
    link.id = 'qg-announce-css';
    link.rel = 'stylesheet';
    link.href = 'qg-announcement.css?v=1';
    document.head.appendChild(link);
  }

  function esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function dismissKey(banner) {
    return 'qg-banner-dismiss-' + (banner.updated_at || banner.id || '1');
  }

  function injectBanner(banner) {
    if (!banner || !banner.active || !banner.message) return;
    if (localStorage.getItem(dismissKey(banner)) === '1') return;

    var existing = document.getElementById('qgPlatformBanner');
    if (existing) existing.remove();

    var style = (banner.style || 'info').toLowerCase();
    var el = document.createElement('div');
    el.id = 'qgPlatformBanner';
    el.className = 'qg-platform-banner is-' + style;
    el.setAttribute('role', 'status');

    var inner = '<div class="qg-platform-banner-inner">' +
      '<span class="qg-platform-banner-text">' + esc(banner.message) + '</span>';

    if (banner.link) {
      inner += ' <a class="qg-platform-banner-link" href="' + esc(banner.link) + '">Learn more →</a>';
    }

    inner += '<button type="button" class="qg-platform-banner-close" aria-label="Dismiss">×</button></div>';
    el.innerHTML = inner;

    el.querySelector('.qg-platform-banner-close').addEventListener('click', function () {
      localStorage.setItem(dismissKey(banner), '1');
      el.remove();
    });

    var nav = document.querySelector('.nav');
    if (nav && nav.parentNode) {
      nav.parentNode.insertBefore(el, nav.nextSibling);
    } else {
      document.body.insertBefore(el, document.body.firstChild);
    }
  }

  async function fetchBanner() {
    if (typeof sbGet !== 'function') return null;
    var rows = await sbGet('platform_banner', 'id=eq.1', null, 1);
    return rows && rows[0] ? rows[0] : null;
  }

  async function showBanner() {
    try {
      var banner = await fetchBanner();
      if (banner) injectBanner(banner);
    } catch (err) {
      console.warn('Platform banner load failed:', err);
    }
  }

  function init() {
    if (window.__qgAnnounceInit || SKIP[pageKey()]) return;
    loadCss();
    var tries = 0;
    var timer = setInterval(function () {
      if (typeof sbGet !== 'function') {
        if (++tries > 25) clearInterval(timer);
        return;
      }
      clearInterval(timer);
      window.__qgAnnounceInit = true;
      showBanner();
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.QG_refreshPlatformBanner = showBanner;
})();
