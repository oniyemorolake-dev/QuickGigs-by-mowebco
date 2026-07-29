// ================================================================
// QuickGigs — single shared Supabase REST client
// Load before supabase-db.js (defer). Pages must not re-init.
// ================================================================
(function (global) {
  if (global.QGSupabase && global.QGSupabase.url) return;

  var SUPABASE_URL = 'https://nuyfqsxstsrbloztzgau.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51eWZxc3hzdHNyYmxvenR6Z2F1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NzkyNjUsImV4cCI6MjA5ODU1NTI2NX0.UpagWLifoxHmWu30lNnBO89gNYKIh4KxtYu28DKlSBM';

  var SUPABASE_HEADERS = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
  };

  async function getHeaders(extra, opts) {
    opts = opts || {};
    var headers = { 'apikey': SUPABASE_ANON_KEY };
    if (!opts.noContentType) headers['Content-Type'] = 'application/json';
    var bearer = SUPABASE_ANON_KEY;
    var useFirebaseJwt = global.QG_CONFIG && global.QG_CONFIG.supabaseFirebaseAuth === true;
    if (useFirebaseJwt) {
      try {
        var user = global._currentUser;
        if (user && typeof user.getIdToken === 'function') {
          bearer = await user.getIdToken(false);
        }
      } catch (err) {
        console.warn('Supabase auth: Firebase JWT failed, using anon key', err);
      }
    }
    headers['Authorization'] = 'Bearer ' + bearer;
    if (extra) Object.assign(headers, extra);
    global.SUPABASE_HEADERS = headers;
    global.SB_HEADERS = headers;
    global.HEADERS = headers;
    return headers;
  }

  async function refreshAuth() {
    return await getHeaders();
  }

  var client = {
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    headers: SUPABASE_HEADERS,
    getHeaders: getHeaders,
    refreshAuth: refreshAuth
  };

  global.QGSupabase = client;
  global.SUPABASE_URL = SUPABASE_URL;
  global.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
  global.SUPABASE_HEADERS = SUPABASE_HEADERS;
  global.SB_HEADERS = SUPABASE_HEADERS;
  global.HEADERS = SUPABASE_HEADERS;
  global.getSupabaseHeaders = getHeaders;
  global.refreshSupabaseAuth = refreshAuth;

  // Optional ESM-style export for tooling
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = client;
  }
})(typeof window !== 'undefined' ? window : globalThis);
