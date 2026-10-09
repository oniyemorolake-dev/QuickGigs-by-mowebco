/* SwiftGigs — poster/tasker role mode.
 *
 * Extracted from qg-nav.js so the rebuilt pages can read and set the role
 * without loading a UI injector. The storage keys, the migration path and the
 * default are identical to qg-nav.js, so a page using this and a page using
 * qg-nav.js always agree.
 *
 * Role is NOT theme. 'qg-mode' holds poster/tasker; light/dark lives in
 * 'qg-theme' and belongs to qg-theme.js. getMode() below still repairs the old
 * bug where a theme value had been written into 'qg-mode'.
 *
 * Canonical value is 'poster' | 'tasker'. The 'qg-session-mode' and 'qg-role'
 * mirrors use 'poster' | 'worker', which is what the database calls it.
 */
(function () {
  'use strict';

  function normalizeMode(mode) {
    if (mode === 'worker' || mode === 'tasker') return 'tasker';
    return 'poster';
  }

  function getMode() {
    try {
      var raw = localStorage.getItem('qg-mode');
      if (raw === 'light' || raw === 'dark') {
        // A theme value in the role key: move it back and ignore it here.
        try {
          if (!localStorage.getItem('qg-theme')) localStorage.setItem('qg-theme', raw);
        } catch (e1) {}
        raw = null;
      }
      if (raw === 'tasker' || raw === 'worker') return 'tasker';
      if (raw === 'poster') return 'poster';
      var legacy = localStorage.getItem('qg-session-mode') || localStorage.getItem('qg-role');
      var migrated = normalizeMode(legacy);
      try { localStorage.setItem('qg-mode', migrated); } catch (e2) {}
      return migrated;
    } catch (e) {
      return 'poster';
    }
  }

  function setMode(m) {
    var mode = normalizeMode(m);
    try {
      localStorage.setItem('qg-mode', mode);
      localStorage.setItem('qg-session-mode', mode === 'tasker' ? 'worker' : 'poster');
      localStorage.setItem('qg-role', mode === 'tasker' ? 'worker' : 'poster');
    } catch (e) {}
    return mode;
  }

  function getSessionMode() { return getMode() === 'tasker' ? 'worker' : 'poster'; }
  function setSessionMode(mode) { setMode(mode); return getSessionMode(); }
  function isWorkerMode() { return getMode() === 'tasker'; }
  function isPosterMode() { return getMode() === 'poster'; }
  function toggleMode() { return setMode(isWorkerMode() ? 'poster' : 'tasker'); }

  /* Paints the role onto the document so the mode-scoped token blocks in
     qg-tokens.css apply. Unlike qg-nav.js's version this touches nothing but
     these classes and attributes — it does not repaint any navigation. */
  function applyRoleMode() {
    var mode = isWorkerMode() ? 'worker' : 'poster';
    if (document.body && document.body.classList) {
      document.body.classList.toggle('qg-mode-worker', mode === 'worker');
      document.body.classList.toggle('qg-mode-poster', mode === 'poster');
    }
    if (document.documentElement) {
      document.documentElement.setAttribute('data-qg-mode', mode);
      document.documentElement.setAttribute('data-mode', mode === 'worker' ? 'tasker' : 'poster');
    }
    return mode;
  }

  window.normalizeMode = normalizeMode;
  window.getMode = getMode;
  window.setMode = setMode;
  window.getSessionMode = getSessionMode;
  window.setSessionMode = setSessionMode;
  window.isWorkerMode = isWorkerMode;
  window.isPosterMode = isPosterMode;
  window.toggleMode = toggleMode;
  window.QG_applyRoleMode = applyRoleMode;

  /* qg-nav.js owns applyRoleTheme on injector pages, where it also repaints the
     nav. Only fill it in when that file is absent. */
  if (typeof window.applyRoleTheme !== 'function') window.applyRoleTheme = applyRoleMode;

  applyRoleMode();
})();
