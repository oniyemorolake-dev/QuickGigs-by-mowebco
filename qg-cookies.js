/* QuickGigs — PIPEDA cookie / storage consent banner */
(function () {
  var KEY = 'qg-cookie-consent';
  var CSS_HREF = 'qg-cookies.css';

  function injectStyles() {
    if (document.getElementById('qgCookieStyles')) return;
    var link = document.createElement('link');
    link.id = 'qgCookieStyles';
    link.rel = 'stylesheet';
    link.href = CSS_HREF;
    document.head.appendChild(link);
  }

  function showBanner() {
    if (localStorage.getItem(KEY) === '1') return;
    injectStyles();
    var el = document.getElementById('qgCookieBanner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'qgCookieBanner';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', 'Cookie consent');
      el.innerHTML =
        '<p>We use essential cookies and local storage for login, theme, and location preferences. ' +
        'See our <a href="privacy.html">Privacy Policy</a> for details (PIPEDA).</p>' +
        '<button type="button" id="qgCookieAccept">Accept</button>';
      document.body.appendChild(el);
      document.getElementById('qgCookieAccept').onclick = function () {
        localStorage.setItem(KEY, '1');
        el.classList.remove('show');
      };
    }
    if (document.querySelector('.tab-bar')) el.classList.add('qg-above-tabbar');
    el.classList.add('show');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showBanner);
  } else {
    showBanner();
  }
})();
