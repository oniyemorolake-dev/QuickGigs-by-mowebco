/* SwiftGigs — empty, error, skeleton and spinner markup.
 *
 * qg-brand-init.js owns these on injector pages, but it also appends thirteen
 * legacy stylesheets, so a rebuilt page cannot load it. These are the same
 * four functions with the same option shapes, drawn with sg-app.css classes
 * instead of the legacy ones, so call sites need no changes.
 *
 * Defined only when absent, so an injector page keeps qg-brand-init.js's
 * versions whatever the load order.
 */
(function () {
  'use strict';

  function def(name, fn) {
    if (typeof window[name] !== 'function') window[name] = fn;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var PATHS = {
    inbox: '<path d="M3 13h5l1.5 2.5h5L16 13h5"/><path d="M4.5 6.5h15l1.5 6.5v4a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17v-4z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/>',
    offline: '<path d="M3 3l18 18"/><path d="M5 12.5a10 10 0 0 1 4-2.4M2 9a15 15 0 0 1 5-3"/><path d="M19 12.5a10 10 0 0 0-3-2.1M22 9a15 15 0 0 0-6-3.4"/><path d="M8.5 16a5 5 0 0 1 7 0"/><path d="M12 20h.01"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-.6 4"/><path d="M20 4.5V11h-6"/>',
    message: '<path d="M21 12a8 8 0 0 1-8 8H6l-3 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/>'
  };

  function icon(name) {
    return '<svg class="i " viewBox="0 0 24 24" aria-hidden="true">' +
      (PATHS[name] || PATHS.inbox) + '</svg>';
  }

  /* Accepts { label, onclick, href, icon, secondary }. A href wins over an
     onclick, matching the original. */
  function actionHtml(a) {
    if (!a || !a.label) return '';
    var cls = 'sg-btn ' + (a.secondary ? 'sg-btn-quiet' : 'purple');
    var inner = (a.icon ? icon(a.icon) : '') + esc(a.label);
    if (a.href) return '<a class="' + cls + '" href="' + esc(a.href) + '">' + inner + '</a>';
    return '<button type="button" class="' + cls + '"' +
      (a.onclick ? ' onclick="' + esc(a.onclick) + '"' : '') + '>' + inner + '</button>';
  }

  function actionsHtml(primary, secondary) {
    var html = actionHtml(primary) + actionHtml(secondary && Object.assign({ secondary: true }, secondary));
    return html ? '<div class="sg-state-actions">' + html + '</div>' : '';
  }

  def('QG_emptyStateHtml', function (opts) {
    opts = opts || {};
    return '<div class="sg-state' + (opts.compact ? ' is-compact' : '') + '" role="status">' +
      '<span class="sg-state-icon" aria-hidden="true">' + icon(opts.icon || 'inbox') + '</span>' +
      '<div class="sg-state-title">' + esc(opts.title || 'Nothing here yet') + '</div>' +
      (opts.sub ? '<div class="sg-state-sub">' + esc(opts.sub) + '</div>' : '') +
      actionsHtml(opts.action, opts.secondary) +
      '</div>';
  });

  def('QG_errorStateHtml', function (opts) {
    opts = opts || {};
    var offline = !!opts.offline;
    var title = opts.title || (offline ? "Can't connect" : 'Something went wrong');
    var sub = opts.sub || (offline
      ? 'Check your connection and try again.'
      : 'Check your connection, then try again.');
    var retry = opts.retry || { label: 'Try again', icon: 'refresh', onclick: 'location.reload()' };
    if (typeof opts.onRetry === 'string' && opts.onRetry) {
      retry = { label: 'Try again', icon: 'refresh', onclick: opts.onRetry };
    }
    return '<div class="sg-state is-error' + (offline ? ' is-offline' : '') + '" role="alert">' +
      '<span class="sg-state-icon" aria-hidden="true">' + icon(offline ? 'offline' : 'alert') + '</span>' +
      '<div class="sg-state-title">' + esc(title) + '</div>' +
      '<div class="sg-state-sub">' + esc(sub) + '</div>' +
      actionsHtml(retry, opts.secondary) +
      '</div>';
  });

  def('QG_listSkeletonHtml', function (opts) {
    opts = opts || {};
    var n = opts.rows || 4;
    var widths = ['w80', 'w60', 'w80', 'w40'];
    var rows = '';
    for (var i = 0; i < n; i++) {
      rows += '<div class="sg-skel-row" aria-hidden="true">' +
        '<span class="sg-skel-sq"></span>' +
        '<span class="sg-skel-lines">' +
          '<span class="sg-skel-line ' + widths[i % widths.length] + '"></span>' +
          '<span class="sg-skel-line ' + widths[(i + 1) % widths.length] + '"></span>' +
        '</span></div>';
    }
    return '<div class="sg-skel" role="status" aria-busy="true" aria-label="' +
      esc(opts.label || 'Loading…') + '">' + rows + '</div>';
  });

  def('QG_spinnerHtml', function (opts) {
    opts = opts || {};
    var label = esc(opts.label || 'Loading…');
    var size = opts.large ? ' is-lg' : '';
    var tag = opts.inline === false ? 'div' : 'span';
    return '<' + tag + ' class="sg-inline-load" role="status" aria-busy="true" aria-label="' + label + '">' +
      '<span class="sg-spinner' + size + '" aria-hidden="true"></span>' +
      (opts.hideLabel && opts.inline !== false ? '' : '<span>' + label + '</span>') +
      '</' + tag + '>';
  });
})();
