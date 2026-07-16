/* QuickGigs — PWA install + service worker registration */
(function () {
  var DISMISS_KEY = 'qg-pwa-dismissed';

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js?v=3').then(function (reg) {
        reg.update();
      }).catch(function (err) {
        console.warn('SW registration failed:', err);
      });
    });
  }

  function injectManifestLink() {
    if (document.querySelector('link[rel="manifest"]')) return;
    var link = document.createElement('link');
    link.rel = 'manifest';
    link.href = '/manifest.json';
    document.head.appendChild(link);

    var theme = document.createElement('meta');
    theme.name = 'theme-color';
    theme.content = '#6b3fa0';
    document.head.appendChild(theme);

    var apple = document.createElement('meta');
    apple.name = 'apple-mobile-web-app-capable';
    apple.content = 'yes';
    document.head.appendChild(apple);

    var appleTitle = document.createElement('meta');
    appleTitle.name = 'apple-mobile-web-app-title';
    appleTitle.content = 'QuickGigs';
    document.head.appendChild(appleTitle);

    var appleIcon = document.createElement('link');
    appleIcon.rel = 'apple-touch-icon';
    appleIcon.href = '/QuickGigsLogo.png';
    document.head.appendChild(appleIcon);
  }

  function showInstallBanner(deferredPrompt) {
    if (localStorage.getItem(DISMISS_KEY) === '1') return;
    if (window.matchMedia('(display-mode: standalone)').matches) return;

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
        alert('To install: use your browser menu → Add to Home Screen / Install app.');
        return;
      }
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      window._qgDeferredPrompt = null;
      banner.remove();
    };
  }

  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    window._qgDeferredPrompt = e;
    showInstallBanner(deferredPrompt);
  });

  window.promptQuickGigsInstall = function () {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      return deferredPrompt.userChoice;
    }
    alert('To install QuickGigs: open the browser menu and choose "Add to Home Screen" or "Install app".');
    return Promise.resolve({ outcome: 'dismissed' });
  };

  injectManifestLink();
  registerServiceWorker();
})();
