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

  function scrollFieldIntoView(el) {
    if (!el || typeof el.scrollIntoView !== 'function') return;
    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    } catch (e) {
      try { el.scrollIntoView(true); } catch (e2) {}
    }
    // Also scroll parent modal sheet if present
    var scrollParent = el.closest('.modal-scroll, .qg-sheet-body, .confirm-box');
    if (scrollParent) {
      var top = el.offsetTop - 24;
      if (top > 0) scrollParent.scrollTop = top;
    }
  }

  function initVisualViewport() {
    if (!window.visualViewport || !isMobile()) return;

    function syncKeyboard() {
      var vv = window.visualViewport;
      var keyboardOpen = vv.height < window.innerHeight * 0.78;
      document.body.classList.toggle('qg-keyboard-open', keyboardOpen);
      document.documentElement.style.setProperty('--qg-vvh', Math.round(vv.height) + 'px');

      var bar = document.getElementById('qgTabBar');
      if (!bar || keyboardOpen) return;
      bar.style.transform = 'translateZ(0)';
    }

    window.visualViewport.addEventListener('resize', syncKeyboard);
    window.visualViewport.addEventListener('scroll', syncKeyboard);
    syncKeyboard();

    document.addEventListener('focusin', function (e) {
      var t = e.target;
      if (!t || !t.matches || !t.matches('input, textarea, select')) return;
      setTimeout(function () {
        syncKeyboard();
        scrollFieldIntoView(t);
      }, 300);
    });
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
