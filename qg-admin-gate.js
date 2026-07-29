/**
 * QuickGigs — single client-side isAdmin() / resolveAdminAccess() helper.
 *
 * SECURITY: This is UX gating only. True enforcement is server-side (RLS +
 * service-role Edge Function that checks the `admins` table and/or Firebase
 * custom claim `admin: true`) once the backend exists. Never put a
 * service-role key, admin password, or secret in frontend code.
 *
 * Canonical DB rule for admin console entry (admin-login.html + admin.html):
 *   users.role === 'admin'  AND  (users.verified === true OR users.email_verified === true)
 * Exact role string: 'admin' (QG_ADMIN_ROLE).
 */
(function () {
  /** Exact role value required in the users table for admin console access. */
  var QG_ADMIN_ROLE = 'admin';

  function cfg() {
    return window.QG_CONFIG || {};
  }

  function fallbackAdminEmail() {
    return String(cfg().adminEmail || '').trim().toLowerCase();
  }

  /** Optional Firebase UID allow-list (prefer over email when non-empty). */
  function fallbackAdminUids() {
    var list = cfg().adminUids;
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

  function isTruthyFlag(v) {
    return v === true || v === 1 || v === 'true' || v === '1';
  }

  /**
   * DB row check used by admin-login + admin.html.
   * role must be exactly 'admin'; verified uses verified OR email_verified
   * (there is no separate required column name beyond what the row has).
   */
  function userRowIsAdmin(dbUser) {
    if (!dbUser) return false;
    var role = String(dbUser.role || '').trim().toLowerCase();
    if (role !== QG_ADMIN_ROLE) return false;
    var verified = isTruthyFlag(dbUser.verified) || isTruthyFlag(dbUser.email_verified);
    return verified;
  }

  /**
   * Sync UX helper (menus, soft-close bypass). Prefer resolveAdminAccess() for
   * the admin console — that hits the users table.
   */
  function isAdmin(user) {
    user = user || getAuthUser();
    if (!user) return false;

    if (window._qgAdminDbOk === true) return true;

    // 1) Firebase custom claim — preferred long-term
    if (user.admin === true) return true;
    if (window._qgAdminClaim === true) return true;
    var claims = window._qgIdTokenClaims || user.claims || null;
    if (claims && (claims.admin === true || claims.admin === 'true')) return true;

    // 2) UID allow-list from config
    var uid = String(user.uid || user.firebase_uid || '').trim();
    var uids = fallbackAdminUids();
    if (uid && uids.length) {
      for (var i = 0; i < uids.length; i++) {
        if (uids[i] === uid) return true;
      }
    }

    // 3) Cached DB row from resolveAdminAccess
    if (window._qgAdminDbUser && userRowIsAdmin(window._qgAdminDbUser)) {
      var rowUid = String(window._qgAdminDbUser.firebase_uid || '');
      if (!uid || !rowUid || rowUid === uid) return true;
    }

    // 4) Temporary email match (UX only — admin console uses DB role check)
    var email = String(user.email || '').trim().toLowerCase();
    var allow = fallbackAdminEmail();
    return !!(email && allow && email === allow);
  }

  /**
   * Fetch users row for this Firebase uid and require role==='admin' + verified.
   * @returns {Promise<{ok:boolean, user:object|null, dbUser:object|null, reason:string}>}
   */
  async function resolveAdminAccess(firebaseUser) {
    var result = { ok: false, user: firebaseUser || null, dbUser: null, reason: 'not_signed_in' };
    window._qgAdminDbOk = false;

    var user = firebaseUser || getAuthUser();
    if (!user || !user.uid) {
      window._qgAdminDbUser = null;
      return result;
    }
    result.user = user;

    // Prefer live Auth identity — never a cached other account.
    try {
      if (window._auth && window._auth.currentUser) {
        if (String(window._auth.currentUser.uid) !== String(user.uid)) {
          user = window._auth.currentUser;
          result.user = user;
        }
      }
    } catch (e) {}

    var dbUser = null;
    try {
      // Dedicated select for the admin gate — do not reuse profile caches.
      var fetchAdmin = typeof sbGetOrThrow === 'function' ? sbGetOrThrow : null;
      var fetchSoft = typeof sbGet === 'function' ? sbGet : null;
      if (fetchAdmin || fetchSoft) {
        var baseFilter = 'firebase_uid=eq.' + encodeURIComponent(user.uid);
        var coreSelect = 'user_id,firebase_uid,name,email,role,status,email_verified';
        try {
          if (fetchAdmin) {
            var full = await fetchAdmin(
              'users',
              baseFilter + '&select=' + coreSelect + ',verified',
              null,
              1
            );
            dbUser = full && full[0] ? full[0] : null;
          } else {
            throw new Error('no_throw');
          }
        } catch (colErr) {
          var core = fetchAdmin
            ? await fetchAdmin('users', baseFilter + '&select=' + coreSelect, null, 1)
            : await fetchSoft('users', baseFilter + '&select=' + coreSelect, null, 1);
          dbUser = core && core[0] ? core[0] : null;
        }
      } else if (typeof getUserByFirebaseUid === 'function') {
        dbUser = await getUserByFirebaseUid(user.uid, { fresh: true, self: true });
      }
    } catch (err) {
      console.warn('resolveAdminAccess fetch failed:', err);
      result.reason = 'lookup_failed';
      window._qgAdminDbUser = null;
      return result;
    }

    result.dbUser = dbUser;
    window._qgAdminDbUser = dbUser || null;

    if (!dbUser) {
      result.reason = 'no_user_row';
      return result;
    }
    if (!userRowIsAdmin(dbUser)) {
      result.reason = 'not_admin';
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
      var result = await user.getIdTokenResult(false);
      window._qgIdTokenClaims = (result && result.claims) || null;
      window._qgAdminClaim = !!(result && result.claims && result.claims.admin === true);
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

  window.QG_ADMIN_ROLE = QG_ADMIN_ROLE;
  window.userRowIsAdmin = userRowIsAdmin;
  window.resolveAdminAccess = resolveAdminAccess;
  window.isAdmin = isAdmin;
  window.refreshAdminClaim = refreshAdminClaim;
  window.requireAdmin = requireAdmin;
})();
