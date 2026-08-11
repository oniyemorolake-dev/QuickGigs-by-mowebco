/**
 * QuickGigs — content page helpers (TOC for legal pages).
 * Visual wiring only — does not alter legal copy.
 */
(function () {
  'use strict';

  function slugify(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64) || 'section';
  }

  function buildToc(root) {
    root = root || document;
    if (root.querySelector('.qg-content-toc')) return;
    var content = root.querySelector('.content');
    if (!content || content.getAttribute('data-toc') === 'off') return;
    var sections = content.querySelectorAll('.section > .section-title');
    if (sections.length < 4) return;

    var nav = document.createElement('nav');
    nav.className = 'qg-content-toc';
    nav.setAttribute('aria-label', 'On this page');
    var title = document.createElement('div');
    title.className = 'qg-content-toc-title';
    title.textContent = 'On this page';
    nav.appendChild(title);
    var ol = document.createElement('ol');
    var used = {};

    sections.forEach(function (el) {
      var label = (el.textContent || '').trim();
      if (!label) return;
      var id = el.id || slugify(label);
      var base = id;
      var n = 2;
      while (used[id] || document.getElementById(id)) {
        id = base + '-' + n;
        n += 1;
      }
      used[id] = true;
      el.id = id;
      var section = el.closest('.section');
      if (section) section.id = section.id || id;

      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + id;
      a.textContent = label;
      li.appendChild(a);
      ol.appendChild(li);
    });

    if (!ol.children.length) return;
    nav.appendChild(ol);

    var insertAfter =
      content.querySelector('.page-date') ||
      content.querySelector('.page-title') ||
      content.firstChild;
    if (insertAfter && insertAfter.parentNode === content) {
      if (insertAfter.nextSibling) content.insertBefore(nav, insertAfter.nextSibling);
      else content.appendChild(nav);
    } else {
      content.insertBefore(nav, content.firstChild);
    }
  }

  function enhanceFaqChevrons() {
    document.querySelectorAll('.faq-q').forEach(function (q) {
      var mark = q.querySelector('span');
      if (mark && mark.textContent.trim() === '+') return;
      if (!mark) {
        mark = document.createElement('span');
        mark.setAttribute('aria-hidden', 'true');
        mark.textContent = '+';
        q.appendChild(mark);
      }
    });
  }

  function boot() {
    buildToc(document);
    enhanceFaqChevrons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
