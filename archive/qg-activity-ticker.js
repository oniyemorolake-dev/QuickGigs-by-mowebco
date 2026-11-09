/**
 * QuickGigs — marketplace activity ticker ("Happening now near [city]").
 * Privacy: first name + last initial only. Public marketplace actions only.
 */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cityLabel() {
    if (typeof getUserCityLabel === 'function') {
      var c = getUserCityLabel();
      if (c) return c;
    }
    if (typeof getUserLocation === 'function') {
      var loc = getUserLocation() || '';
      if (loc) return loc.split(',')[0].trim();
    }
    return 'you';
  }

  function privacyName(name) {
    if (typeof privacyDisplayName === 'function') return privacyDisplayName(name);
    var raw = String(name || '').trim();
    if (!raw) return 'Someone';
    var parts = raw.split(/\s+/);
    if (parts.length === 1) return parts[0];
    return parts[0] + ' ' + parts[parts.length - 1].charAt(0).toUpperCase() + '.';
  }

  function relTime(iso) {
    if (typeof formatRelativeTime === 'function') return formatRelativeTime(iso) || '';
    try {
      var t = new Date(iso).getTime();
      if (!isFinite(t)) return '';
      var mins = Math.round((Date.now() - t) / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return mins + 'm ago';
      var hrs = Math.round(mins / 60);
      if (hrs < 24) return hrs + 'h ago';
      return Math.round(hrs / 24) + 'd ago';
    } catch (e) {
      return '';
    }
  }

  function formatMoney(n) {
    var v = Number(n);
    if (!isFinite(v) || v <= 0) return '';
    return '$' + (v % 1 ? v.toFixed(2) : String(Math.round(v)));
  }

  function actionCopy(ev) {
    var who = privacyName(ev.name);
    var amount = formatMoney(ev.amount);
    if (ev.type === 'accepted') {
      return '<strong>' + esc(who) + '</strong> accepted a gig' +
        (amount ? ' for <span class="qg-activity-money">' + esc(amount) + '</span>' : '');
    }
    if (ev.type === 'completed') {
      return '<strong>' + esc(who) + '</strong> completed a job' +
        (amount ? ' · earned <span class="qg-activity-money">' + esc(amount) + '</span>' : '');
    }
    return '<strong>' + esc(who) + '</strong> posted a task' +
      (amount ? ' · <span class="qg-activity-money">' + esc(amount) + '</span>' : '');
  }

  function rowHtml(ev) {
    var who = privacyName(ev.name);
    var initial = who.charAt(0).toUpperCase() || '?';
    return (
      '<div class="qg-activity-row">' +
      '<div class="qg-activity-avatar" aria-hidden="true">' +
      esc(initial) +
      '</div>' +
      '<div class="qg-activity-copy"><div class="qg-activity-text">' +
      actionCopy(ev) +
      '</div></div>' +
      '<div class="qg-activity-time">' +
      esc(relTime(ev.at)) +
      '</div>' +
      '</div>'
    );
  }

  function shellHtml(city, bodyInner) {
    return (
      '<aside class="qg-activity-ticker" aria-label="Marketplace activity near ' +
      esc(city) +
      '">' +
      '<div class="qg-activity-ticker-head">' +
      '<div class="qg-activity-ticker-title">Happening now near <span>' +
      esc(city) +
      '</span></div>' +
      '<div class="qg-activity-ticker-sub">Public activity</div>' +
      '</div>' +
      bodyInner +
      '</aside>'
    );
  }

  function loadingHtml(city) {
    return shellHtml(
      city,
      '<div class="qg-activity-loading" role="status">Loading nearby activity…</div>'
    );
  }

  function emptyHtml(city) {
    return shellHtml(
      city,
      '<div class="qg-activity-empty">No recent public activity nearby yet.</div>'
    );
  }

  function listHtml(city, events) {
    if (!events || !events.length) return emptyHtml(city);
    return shellHtml(
      city,
      '<div class="qg-activity-list">' + events.map(rowHtml).join('') + '</div>'
    );
  }

  async function fetchFromEdge(city) {
    var url =
      (global.QG_CONFIG && global.QG_CONFIG.marketplaceActivityUrl) ||
      '';
    if (!url) return null;
    try {
      var res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city: city, limit: 8 })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || data.ok === false) return null;
      return Array.isArray(data.events) ? data.events : [];
    } catch (e) {
      return null;
    }
  }

  function cityMatch(location, city) {
    if (!city || city === 'you') return true;
    var loc = String(location || '').toLowerCase();
    var c = String(city).toLowerCase();
    return loc.indexOf(c) >= 0;
  }

  async function fetchFromOpenTasks(city) {
    var rows = [];
    if (typeof getOpenTasksPage === 'function') {
      rows = await getOpenTasksPage(0, 24);
    } else if (Array.isArray(global.allTasks) && global.allTasks.length) {
      rows = global.allTasks;
    }
    if (!Array.isArray(rows)) rows = [];
    var events = rows
      .filter(function (t) {
        var loc = t.location || t.LOCATION || '';
        return cityMatch(loc, city);
      })
      .map(function (t) {
        return {
          type: 'posted',
          name: t.poster_name || t.posterName || t.POSTER_NAME || 'Someone',
          amount: t.budget != null ? t.budget : t.price,
          at: t.created_at || t.createdAt || t.CREATED_AT || '',
          id: t.task_id || t.id
        };
      })
      .filter(function (e) { return e.at; })
      .sort(function (a, b) {
        return new Date(b.at).getTime() - new Date(a.at).getTime();
      })
      .slice(0, 8);
    return events;
  }

  async function loadEvents(city) {
    var fromEdge = await fetchFromEdge(city);
    if (fromEdge && fromEdge.length) return { events: fromEdge, source: 'edge' };
    var fromTasks = await fetchFromOpenTasks(city);
    return { events: fromTasks || [], source: 'open_tasks' };
  }

  async function renderInto(el, opts) {
    if (!el) return;
    opts = opts || {};
    var city = opts.city || cityLabel();
    el.innerHTML = loadingHtml(city);
    try {
      var result = await loadEvents(city);
      el.innerHTML = listHtml(city, result.events);
      el.setAttribute('data-ticker-source', result.source || '');
    } catch (e) {
      el.innerHTML = emptyHtml(city);
    }
  }

  function mount(selectorOrEl, opts) {
    var el =
      typeof selectorOrEl === 'string'
        ? document.querySelector(selectorOrEl)
        : selectorOrEl;
    if (!el) return;
    renderInto(el, opts);
  }

  /** Helper for browse empty-state injection. */
  function tickerMountHtml() {
    return '<div id="browseActivityTicker" class="qg-activity-ticker-host"></div>';
  }

  global.QGActivityTicker = {
    mount: mount,
    renderInto: renderInto,
    loadEvents: loadEvents,
    tickerMountHtml: tickerMountHtml,
    cityLabel: cityLabel,
    privacyName: privacyName
  };
})(window);
