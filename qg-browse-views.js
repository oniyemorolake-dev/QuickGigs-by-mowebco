/**
 * QuickGigs — Browse Map / Spotlight / Find Best Match
 * Extends browsetask.html; shares the same filtered task list.
 */
(function (global) {
  'use strict';

  var VIEW_KEY = 'qg-browse-view';
  var browseView = 'list';
  var mapInstance = null;
  var mapMarkers = {};
  var mapLayerGroup = null;
  var selectedTaskId = null;
  var spotlightIndex = 0;
  var spotlightSeenIds = {};
  var lastFilteredIds = '';
  var bestMatchId = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function pinMoney(t) {
    var n = Number(t && t.price);
    if (!isFinite(n)) return '—';
    return '$' + Math.round(n);
  }

  function moneyLabel(t) {
    if (t && t.priceLabel) return String(t.priceLabel);
    return pinMoney(t);
  }

  function hasCoords(t) {
    var lat = Number(t && t.lat);
    var lng = Number(t && t.lng);
    return isFinite(lat) && isFinite(lng) && !(lat === 0 && lng === 0);
  }

  /** Compact distance for map list rows (e.g. "4.1km"). */
  function compactDist(t) {
    var km = t && t._distanceKm;
    if (km == null || !isFinite(km)) return '';
    if (km < 1) return Math.max(0.1, Math.round(km * 10) / 10) + 'km';
    if (km < 100) return Math.round(km * 10) / 10 + 'km';
    return Math.round(km) + 'km';
  }

  function getView() {
    return browseView;
  }

  function setView(view, opts) {
    opts = opts || {};
    if (view !== 'list' && view !== 'map' && view !== 'spotlight') view = 'list';
    browseView = view;
    try {
      sessionStorage.setItem(VIEW_KEY, view);
    } catch (e) {}
    var body = document.body;
    if (body) body.setAttribute('data-browse-view', view);
    document.querySelectorAll('.qg-browse-view-opt').forEach(function (btn) {
      var v = btn.getAttribute('data-view');
      btn.classList.toggle('active', v === view);
      btn.setAttribute('aria-pressed', v === view ? 'true' : 'false');
    });
    if (!opts.skipRender && typeof global.renderCards === 'function') {
      global.renderCards();
    }
    if (view === 'map') {
      setTimeout(invalidateMap, 80);
    }
  }

  function initViewFromSession() {
    var saved = 'list';
    try {
      saved = sessionStorage.getItem(VIEW_KEY) || 'list';
    } catch (e) {}
    if (saved !== 'list' && saved !== 'map' && saved !== 'spotlight') saved = 'list';
    browseView = saved;
    if (document.body) document.body.setAttribute('data-browse-view', saved);
    document.querySelectorAll('.qg-browse-view-opt').forEach(function (btn) {
      var v = btn.getAttribute('data-view');
      btn.classList.toggle('active', v === saved);
      btn.setAttribute('aria-pressed', v === saved ? 'true' : 'false');
    });
  }

  function bindToggle() {
    document.querySelectorAll('.qg-browse-view-opt').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var v = btn.getAttribute('data-view') || 'list';
        if (typeof haptic === 'function') haptic(10);
        setView(v);
      });
    });
    var bestBtn = document.getElementById('findBestMatchBtn');
    if (bestBtn) {
      bestBtn.addEventListener('click', function () {
        findBestMatch();
      });
    }
  }

  function ensureMap() {
    if (mapInstance) return mapInstance;
    var el = document.getElementById('browseMap');
    if (!el) return null;
    if (typeof L === 'undefined') {
      el.innerHTML =
        '<div class="qg-browse-map-empty empty-state" style="padding:40px 18px">' +
        '<p class="empty-txt">Map unavailable</p>' +
        '<p class="empty-txt" style="margin-top:8px;opacity:.85">Check your connection and refresh to load the map.</p>' +
        '</div>';
      return null;
    }
    mapInstance = L.map(el, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: true
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(mapInstance);
    mapLayerGroup = L.layerGroup().addTo(mapInstance);
    mapInstance.setView([53.5461, -113.4938], 11);
    return mapInstance;
  }

  function invalidateMap() {
    if (mapInstance) {
      try {
        mapInstance.invalidateSize();
      } catch (e) {}
    }
  }

  function updateGigCount(filtered) {
    var el = document.getElementById('browseGigCount');
    if (!el) return;
    if (window._qgAgeTier === 'loading') {
      el.textContent = '…';
      return;
    }
    var n = (filtered && filtered.length) || 0;
    el.textContent = n + ' gig' + (n === 1 ? '' : 's');
  }

  function updateTotalBar(filtered) {
    var amtEl = document.getElementById('browseTotalAmt');
    var btn = document.getElementById('findBestMatchBtn');
    if (window._qgAgeTier === 'loading') {
      if (amtEl) amtEl.textContent = '…';
      if (btn) btn.disabled = true;
      return;
    }
    var sum = 0;
    (filtered || []).forEach(function (t) {
      var p = Number(t && t.price);
      if (isFinite(p) && p > 0) sum += p;
    });
    if (amtEl) {
      amtEl.textContent = '$' + (sum % 1 ? sum.toFixed(2) : Math.round(sum));
    }
    if (btn) btn.disabled = !(filtered && filtered.length);
  }

  function pinIcon(priceText, active) {
    return L.divIcon({
      className: 'qg-price-pin-wrap',
      html: '<div class="qg-price-pin' + (active ? ' is-active' : '') + '">' + esc(priceText) + '</div>',
      iconSize: [72, 30],
      iconAnchor: [36, 30]
    });
  }

  function selectMapTask(taskId, scrollList) {
    selectedTaskId = String(taskId || '');
    Object.keys(mapMarkers).forEach(function (id) {
      var m = mapMarkers[id];
      var t = m._qgTask;
      if (m && t) {
        m.setIcon(pinIcon(pinMoney(t), id === selectedTaskId));
      }
    });
    document.querySelectorAll('.qg-browse-map-row').forEach(function (row) {
      var on = row.getAttribute('data-task-id') === selectedTaskId;
      row.classList.toggle('is-active', on);
      if (on && scrollList) {
        try {
          row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch (e) {
          row.scrollIntoView();
        }
      }
    });
    var marker = mapMarkers[selectedTaskId];
    if (marker && mapInstance) {
      try {
        mapInstance.panTo(marker.getLatLng(), { animate: true });
      } catch (e) {}
    }
  }

  function renderMapList(filtered) {
    var list = document.getElementById('browseMapList');
    if (!list) return;
    if (!filtered.length) {
      list.innerHTML = typeof QG_emptyStateHtml === 'function'
        ? QG_emptyStateHtml({
            icon: 'mapPin',
            title: 'No tasks match',
            sub: 'Clear filters to see map pins again.',
            compact: true
          })
        : '<div class="qg-browse-map-empty empty-state"><p class="empty-txt">No tasks match your filters</p></div>';
      return;
    }
    list.innerHTML = filtered
      .map(function (t) {
        var dist = compactDist(t);
        var best =
          bestMatchId && String(t.id) === String(bestMatchId) ? ' is-best-match' : '';
        var active = String(t.id) === String(selectedTaskId) ? ' is-active' : '';
        return (
          '<button type="button" class="qg-browse-map-row' +
          best +
          active +
          '" data-task-id="' +
          esc(String(t.id)) +
          '">' +
          '<p class="row-title">' +
          esc(t.title) +
          (!hasCoords(t) ? ' · no pin' : '') +
          '</p>' +
          '<div class="row-meta">' +
          esc(dist || 'Distance unknown') +
          '</div>' +
          '<div class="row-price">' +
          esc(pinMoney(t)) +
          '</div>' +
          '</button>'
        );
      })
      .join('');
    list.querySelectorAll('.qg-browse-map-row').forEach(function (row) {
      row.addEventListener('click', function () {
        var id = row.getAttribute('data-task-id');
        selectMapTask(id, true);
      });
      row.addEventListener('dblclick', function () {
        if (typeof openModal === 'function') openModal(row.getAttribute('data-task-id'));
      });
    });
  }

  function renderMapView(filtered) {
    var wrap = document.getElementById('browseMapView');
    if (!wrap) return;
    wrap.removeAttribute('hidden');
    updateTotalBar(filtered);
    if (window._qgAgeTier === 'loading') {
      var listEl = document.getElementById('browseMapList');
      if (listEl) {
        listEl.innerHTML =
          typeof QG_listSkeletonHtml === 'function'
            ? QG_listSkeletonHtml({ rows: 3, label: 'Checking gig eligibility…' })
            : '<div class="loading-state"><div class="loading-txt">Checking gig eligibility…</div></div>';
      }
      return;
    }
    ensureMap();
    renderMapList(filtered);
    if (!mapInstance || !mapLayerGroup) return;
    mapLayerGroup.clearLayers();
    mapMarkers = {};
    var bounds = [];
    filtered.forEach(function (t) {
      if (!hasCoords(t)) return;
      var lat = Number(t.lat);
      var lng = Number(t.lng);
      var marker = L.marker([lat, lng], {
        icon: pinIcon(pinMoney(t), String(t.id) === String(selectedTaskId)),
        riseOnHover: true
      });
      marker._qgTask = t;
      marker.on('click', function () {
        selectMapTask(t.id, true);
      });
      marker.bindTooltip(esc(t.title), { direction: 'top', opacity: 0.9 });
      marker.addTo(mapLayerGroup);
      mapMarkers[String(t.id)] = marker;
      bounds.push([lat, lng]);
    });
    if (bounds.length) {
      try {
        mapInstance.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 });
      } catch (e) {}
    }
    setTimeout(invalidateMap, 60);
  }

  function hideMapView() {
    var wrap = document.getElementById('browseMapView');
    if (wrap) wrap.setAttribute('hidden', '');
  }

  function spotlightMeta(t) {
    var loc = typeof formatLocationDisplay === 'function' ? formatLocationDisplay(t.location) : t.location || '';
    var dist =
      t._distanceKm != null && typeof formatDistanceKm === 'function'
        ? formatDistanceKm(t._distanceKm)
        : '';
    var when = '';
    if (t.when && typeof formatTaskWhen === 'function') when = formatTaskWhen(t.when);
    else if (t.when) when = String(t.when);
    else if (typeof postedLabelForTask === 'function') when = postedLabelForTask(t);
    return [loc, dist, when].filter(Boolean).join(' · ');
  }

  function resetSpotlightIfNeeded(filtered) {
    var ids = filtered.map(function (t) { return String(t.id); }).join(',');
    if (ids !== lastFilteredIds) {
      lastFilteredIds = ids;
      spotlightIndex = 0;
      spotlightSeenIds = {};
    }
    if (spotlightIndex >= filtered.length) spotlightIndex = Math.max(0, filtered.length - 1);
  }

  function renderSpotlightView(filtered) {
    var wrap = document.getElementById('browseSpotlightView');
    var card = document.getElementById('spotlightCard');
    if (!wrap || !card) return;
    wrap.removeAttribute('hidden');
    hideMapView();
    if (window._qgAgeTier === 'loading') {
      card.innerHTML =
        typeof QG_listSkeletonHtml === 'function'
          ? QG_listSkeletonHtml({ rows: 2, label: 'Checking gig eligibility…' })
          : '<div class="loading-state"><div class="loading-txt">Checking gig eligibility…</div></div>';
      return;
    }
    resetSpotlightIfNeeded(filtered);
    if (!filtered.length) {
      card.innerHTML = typeof QG_emptyStateHtml === 'function'
        ? QG_emptyStateHtml({
            icon: 'search',
            title: 'No tasks match',
            sub: 'Clear filters or switch to List / Map.'
          })
        : '<div class="qg-browse-spotlight-empty empty-state"><p class="empty-txt">No tasks match your filters</p></div>';
      return;
    }
    var remaining = filtered.filter(function (t) {
      return !spotlightSeenIds[String(t.id)];
    });
    if (!remaining.length) {
      card.innerHTML =
        '<div class="qg-browse-spotlight-empty empty-state">' +
        '<div class="empty-icon">' +
        (typeof qgIcon === 'function' ? qgIcon('check', { size: 24 }) : '') +
        '</div>' +
        '<p class="empty-txt">You\'ve seen them all</p>' +
        '<p class="empty-txt" style="margin-top:8px;opacity:.85">Adjust filters or switch to List / Map to browse again.</p>' +
        '<button type="button" class="empty-btn qg-spotlight-reset" style="margin-top:14px;min-height:44px;padding:12px 20px;border-radius:12px;border:none;background:var(--grad-accent);color:var(--on-accent);font:inherit;cursor:pointer">Start over</button>' +
        '</div>';
      var reset = card.querySelector('.qg-spotlight-reset');
      if (reset) {
        reset.addEventListener('click', function () {
          spotlightSeenIds = {};
          spotlightIndex = 0;
          renderSpotlightView(filtered);
        });
      }
      return;
    }
    var t = remaining[0];
    var desc = (t.desc || '').trim() || 'No description provided.';
    if (desc.length > 280) desc = desc.slice(0, 277) + '…';
    card.innerHTML =
      '<div class="qg-spotlight-card">' +
      '<span class="qg-spotlight-cat">' +
      esc(t.catLabel || t.cat || 'Task') +
      '</span>' +
      '<h2 class="qg-spotlight-title">' +
      esc(t.title) +
      '</h2>' +
      '<div class="qg-spotlight-price">' +
      esc(pinMoney(t)) +
      (t.mode === 'recurring' ? '/hr' : '') +
      '</div>' +
      '<p class="qg-spotlight-desc">' +
      esc(desc) +
      '</p>' +
      '<div class="qg-spotlight-meta">' +
      esc(spotlightMeta(t)) +
      '</div>' +
      '<div class="qg-spotlight-actions">' +
      '<button type="button" class="qg-spotlight-skip" id="spotlightSkipBtn">Skip</button>' +
      '<button type="button" class="qg-spotlight-apply" id="spotlightApplyBtn">Apply</button>' +
      '</div>' +
      '</div>';
    var skip = document.getElementById('spotlightSkipBtn');
    var apply = document.getElementById('spotlightApplyBtn');
    if (skip) {
      skip.addEventListener('click', function () {
        spotlightSeenIds[String(t.id)] = true;
        if (typeof haptic === 'function') haptic(8);
        renderSpotlightView(filtered);
      });
    }
    if (apply) {
      apply.addEventListener('click', function () {
        spotlightSeenIds[String(t.id)] = true;
        if (typeof haptic === 'function') haptic(12);
        if (typeof openModal === 'function') openModal(String(t.id));
        renderSpotlightView(filtered);
      });
    }
  }

  function hideSpotlightView() {
    var wrap = document.getElementById('browseSpotlightView');
    if (wrap) wrap.setAttribute('hidden', '');
  }

  function scoreTask(t) {
    var pay = Number(t.price) || 0;
    var dist = t._distanceKm;
    if (dist == null || !isFinite(dist)) dist = 25;
    return pay - dist * 2.5;
  }

  function findBestMatch() {
    var filtered =
      typeof global.getFilteredBrowseTasks === 'function'
        ? global.getFilteredBrowseTasks()
        : global._browseFiltered || [];
    if (!filtered || !filtered.length) {
      if (typeof showToast === 'function') showToast('No tasks in view to match');
      else alert('No tasks in view to match');
      return;
    }
    var best = filtered.slice().sort(function (a, b) {
      return scoreTask(b) - scoreTask(a);
    })[0];
    if (!best) return;
    bestMatchId = String(best.id);
    if (typeof haptic === 'function') haptic(12);
    setView('list', { skipRender: false });
    setTimeout(function () {
      var id = String(best.id);
      var card = null;
      document.querySelectorAll('.task-card[data-task-id]').forEach(function (el) {
        if (el.getAttribute('data-task-id') === id) card = el;
      });
      document.querySelectorAll('.task-card.is-best-match').forEach(function (el) {
        el.classList.remove('is-best-match');
      });
      if (card) {
        card.classList.add('is-best-match');
        try {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (e) {
          card.scrollIntoView();
        }
      }
    }, 120);
  }

  function onAfterListRender(filtered) {
    if (!bestMatchId) return;
    var card = document.querySelector('.task-card[data-task-id="' + String(bestMatchId).replace(/"/g, '\\"') + '"]');
    if (card) card.classList.add('is-best-match');
  }

  /**
   * Called from renderCards after filters are computed.
   * Returns true if this module handled the view (map/spotlight).
   */
  function renderBrowseView(filtered) {
    global._browseFiltered = filtered || [];
    updateGigCount(filtered || []);
    updateTotalBar(filtered || []);
    if (browseView === 'map') {
      hideSpotlightView();
      renderMapView(filtered || []);
      return true;
    }
    if (browseView === 'spotlight') {
      hideMapView();
      renderSpotlightView(filtered || []);
      return true;
    }
    hideMapView();
    hideSpotlightView();
    return false;
  }

  function init() {
    initViewFromSession();
    bindToggle();
    if (typeof global.renderCards === 'function') {
      try {
        global.renderCards();
      } catch (e) {}
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.QGBrowseViews = {
    getView: getView,
    setView: setView,
    renderBrowseView: renderBrowseView,
    onAfterListRender: onAfterListRender,
    findBestMatch: findBestMatch,
    invalidateMap: invalidateMap
  };
  global.setBrowseView = setView;
  global.findBestMatch = findBestMatch;
})(window);
