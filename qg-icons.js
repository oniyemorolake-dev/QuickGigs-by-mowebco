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
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/>',
    send: '<path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-4 4-2-2-5 5"/>',
    bell: '<path d="M12 3a5 5 0 0 0-5 5v3.5c0 .8-.3 1.5-.8 2.1L5 15h14l-1.2-1.4c-.5-.6-.8-1.3-.8-2.1V8a5 5 0 0 0-5-5Z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
    handshake: '<path d="M8 13c1.5 1.5 3 2 4 2s2.5-.5 4-2"/><path d="M4 10l3-3 3 2 3-2 3 3"/><path d="M7 14v4M17 14v4"/>',
    party: '<path d="M5 19 12 5l7 14"/><path d="M8 15h8M7 11h2M15 11h2"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-3 3-3-3 3-3Z"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    sparkles: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><path d="m6.5 6.5 2 2M15.5 15.5l2 2M17.5 6.5l-2 2M8.5 15.5l-2 2"/><path d="M12 8.5 13.5 12 17 13.5 13.5 15 12 18.5 10.5 15 7 13.5 10.5 12Z"/>'
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
})();
