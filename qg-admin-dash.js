/* QuickGigs — admin live mode, customizable layout, rule-based insights */
(function () {
  'use strict';

  var LAYOUT_KEY = 'qg-admin-layout';
  var LIVE_KEY = 'qg-admin-live';
  var DEFAULT_ORDER = ['today', 'cohort', 'stats', 'health', 'insights', 'activity', 'categories', 'signups'];

  var liveOn = false;
  var editMode = false;
  var refreshTimer = null;
  var lastCounts = { users: null, tasks: null, disputes: null };
  var liveActivity = [];
  var refreshing = false;

  function esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  function getLayout() {
    var saved = readJson(LAYOUT_KEY, null);
    var order = DEFAULT_ORDER.slice();
    var hidden = [];
    if (saved && Array.isArray(saved.order)) {
      order = [];
      saved.order.forEach(function (id) {
        if (DEFAULT_ORDER.indexOf(id) >= 0 && order.indexOf(id) < 0) order.push(id);
      });
      DEFAULT_ORDER.forEach(function (id) {
        if (order.indexOf(id) < 0) order.push(id);
      });
    }
    if (saved && Array.isArray(saved.hidden)) {
      hidden = saved.hidden.filter(function (id) { return DEFAULT_ORDER.indexOf(id) >= 0; });
    }
    return { order: order, hidden: hidden };
  }

  function saveLayout(layout) {
    writeJson(LAYOUT_KEY, layout);
  }

  /* ── Layout ── */
  function applyLayout() {
    var host = document.getElementById('overviewDash');
    if (!host) return;
    var layout = getLayout();
    layout.order.forEach(function (id) {
      var el = host.querySelector('.dash-card[data-dash-id="' + id + '"]');
      if (el) host.appendChild(el);
    });
    host.querySelectorAll('.dash-card[data-dash-id]').forEach(function (el) {
      var id = el.getAttribute('data-dash-id');
      var isHidden = layout.hidden.indexOf(id) >= 0;
      el.classList.toggle('dash-is-hidden', isHidden && !editMode);
      el.classList.toggle('dash-edit-hidden', isHidden && editMode);
      var eye = el.querySelector('.dash-eye');
      if (eye) eye.textContent = isHidden ? '🙈' : '👁';
      eye && eye.setAttribute('aria-label', isHidden ? 'Show card' : 'Hide card');
    });
    syncEditChrome();
  }

  function syncEditChrome() {
    var host = document.getElementById('overviewDash');
    var btn = document.getElementById('btnEditLayout');
    var reset = document.getElementById('btnResetLayout');
    if (host) host.classList.toggle('dash-edit-mode', editMode);
    if (btn) btn.textContent = editMode ? 'Done' : 'Edit layout';
    if (reset) reset.style.display = editMode ? 'inline-flex' : 'none';
    document.querySelectorAll('.dash-edit-controls').forEach(function (el) {
      el.hidden = !editMode;
    });
  }

  function ensureEditControls() {
    var host = document.getElementById('overviewDash');
    if (!host) return;
    host.querySelectorAll('.dash-card[data-dash-id]').forEach(function (card) {
      if (card.querySelector('.dash-edit-controls')) return;
      var bar = document.createElement('div');
      bar.className = 'dash-edit-controls';
      bar.hidden = true;
      bar.innerHTML =
        '<button type="button" class="dash-ctrl dash-eye" title="Hide / show">👁</button>' +
        '<button type="button" class="dash-ctrl dash-up" title="Move up">↑</button>' +
        '<button type="button" class="dash-ctrl dash-down" title="Move down">↓</button>';
      card.insertBefore(bar, card.firstChild);
      bar.querySelector('.dash-eye').onclick = function (e) {
        e.stopPropagation();
        toggleCardHidden(card.getAttribute('data-dash-id'));
      };
      bar.querySelector('.dash-up').onclick = function (e) {
        e.stopPropagation();
        moveCard(card.getAttribute('data-dash-id'), -1);
      };
      bar.querySelector('.dash-down').onclick = function (e) {
        e.stopPropagation();
        moveCard(card.getAttribute('data-dash-id'), 1);
      };
    });
  }

  function toggleCardHidden(id) {
    var layout = getLayout();
    var idx = layout.hidden.indexOf(id);
    if (idx >= 0) layout.hidden.splice(idx, 1);
    else layout.hidden.push(id);
    saveLayout(layout);
    applyLayout();
  }

  function moveCard(id, dir) {
    var layout = getLayout();
    var i = layout.order.indexOf(id);
    if (i < 0) return;
    var j = i + dir;
    if (j < 0 || j >= layout.order.length) return;
    var tmp = layout.order[i];
    layout.order[i] = layout.order[j];
    layout.order[j] = tmp;
    saveLayout(layout);
    applyLayout();
  }

  window.toggleAdminEditLayout = function () {
    editMode = !editMode;
    ensureEditControls();
    applyLayout();
  };

  window.resetAdminLayout = function () {
    writeJson(LAYOUT_KEY, { order: DEFAULT_ORDER.slice(), hidden: [] });
    applyLayout();
    if (typeof showToast === 'function') showToast('Layout reset', 'green');
  };

  /* ── Insights ── */
  function daysAgo(n) {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - n);
    return d.getTime();
  }

  function inRange(iso, start, end) {
    if (!iso) return false;
    var t = new Date(iso).getTime();
    return t >= start && t < end;
  }

  function userKeyOf(u) {
    if (typeof userKey === 'function') return String(userKey(u));
    return String(u.firebase_uid || u.user_id || u.id || '');
  }

  window.renderAdminInsights = function () {
    var el = document.getElementById('adminInsights');
    if (!el) return;
    var users = window.users || [];
    var tasks = window.tasks || [];
    var apps = window.applications || [];
    var disputes = window.disputes || [];
    var now = Date.now();
    var d7 = daysAgo(7);
    var d14 = daysAgo(14);
    var insights = [];

    var signupsThis = users.filter(function (u) { return inRange(u.created_at, d7, now + 1); }).length;
    var signupsPrev = users.filter(function (u) { return inRange(u.created_at, d14, d7); }).length;
    if (signupsPrev > 0) {
      var pct = Math.round(((signupsThis - signupsPrev) / signupsPrev) * 100);
      var dir = pct >= 0 ? 'up' : 'down';
      insights.push({
        icon: pct >= 0 ? '📈' : '📉',
        text: 'Signups are ' + dir + ' ' + Math.abs(pct) + '% vs the previous 7 days (' + signupsThis + ' vs ' + signupsPrev + ').'
      });
    } else if (signupsThis > 0) {
      insights.push({
        icon: '📈',
        text: signupsThis + ' signup' + (signupsThis === 1 ? '' : 's') + ' in the last 7 days (no prior-week baseline yet).'
      });
    }

    var weekTasks = tasks.filter(function (t) { return inRange(t.created_at, d7, now + 1); });
    var catCounts = {};
    weekTasks.forEach(function (t) {
      var c = (t.category || t.CATEGORY || 'Other').toString().trim() || 'Other';
      catCounts[c] = (catCounts[c] || 0) + 1;
    });
    var topCat = null;
    var topN = 0;
    Object.keys(catCounts).forEach(function (c) {
      if (catCounts[c] > topN) { topN = catCounts[c]; topCat = c; }
    });
    if (topCat && topN > 0) {
      insights.push({
        icon: '🏷',
        text: 'Most popular category this week: ' + topCat + ' (' + topN + ' task' + (topN === 1 ? '' : 's') + ').'
      });
    }

    var posters = {};
    tasks.forEach(function (t) {
      var id = String(t.posted_by || t.POSTED_BY || '');
      if (id) posters[id] = true;
    });
    var appliers = {};
    apps.forEach(function (a) {
      var id = String(a.worker_id || a.WORKER_ID || '');
      if (id) appliers[id] = true;
    });
    var inactive = users.filter(function (u) {
      var uid = userKeyOf(u);
      return uid && !posters[uid] && !appliers[uid];
    }).length;
    if (inactive > 0) {
      insights.push({
        icon: '✉️',
        text: inactive + ' user' + (inactive === 1 ? '' : 's') + ' signed up but never posted or applied — consider a reminder email.'
      });
    }

    var completedish = tasks.filter(function (t) {
      var st = String(t.status || '').toLowerCase();
      return st === 'completed' || st === 'in_progress' || st === 'open' || st === 'cancelled';
    }).length;
    var disputeRate = completedish ? (disputes.length / Math.max(tasks.length, 1)) * 100 : 0;
    if (tasks.length > 0) {
      var rate = Math.round(disputeRate * 10) / 10;
      var vs = rate > 5 ? 'above' : (rate < 5 ? 'below' : 'at');
      insights.push({
        icon: rate > 5 ? '⚠️' : '✅',
        text: 'Dispute rate is ' + rate + '% — ' + vs + ' your 5% target (' + disputes.length + ' dispute' + (disputes.length === 1 ? '' : 's') + ' / ' + tasks.length + ' tasks).'
      });
    }

    var openTasks = tasks.filter(function (t) { return String(t.status || '').toLowerCase() === 'open'; }).length;
    if (openTasks >= 5) {
      insights.push({
        icon: '📋',
        text: openTasks + ' tasks are currently open and waiting for applicants.'
      });
    }

    insights = insights.slice(0, 4);
    if (!insights.length) {
      el.innerHTML = '<div class="insight-empty">Not enough data yet for insights — check back after more signups and tasks.</div>';
      return;
    }
    el.innerHTML = insights.map(function (ins) {
      return '<div class="insight-row"><span class="insight-icon" aria-hidden="true">' + ins.icon + '</span><div class="insight-text">' + esc(ins.text) + '</div></div>';
    }).join('');
  };

  /* ── Live mode ── */
  function setLiveUi() {
    var btn = document.getElementById('adminLiveToggle');
    var dot = document.getElementById('adminLiveDot');
    if (btn) btn.classList.toggle('is-live', liveOn);
    if (btn) btn.setAttribute('aria-pressed', liveOn ? 'true' : 'false');
    if (dot) dot.hidden = !liveOn;
  }

  function flashStat(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var card = el.closest('.stat-card') || el;
    card.classList.remove('admin-stat-flash');
    void card.offsetWidth;
    card.classList.add('admin-stat-flash');
    setTimeout(function () { card.classList.remove('admin-stat-flash'); }, 900);
  }

  function liveActivityHtml() {
    return liveActivity.map(function (i) {
      return '<div class="activity-item activity-live-new"><div class="act-dot" style="background:' + i.dot + '"></div>' +
        '<div class="act-content"><div class="act-text">' + esc(i.text) + '</div><div class="act-time">' + esc(i.time) + '</div></div></div>';
    }).join('');
  }

  function injectLiveActivity() {
    var feed = document.getElementById('activityFeed');
    if (!feed || !liveActivity.length) return;
    feed.querySelectorAll('.activity-live-new').forEach(function (n) { n.remove(); });
    feed.insertAdjacentHTML('afterbegin', liveActivityHtml());
  }

  function prependLiveActivity(text, color) {
    liveActivity.unshift({
      dot: color || '#9b6fc4',
      text: text,
      time: 'Just now'
    });
    if (liveActivity.length > 8) liveActivity = liveActivity.slice(0, 8);
    injectLiveActivity();
  }

  async function fetchTableCount(table) {
    var headers = typeof getSupabaseHeaders === 'function'
      ? await getSupabaseHeaders()
      : (window.SB_HEADERS || {});
    headers = Object.assign({}, headers, {
      Prefer: 'count=exact',
      Range: '0-0'
    });
    var url = window.SUPABASE_URL + '/rest/v1/' + table + '?select=user_id';
    if (table === 'tasks') url = window.SUPABASE_URL + '/rest/v1/tasks?select=task_id';
    if (table === 'disputes') url = window.SUPABASE_URL + '/rest/v1/disputes?select=dispute_id';
    var res = await fetch(url, { method: 'GET', headers: headers });
    var cr = res.headers.get('content-range') || res.headers.get('Content-Range') || '';
    var m = cr.match(/\/(\d+)\s*$/);
    if (m) return parseInt(m[1], 10);
    // Fallback if Content-Range is not exposed — use in-memory length after full refresh
    return null;
  }

  async function pollLiveCounts() {
    if (!liveOn || document.hidden || refreshing) return;
    refreshing = true;
    try {
      var countResults = await Promise.all([
        fetchTableCount('users'),
        fetchTableCount('tasks'),
        fetchTableCount('disputes')
      ]);
      var next = {
        users: countResults[0],
        tasks: countResults[1],
        disputes: countResults[2]
      };
      // If count headers unavailable, fall back to a light full fetch for those tables
      if (next.users == null || next.tasks == null || next.disputes == null) {
        if (typeof loadData === 'function') await loadData();
        next = {
          users: (window.users || []).length,
          tasks: (window.tasks || []).length,
          disputes: (window.disputes || []).length
        };
      }
      var grew = false;
      if (lastCounts.users != null && next.users > lastCounts.users) {
        flashStat('statUsers');
        prependLiveActivity('+' + (next.users - lastCounts.users) + ' new signup' + (next.users - lastCounts.users === 1 ? '' : 's') + ' detected', '#9b6fc4');
        grew = true;
      }
      if (lastCounts.tasks != null && next.tasks > lastCounts.tasks) {
        flashStat('statTasks');
        prependLiveActivity('+' + (next.tasks - lastCounts.tasks) + ' new task' + (next.tasks - lastCounts.tasks === 1 ? '' : 's') + ' posted', '#4ade80');
        grew = true;
      }
      if (lastCounts.disputes != null && next.disputes > lastCounts.disputes) {
        flashStat('statDisputes');
        prependLiveActivity('+' + (next.disputes - lastCounts.disputes) + ' new dispute' + (next.disputes - lastCounts.disputes === 1 ? '' : 's') + ' opened', '#ef4444');
        grew = true;
      }
      lastCounts = next;
      if (grew && typeof loadData === 'function') {
        await loadData();
      }
      if (window.currentSection === 'overview' && typeof renderOverview === 'function') {
        if (grew || countResults[0] == null) renderOverview();
        else {
          var uEl = document.getElementById('statUsers');
          var tEl = document.getElementById('statTasks');
          if (uEl) uEl.textContent = next.users;
          if (tEl) tEl.textContent = next.tasks;
        }
      }
    } catch (e) {
      // silent — avoid console noise on transient network errors
    } finally {
      refreshing = false;
    }
  }

  async function pollFullRefresh() {
    if (document.hidden || refreshing) return;
    refreshing = true;
    try {
      if (typeof loadData === 'function') await loadData();
      lastCounts = {
        users: (window.users || []).length,
        tasks: (window.tasks || []).length,
        disputes: (window.disputes || []).length
      };
      if (window.currentSection === 'overview') {
        if (typeof renderOverview === 'function') renderOverview();
        if (typeof renderTodaySnapshot === 'function') renderTodaySnapshot();
        if (typeof renderCohortChart === 'function') renderCohortChart();
        if (typeof renderAdminInsights === 'function') renderAdminInsights();
      }
    } catch (e) {
    } finally {
      refreshing = false;
    }
  }

  function clearRefreshTimer() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  function scheduleRefresh() {
    clearRefreshTimer();
    if (document.hidden) return;
    var ms = liveOn ? 15000 : 60000;
    refreshTimer = setInterval(function () {
      if (liveOn) pollLiveCounts();
      else pollFullRefresh();
    }, ms);
  }

  window.toggleAdminLive = function () {
    liveOn = !liveOn;
    try { localStorage.setItem(LIVE_KEY, liveOn ? '1' : '0'); } catch (e) {}
    setLiveUi();
    scheduleRefresh();
    if (liveOn) {
      lastCounts = {
        users: (window.users || []).length,
        tasks: (window.tasks || []).length,
        disputes: (window.disputes || []).length
      };
      pollLiveCounts();
      if (typeof showToast === 'function') showToast('Live mode on — refreshing every 15s', 'green');
    } else if (typeof showToast === 'function') {
      showToast('Live mode off — 60s refresh', 'amber');
    }
  };

  window.adminInitRefresh = function () {
    liveOn = false;
    try { liveOn = localStorage.getItem(LIVE_KEY) === '1'; } catch (e) {}
    setLiveUi();
    lastCounts = {
      users: (window.users || []).length,
      tasks: (window.tasks || []).length,
      disputes: (window.disputes || []).length
    };
    scheduleRefresh();
  };

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      clearRefreshTimer();
    } else {
      scheduleRefresh();
      if (liveOn) pollLiveCounts();
    }
  });

  /* ── Hook overview render ── */
  var _renderOverview = window.renderOverview;
  window.renderOverview = function () {
    if (typeof _renderOverview === 'function') _renderOverview();
    if (typeof renderAdminInsights === 'function') renderAdminInsights();
    injectLiveActivity();
    ensureEditControls();
    applyLayout();
  };

  var _showSection = window.showSection;
  window.showSection = function (section, btn) {
    if (typeof _showSection === 'function') _showSection(section, btn);
    if (section === 'overview') {
      ensureEditControls();
      applyLayout();
      if (typeof renderAdminInsights === 'function') renderAdminInsights();
      injectLiveActivity();
    }
  };

  function boot() {
    ensureEditControls();
    applyLayout();
    if (typeof renderAdminInsights === 'function') renderAdminInsights();
    setLiveUi();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  setTimeout(boot, 800);
})();
