/* QuickGigs — platform announcement banner + admin soft close */
(function () {
  var SKIP = { admin: 1, 'admin-login': 1, terms: 1, privacy: 1, login: 1, 'reset-password': 1 };
  var BLOCK_PAGES = { posttask: 1, browsetask: 1, signup: 1 };
  function pageKey() {
    var path = (window.location.pathname || '').split('/').pop() || 'index.html';
    return path.replace(/\.html$/i, '') || 'index';
  }

  function isAdminUser() {
    // Prefer shared gate (custom claim / uid / email). UX only.
    if (typeof window.isAdmin === 'function') return window.isAdmin(window._currentUser);
    var allow = (window.QG_CONFIG && window.QG_CONFIG.adminEmail) || '';
    var u = window._currentUser;
    return !!(u && u.email && allow && String(u.email).toLowerCase() === String(allow).toLowerCase());
  }

  function shouldBypassSoftClose() {
    var u = window._currentUser;
    var key = pageKey();
    if (u && isAdminUser()) {
      if (key === 'index' || key === 'signup') return false;
      return true;
    }
    // Existing users can use the app during soft close (new sign-ups stay blocked)
    if (u && u.uid && key !== 'index' && key !== 'signup') return true;
    return false;
  }

  function loadCss() {
    if (document.getElementById('qg-announce-css')) return;
    var link = document.createElement('link');
    link.id = 'qg-announce-css';
    link.rel = 'stylesheet';
    link.href = 'qg-announcement.css?v=3';
    document.head.appendChild(link);
  }

  function esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function dismissKey(banner) {
    return 'qg-banner-dismiss-' + (banner.updated_at || banner.id || '1');
  }

  function injectBanner(banner) {
    if (!banner || !banner.active || !banner.message) return;
    if (banner.soft_close) return;
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
      var safeLink = typeof safeUrl === 'function' ? safeUrl(banner.link) : '';
      if (safeLink) {
        inner += ' <a class="qg-platform-banner-link" href="' + esc(safeLink) + '">Learn more →</a>';
      }
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

  function applyIndexSoftClose(banner) {
    var wrap = document.getElementById('ctaWrap');
    var badge = document.querySelector('.beta-badge');
    if (badge) {
      badge.textContent = '🔒 Beta closed · Launching soon';
      badge.style.color = '#fde68a';
      badge.style.background = 'rgba(251,191,36,0.12)';
      badge.style.borderColor = 'rgba(251,191,36,0.25)';
    }
    if (wrap) {
      wrap.innerHTML =
        '<div class="qg-soft-close-box">' +
          '<p class="qg-soft-close-title">' + esc(banner.message || 'QuickGigs beta is closed while we prepare for launch.') + '</p>' +
          '<p class="qg-soft-close-sub" style="margin-top:14px">Already have an account? <a href="login.html" style="color:var(--al);font-weight:500;text-decoration:none">Log in to continue →</a></p>' +
          (function () {
            var safeLink = typeof safeUrl === 'function' ? safeUrl(banner.link) : '';
            return safeLink
              ? '<p class="qg-soft-close-sub"><a href="' + esc(safeLink) + '" style="color:var(--al)">Learn more →</a></p>'
              : '';
          })() +
        '</div>';
    }
  }

  function applySignupSoftClose(banner) {
    var params = new URLSearchParams(window.location.search);
    if (params.get('oauth') === 'continue') return;
    var card = document.querySelector('.signup-card') || document.querySelector('.signup-page');
    if (!card) return;
    var msg = banner.message || 'Sign-ups are paused while we prepare for launch.';
    var existing = document.getElementById('qgSignupSoftCloseNotice');
    if (existing) existing.remove();
    var notice = document.createElement('div');
    notice.id = 'qgSignupSoftCloseNotice';
    notice.className = 'qg-soft-close-block';
    notice.style.marginBottom = '16px';
    notice.innerHTML = '<p><strong>Heads up</strong></p><p>' + esc(msg) + '</p>' +
      '<p style="margin-top:10px;font-size:12px">You can still sign up with Google or email below for testing. To fully reopen sign-ups, turn off soft close in Admin → Settings.</p>';
    card.insertBefore(notice, card.firstChild);
  }

  function deferBlockPageRedirect() {
    var waited = 0;
    var timer = setInterval(function () {
      if (window._currentUser && window._currentUser.uid) {
        clearInterval(timer);
        return;
      }
      waited += 150;
      if (waited >= 4000) {
        clearInterval(timer);
        window.location.replace('index.html?closed=1');
      }
    }, 150);
  }

  function applySoftClose(banner) {
    if (!banner || !banner.active || !banner.soft_close) return false;
    if (shouldBypassSoftClose()) return false;

    var key = pageKey();
    if (key === 'index') {
      applyIndexSoftClose(banner);
      return true;
    }
    if (key === 'signup') {
      applySignupSoftClose(banner);
      return true;
    }
    if (BLOCK_PAGES[key]) {
      if (window._currentUser && window._currentUser.uid) return false;
      deferBlockPageRedirect();
      return true;
    }
    return false;
  }

  async function fetchBanner() {
    if (typeof sbGet !== 'function') return null;
    var rows = await sbGet('platform_banner', 'id=eq.1&select=id,message,link,style,active,soft_close,updated_at', 'id.asc', 1);
    return rows && rows[0] ? rows[0] : null;
  }

  async function applyPlatformState() {
    try {
      var banner = await fetchBanner();
      if (!banner) return null;
      if (applySoftClose(banner)) return banner;
      injectBanner(banner);
      return banner;
    } catch (err) {
      console.warn('Platform banner load failed:', err);
      return null;
    }
  }

  function init() {
    if (window.__qgAnnounceInit || SKIP[pageKey()]) return;
    loadCss();
    var tries = 0;
    var timer = setInterval(function () {
      if (typeof sbGet !== 'function') {
        if (++tries > 40) clearInterval(timer);
        return;
      }
      clearInterval(timer);
      window.__qgAnnounceInit = true;
      applyPlatformState();
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.QG_refreshPlatformBanner = applyPlatformState;
  window.QG_fetchPlatformBanner = fetchBanner;
  window.QG_onAuthReadyForSoftClose = function () {
    applyPlatformState();
  };

  window.QG_setCurrentUserForSoftClose = function (user) {
    if (typeof setCurrentUser === 'function') setCurrentUser(user);
    else window._currentUser = user;
    if (typeof window.QG_onAuthReadyForSoftClose === 'function') {
      window.QG_onAuthReadyForSoftClose();
    }
  };
})();
