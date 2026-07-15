// QuickGigs — mobile keyboard + bottom nav fixes
(function () {
  function isMobile() {
    return window.matchMedia('(max-width: 768px), (pointer: coarse)').matches;
  }

  function initKeyboardDismiss() {
    document.addEventListener('touchstart', function (e) {
      var t = e.target;
      if (t.closest('input, textarea, select, button, a, [contenteditable]')) return;
      var active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
        active.blur();
      }
    }, { passive: true });

    document.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest('input, textarea, select, button, a, [contenteditable]')) return;
      var active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
        active.blur();
      }
    });
  }

  function initVisualViewport() {
    if (!window.visualViewport || !isMobile()) return;

    function syncKeyboard() {
      var vv = window.visualViewport;
      var keyboardOpen = vv.height < window.innerHeight * 0.78;
      document.body.classList.toggle('qg-keyboard-open', keyboardOpen);

      var bar = document.getElementById('qgTabBar');
      if (!bar || keyboardOpen) return;
      bar.style.transform = 'translateZ(0)';
    }

    window.visualViewport.addEventListener('resize', syncKeyboard);
    window.visualViewport.addEventListener('scroll', syncKeyboard);
    syncKeyboard();
  }

  function injectMobileCss() {
    if (document.getElementById('qg-mobile-css')) return;
    var link = document.createElement('link');
    link.id = 'qg-mobile-css';
    link.rel = 'stylesheet';
    link.href = 'qg-mobile.css';
    document.head.appendChild(link);
  }

  function init() {
    injectMobileCss();
    if (isMobile()) {
      initKeyboardDismiss();
      initVisualViewport();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.QG_initMobile = init;
})();
