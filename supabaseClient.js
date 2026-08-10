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

  async function getHeaders(extra, opts) {
    opts = opts || {};
    var headers = { apikey: SUPABASE_ANON_KEY };
    if (!opts.noContentType) headers['Content-Type'] = 'application/json';
    var bearer = SUPABASE_ANON_KEY;
    var useFirebaseJwt = global.QG_CONFIG && global.QG_CONFIG.supabaseFirebaseAuth === true;
    var rejected = global.__qgSupabaseFirebaseRejected === true;

    if (useFirebaseJwt && !rejected) {
      try {
        var token = await getFirebaseBearer(!!opts.forceRefresh);
        if (token) bearer = token;
        else logAuth('headers:anon', { reason: 'no_firebase_token_yet' });
      } catch (err) {
        logAuth('headers:token_error', err && err.message ? err.message : String(err));
        try {
          var retry = await getFirebaseBearer(true);
          if (retry) bearer = retry;
        } catch (err2) {
          logAuth('headers:refresh_failed', err2 && err2.message ? err2.message : String(err2));
        }
      }
    } else if (rejected) {
      logAuth('headers:anon', { reason: 'firebase_jwt_rejected_by_supabase' });
    } else {
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
