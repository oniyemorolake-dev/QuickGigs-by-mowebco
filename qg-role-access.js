/* QuickGigs — secure Tasker/Poster capability state and mode persistence. */
(function () {
  var memory = null;
  var memoryUid = '';
  var loading = null;

  function currentUser() {
    if (typeof getCurrentUser === 'function') return getCurrentUser();
    return window._currentUser || null;
  }

  function cacheKey(uid) {
    return 'qg-role-access:' + String(uid || '');
  }

  function readCache() {
    var user = currentUser();
    var uid = user && user.uid;
    if (!uid) {
      try { uid = localStorage.getItem('qg-auth-uid') || ''; } catch (e) {}
    }
    if (!uid) return null;
    if (memory && memoryUid === String(uid)) return memory;
    if (memoryUid && memoryUid !== String(uid)) memory = null;
    try {
      var raw = localStorage.getItem(cacheKey(uid));
      memory = raw ? JSON.parse(raw) : null;
      memoryUid = String(uid);
      if (memory) {
        window._qgRoleAccessState = memory;
        document.documentElement.setAttribute('data-tasker-enabled', String(memory.is_tasker === true));
        document.documentElement.setAttribute('data-poster-enabled', String(memory.is_poster === true));
      }
    } catch (e2) {
      memory = null;
    }
    return memory;
  }

  function normalize(data) {
    if (!data) return null;
    var state = {
      is_tasker: data.is_tasker === true,
      is_poster: data.is_poster === true,
      last_active_mode: data.last_active_mode === 'poster' ? 'poster' : 'tasker',
      is_teen: data.is_teen === true,
      roles_updated_at: data.roles_updated_at || null
    };
    if (state.is_teen) state.is_poster = false;
    if (!state.is_tasker && !state.is_poster) state.is_tasker = true;
    if (state.last_active_mode === 'poster' && !state.is_poster) state.last_active_mode = 'tasker';
    if (state.last_active_mode === 'tasker' && !state.is_tasker) state.last_active_mode = 'poster';
    return state;
  }

  function writeCache(data) {
    var state = normalize(data);
    if (!state) return null;
    memory = state;
    window._qgRoleAccessState = state;
    document.documentElement.setAttribute('data-tasker-enabled', String(state.is_tasker));
    document.documentElement.setAttribute('data-poster-enabled', String(state.is_poster));
    var user = currentUser();
    if (user && user.uid) {
      memoryUid = String(user.uid);
      try { localStorage.setItem(cacheKey(user.uid), JSON.stringify(state)); } catch (e) {}
    }
    document.dispatchEvent(new CustomEvent('qg-role-access-changed', { detail: state }));
    return state;
  }

  function endpoint() {
    return window.QG_CONFIG && window.QG_CONFIG.roleAccessUrl;
  }

  async function call(action, extra) {
    var user = currentUser();
    if (!user || !endpoint() || typeof callVerifiedFunction !== 'function') {
      return { success: false, error: 'role_access_unavailable' };
    }
    var payload = Object.assign({ action: action }, extra || {});
    console.info('[QuickGigs role-access] request', {
      url: endpoint(),
      method: 'POST',
      uid: user.uid,
      authorization: 'Firebase ID token attached',
      body: payload
    });
    var result = await callVerifiedFunction(
      endpoint(),
      payload,
      user
    );
    console.info('[QuickGigs role-access] response', {
      status: result.http_status == null ? 'unknown' : result.http_status,
      body: result
    });
    return result;
  }

  async function load(force) {
    var cached = readCache();
    if (!force && cached) return cached;
    if (loading) return loading;
    loading = call('status').then(function (result) {
      loading = null;
      if (!result.success) {
        console.error('[QuickGigs role-access] status failed', result.error || result);
        return cached;
      }
      var state = normalize(result);
      console.info('[QuickGigs role-access] current account state', {
        is_tasker: !!(state && state.is_tasker),
        is_poster: !!(state && state.is_poster),
        is_teen: !!(state && state.is_teen),
        last_active_mode: state && state.last_active_mode
      });
      var previous = typeof getMode === 'function' ? getMode() : '';
      if (state && typeof setMode === 'function') setMode(state.last_active_mode);
      state = writeCache(state);
      if (typeof applyRoleTheme === 'function') applyRoleTheme();
      if (state && previous && previous !== state.last_active_mode) {
        document.dispatchEvent(new CustomEvent('qg-mode-changed', {
          detail: { mode: state.last_active_mode, restored: true }
        }));
        if (typeof window.onQuickGigsModeChange === 'function') {
          setTimeout(function () { window.onQuickGigsModeChange(state.last_active_mode); }, 0);
        }
      }
      return state;
    }).catch(function (err) {
      loading = null;
      console.error('[QuickGigs role-access] status request failed', err);
      return cached;
    });
    return loading;
  }

  async function setActiveMode(mode) {
    mode = mode === 'poster' ? 'poster' : 'tasker';
    var state = await load(false);
    if (!state || (mode === 'poster' ? !state.is_poster : !state.is_tasker)) {
      return { success: false, error: mode + '_role_required' };
    }
    var result = await call('set_mode', { mode: mode });
    if (!result.success) {
      console.error('[QuickGigs role-access] set_mode failed', { mode: mode, error: result.error });
      return result;
    }
    if (typeof setMode === 'function') setMode(mode);
    state = writeCache(result);
    if (typeof applyRoleTheme === 'function') applyRoleTheme();
    document.dispatchEvent(new CustomEvent('qg-mode-changed', { detail: { mode: mode } }));
    return { success: true, state: state, mode: mode };
  }

  async function enableRole(mode) {
    mode = mode === 'poster' ? 'poster' : 'tasker';
    var result = await call(mode === 'poster' ? 'enable_poster' : 'enable_tasker');
    if (!result.success) {
      console.error('[QuickGigs role-access] enable role failed', { mode: mode, error: result.error });
      return result;
    }
    if (typeof setMode === 'function') setMode(mode);
    var state = writeCache(result);
    if (typeof applyRoleTheme === 'function') applyRoleTheme();
    document.dispatchEvent(new CustomEvent('qg-mode-changed', { detail: { mode: mode } }));
    return { success: true, state: state, mode: mode };
  }

  function canUse(mode) {
    var state = readCache();
    if (!state) return null;
    return mode === 'poster' ? state.is_poster === true : state.is_tasker === true;
  }

  function boot(attempt) {
    attempt = attempt || 0;
    if (currentUser() && typeof callVerifiedFunction === 'function' && endpoint()) {
      load(true);
      return;
    }
    if (attempt < 50) setTimeout(function () { boot(attempt + 1); }, 120);
  }

  window.QG_getRoleAccess = readCache;
  window.QG_loadRoleAccess = load;
  window.QG_canUseRole = canUse;
  window.QG_enableRole = enableRole;
  window.QG_setActiveRoleMode = setActiveMode;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { boot(0); });
  } else {
    boot(0);
  }
})();
