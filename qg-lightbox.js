/* QuickGigs — full-screen image lightbox (tap task photos to expand) */
(function () {
  var root;
  var imgEl;
  var captionEl;
  var dotsEl;
  var urls = [];
  var index = 0;
  var open = false;

  function loadCss() {
    if (document.getElementById('qg-lightbox-css')) return;
    var link = document.createElement('link');
    link.id = 'qg-lightbox-css';
    link.rel = 'stylesheet';
    link.href = 'qg-lightbox.css?v=1';
    document.head.appendChild(link);
  }

  function ensureRoot() {
    if (root) return;
    loadCss();
    root = document.createElement('div');
    root.id = 'qgLightbox';
    root.className = 'qg-lightbox';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Photo viewer');
    root.innerHTML =
      '<div class="qg-lightbox-toolbar">' +
        '<span class="qg-lightbox-caption" id="qgLightboxCaption"></span>' +
        '<button type="button" class="qg-lightbox-close" id="qgLightboxClose" aria-label="Close">×</button>' +
      '</div>' +
      '<div class="qg-lightbox-stage">' +
        '<button type="button" class="qg-lightbox-nav qg-lightbox-prev" id="qgLightboxPrev" aria-label="Previous photo">‹</button>' +
        '<img class="qg-lightbox-img" id="qgLightboxImg" alt="">' +
        '<button type="button" class="qg-lightbox-nav qg-lightbox-next" id="qgLightboxNext" aria-label="Next photo">›</button>' +
      '</div>' +
      '<div class="qg-lightbox-dots" id="qgLightboxDots"></div>';
    document.body.appendChild(root);

    imgEl = document.getElementById('qgLightboxImg');
    captionEl = document.getElementById('qgLightboxCaption');
    dotsEl = document.getElementById('qgLightboxDots');

    document.getElementById('qgLightboxClose').onclick = closeQgLightbox;
    document.getElementById('qgLightboxPrev').onclick = function () { step(-1); };
    document.getElementById('qgLightboxNext').onclick = function () { step(1); };
    root.addEventListener('click', function (e) {
      if (e.target === root || e.target.classList.contains('qg-lightbox-stage')) closeQgLightbox();
    });
    document.addEventListener('keydown', onKey);
  }

  function render() {
    if (!urls.length) return;
    index = Math.max(0, Math.min(index, urls.length - 1));
    imgEl.src = urls[index];
    imgEl.alt = 'Photo ' + (index + 1) + ' of ' + urls.length;
    dotsEl.textContent = urls.length > 1 ? (index + 1) + ' / ' + urls.length : '';
    document.getElementById('qgLightboxPrev').style.display = urls.length > 1 ? '' : 'none';
    document.getElementById('qgLightboxNext').style.display = urls.length > 1 ? '' : 'none';
  }

  function step(dir) {
    if (urls.length < 2) return;
    index = (index + dir + urls.length) % urls.length;
    render();
  }

  function onKey(e) {
    if (!open) return;
    if (e.key === 'Escape') closeQgLightbox();
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  }

  window.openQgLightbox = function (photoUrls, startIndex, caption) {
    if (!photoUrls || !photoUrls.length) return;
    ensureRoot();
    urls = photoUrls.filter(Boolean);
    index = startIndex || 0;
    if (captionEl) captionEl.textContent = caption || '';
    render();
    open = true;
    root.classList.add('open');
    document.body.classList.add('qg-lightbox-open');
    document.getElementById('qgLightboxClose').focus();
  };

  window.closeQgLightbox = function () {
    if (!open || !root) return;
    open = false;
    root.classList.remove('open');
    document.body.classList.remove('qg-lightbox-open');
    if (imgEl) imgEl.removeAttribute('src');
  };

  window.bindQgPhotoLightbox = function (container, selector) {
    if (!container) return;
    selector = selector || '.tc-photo-tappable, .qg-modal-photo-tap';
    container.addEventListener('click', function (e) {
      var el = e.target.closest(selector);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      var raw = el.getAttribute('data-photos');
      var list = [];
      try { list = JSON.parse(raw || '[]'); } catch (err) { list = []; }
      if (!list.length) {
        var single = el.getAttribute('data-photo') || (el.tagName === 'IMG' ? el.src : '');
        if (single) list = [single];
      }
      var cap = el.getAttribute('data-photo-caption') || '';
      var start = parseInt(el.getAttribute('data-photo-index') || '0', 10) || 0;
      if (list.length) openQgLightbox(list, start, cap);
    });
  };
})();
