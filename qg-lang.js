/* SwiftGigs languages.
   Detects the device language, asks once whether to switch, and then
   translates the app's own text through the `translate` function, which caches
   every phrase so each one is only ever translated once.

   Off by default: if the server has no translation key, nothing is shown.
   Never translated: chat messages, anything typed into a field, and anything
   inside translate="no" or .notranslate. */
(function () {
  'use strict';

  var URL_ = 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/translate';
  var KEY = 'qg-lang';            // chosen language ('en' = stay in English)
  var ASKED = 'qg-lang-asked';    // the prompt was answered or dismissed
  var NAMES = {
    en: 'English', fr: 'Français', es: 'Español', zh: '中文', pa: 'ਪੰਜਾਬੀ', hi: 'हिन्दी',
    tl: 'Tagalog', ar: 'العربية', ur: 'اردو', pt: 'Português', vi: 'Tiếng Việt',
    ko: '한국어', uk: 'Українська', fa: 'فارسی', de: 'Deutsch', it: 'Italiano'
  };
  // The question has to be readable before anything is translated.
  var ASK = {
    fr: ['Voir SwiftGigs en français ?', 'Oui', 'Non merci'],
    es: ['¿Ver SwiftGigs en español?', 'Sí', 'No, gracias'],
    zh: ['用中文查看 SwiftGigs？', '好的', '不用了'],
    pa: ['SwiftGigs ਪੰਜਾਬੀ ਵਿੱਚ ਵੇਖੋ?', 'ਹਾਂ', 'ਨਹੀਂ'],
    hi: ['SwiftGigs हिन्दी में देखें?', 'हाँ', 'नहीं'],
    tl: ['Tingnan ang SwiftGigs sa Tagalog?', 'Oo', 'Hindi na'],
    ar: ['عرض SwiftGigs بالعربية؟', 'نعم', 'لا شكرًا'],
    ur: ['SwiftGigs اردو میں دیکھیں؟', 'جی ہاں', 'نہیں'],
    pt: ['Ver o SwiftGigs em português?', 'Sim', 'Não, obrigado'],
    vi: ['Xem SwiftGigs bằng tiếng Việt?', 'Có', 'Không'],
    ko: ['SwiftGigs를 한국어로 볼까요?', '예', '아니요'],
    uk: ['Показати SwiftGigs українською?', 'Так', 'Ні'],
    fa: ['SwiftGigs را به فارسی ببینید؟', 'بله', 'نه'],
    de: ['SwiftGigs auf Deutsch ansehen?', 'Ja', 'Nein danke'],
    it: ['Vedere SwiftGigs in italiano?', 'Sì', 'No grazie']
  };
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, CODE: 1, PRE: 1, SVG: 1, IFRAME: 1, OPTION: 0 };
  var SKIP_SEL = '[translate="no"], .notranslate, [contenteditable="true"], #sgChatScroll, .qg-lang-ui, .leaflet-container';
  var ATTRS = ['placeholder', 'aria-label', 'title'];

  var lang = 'en', enabled = null, memo = {}, originals = new WeakMap(), queue = [], timer = null, observer = null;

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function loadMemo(code) {
    try { memo = JSON.parse(localStorage.getItem('qg-lang-memo-' + code) || '{}') || {}; } catch (e) { memo = {}; }
  }
  var memoTimer = null;
  function saveMemo() {
    clearTimeout(memoTimer);
    memoTimer = setTimeout(function () {
      try {
        var keys = Object.keys(memo);
        if (keys.length > 2500) { var trimmed = {}; keys.slice(-2000).forEach(function (k) { trimmed[k] = memo[k]; }); memo = trimmed; }
        localStorage.setItem('qg-lang-memo-' + lang, JSON.stringify(memo));
      } catch (e) {}
    }, 600);
  }

  function post(body) {
    return fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); });
  }
  function status() {
    if (enabled !== null) return Promise.resolve(enabled);
    try {
      var c = sessionStorage.getItem('qg-lang-on');
      if (c === '1' || c === '0') { enabled = c === '1'; return Promise.resolve(enabled); }
    } catch (e) {}
    return post({ action: 'status' }).then(function (d) {
      enabled = !!(d && d.enabled);
      try { sessionStorage.setItem('qg-lang-on', enabled ? '1' : '0'); } catch (e) {}
      return enabled;
    }).catch(function () { enabled = false; return false; });
  }

  // Worth sending? Not numbers, prices, emails, links or single symbols.
  function worth(s) {
    if (!s || s.length < 2 || s.length > 300) return false;
    if (!/[A-Za-z]{2}/.test(s)) return false;
    if (/^[\s\d$.,:%+\-–—·/()#@]*$/.test(s)) return false;
    if (/^\S+@\S+\.\S+$/.test(s) || /^https?:\/\//i.test(s)) return false;
    return true;
  }
  function skipped(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentNode) {
      if (SKIP_TAGS[n.tagName.toUpperCase()]) return true;
    }
    return !!(el.closest && el.closest(SKIP_SEL));
  }

  /* A unit is one text node or one attribute. `src` is always the English. */
  function collect(root, units) {
    if (!root) return;
    if (root.nodeType === 3) { addText(root, units); return; }
    if (root.nodeType !== 1 || skipped(root)) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) addText(node, units);
    var els = root.querySelectorAll ? root.querySelectorAll('[placeholder],[aria-label],[title]') : [];
    var list = Array.prototype.slice.call(els);
    if (root.hasAttribute && (root.hasAttribute('placeholder') || root.hasAttribute('aria-label') || root.hasAttribute('title'))) list.push(root);
    list.forEach(function (el) {
      if (skipped(el)) return;
      ATTRS.forEach(function (a) {
        var v = el.getAttribute(a);
        if (!v) return;
        var rec = originals.get(el) || {};
        if (rec[a] && rec[a].out === v) return;            // already ours
        var src = v.trim();
        if (!worth(src)) return;
        rec[a] = { src: src, out: null };
        originals.set(el, rec);
        units.push({ el: el, attr: a, src: src });
      });
    });
  }
  function addText(node, units) {
    var parent = node.parentNode;
    if (!parent || parent.nodeType !== 1 || skipped(parent)) return;
    var raw = node.nodeValue;
    var rec = originals.get(node);
    if (rec && rec.out === raw) return;                    // already ours
    var src = raw.trim();
    if (!worth(src)) return;
    originals.set(node, { src: src, out: null, lead: raw.match(/^\s*/)[0], tail: raw.match(/\s*$/)[0] });
    units.push({ node: node, src: src });
  }
  function apply(unit, text) {
    if (!text) return;
    if (unit.node) {
      var rec = originals.get(unit.node);
      if (!rec || !unit.node.parentNode) return;
      rec.out = rec.lead + text + rec.tail;
      unit.node.nodeValue = rec.out;
    } else {
      var r = originals.get(unit.el);
      if (!r || !r[unit.attr]) return;
      r[unit.attr].out = text;
      unit.el.setAttribute(unit.attr, text);
    }
  }

  function translate(root) {
    if (lang === 'en') return;
    var units = [];
    collect(root, units);
    if (!units.length) return;
    var need = {};
    units.forEach(function (u) {
      if (memo[u.src]) apply(u, memo[u.src]);
      else (need[u.src] || (need[u.src] = [])).push(u);
    });
    Object.keys(need).forEach(function (src) { queue.push({ src: src, units: need[src] }); });
    if (queue.length && !timer) timer = setTimeout(flush, 60);
  }
  function flush() {
    timer = null;
    var batch = queue.splice(0, 80);
    if (!batch.length) return;
    var forLang = lang;
    post({ action: 'translate', lang: forLang, texts: batch.map(function (b) { return b.src; }) })
      .then(function (d) {
        if (forLang !== lang || !d || !d.out) return;
        batch.forEach(function (b, i) {
          var t = d.out[i];
          if (!t) return;
          memo[b.src] = t;
          b.units.forEach(function (u) { apply(u, t); });
        });
        saveMemo();
      })
      .catch(function () {})
      .then(function () { if (queue.length && !timer) timer = setTimeout(flush, 120); });
  }

  function watch() {
    if (observer || !window.MutationObserver) return;
    var pending = [], t = null;
    observer = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        if (m.type === 'characterData') pending.push(m.target);
        else if (m.type === 'attributes') pending.push(m.target);
        else Array.prototype.forEach.call(m.addedNodes, function (n) { pending.push(n); });
      });
      if (!t) t = setTimeout(function () {
        t = null;
        var nodes = pending; pending = [];
        nodes.forEach(function (n) { if (n.isConnected !== false) translate(n); });
      }, 120);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  function start(code) {
    lang = code;
    loadMemo(code);
    document.documentElement.setAttribute('lang', code);
    translate(document.body);
    watch();
  }

  function choose(code) {
    set(KEY, code);
    set(ASKED, '1');
    // Going back to English (or changing language) is cleanest from a fresh page.
    if (lang !== 'en' || code === 'en') { location.reload(); return; }
    start(code);
  }

  /* ── UI ─────────────────────────────────────────────────────────────── */
  function css() {
    if (document.getElementById('qgLangCss')) return;
    var s = document.createElement('style');
    s.id = 'qgLangCss';
    s.textContent =
      '.qg-lang-ask{position:fixed;left:12px;right:12px;bottom:calc(84px + env(safe-area-inset-bottom));z-index:11000;max-width:456px;margin:0 auto;display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:14px;background:var(--surface,#fff);color:var(--text,#111);border:1px solid var(--border,#ddd);box-shadow:0 8px 28px rgba(0,0,0,.18);font-size:14px;font-weight:600;}' +
      '.qg-lang-ask span{flex:1;min-width:0;}' +
      '.qg-lang-ask button{flex:none;height:36px;padding:0 14px;border-radius:10px;border:1px solid var(--border,#ddd);background:transparent;color:var(--text,#111);font:inherit;font-size:13px;font-weight:700;cursor:pointer;}' +
      '.qg-lang-ask button.yes{background:var(--primary,#6d28d9);border-color:var(--primary,#6d28d9);color:#fff;}' +
      '.qg-lang-ov{position:fixed;inset:0;z-index:12500;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;justify-content:center;}' +
      '.qg-lang-sheet{width:100%;max-width:480px;max-height:80vh;overflow:auto;background:var(--surface,#fff);color:var(--text,#111);border-radius:20px 20px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom));box-sizing:border-box;}' +
      '.qg-lang-sheet h2{margin:0 0 4px;font-size:18px;font-weight:700;}' +
      '.qg-lang-sheet p{margin:0 0 12px;font-size:13px;color:var(--text-muted,#666);line-height:1.45;}' +
      '.qg-lang-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}' +
      '.qg-lang-grid button{height:46px;border-radius:12px;border:1px solid var(--border,#ddd);background:transparent;color:var(--text,#111);font:inherit;font-size:15px;font-weight:600;cursor:pointer;}' +
      '.qg-lang-grid button.on{border-color:var(--primary,#6d28d9);background:var(--primary,#6d28d9);color:#fff;}';
    document.head.appendChild(s);
  }
  function ask(code) {
    css();
    var words = ASK[code];
    if (!words) return;
    var bar = document.createElement('div');
    bar.className = 'qg-lang-ask qg-lang-ui';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('lang', code);
    bar.innerHTML = '<span></span><button type="button" class="yes"></button><button type="button" class="no"></button>';
    bar.querySelector('span').textContent = words[0];
    bar.querySelector('.yes').textContent = words[1];
    bar.querySelector('.no').textContent = words[2];
    bar.querySelector('.yes').onclick = function () { bar.remove(); choose(code); };
    bar.querySelector('.no').onclick = function () { bar.remove(); set(ASKED, '1'); };
    document.body.appendChild(bar);
  }
  function openPicker() {
    css();
    status().then(function (on) {
      var ov = document.createElement('div');
      ov.className = 'qg-lang-ov qg-lang-ui';
      var codes = on ? Object.keys(NAMES) : ['en'];
      ov.innerHTML = '<div class="qg-lang-sheet" role="dialog" aria-modal="true" aria-label="Language"><h2>Language</h2>' +
        '<p>' + (on
          ? 'Translation is automatic, so some wording may be imperfect. Gig posts and chat messages stay in the language they were written in.'
          : 'Other languages are not switched on yet.') + '</p>' +
        '<div class="qg-lang-grid">' + codes.map(function (c) {
          return '<button type="button" data-lang="' + c + '" lang="' + c + '" class="' + (c === lang ? 'on' : '') + '">' + NAMES[c] + '</button>';
        }).join('') + '</div></div>';
      ov.addEventListener('click', function (e) {
        var b = e.target.closest('[data-lang]');
        if (b) { ov.remove(); if (b.getAttribute('data-lang') !== lang) choose(b.getAttribute('data-lang')); return; }
        if (e.target === ov) ov.remove();
      });
      document.body.appendChild(ov);
    });
  }

  function boot() {
    document.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-qg-language]');
      if (t) { e.preventDefault(); openPicker(); }
    });
    // Language rows in menus stay hidden until translation is switched on.
    status().then(function (on) {
      if (!on) return;
      Array.prototype.forEach.call(document.querySelectorAll('[data-qg-language][hidden]'), function (el) { el.hidden = false; });
    });
    var chosen = get(KEY);
    if (chosen && chosen !== 'en' && NAMES[chosen]) {
      status().then(function (on) { if (on) start(chosen); });
      return;
    }
    if (chosen === 'en' || get(ASKED)) return;
    var device = String((navigator.languages && navigator.languages[0]) || navigator.language || 'en').toLowerCase().split('-')[0];
    if (device === 'fil') device = 'tl';
    if (device === 'en' || !ASK[device]) return;
    status().then(function (on) { if (on) ask(device); });
  }

  window.QG_openLanguage = openPicker;
  window.QG_currentLanguage = function () { return lang; };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
