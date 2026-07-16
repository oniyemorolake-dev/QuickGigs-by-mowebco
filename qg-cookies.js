/* QuickGigs — PIPEDA cookie / storage consent banner */
(function () {
  var KEY = 'qg-cookie-consent';

  function showBanner() {
    if (localStorage.getItem(KEY) === '1') return;
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
    el.classList.add('show');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showBanner);
  } else {
    showBanner();
  }
})();
