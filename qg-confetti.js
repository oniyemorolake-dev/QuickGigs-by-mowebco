/* QuickGigs — lightweight celebration burst (task complete, milestones) */
(function () {
  var stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    var style = document.createElement('style');
    style.textContent =
      '.qg-confetti-root{pointer-events:none;position:fixed;inset:0;z-index:99999;overflow:hidden;}' +
      '.qg-confetti-piece{position:absolute;top:-16px;opacity:0.92;animation:qg-confetti-fall var(--dur,2.8s) var(--delay,0s) forwards ease-in;}' +
      '@keyframes qg-confetti-fall{' +
        '0%{transform:translate3d(0,0,0) rotate(0deg);opacity:1;}' +
        '100%{transform:translate3d(var(--dx,0),110vh,0) rotate(720deg);opacity:0;}' +
      '}';
    document.head.appendChild(style);
  }

  window.qgBurstConfetti = function (opts) {
    opts = opts || {};
    injectStyles();

    var root = document.createElement('div');
    root.className = 'qg-confetti-root';
    root.setAttribute('aria-hidden', 'true');
    document.body.appendChild(root);

    var colors = opts.colors || ['#6b3fa0', '#9b6fc4', '#c8a8e9', '#fbbf24', '#4ade80', '#ffffff'];
    var count = opts.count || 72;

    for (var i = 0; i < count; i++) {
      var piece = document.createElement('div');
      piece.className = 'qg-confetti-piece';
      piece.style.left = (Math.random() * 100) + 'vw';
      piece.style.background = colors[i % colors.length];
      piece.style.width = (6 + Math.random() * 6) + 'px';
      piece.style.height = (8 + Math.random() * 8) + 'px';
      piece.style.borderRadius = Math.random() > 0.5 ? '2px' : '50%';
      piece.style.setProperty('--dur', (2 + Math.random() * 1.4) + 's');
      piece.style.setProperty('--delay', (Math.random() * 0.35) + 's');
      piece.style.setProperty('--dx', ((Math.random() - 0.5) * 48) + 'vw');
      root.appendChild(piece);
    }

    setTimeout(function () {
      if (root.parentNode) root.parentNode.removeChild(root);
    }, 4500);
  };
})();
