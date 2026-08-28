/**
 * QuickGigs — client-side admin UX gate (NOT security).
 *
 * COSMETIC ONLY: hides admin UI from non-operators so they do not see a broken
 * page. All privileged reads and writes are enforced server-side by the
 * admin-console Edge Function, which verifies the Firebase JWT and checks the
 * `admins` table (service role). Never add secrets, service-role keys, or
 * email allow-lists here.
 */
(function () {
  /** Optional Firebase UID allow-list for menu/soft-close UX hints only. */
  function fallbackAdminUids() {
    var list = (window.QG_CONFIG || {}).adminUids;
    if (!Array.isArray(list)) return [];
    return list.map(function (id) { return String(id || '').trim(); }).filter(Boolean);
  }

  function getAuthUser() {
    if (window._auth && window._auth.currentUser) return window._auth.currentUser;
    if (typeof getCurrentUser === 'function') {
      var cu = getCurrentUser();
      if (cu) return cu;
    }
    if (window._currentUser) return window._currentUser;
    return null;
  }

  /**
   * Sync UX helper (menus, soft-close bypass). Admin console entry uses
   * resolveAdminAccess() which calls the admin-console verify action.
   */
  function isAdmin(user) {
    user = user || getAuthUser();
    if (!user) return false;

    if (window._qgAdminDbOk === true) return true;

    if (user.admin === true) return true;
    if (window._qgAdminClaim === true) return true;
    var claims = window._qgIdTokenClaims || user.claims || null;
    if (claims && (claims.admin === true || claims.admin === 'true')) return true;

    var uid = String(user.uid || user.firebase_uid || '').trim();
    var uids = fallbackAdminUids();
    if (uid && uids.length) {
      for (var i = 0; i < uids.length; i++) {
        if (uids[i] === uid) return true;
      }
    }

    return false;
  }

  /**
   * Server-side admin check via admin-console (admins table).
   * @returns {Promise<{ok:boolean, user:object|null, dbUser:object|null, reason:string}>}
   */
  async function resolveAdminAccess(firebaseUser) {
    var result = { ok: false, user: firebaseUser || null, dbUser: null, reason: 'not_signed_in' };
    window._qgAdminDbOk = false;
    window._qgAdminDbUser = null;

    var user = firebaseUser || getAuthUser();
    if (!user || !user.uid) {
      return result;
    }
    result.user = user;

    try {
      if (window._auth && window._auth.currentUser) {
        if (String(window._auth.currentUser.uid) !== String(user.uid)) {
          user = window._auth.currentUser;
          result.user = user;
        }
      }
    } catch (e) {}

    if (typeof callAdminConsole !== 'function') {
      result.reason = 'admin_api_missing';
      return result;
    }

    var verify = await callAdminConsole('verify', {}, user);
    if (!verify || !verify.ok) {
      result.reason = verify && verify.http_status === 403 ? 'not_admin' : 'verify_failed';
      return result;
    }

    window._qgAdminDbOk = true;
    result.ok = true;
    result.reason = 'ok';
    return result;
  }

  /** Refresh ID token claims so isAdmin() can see admin: true without page reload. */
  async function refreshAdminClaim() {
    var user = getAuthUser();
    window._qgAdminClaim = false;
    window._qgIdTokenClaims = null;
    if (!user || typeof user.getIdTokenResult !== 'function') {
      return isAdmin(user);
    }
    try {
      var tokenResult = await user.getIdTokenResult(false);
      window._qgIdTokenClaims = (tokenResult && tokenResult.claims) || null;
      window._qgAdminClaim = !!(tokenResult && tokenResult.claims && tokenResult.claims.admin === true);
    } catch (e) {
      window._qgAdminClaim = false;
    }
    return isAdmin(user);
  }

  function requireAdmin(opts) {
    opts = opts || {};
    if (isAdmin()) return true;
    if (opts.silent) return false;
    if (typeof showToast === 'function') showToast('Admin only', 'red');
    else if (typeof qgNotify === 'function') qgNotify('Admin only', '#ef4444');
    return false;
  }

  window.resolveAdminAccess = resolveAdminAccess;
  window.isAdmin = isAdmin;
  window.refreshAdminClaim = refreshAdminClaim;
  window.requireAdmin = requireAdmin;
})();
