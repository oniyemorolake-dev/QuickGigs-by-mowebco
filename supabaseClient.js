// ================================================================
// QuickGigs — single shared Supabase REST client
// Load AFTER qg-config.js. Pages must not re-init.
// ================================================================
(function (global) {
  if (global.QGSupabase && global.QGSupabase.url && global.QGSupabase.__qgAuthV2) return;

  var SUPABASE_URL = 'https://nuyfqsxstsrbloztzgau.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51eWZxc3hzdHNyYmxvenR6Z2F1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NzkyNjUsImV4cCI6MjA5ODU1NTI2NX0.UpagWLifoxHmWu30lNnBO89gNYKIh4KxtYu28DKlSBM';

  var SUPABASE_HEADERS = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
  };

  function authUser() {
    if (global._auth && global._auth.currentUser) return global._auth.currentUser;
    if (global._currentUser && typeof global._currentUser.getIdToken === 'function') {
      return global._currentUser;
    }
    return null;
  }

  function decodeJwtPayload(token) {
    try {
      var part = String(token || '').split('.')[1];
      if (!part) return null;
      var b64 = part.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      return JSON.parse(atob(b64));
    } catch (e) {
      return null;
    }
  }

  function logAuth(step, detail) {
    try {
      console.info('[QG auth]', step, detail || '');
    } catch (e) {}
  }

  async function getFirebaseBearer(forceRefresh) {
    var user = authUser();
    if (!user || typeof user.getIdToken !== 'function') {
      logAuth('token:skip', { reason: 'no_user' });
      return null;
    }
    var token = await user.getIdToken(!!forceRefresh);
    var claims = decodeJwtPayload(token);
    logAuth(forceRefresh ? 'token:refresh' : 'token:ok', {
      uid: user.uid,
      iss: claims && claims.iss,
      aud: claims && claims.aud,
      sub: claims && claims.sub,
      role: claims && claims.role,
      exp: claims && claims.exp
    });
    return token;
  }

  /**
   * One-shot probe: does Supabase Data API accept this Firebase JWT?
   * 401 => third-party auth misconfigured / rejected token (NOT "please log in again").
   */
  async function probeFirebaseJwt(user) {
    if (global.__qgSupabaseJwtProbeDone) {
      return !global.__qgSupabaseFirebaseRejected;
    }
    global.__qgSupabaseJwtProbeDone = true;
    try {
      if (user) {
        if (typeof setCurrentUser === 'function') setCurrentUser(user);
        else global._currentUser = user;
      }
      var token = await getFirebaseBearer(true);
      if (!token) {
        logAuth('probe:skip', { reason: 'no_token' });
        return false;
      }
      var res = await fetch(
        SUPABASE_URL + '/rest/v1/users?select=firebase_uid&limit=1',
        {
          method: 'GET',
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: 'Bearer ' + token,
            Accept: 'application/json'
          }
        }
      );
      var body = '';
      try { body = await res.text(); } catch (e) {}
      logAuth('probe:result', { status: res.status, body: String(body).slice(0, 240) });
      if (res.status === 401) {
        global.__qgSupabaseFirebaseRejected = true;
        logAuth('probe:FAIL', {
          message:
            'Supabase rejected the Firebase JWT (REST 401). Check Authentication → Third-party → Firebase project ID = quickgigs-7b12d. Re-login will not help until that is fixed.'
        });
        try {
          if (typeof global.qgShowSessionModal === 'function') {
            global.qgShowSessionModal({
              title: 'Database auth needs a fix',
              body: 'You are signed into Firebase, but Supabase rejected your token (REST 401). Logging in again will not fix this. In Supabase → Authentication → Third-party, set Firebase project ID to quickgigs-7b12d, then reload.',
              button: 'Reload page',
              onClick: function () { global.location.reload(); }
            });
          }
        } catch (eModal) {}
        return false;
      }
      global.__qgSupabaseFirebaseRejected = false;
      logAuth('probe:ok', { status: res.status });
      return true;
    } catch (err) {
      logAuth('probe:error', err && err.message ? err.message : String(err));
      return false;
    }
  }

  function surfaceAuthFailure(reason, message) {
    logAuth('headers:FAIL_CLOSED', { reason: reason || 'unknown' });
    try {
      if (typeof global.qgShowSessionModal === 'function') {
        global.qgShowSessionModal({
          title: 'Session auth error',
          body: message ||
            'Your Firebase session could not be used with Supabase. Reloading or signing in again may help. If this persists, check Supabase → Authentication → Third-party Firebase.',
          button: 'Reload page',
          onClick: function () { global.location.reload(); }
        });
      }
    } catch (eModal) {}
    var err = new Error(message || 'supabase_firebase_auth_required');
    err.code = 'supabase_firebase_auth_required';
    err.reason = reason || 'unknown';
    return err;
  }

  async function getHeaders(extra, opts) {
    opts = opts || {};
    var headers = { apikey: SUPABASE_ANON_KEY };
    if (!opts.noContentType) headers['Content-Type'] = 'application/json';
    var useFirebaseJwt = global.QG_CONFIG && global.QG_CONFIG.supabaseFirebaseAuth === true;
    var rejected = global.__qgSupabaseFirebaseRejected === true;
    var user = authUser();
    var bearer = null;

    if (useFirebaseJwt && rejected) {
      // Fail closed: never silently drop a signed-in user to anon RLS.
      throw surfaceAuthFailure(
        'firebase_jwt_rejected_by_supabase',
        'Supabase rejected your Firebase token. Requests are blocked until third-party Firebase auth is fixed (project ID quickgigs-7b12d).'
      );
    }

    if (useFirebaseJwt) {
      try {
        var token = await getFirebaseBearer(!!opts.forceRefresh);
        if (token) {
          bearer = token;
        } else if (user) {
          // Signed in but no token — do not fall back to anon.
          throw surfaceAuthFailure(
            'no_firebase_token',
            'Could not get a Firebase ID token for Supabase. Sign in again, then retry.'
          );
        } else {
          // Logged-out public browse may use anon.
          bearer = SUPABASE_ANON_KEY;
          logAuth('headers:anon', { reason: 'logged_out_public' });
        }
      } catch (err) {
        if (err && err.code === 'supabase_firebase_auth_required') throw err;
        logAuth('headers:token_error', err && err.message ? err.message : String(err));
        try {
          var retry = await getFirebaseBearer(true);
          if (retry) {
            bearer = retry;
          } else if (user) {
            throw surfaceAuthFailure(
              'firebase_token_refresh_failed',
              'Could not refresh your Firebase token for Supabase. Sign in again, then retry.'
            );
          } else {
            bearer = SUPABASE_ANON_KEY;
            logAuth('headers:anon', { reason: 'logged_out_after_token_error' });
          }
        } catch (err2) {
          if (err2 && err2.code === 'supabase_firebase_auth_required') throw err2;
          if (user) {
            throw surfaceAuthFailure(
              'firebase_token_refresh_failed',
              'Could not refresh your Firebase token for Supabase. Sign in again, then retry.'
            );
          }
          bearer = SUPABASE_ANON_KEY;
          logAuth('headers:anon', { reason: 'logged_out_after_refresh_failed' });
        }
      }
    } else {
      bearer = SUPABASE_ANON_KEY;
      logAuth('headers:anon', { reason: 'supabaseFirebaseAuth_off' });
    }

    headers.Authorization = 'Bearer ' + bearer;
    if (extra) Object.assign(headers, extra);
    global.SUPABASE_HEADERS = headers;
    global.SB_HEADERS = headers;
    global.HEADERS = headers;
    return headers;
  }

  async function refreshAuth() {
    return await getHeaders(null, { forceRefresh: true });
  }

  var client = {
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    headers: SUPABASE_HEADERS,
    getHeaders: getHeaders,
    refreshAuth: refreshAuth,
    probeFirebaseJwt: probeFirebaseJwt,
    decodeJwtPayload: decodeJwtPayload,
    __qgAuthV2: true
  };

  global.QGSupabase = client;
  global.SUPABASE_URL = SUPABASE_URL;
  global.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
  global.SUPABASE_HEADERS = SUPABASE_HEADERS;
  global.SB_HEADERS = SUPABASE_HEADERS;
  global.HEADERS = SUPABASE_HEADERS;
  global.getSupabaseHeaders = getHeaders;
  global.refreshSupabaseAuth = refreshAuth;
  global.qgProbeSupabaseFirebaseAuth = probeFirebaseJwt;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = client;
  }
})(typeof window !== 'undefined' ? window : globalThis);
