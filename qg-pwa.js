/* QuickGigs — PWA install (Android prompt + iPhone Safari guide) */
(function () {
  var DISMISS_KEY = 'qg-pwa-dismissed';
  var IOS_DISMISS_KEY = 'qg-ios-install-dismissed';
  var SHEET_VER = '5';

  function assetUrl(path) {
    try {
      return new URL(path, window.location.href).href;
    } catch (e) {
      return path;
    }
  }

  function injectPwaHead() {
    if (document.getElementById('qg-pwa-head')) return;

    var marker = document.createElement('meta');
    marker.id = 'qg-pwa-head';
    marker.name = 'generator';
    marker.content = 'QuickGigs PWA';
    document.head.appendChild(marker);

    if (!document.querySelector('link[rel="manifest"]')) {
      var manifest = document.createElement('link');
      manifest.rel = 'manifest';
      manifest.href = assetUrl('/manifest.json?v=' + SHEET_VER);
      document.head.appendChild(manifest);
    }

    if (!document.querySelector('meta[name="theme-color"]')) {
      var theme = document.createElement('meta');
      theme.name = 'theme-color';
      theme.content = '#6b3fa0';
      document.head.appendChild(theme);
    }

    if (!document.querySelector('meta[name="mobile-web-app-capable"]')) {
      var mobile = document.createElement('meta');
      mobile.name = 'mobile-web-app-capable';
      mobile.content = 'yes';
      document.head.appendChild(mobile);
    }

    if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
      var apple = document.createElement('meta');
      apple.name = 'apple-mobile-web-app-capable';
      apple.content = 'yes';
      document.head.appendChild(apple);
    }

    if (!document.querySelector('meta[name="apple-mobile-web-app-title"]')) {
      var appleTitle = document.createElement('meta');
      appleTitle.name = 'apple-mobile-web-app-title';
      appleTitle.content = 'QuickGigs';
      document.head.appendChild(appleTitle);
    }

    if (!document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')) {
      var status = document.createElement('meta');
      status.name = 'apple-mobile-web-app-status-bar-style';
      status.content = 'black-translucent';
      document.head.appendChild(status);
    }

    if (!document.querySelector('link[rel="apple-touch-icon"]')) {
      var appleIcon = document.createElement('link');
      appleIcon.rel = 'apple-touch-icon';
      appleIcon.href = assetUrl('/QuickGigsLogo.png');
      appleIcon.setAttribute('sizes', '180x180');
      document.head.appendChild(appleIcon);
    }
  }

  function isIos() {
    var ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/i.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
  }

  function isInAppBrowser() {
    var ua = navigator.userAgent || '';
    return /FBAN|FBAV|Instagram|Line\/|Twitter|LinkedInApp|GSA\/|CriOS|FxiOS/i.test(ua);
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register(assetUrl('/sw.js?v=' + SHEET_VER)).then(function (reg) {
        reg.update();
      }).catch(function (err) {
        console.warn('SW registration failed:', err);
      });
    });
  }

  function ensureIosSheetStyles() {
    if (document.getElementById('qg-ios-install-css')) return;
    var style = document.createElement('style');
    style.id = 'qg-ios-install-css';
    style.textContent =
      '.qg-ios-overlay{position:fixed;inset:0;z-index:9998;display:none;align-items:flex-end;justify-content:center;background:rgba(5,0,15,.85);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}' +
      '.qg-ios-overlay.open{display:flex}' +
      '.qg-ios-sheet{width:100%;max-width:420px;border-radius:24px 24px 0 0;padding:12px 22px calc(24px + env(safe-area-inset-bottom));background:linear-gradient(180deg,#1a0a38,#120628);border:0.5px solid rgba(200,168,233,.2);color:#fff;font-family:DM Sans,sans-serif}' +
      '.qg-ios-handle{width:40px;height:4px;border-radius:2px;background:rgba(200,168,233,.35);margin:0 auto 14px}' +
      '.qg-ios-title{font-family:Playfair Display,serif;font-style:italic;font-size:1.5rem;margin:0 0 6px;text-align:center}' +
      '.qg-ios-sub{font-size:13px;line-height:1.55;color:rgba(255,255,255,.55);text-align:center;margin:0 0 18px}' +
      '.qg-ios-step{display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-top:0.5px solid rgba(200,168,233,.12)}' +
      '.qg-ios-num{width:26px;height:26px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:rgba(107,63,160,.35);color:#c8a8e9;font-size:12px;font-weight:600}' +
      '.qg-ios-step strong{display:block;font-size:14px;margin-bottom:3px}' +
      '.qg-ios-step p{margin:0;font-size:12px;line-height:1.5;color:rgba(255,255,255,.5)}' +
      '.qg-ios-actions{display:flex;gap:10px;margin-top:16px}' +
      '.qg-ios-btn{flex:1;padding:14px;border-radius:14px;border:none;font-family:DM Sans,sans-serif;font-size:14px;font-weight:600;cursor:pointer}' +
      '.qg-ios-btn.secondary{background:transparent;border:0.5px solid rgba(200,168,233,.25);color:rgba(255,255,255,.65)}' +
      '.qg-ios-btn.primary{background:linear-gradient(135deg,#6b3fa0,#9b6fc4);color:#fff}' +
      '.qg-ios-warn{margin:0 0 14px;padding:12px 14px;border-radius:14px;background:rgba(251,191,36,.12);border:0.5px solid rgba(251,191,36,.28);font-size:12px;line-height:1.5;color:#fde68a}';
    document.head.appendChild(style);
  }

  function closeIosInstallSheet() {
    var overlay = document.getElementById('qgIosInstallOverlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.style.display = 'none';
    document.body.style.overflow = '';
  }

  function showIosInstallSheet() {
    if (isStandalone()) return;

    ensureIosSheetStyles();

    var overlay = document.getElementById('qgIosInstallOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'qg-ios-overlay';
      overlay.id = 'qgIosInstallOverlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.innerHTML =
        '<div class="qg-ios-sheet" role="document">' +
          '<div class="qg-ios-handle" aria-hidden="true"></div>' +
          '<h2 class="qg-ios-title">Add QuickGigs to Home Screen</h2>' +
          '<p class="qg-ios-sub">iPhone doesn&apos;t have an Install button — use Safari&apos;s Share menu instead.</p>' +
          '<div id="qgIosInAppWarn" class="qg-ios-warn" style="display:none">' +
            '<strong>Open in Safari first.</strong> Instagram, Chrome, and other in-app browsers can&apos;t add home screen apps. Copy the link and open it in Safari.' +
          '</div>' +
          '<div class="qg-ios-step"><span class="qg-ios-num">1</span><div><strong>Tap the Share button</strong><p>Bottom of Safari — square with an arrow pointing up.</p></div></div>' +
          '<div class="qg-ios-step"><span class="qg-ios-num">2</span><div><strong>Scroll → &ldquo;Add to Home Screen&rdquo;</strong><p>It may be in the <em>More</em> (⋯) menu if you don&apos;t see it right away.</p></div></div>' +
          '<div class="qg-ios-step"><span class="qg-ios-num">3</span><div><strong>Tap Add</strong><p>QuickGigs opens like a real app from your home screen.</p></div></div>' +
          '<div class="qg-ios-actions">' +
            '<button type="button" class="qg-ios-btn secondary" id="qgIosDismissBtn">Not now</button>' +
            '<button type="button" class="qg-ios-btn primary" id="qgIosGotItBtn">Got it</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeIosInstallSheet();
      });
      document.getElementById('qgIosDismissBtn').onclick = function () {
        localStorage.setItem(IOS_DISMISS_KEY, '1');
        closeIosInstallSheet();
      };
      document.getElementById('qgIosGotItBtn').onclick = closeIosInstallSheet;
    }

    var warn = document.getElementById('qgIosInAppWarn');
    if (warn) warn.style.display = isInAppBrowser() ? 'block' : 'none';

    overlay.classList.add('open');
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function showAndroidBanner(deferredPrompt) {
    if (localStorage.getItem(DISMISS_KEY) === '1') return;
    if (isStandalone()) return;

    var existing = document.getElementById('qgPwaBanner');
    if (existing) existing.remove();

    var banner = document.createElement('div');
    banner.id = 'qgPwaBanner';
    banner.className = 'qg-pwa-banner show';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Install QuickGigs app');
    banner.innerHTML =
      '<div class="qg-pwa-banner-text">' +
        '<strong>Install QuickGigs</strong>' +
        'Add to your home screen for faster access to tasks and messages.' +
      '</div>' +
      '<button type="button" class="qg-pwa-install" id="qgPwaInstallBtn">Install</button>' +
      '<button type="button" class="qg-pwa-dismiss" id="qgPwaDismissBtn" aria-label="Dismiss">×</button>';

    var anchor = document.querySelector('.greeting') ||
      document.querySelector('.qg-page-hero') ||
      document.querySelector('.dash-hero') ||
      document.querySelector('.nav');
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(banner, anchor.nextSibling);
    } else {
      document.body.insertBefore(banner, document.body.firstChild);
    }

    document.getElementById('qgPwaDismissBtn').onclick = function () {
      localStorage.setItem(DISMISS_KEY, '1');
      banner.remove();
    };

    document.getElementById('qgPwaInstallBtn').onclick = async function () {
      if (!deferredPrompt) {
        window.promptQuickGigsInstall();
        return;
      }
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      window._qgDeferredPrompt = null;
      banner.remove();
    };
  }

  function maybeShowIosPrompt() {
    if (!isIos() || isStandalone()) return;
    if (localStorage.getItem(IOS_DISMISS_KEY) === '1') return;
    var page = (window.location.pathname || '').split('/').pop() || '';
    if (page !== 'dashboard.html' && page !== 'index.html') return;
    setTimeout(showIosInstallSheet, 1200);
  }

  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    window._qgDeferredPrompt = e;
    showAndroidBanner(deferredPrompt);
  });

  window.promptQuickGigsInstall = function () {
    if (isStandalone()) {
      alert('QuickGigs is already installed on this device.');
      return Promise.resolve({ outcome: 'accepted' });
    }
    if (isIos()) {
      showIosInstallSheet();
      return Promise.resolve({ outcome: 'dismissed' });
    }
    if (deferredPrompt) {
      deferredPrompt.prompt();
      return deferredPrompt.userChoice;
    }
    alert('To install QuickGigs: open your browser menu and choose "Add to Home Screen" or "Install app".');
    return Promise.resolve({ outcome: 'dismissed' });
  };

  window.showIosInstallSheet = showIosInstallSheet;
  window.isQuickGigsInstalled = isStandalone;

  injectPwaHead();
  registerServiceWorker();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeShowIosPrompt);
  } else {
    maybeShowIosPrompt();
  }
})();
