/* QuickGigs — big tech UX wave 2. Vanilla only. Zero new blocking requests. */
(function () {
  'use strict';

  // ── 16. Announcement bar (JS constant) ──
  var QG_ANNOUNCE = {
    id: 'beta-live-2026',
    message: '🎉 QuickGigs beta is live — payments coming soon.',
    link: 'feedback.html',
    linkLabel: 'Feedback'
  };

  var PAGE = (window.location.pathname || '').split('/').pop() || '';
  var RECENT_KEY = 'qg-recently-viewed';
  var SAVED_KEY = 'qg-saved-tasks';
  var STREAK_KEY = 'qg-streak';
  var POST_PREFS = 'qg-post-prefs';
  var BROWSE_FILTERS = 'qg-browse-filters';
  var DISMISS_KEY = 'qg-dismissed-banners';
  var typingEnabled = null; // null=unknown, false=disabled, true=ok

  function esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function idle(fn) {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 1200 });
    else setTimeout(fn, 200);
  }
  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function writeJson(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
  function readTasksCache() {
    try {
      var raw = sessionStorage.getItem('qg-tasks-cache') || sessionStorage.getItem('qg-tasks-cache-v1');
      if (!raw) return [];
      var p = JSON.parse(raw);
      return Array.isArray(p) ? p : (p && p.items) || [];
    } catch (e) { return []; }
  }
  function taskId(t) { return t && (t.task_id != null ? t.task_id : (t.TASK_ID != null ? t.TASK_ID : t.id)); }
  function taskTitle(t) { return (t && (t.title || t.TITLE)) || 'Task'; }
  function taskBudget(t) { return parseFloat((t && (t.budget != null ? t.budget : t.BUDGET)) || 0) || 0; }
  function taskCat(t) { return String((t && (t.category || t.CATEGORY)) || '').toLowerCase(); }
  function taskLoc(t) { return (t && (t.location || t.LOCATION)) || ''; }
  function taskWhen(t) { return t && (t.created_at || t.CREATED_AT || t.createdAt || ''); }

  /* ── Confetti (lightweight, reduced-motion aware) ── */
  window.qgCelebrate = function (opts) {
    opts = opts || {};
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (typeof window.qgBurstConfetti === 'function') {
      window.qgBurstConfetti({ count: opts.count || 36, colors: opts.colors });
      return;
    }
    var root = document.createElement('div');
    root.className = 'qg-confetti-root';
    root.setAttribute('aria-hidden', 'true');
    root.style.cssText = 'pointer-events:none;position:fixed;inset:0;z-index:99999;overflow:hidden';
    document.body.appendChild(root);
    var colors = opts.colors || ['#6b3fa0', '#9b6fc4', '#c8a8e9', '#fbbf24', '#4ade80'];
    for (var i = 0; i < (opts.count || 36); i++) {
      var p = document.createElement('i');
      p.style.cssText = 'position:absolute;top:-12px;left:' + (Math.random() * 100) + 'vw;width:6px;height:8px;border-radius:2px;background:' +
        colors[i % colors.length] + ';animation:qgW2Fall ' + (1.2 + Math.random() * 0.6) + 's linear forwards';
      root.appendChild(p);
    }
    if (!document.getElementById('qgW2ConfettiAnim')) {
      var st = document.createElement('style');
      st.id = 'qgW2ConfettiAnim';
      st.textContent = '@keyframes qgW2Fall{to{transform:translateY(110vh) rotate(540deg);opacity:0}}';
      document.head.appendChild(st);
    }
    setTimeout(function () { root.remove(); }, 1600);
  };

  /* ── Recently viewed ── */
  window.qgTrackTaskView = function (task) {
    if (!task) return;
    var id = String(taskId(task));
    if (!id || id === 'undefined') return;
    var list = readJson(RECENT_KEY, []);
    if (!Array.isArray(list)) list = [];
    list = list.filter(function (x) { return String(x.id) !== id; });
    list.unshift({
      id: id,
      title: taskTitle(task),
      budget: taskBudget(task),
      location: taskLoc(task),
      category: taskCat(task),
      at: Date.now()
    });
    writeJson(RECENT_KEY, list.slice(0, 10));
  };

  window.qgRenderRecentlyViewed = function (hostId) {
    var host = typeof hostId === 'string' ? document.getElementById(hostId) : hostId;
    if (!host) return;
    var list = readJson(RECENT_KEY, []);
    if (!list.length) { host.innerHTML = ''; host.hidden = true; return; }
    host.hidden = false;
    host.innerHTML =
      '<div class="qg-section-head"><h3>Recently viewed</h3></div>' +
      '<div class="qg-hscroll" role="list">' +
      list.map(function (t) {
        return '<a class="qg-mini-card" role="listitem" href="browsetask.html?task=' + encodeURIComponent(t.id) + '">' +
          '<div class="tit">' + esc(t.title) + '</div>' +
          '<div class="meta">$' + esc(String(t.budget || 0)) + ' CAD · ' + esc(t.location || '') + '</div></a>';
      }).join('') + '</div>';
  };

  /* ── Saved tasks localStorage mirror ── */
  function syncSavedLocal(idsMap) {
    writeJson(SAVED_KEY, Object.keys(idsMap || {}));
  }
  function loadSavedLocal() {
    var arr = readJson(SAVED_KEY, []);
    var map = {};
    (arr || []).forEach(function (id) { map[String(id)] = true; });
    return map;
  }

  /* ── Streak ── */
  window.qgTouchStreak = function () {
    var today = new Date().toISOString().slice(0, 10);
    var data = readJson(STREAK_KEY, { lastDate: '', count: 0 }) || { lastDate: '', count: 0 };
    if (data.lastDate === today) return data;
    var y = new Date();
    y.setDate(y.getDate() - 1);
    var yesterday = y.toISOString().slice(0, 10);
    if (data.lastDate === yesterday) data.count = (data.count || 0) + 1;
    else data.count = 1;
    data.lastDate = today;
    writeJson(STREAK_KEY, data);
    if ([3, 7, 14, 30].indexOf(data.count) >= 0) {
      window.qgCelebrate({ count: 40 });
      if (typeof haptic === 'function') haptic([15, 30, 15]);
    }
    return data;
  };

  window.qgRenderStreak = function (hostId) {
    var host = document.getElementById(hostId);
    if (!host) return;
    var data = window.qgTouchStreak();
    var n = data.count || 1;
    var line = n >= 14 ? 'Incredible consistency — keep it up!' :
      n >= 7 ? 'A full week of momentum!' :
      n >= 3 ? 'You\'re building a habit.' :
      'Come back tomorrow to keep your streak.';
    host.innerHTML =
      '<div class="qg-streak-card" role="status">' +
      '<div class="qg-streak-title">🔥 ' + n + ' day streak</div>' +
      '<div class="qg-streak-sub">' + esc(line) + '</div></div>';
  };

  /* ── Suggested for you ── */
  window.qgRenderSuggested = function (hostId, skills) {
    var host = document.getElementById(hostId);
    if (!host) return;
    var tasks = readTasksCache().filter(function (t) {
      return String(t.status || t.STATUS || 'open').toLowerCase() === 'open';
    });
    var skillList = (skills || []).map(function (s) { return String(s).toLowerCase(); });
    if (!skillList.length) {
      try {
        var uid = window._currentUser && window._currentUser.uid;
        var raw = uid && localStorage.getItem('qg-profile-' + uid);
        if (raw) {
          var p = JSON.parse(raw);
          if (p && p.skills) skillList = (Array.isArray(p.skills) ? p.skills : String(p.skills).split(',')).map(function (s) { return String(s).trim().toLowerCase(); });
        }
      } catch (e) {}
    }
    function score(t) {
      var hay = (taskTitle(t) + ' ' + taskCat(t)).toLowerCase();
      var s = 0;
      skillList.forEach(function (sk) { if (sk && hay.indexOf(sk) >= 0) s += 3; });
      var age = Date.now() - new Date(taskWhen(t) || 0).getTime();
      if (!isNaN(age) && age < 86400000) s += 1;
      return s;
    }
    var ranked = tasks.slice().sort(function (a, b) {
      var ds = score(b) - score(a);
      if (ds) return ds;
      return new Date(taskWhen(b) || 0) - new Date(taskWhen(a) || 0);
    }).slice(0, 3);
    if (!ranked.length) { host.innerHTML = ''; return; }
    host.innerHTML =
      '<div class="qg-section-head"><h3>Suggested for you</h3><a href="browsetask.html">See more</a></div>' +
      '<div class="qg-hscroll">' +
      ranked.map(function (t) {
        var id = taskId(t);
        return '<a class="qg-mini-card" href="browsetask.html?task=' + encodeURIComponent(String(id)) + '">' +
          '<div class="tit">' + esc(taskTitle(t)) + '</div>' +
          '<div class="meta">$' + esc(String(taskBudget(t))) + ' CAD · ' + esc(taskLoc(t)) + '</div></a>';
      }).join('') + '</div>';
  };

  /* ── Offline banner ── */
  function initOfflineBanner() {
    var el = document.getElementById('qgOfflineBanner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'qgOfflineBanner';
      el.className = 'qg-offline-banner';
      el.setAttribute('role', 'status');
      el.textContent = "You're offline — showing cached tasks";
      document.body.insertBefore(el, document.body.firstChild);
    }
    function sync() {
      el.classList.toggle('show', !navigator.onLine);
    }
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    sync();
  }

  /* ── Announcement bar ── */
  function initAnnounceBar() {
    var dismissed = readJson(DISMISS_KEY, []);
    if (!Array.isArray(dismissed)) dismissed = [];
    if (dismissed.indexOf(QG_ANNOUNCE.id) >= 0) return;
    if (document.getElementById('qgWave2Announce')) return;
    var bar = document.createElement('div');
    bar.id = 'qgWave2Announce';
    bar.className = 'qg-announce-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Announcement');
    bar.innerHTML =
      '<span>' + esc(QG_ANNOUNCE.message) + '</span>' +
      (QG_ANNOUNCE.link ? '<a href="' + esc(QG_ANNOUNCE.link) + '">' + esc(QG_ANNOUNCE.linkLabel || 'Learn more') + '</a>' : '') +
      '<button type="button" aria-label="Dismiss announcement">×</button>';
    bar.querySelector('button').onclick = function () {
      dismissed.push(QG_ANNOUNCE.id);
      writeJson(DISMISS_KEY, dismissed);
      bar.remove();
    };
    var nav = document.querySelector('nav.nav, .nav');
    if (nav && nav.parentNode) nav.parentNode.insertBefore(bar, nav);
    else document.body.insertBefore(bar, document.body.firstChild);
  }

  /* ── Title/desc quality hints (posttask) ── */
  function initPostQualityHints() {
    if (PAGE !== 'posttask.html') return;
    var title = document.getElementById('taskTitle');
    var desc = document.getElementById('taskDesc');
    function bind(el, thresholds, messages) {
      if (!el) return;
      var hint = document.createElement('div');
      hint.className = 'qg-field-quality';
      hint.setAttribute('aria-live', 'polite');
      el.parentNode.appendChild(hint);
      function update() {
        var n = (el.value || '').trim().length;
        hint.className = 'qg-field-quality';
        if (n < thresholds[0]) { hint.textContent = messages.short; hint.classList.add('warn'); }
        else if (n > thresholds[1]) { hint.textContent = messages.long; hint.classList.add('warn'); }
        else { hint.textContent = messages.good; hint.classList.add('good'); }
      }
      el.addEventListener('input', update);
      update();
    }
    bind(title, [15, 80], {
      short: 'Add more detail to attract applicants',
      good: '✓ Great title',
      long: 'Keep it concise'
    });
    bind(desc, [30, 500], {
      short: 'A bit more detail helps taskers know what to expect',
      good: '✓ Solid description',
      long: 'Keep it focused — you can share more in chat'
    });

    // Prefs: remember category + location
    try {
      var prefs = readJson(POST_PREFS, {}) || {};
      var loc = document.getElementById('taskLocation');
      if (loc && !loc.value && prefs.location) loc.value = prefs.location;
      if (prefs.category) {
        document.querySelectorAll('.cat-chip').forEach(function (chip) {
          var label = chip.textContent.replace(/[^\w\s]/g, '').trim().toLowerCase();
          if (label.indexOf(String(prefs.category).toLowerCase()) >= 0 ||
              (window.CAT_SLUGS && window.CAT_SLUGS[chip.textContent.replace(/[^\w\s]/g, '').trim()] === prefs.category)) {
            chip.click();
          }
        });
      }
    } catch (e) {}

    // Restore repost draft
    try {
      var draft = sessionStorage.getItem('qg-repost-draft');
      if (draft) {
        var d = JSON.parse(draft);
        sessionStorage.removeItem('qg-repost-draft');
        if (d.title && document.getElementById('taskTitle')) document.getElementById('taskTitle').value = d.title;
        if (d.description && document.getElementById('taskDesc')) document.getElementById('taskDesc').value = d.description;
        if (d.budget != null && document.getElementById('taskBudget')) document.getElementById('taskBudget').value = d.budget;
        if (d.location && document.getElementById('taskLocation')) document.getElementById('taskLocation').value = d.location;
        if (typeof showToast === 'function') showToast('Details loaded — review and post again', '#9b6fc4');
      }
    } catch (e2) {}

    var form = document.getElementById('formContent');
    if (form) {
      form.addEventListener('change', function () {
        var locEl = document.getElementById('taskLocation');
        var cat = window.selectedCat || '';
        writeJson(POST_PREFS, {
          location: locEl ? locEl.value : '',
          category: cat
        });
      });
    }
  }

  /* ── Profile inline edit + review bars ── */
  function initProfileWave2() {
    if (PAGE !== 'profile.html') return;
    idle(function () {
      // Review summary bars
      var reviewsHost = document.getElementById('reviewsList') || document.querySelector('.reviews-list, #reviewsSection');
      if (reviewsHost && !document.getElementById('qgReviewSummary')) {
        var cards = reviewsHost.querySelectorAll('[data-rating], .review-card, .rev-item');
        var ratings = [];
        cards.forEach(function (c) {
          var r = Number(c.getAttribute('data-rating') || c.querySelector('.rev-stars, .rating') && (c.textContent.match(/([1-5])\s*★/) || [])[1]);
          if (r >= 1 && r <= 5) ratings.push(r);
        });
        // Also from window cache if present
        if (!ratings.length && Array.isArray(window._profileReviews)) {
          window._profileReviews.forEach(function (r) {
            var n = Number(r.rating || r.RATING);
            if (n >= 1 && n <= 5) ratings.push(n);
          });
        }
        if (ratings.length) {
          var avg = ratings.reduce(function (a, b) { return a + b; }, 0) / ratings.length;
          var counts = [0, 0, 0, 0, 0];
          ratings.forEach(function (r) { counts[r - 1] += 1; });
          var max = Math.max.apply(null, counts) || 1;
          var sum = document.createElement('div');
          sum.id = 'qgReviewSummary';
          sum.className = 'qg-review-summary';
          var bars = '';
          for (var s = 5; s >= 1; s--) {
            var pct = Math.round((counts[s - 1] / max) * 100);
            bars += '<div class="qg-rev-bar-row"><span>' + s + '★</span><div class="qg-rev-bar-track"><div class="qg-rev-bar-fill" style="width:' + pct + '%"></div></div><span>' + counts[s - 1] + '</span></div>';
          }
          sum.innerHTML =
            '<div><div class="qg-rev-avg">' + avg.toFixed(1) + '</div>' +
            '<div class="qg-rev-stars" aria-label="' + avg.toFixed(1) + ' out of 5">' + '★'.repeat(Math.round(avg)) + '☆'.repeat(5 - Math.round(avg)) + '</div>' +
            '<div style="font-size:11px;opacity:0.6">' + ratings.length + ' review' + (ratings.length === 1 ? '' : 's') + '</div></div>' +
            '<div class="qg-rev-bars">' + bars + '</div>';
          var sec = document.getElementById('reviewsSection') || reviewsHost.parentNode;
          sec.insertBefore(sum, sec.firstChild === reviewsHost ? reviewsHost : sec.children[1] || reviewsHost);
        }
      }

      // Inline bio
      var bio = document.getElementById('bioText');
      if (bio && !bio.dataset.qgInline) {
        bio.dataset.qgInline = '1';
        bio.classList.add('qg-inline-edit');
        bio.setAttribute('tabindex', '0');
        bio.setAttribute('role', 'button');
        bio.setAttribute('aria-label', 'Edit bio');
        function startBioEdit() {
          if (bio.querySelector('textarea')) return;
          var prev = bio.textContent === 'No bio yet.' ? '' : bio.textContent;
          bio.innerHTML = '<textarea class="field-input" id="qgInlineBio" rows="3" maxlength="500" style="width:100%">' + esc(prev) + '</textarea>' +
            '<div class="qg-inline-tools"><button type="button" class="qg-inline-save" id="qgBioSave">Save</button><button type="button" class="qg-inline-cancel" id="qgBioCancel">Cancel</button></div>';
          var ta = document.getElementById('qgInlineBio');
          ta.focus();
          document.getElementById('qgBioCancel').onclick = function () { bio.textContent = prev || 'No bio yet.'; };
          document.getElementById('qgBioSave').onclick = async function () {
            var val = ta.value.trim();
            bio.textContent = val || 'No bio yet.';
            if (typeof haptic === 'function') haptic(10);
            if (typeof upsertUserProfile === 'function' && window._currentUser) {
              var r = await upsertUserProfile({ firebase_uid: window._currentUser.uid, bio: val });
              if (!r || r.success === false) {
                bio.textContent = prev || 'No bio yet.';
                if (typeof showToast === 'function') showToast('Could not save bio', '#ef4444');
              } else if (typeof showToast === 'function') showToast('Bio updated', '#4ade80');
            }
          };
        }
        bio.addEventListener('click', startBioEdit);
        bio.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startBioEdit(); }
        });
      }
    });
  }

  /* ── Browse filter persistence helpers exposed ── */
  window.qgSaveBrowseFilters = function (state) {
    try { sessionStorage.setItem(BROWSE_FILTERS, JSON.stringify(state || {})); } catch (e) {}
  };
  window.qgLoadBrowseFilters = function () {
    try {
      var raw = sessionStorage.getItem(BROWSE_FILTERS);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  };

  /* ── Typing indicator (best-effort; disables if column missing) ── */
  window.qgSetTypingFlag = async function (convId, userId) {
    if (typingEnabled === false || !convId || !userId || typeof sbUpdate !== 'function') return;
    try {
      var patch = { typing_by: userId, typing_at: new Date().toISOString() };
      var res = await sbUpdate('conversations', patch, 'conv_id=eq.' + encodeURIComponent(convId));
      if (res && res.success === false) typingEnabled = false;
      else typingEnabled = true;
    } catch (e) {
      typingEnabled = false;
    }
  };
  window.qgPollTyping = async function (convId, myId, bubbleEl) {
    if (typingEnabled === false || !convId || typeof getConversationById !== 'function' && typeof sbGet !== 'function') return;
    try {
      var rows = typeof sbGet === 'function'
        ? await sbGet('conversations', 'select=conv_id,poster_id,worker_id,typing_by,typing_at&conv_id=eq.' + encodeURIComponent(convId), null, 1)
        : null;
      var row = rows && rows[0];
      if (!row) return;
      if (row.typing_by == null && row.typing_at == null && typingEnabled === null) {
        // Column likely missing — stop trying after first empty successful fetch without fields
        // Don't disable on first null; only on update failure
      }
      if (!bubbleEl) return;
      var by = row.typing_by || row.TYPING_BY;
      var at = row.typing_at || row.TYPING_AT;
      if (by && String(by) !== String(myId) && at) {
        var age = Date.now() - new Date(at).getTime();
        bubbleEl.classList.toggle('show', age >= 0 && age < 6000);
      } else {
        bubbleEl.classList.remove('show');
      }
    } catch (e) {
      typingEnabled = false;
    }
  };

  /* ── Wire saved localStorage into existing saved module ── */
  function enhanceSavedLocal() {
    var local = loadSavedLocal();
    if (typeof window.isTaskSaved === 'function') {
      var orig = window.isTaskSaved;
      window.isTaskSaved = function (id) {
        return orig(id) || !!local[String(id)];
      };
    }
    var origToggle = window.toggleSavedTask;
    if (typeof origToggle === 'function') {
      window.toggleSavedTask = async function (taskId) {
        var result = await origToggle(taskId);
        if (result && result.success) {
          if (result.saved) local[String(taskId)] = true;
          else delete local[String(taskId)];
          syncSavedLocal(local);
          if (typeof haptic === 'function') haptic(10);
        }
        return result;
      };
    } else {
      // Fallback pure localStorage bookmarks
      window.isTaskSaved = function (id) { return !!local[String(id)]; };
      window.bookmarkButtonHtml = function (taskId) {
        var saved = !!local[String(taskId)];
        return '<button type="button" class="qg-chip-btn qg-save-trigger' + (saved ? ' is-saved' : '') + '" data-task-id="' +
          String(taskId).replace(/"/g, '&quot;') + '" aria-pressed="' + (saved ? 'true' : 'false') +
          '" aria-label="' + (saved ? 'Remove from saved' : 'Save task') + '">' + (saved ? '★ Saved' : '☆ Save') + '</button>';
      };
      window.toggleSavedTask = async function (taskId) {
        var tid = String(taskId);
        if (local[tid]) { delete local[tid]; syncSavedLocal(local); return { success: true, saved: false }; }
        local[tid] = true; syncSavedLocal(local); return { success: true, saved: true };
      };
      window.bindSavedTriggers = function (root, onChange) {
        (root || document).querySelectorAll('.qg-save-trigger').forEach(function (btn) {
          if (btn._qgSaveBound) return;
          btn._qgSaveBound = true;
          btn.onclick = async function (e) {
            e.preventDefault(); e.stopPropagation();
            var tid = btn.getAttribute('data-task-id');
            var result = await window.toggleSavedTask(tid);
            btn.classList.toggle('is-saved', !!result.saved);
            btn.setAttribute('aria-pressed', result.saved ? 'true' : 'false');
            btn.setAttribute('aria-label', result.saved ? 'Remove from saved' : 'Save task');
            btn.textContent = result.saved ? '★ Saved' : '☆ Save';
            if (onChange) onChange(tid, result.saved);
          };
        });
      };
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    initOfflineBanner();
    initAnnounceBar();
    enhanceSavedLocal();
    initPostQualityHints();
    if (PAGE === 'dashboard.html' || PAGE === 'browsetask.html' || PAGE === 'profile.html' || PAGE === 'mytasks.html' || PAGE === 'chat.html') {
      idle(function () { window.qgTouchStreak(); });
    }
    if (PAGE === 'dashboard.html') {
      idle(function () {
        if (!document.getElementById('dashRecent')) {
          var slot = document.createElement('div');
          slot.id = 'dashRecent';
          slot.className = 'qg-page-wide';
          slot.style.padding = '0 16px 8px';
          var act = document.getElementById('dashActivity');
          if (act && act.parentNode) act.parentNode.insertBefore(slot, act);
          else {
            var stats = document.getElementById('statsGrid');
            if (stats && stats.parentNode) stats.parentNode.insertBefore(slot, stats.nextSibling);
          }
        }
        if (!document.getElementById('dashSuggested')) {
          var sug = document.createElement('div');
          sug.id = 'dashSuggested';
          sug.className = 'qg-page-wide';
          sug.style.padding = '0 16px 8px';
          var recent = document.getElementById('dashRecent');
          if (recent && recent.parentNode) recent.parentNode.insertBefore(sug, recent.nextSibling);
        }
        if (!document.getElementById('dashStreak')) {
          var st = document.createElement('div');
          st.id = 'dashStreak';
          var greet = document.querySelector('.greeting');
          if (greet && greet.parentNode) greet.parentNode.insertBefore(st, greet.nextSibling);
        }
        window.qgRenderRecentlyViewed('dashRecent');
        window.qgRenderStreak('dashStreak');
        var isWorker = (typeof isWorkerMode === 'function' && isWorkerMode()) ||
          (typeof getMode === 'function' ? getMode() === 'tasker' : localStorage.getItem('qg-mode') === 'tasker' || localStorage.getItem('qg-session-mode') === 'worker');
        if (isWorker) window.qgRenderSuggested('dashSuggested');
      });
    }
    if (PAGE === 'browsetask.html') {
      idle(function () {
        if (!document.getElementById('browseRecent')) {
          var wrap = document.createElement('div');
          wrap.id = 'browseRecent';
          wrap.style.padding = '8px 18px 0';
          var cards = document.getElementById('cardsArea');
          if (cards && cards.parentNode) cards.parentNode.insertBefore(wrap, cards);
        }
        window.qgRenderRecentlyViewed('browseRecent');
      });
    }
    if (PAGE === 'profile.html') initProfileWave2();
  });

  window.QG_ANNOUNCE = QG_ANNOUNCE;
})();
