/* SwiftGigs — small helpers the rebuilt pages need from injectors.
 *
 * Each of these was the only thing a page wanted out of qg-polish.js,
 * qg-wave2.js, qg-ux.js, qg-nav.js or qg-site.js — files that cannot be loaded
 * on a rebuilt page because they mount chrome the moment they load. Verify
 * that claim with `node scripts/injector-probe.js`; find what a page still
 * needs with `node scripts/injector-deps.js <page.html>`.
 *
 * Storage keys and stored shapes match the originals exactly, so a value
 * written by an injector page is read correctly here and the other way round.
 *
 * Everything is defined only when absent, so on a page that does load one of
 * those files the original stays in charge whatever the load order.
 */
(function () {
  'use strict';

  function def(name, fn) {
    if (typeof window[name] !== 'function') window[name] = fn;
  }

  function readJson(key, fallback, store) {
    try {
      var raw = (store || localStorage).getItem(key);
      if (!raw) return fallback;
      var p = JSON.parse(raw);
      return p == null ? fallback : p;
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(key, value, store) {
    try { (store || localStorage).setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  /* ── from qg-polish.js ── */

  def('haptic', function (pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern || 10);
  });

  /* Entry animation for card lists. The rebuilt pages render their lists in
     one pass, so there is nothing to stagger; kept as a no-op purely so the
     existing call sites do not have to be hunted down. */
  def('qgStaggerCards', function () {});

  /* ── from qg-site.js / qg-menu.js ── */

  /* Theme is owned by qg-theme.js. This is only the toggle the old pages
     called by name; it reads and writes through that API, never the key. */
  def('toggleTheme', function () {
    var isDark = typeof window.QG_isDarkTheme === 'function'
      ? window.QG_isDarkTheme()
      : localStorage.getItem('qg-theme') !== 'light';
    if (typeof window.QG_applyTheme === 'function') window.QG_applyTheme(!isDark);
    return !isDark;
  });

  /* ── from qg-wave2.js ── */

  var BROWSE_FILTERS = 'qg-browse-filters';
  var RECENT_KEY = 'qg-recently-viewed';

  def('qgSaveBrowseFilters', function (state) {
    writeJson(BROWSE_FILTERS, state || {}, sessionStorage);
  });

  def('qgLoadBrowseFilters', function () {
    return readJson(BROWSE_FILTERS, null, sessionStorage);
  });

  function taskId(t) { return t && (t.task_id != null ? t.task_id : (t.TASK_ID != null ? t.TASK_ID : t.id)); }
  function taskTitle(t) { return (t && (t.title || t.TITLE)) || 'Task'; }
  function taskBudget(t) { return parseFloat((t && (t.budget != null ? t.budget : t.BUDGET)) || 0) || 0; }
  function taskCat(t) { return String((t && (t.category || t.CATEGORY)) || '').toLowerCase(); }
  function taskLoc(t) { return (t && (t.location || t.LOCATION)) || ''; }

  def('qgTrackTaskView', function (task) {
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
    writeJson(RECENT_KEY, list.slice(0, 12));
  });

  /* ── from qg-ux.js: post-task draft ── */

  var DRAFT_KEY = 'qg-post-draft';

  def('qgSavePostDraft', function (data) { writeJson(DRAFT_KEY, data || {}); });
  def('qgLoadPostDraft', function () { return readJson(DRAFT_KEY, null); });
  def('qgClearPostDraft', function () {
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
  });

  /* ── from qg-nav.js: My tasks tab rules ── */

  function isWorker() {
    return typeof window.isWorkerMode === 'function'
      ? window.isWorkerMode()
      : (typeof window.getMode === 'function' ? window.getMode() === 'tasker' : false);
  }

  def('defaultMyTasksTab', function () { return isWorker() ? 'applied' : 'posted'; });

  def('normalizeMyTasksTab', function (tab) {
    var allowed = isWorker()
      ? { applied: 1, inprogress: 1, completed: 1 }
      : { posted: 1, inprogress: 1, completed: 1 };
    return allowed[tab] ? tab : window.defaultMyTasksTab();
  });
})();
