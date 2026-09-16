/* QuickGigs — Feather/Lucide-style stroke icons (24px grid, 1.5 stroke, currentColor) */
(function () {
  var PATHS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    clipboard: '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M16 5h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h4"/>',
    message: '<path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 1 1 18 0Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 19c0-3 2.8-5.5 6.5-5.5S15.5 16 15.5 19"/><path d="M16 14.2c2.4.4 4.5 2 4.5 4.8"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 5-5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    dollar: '<circle cx="12" cy="12" r="9"/><path d="M12 6v12M15 9.5c0-1.4-1.3-2.5-3-2.5s-3 1.1-3 2.5 1.3 2.2 3 2.5 3 1.1 3 2.5-1.3 2.5-3 2.5-3-1.1-3-2.5"/>',
    mapPin: '<path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
    creditCard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
    smartphone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    bug: '<path d="M8 9h8v7a4 4 0 0 1-8 0V9Z"/><path d="M9 5.5 7 3M15 5.5 17 3M12 3v3M5 12H2M22 12h-3M5.5 17 3 19M18.5 17 21 19"/>',
    star: '<path d="m12 3 2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.5 6.7 19.1l1-5.8L3.5 9.2l5.9-.9L12 3Z"/>',
    inbox: '<path d="M22 13v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5"/><path d="m2 8 3.5-4h13L22 8"/><path d="M2 13h6l2 3h4l2-3h6"/>',
    alert: '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
    shield: '<path d="M12 3 5 6v6c0 5 3.5 8.5 7 9.5 3.5-1 7-4.5 7-9.5V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/>',
    send: '<path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/>',
    camera: '<path d="M4 8h3l2-2h6l2 2h3v11H4V8Z"/><circle cx="12" cy="13" r="3.5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-4 4-2-2-5 5"/>',
    bell: '<path d="M12 3a5 5 0 0 0-5 5v3.5c0 .8-.3 1.5-.8 2.1L5 15h14l-1.2-1.4c-.5-.6-.8-1.3-.8-2.1V8a5 5 0 0 0-5-5Z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
    handshake: '<path d="M8 13c1.5 1.5 3 2 4 2s2.5-.5 4-2"/><path d="M4 10l3-3 3 2 3-2 3 3"/><path d="M7 14v4M17 14v4"/>',
    party: '<path d="M5 19 12 5l7 14"/><path d="M8 15h8M7 11h2M15 11h2"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-3 3-3-3 3-3Z"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    sparkles: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><path d="m6.5 6.5 2 2M15.5 15.5l2 2M17.5 6.5l-2 2M8.5 15.5l-2 2"/><path d="M12 8.5 13.5 12 17 13.5 13.5 15 12 18.5 10.5 15 7 13.5 10.5 12Z"/>',
    zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
    flame: '<path d="M12 3c2 3 2.5 5 1.5 7 .8-.3 1.5-1.2 2-2.2 1.5 2.2 2.5 4.2 2.5 6.7A6 6 0 0 1 6 14.5C6 10.5 9 7.5 12 3Z"/><path d="M10.5 16.5c0 1.5 1 2.5 1.5 2.5s1.5-1 1.5-2.5c0-1-.5-1.8-1.5-2.8-.9 1-1.5 1.8-1.5 2.8Z"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1 14h6M9 8h6M17 16h6"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    helpCircle: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.2 2.4c-.7.3-1.2.9-1.2 1.6V14"/><path d="M12 17h.01"/>',
    repeat: '<path d="m17 1 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 23-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    lightbulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2.3h6c0-1.1.4-1.8 1-2.3A7 7 0 0 0 12 2Z"/>',
    user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="8" r="5"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    car: '<path d="M5 17h14l-1.5-5.5a2 2 0 0 0-1.9-1.5H8.4a2 2 0 0 0-1.9 1.5L5 17Z"/><circle cx="7.5" cy="17" r="1.5"/><circle cx="16.5" cy="17" r="1.5"/>',
    graduationCap: '<path d="M2 9.5 12 5l10 4.5-10 4.5-10-4.5Z"/><path d="M6 11.5V16c0 1.1 2.7 2 6 2s6-.9 6-2v-4.5"/><path d="M22 9.5v5"/>',
    scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.5 8.5 19 19M8.5 15.5 19 5"/>',
    truck: '<rect x="1" y="7" width="13" height="10" rx="1"/><path d="M14 10h4l3 3v4h-7"/><circle cx="6" cy="19" r="1.7"/><circle cx="17" cy="19" r="1.7"/>',
    pot: '<path d="M4 11h16v3a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6v-3Z"/><path d="M2 11h20"/><path d="M8 11 9 7M16 11l-1-4"/>',
    laptop: '<rect x="4" y="4" width="16" height="10" rx="1"/><path d="M2 18h20"/>',
    heart: '<path d="M12 20.5c-4.5-2.8-9-6.7-9-11A5 5 0 0 1 8 4.7c1.6-.9 3.3-.4 4 .8.7-1.2 2.4-1.7 4-.8A5 5 0 0 1 21 9.5c0 4.3-4.5 8.2-9 11Z"/>',
    leaf: '<path d="M5 21c0-9 5-16 14-16 0 9-5 16-14 16Z"/><path d="M5 21c3-3 6-6 9-12"/>',
    package: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    chart: '<path d="M5 20V13M12 20V6M19 20v-9"/>',
    trendingUp: '<path d="M3 17l6.5-6.5 5 5L21 8"/><path d="M15 8h6v6"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="m5.5 5.5 13 13"/>',
    flag: '<path d="M6 3v18"/><path d="M6 4h11l-3 4 3 4H6Z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>'
  };

  function svg(name, opts) {
    opts = opts || {};
    var d = PATHS[name];
    if (!d) return '';
    var size = opts.size || 24;
    var cls = 'qg-ico' + (opts.className ? ' ' + opts.className : '');
    return '<svg class="' + cls + '" width="' + size + '" height="' + size +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  }

  window.qgIcon = svg;
  window.QG_ICONS = PATHS;

  /** Prefix labels that use data-qg-ico="zap|star|..." with an inline SVG. */
  function hydrateIcoAttrs(root) {
    root = root || document;
    if (!root.querySelectorAll) return;
    var nodes = root.querySelectorAll('[data-qg-ico]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var name = el.getAttribute('data-qg-ico');
      if (!name || el.getAttribute('data-qg-ico-done') === '1') continue;
      var mark = svg(name, { size: Number(el.getAttribute('data-qg-ico-size') || 14) || 14 });
      if (!mark) continue;
      el.insertAdjacentHTML('afterbegin', mark + ' ');
      el.setAttribute('data-qg-ico-done', '1');
    }
  }
  window.qgHydrateIcons = hydrateIcoAttrs;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { hydrateIcoAttrs(document); });
    } else {
      hydrateIcoAttrs(document);
    }
  }
})();
