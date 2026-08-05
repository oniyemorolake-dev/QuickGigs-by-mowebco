// ================================================================
// QuickGigs — Supabase Database Utility
// Load after supabaseClient.js (single shared client).
// ================================================================

var SUPABASE_URL = (window.QGSupabase && window.QGSupabase.url) || window.SUPABASE_URL || 'https://nuyfqsxstsrbloztzgau.supabase.co';
var SUPABASE_ANON_KEY = (window.QGSupabase && window.QGSupabase.anonKey) || window.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51eWZxc3hzdHNyYmxvenR6Z2F1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NzkyNjUsImV4cCI6MjA5ODU1NTI2NX0.UpagWLifoxHmWu30lNnBO89gNYKIh4KxtYu28DKlSBM';

var SUPABASE_HEADERS = window.SUPABASE_HEADERS || {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
};

/** Supabase REST auth — prefers shared client from supabaseClient.js. */
async function getSupabaseHeaders(extra, opts) {
  if (window.QGSupabase && typeof window.QGSupabase.getHeaders === 'function') {
    return window.QGSupabase.getHeaders(extra, opts);
  }
  opts = opts || {};
  var headers = { 'apikey': SUPABASE_ANON_KEY };
  if (!opts.noContentType) headers['Content-Type'] = 'application/json';
  var bearer = SUPABASE_ANON_KEY;
  var useFirebaseJwt = window.QG_CONFIG && window.QG_CONFIG.supabaseFirebaseAuth === true;
  if (useFirebaseJwt) {
    try {
      var user = window._currentUser;
      if (user && typeof user.getIdToken === 'function') {
        bearer = await user.getIdToken(false);
      }
    } catch (err) {
      console.warn('Supabase auth: Firebase JWT failed, using anon key', err);
    }
  }
  headers['Authorization'] = 'Bearer ' + bearer;
  if (extra) Object.assign(headers, extra);
  window.SUPABASE_HEADERS = headers;
  window.SB_HEADERS = headers;
  window.HEADERS = headers;
  return headers;
}

async function refreshSupabaseAuth() {
  if (window.QGSupabase && typeof window.QGSupabase.refreshAuth === 'function') {
    return window.QGSupabase.refreshAuth();
  }
  return await getSupabaseHeaders();
}

/** Call a security-sensitive Edge Function with a verified Firebase ID token. */
async function callVerifiedFunction(url, body, firebaseUser) {
  var user = firebaseUser || window._currentUser;
  if (!url) return { success: false, ok: false, error: 'function_not_configured' };
  if (!user || typeof user.getIdToken !== 'function') {
    return { success: false, ok: false, error: 'firebase_auth_required' };
  }
  try {
    var token = await user.getIdToken(false);
    var res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify(body || {})
    });
    var data = await res.json().catch(function () { return {}; });
    data.http_status = res.status;
    if (!res.ok) {
      return Object.assign({
        success: false,
        ok: false,
        http_status: res.status,
        error: data.error || ('http_' + res.status)
      }, data);
    }
    if (data.success == null) data.success = data.ok !== false;
    return data;
  } catch (err) {
    return { success: false, ok: false, http_status: 0, error: err && err.message ? err.message : String(err) };
  }
}

/** Explicit column lists — only fields the UI actually renders / needs. Never select=*. */
var SELECT_TASKS_BROWSE = 'task_id,title,budget,location,lat,lng,task_mode,status,created_at,category,description,posted_by,poster_name,age_preference,budget_negotiable,photo_urls,scheduled_label,requires_photos,rate_type,is_recurring,hourly_rate,frequency,est_hours';
/** Detail includes precise_address for post-accept reveal — public cards use BROWSE (no precise_address). */
var SELECT_TASKS_DETAIL = SELECT_TASKS_BROWSE + ',scheduled_at,precise_address,worker_completed_at,poster_confirmed_at,evidence_frozen';
/** Dashboard first paint — no description/photos/geo (smaller cellular payload). */
var SELECT_TASKS_DASH = 'task_id,title,budget,location,task_mode,status,created_at,category,posted_by,age_preference,budget_negotiable';
var SELECT_APPLICATIONS = 'app_id,task_id,worker_id,worker_name,message,price,status,guardian_status,guardian_reviewed_at,guardian_distance_km,created_at,counter_price,counter_by,counter_round,last_counter_at';
var SELECT_MESSAGES = 'message_id,conv_id,sender_id,body,created_at';
/** Core conversation columns — always available after messaging.sql. */
var SELECT_CONVERSATIONS_CORE =
  'conv_id,task_id,poster_id,worker_id,poster_name,worker_name,task_title,task_category,status,is_unlocked,last_message,last_message_at,last_sender_id,created_at';
/** Full select — last_read cols added later for receipts; fall back to CORE if missing. */
var SELECT_CONVERSATIONS = SELECT_CONVERSATIONS_CORE + ',poster_last_read_at,worker_last_read_at';
var SELECT_PAYMENTS = 'payment_id,task_id,poster_id,worker_id,amount,platform_fee,worker_payout,status,stripe_id,transfer_id,created_at,completed_at';
var SELECT_REVIEWS = 'review_id,task_id,reviewer_id,reviewee_id,rating,review_comment,reviewer_name,task_title,tags,created_at';
/**
 * Public user card/list — NEVER email/phone.
 * Do NOT select is_verified here — optional column; missing it 400s the whole users GET.
 * Rating is not a users column (computed from reviews).
 */
var SELECT_USERS_PUBLIC_CARD = 'user_id,firebase_uid,name,avatar_url,is_tasker,is_poster,tasker_verified,poster_verified';
/**
 * Public profile / worker discovery — rendered fields only, still NEVER email/phone.
 */
var SELECT_USERS_PUBLIC = SELECT_USERS_PUBLIC_CARD + ',role,status,bio,skills,availability,service_area,languages,pronouns,account_status,created_at';
/**
 * Own profile — completion meter columns + common settings.
 * Keep this list conservative: a missing optional column must not blank the profile (0%).
 * Completion reads: name, email, avatar_url, bio, skills, pronouns, email_verified.
 */
var SELECT_USERS_SELF_CORE =
  'user_id,firebase_uid,name,email,avatar_url,bio,skills,pronouns,email_verified,email_verified_at,role,status,phone,phone_e164,phone_verified,phone_verified_at,created_at,account_status,' +
  'is_tasker,is_poster,last_active_mode,roles_updated_at,' +
  'tasker_verified,tasker_verified_at,tasker_verification_status,tasker_background_check_status,tasker_id_check_status,tasker_id_check_required,' +
  'poster_verified,poster_verified_at,poster_verification_status';
var SELECT_USERS_SELF =
  SELECT_USERS_SELF_CORE +
  ',availability,service_area,languages,gender,date_of_birth,identity_collected_at,' +
  'guardian_name,guardian_email,guardian_phone,guardian_consent_status,guardian_consent_at,guardian_consent_token,' +
  'stripe_connect_id,stripe_payouts_enabled,graduated_at,payout_owner,is_subscriber,' +
  'notify_new_gigs,notify_new_gigs_email,alert_radius_km,alert_categories,alert_lat,alert_lng,alert_location';
/** Parent-consent page — no email/phone of the teen exposed beyond name + consent state. */
var SELECT_USERS_GUARDIAN = 'user_id,firebase_uid,name,guardian_consent_status,guardian_consent_at,account_status';
var SELECT_USERS_NAME = 'firebase_uid,name';
var SELECT_USERS_AVATAR = 'firebase_uid,avatar_url';
/** Login gate only — ban + onboarding check before redirect (minimal columns). */
var SELECT_USERS_LOGIN_GATE = 'firebase_uid,status,date_of_birth,role,is_tasker,is_poster,last_active_mode,account_status,guardian_consent_status,guardian_email,guardian_consent_token,graduated_at,payout_owner,stripe_payouts_enabled,tasker_verified,tasker_verification_status,poster_verified,poster_verification_status';
/** @deprecated use SELECT_USERS_PUBLIC / SELECT_USERS_SELF */
var SELECT_USERS_LIST = SELECT_USERS_PUBLIC;
var BROWSE_PAGE_SIZE = 20;
var DASHBOARD_PAGE_SIZE = 20;

function currentActorId(opts) {
  opts = opts || {};
  if (opts.actorId) return String(opts.actorId);
  if (typeof getCurrentUserId === 'function') {
    var id = getCurrentUserId();
    if (id) return id;
  }
  var u = typeof getCurrentUser === 'function' ? getCurrentUser() : window._currentUser;
  if (u && u.uid) return String(u.uid);
  return '';
}

function isSelfUserQuery(firebaseUid, opts) {
  opts = opts || {};
  if (opts.self === true) return true;
  var me = currentActorId(opts);
  return !!(me && firebaseUid && String(me) === String(firebaseUid));
}

function hasSelectParam(filters) {
  return /(^|&)select=/.test(String(filters || ''));
}

function withSelect(filters, selectCols) {
  if (!selectCols || hasSelectParam(filters)) return filters || '';
  var base = filters ? String(filters) : '';
  return (base ? base + '&' : '') + 'select=' + selectCols;
}

var TASKS_CACHE_KEY = 'qg-tasks-cache-v1';
var APPS_CACHE_KEY = 'qg-apps-cache-v1';
var CONVS_CACHE_PREFIX = 'qg-convs-cache-v1-';
var TASKS_CACHE_MS = 60000;
var STALE_CACHE_MS = 1000 * 60 * 60 * 24; // keep up to 24h as offline fallback

function readJsonCache(key, allowStale) {
  try {
    var raw = sessionStorage.getItem(key);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    if (!parsed || !parsed.at) return null;
    var maxAge = allowStale ? STALE_CACHE_MS : TASKS_CACHE_MS;
    if ((Date.now() - parsed.at) > maxAge) return null;
    return parsed.items || null;
  } catch (err) {
    return null;
  }
}

function writeJsonCache(key, items) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), items: items || [] }));
  } catch (err) {}
}

function readTasksCache(allowStale) {
  return readJsonCache(TASKS_CACHE_KEY, allowStale);
}

function writeTasksCache(items) {
  writeJsonCache(TASKS_CACHE_KEY, items);
  // Alias key used by UX cache-first helpers (same payload; does not change fetch queries)
  try {
    sessionStorage.setItem('qg-tasks-cache', JSON.stringify({ at: Date.now(), items: items || [] }));
  } catch (err) {}
}

function readAppsCache(allowStale) {
  return readJsonCache(APPS_CACHE_KEY, allowStale);
}

function writeAppsCache(items) {
  writeJsonCache(APPS_CACHE_KEY, items);
}

function readConversationsCache(userId, allowStale) {
  if (!userId) return null;
  return readJsonCache(CONVS_CACHE_PREFIX + userId, allowStale);
}

function writeConversationsCache(userId, items) {
  if (!userId) return;
  writeJsonCache(CONVS_CACHE_PREFIX + userId, items);
}

function invalidateTasksCache() {
  try { sessionStorage.removeItem(TASKS_CACHE_KEY); } catch (err) {}
}

function invalidateAppsCache() {
  try { sessionStorage.removeItem(APPS_CACHE_KEY); } catch (err) {}
}

function getTaskRowId(row) {
  if (!row) return null;
  return row.task_id != null ? row.task_id : (row.TASK_ID != null ? row.TASK_ID : row.id);
}

function mergeTaskLists(existing, incoming) {
  var map = {};
  (existing || []).forEach(function (t) {
    var id = getTaskRowId(t);
    if (id == null || id === '') return;
    map[String(id)] = t;
  });
  (incoming || []).forEach(function (t) {
    var id = getTaskRowId(t);
    if (id == null || id === '') return;
    var key = String(id);
    map[key] = map[key] ? Object.assign({}, map[key], normalizeTaskRow(t)) : normalizeTaskRow(t);
  });
  return Object.keys(map).map(function (k) { return map[k]; });
}

function mergeApplicationLists(existing, incoming) {
  var map = {};
  function appKey(a) {
    var id = a.app_id || a.APP_ID || a.id;
    if (id != null && id !== '') return 'id:' + String(id);
    return 'pair:' + String(a.task_id || a.TASK_ID) + ':' + String(a.worker_id || a.WORKER_ID);
  }
  (existing || []).forEach(function (a) { map[appKey(a)] = a; });
  (incoming || []).forEach(function (a) {
    var k = appKey(a);
    map[k] = map[k] ? Object.assign({}, map[k], normalizeApplicationRow(a)) : normalizeApplicationRow(a);
  });
  return Object.keys(map).map(function (k) { return map[k]; });
}

function mergeTaskInCache(taskId, patch) {
  var cached = readTasksCache(true);
  if (!cached || !cached.length) return;
  var tid = String(taskId);
  var changed = false;
  var next = cached.map(function (t) {
    if (String(getTaskRowId(t)) !== tid) return t;
    changed = true;
    return Object.assign({}, t, patch);
  });
  if (changed) writeTasksCache(next);
}

function mergeApplicationInCache(appId, taskId, workerId, patch) {
  var cached = readAppsCache(true);
  if (!cached || !cached.length) return;
  var aid = appId != null ? String(appId) : '';
  var changed = false;
  var next = cached.map(function (a) {
    var rowId = String(a.app_id || a.APP_ID || a.id || '');
    var match = (aid && rowId === aid) ||
      (taskId && workerId &&
        String(a.task_id || a.TASK_ID) === String(taskId) &&
        String(a.worker_id || a.WORKER_ID) === String(workerId));
    if (!match) return a;
    changed = true;
    return Object.assign({}, a, patch);
  });
  if (changed) writeAppsCache(next);
}

/**
 * REST GET. opts: { select, range:[from,to], count:true }
 * Prefer Range over limit when paginating.
 * NEVER select=* on users — forced to public/self column lists.
 */
async function sbGetOrThrow(table, filters, order, limit, opts) {
  opts = opts || {};
  var controller = new AbortController();
  var timeoutId = setTimeout(function () { controller.abort(); }, 8000);
  try {
    var qs = [];
    var filterStr = filters || '';
    if (opts.select && !hasSelectParam(filterStr)) {
      filterStr = withSelect(filterStr, opts.select);
    }
    // Guard: users must never use select=* from the client
    if (String(table) === 'users') {
      filterStr = String(filterStr || '').replace(/(^|&)select=\*(?=&|$)/, '$1select=' + SELECT_USERS_PUBLIC);
      if (!hasSelectParam(filterStr)) {
        filterStr = withSelect(filterStr, SELECT_USERS_PUBLIC);
      }
    } else if (!hasSelectParam(filterStr) && !opts.select) {
      // Default explicit selects for common tables (never bare *)
      var defaults = {
        tasks: SELECT_TASKS_DETAIL,
        applications: SELECT_APPLICATIONS,
        conversations: SELECT_CONVERSATIONS,
        messages: SELECT_MESSAGES,
        payments: SELECT_PAYMENTS,
        reviews: SELECT_REVIEWS
      };
      if (defaults[table]) filterStr = withSelect(filterStr, defaults[table]);
    }
    if (filterStr) qs.push(filterStr);
    if (order === undefined) qs.push('order=created_at.desc');
    else if (order) qs.push('order=' + order);
    if (limit && !(opts.range && opts.range.length === 2)) qs.push('limit=' + limit);
    var url = SUPABASE_URL + '/rest/v1/' + table + (qs.length ? '?' + qs.join('&') : '');
    var extra = {};
    if (opts.range && opts.range.length === 2) {
      extra['Range-Unit'] = 'items';
      extra.Range = String(opts.range[0]) + '-' + String(opts.range[1]);
    }
    if (opts.count) {
      extra.Prefer = 'count=exact';
    }
    var headers = await getSupabaseHeaders(extra);
    var res = await fetch(url, { method: 'GET', headers: headers, signal: controller.signal });
    if (!res.ok) {
      var errText = await res.text();
      throw new Error('GET ' + table + ' failed: ' + res.status + (errText ? ' ' + errText : ''));
    }
    var rows = await res.json();
    if (opts.count) {
      var cr = res.headers.get('content-range') || res.headers.get('Content-Range') || '';
      var m = cr.match(/\/(\d+)\s*$/);
      if (m) rows._totalCount = parseInt(m[1], 10);
    }
    return rows;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function sbGet(table, filters, order, limit, opts) {
  try {
    return await sbGetOrThrow(table, filters, order, limit, opts);
  } catch (err) {
    console.error('Supabase GET error:', err);
    return [];
  }
}

/**
 * Count rows without downloading them.
 * Mirrors supabase-js .select('*', { count: 'exact', head: true }).
 */
async function sbCount(table, filters) {
  try {
    var qs = [];
    var filterStr = filters || '';
    if (!hasSelectParam(filterStr)) {
      filterStr = withSelect(filterStr, 'task_id');
    }
    if (filterStr) qs.push(filterStr);
    var url = SUPABASE_URL + '/rest/v1/' + table + (qs.length ? '?' + qs.join('&') : '');
    var headers = await getSupabaseHeaders({ Prefer: 'count=exact' });
    var res = await fetch(url, { method: 'HEAD', headers: headers });
    if (!res.ok) {
      // Fallback: Range 0-0 GET (still no meaningful row payload needed)
      headers = await getSupabaseHeaders({
        Prefer: 'count=exact',
        'Range-Unit': 'items',
        Range: '0-0'
      });
      res = await fetch(url, { method: 'GET', headers: headers });
    }
    if (!res.ok) {
      console.warn('sbCount failed:', table, res.status);
      return 0;
    }
    var cr = res.headers.get('content-range') || res.headers.get('Content-Range') || '';
    var m = cr.match(/\/(\d+)\s*$/);
    if (m) return parseInt(m[1], 10);
    return 0;
  } catch (err) {
    console.warn('sbCount error:', err);
    return 0;
  }
}

async function sbGetTasksList(filters, limit, opts) {
  opts = opts || {};
  var selectCols = opts.select || SELECT_TASKS_DETAIL;
  var filterWithSelect = withSelect(filters, selectCols);
  var orders = ['created_at.desc', 'task_id.desc', null];
  var lastErr = null;
  for (var i = 0; i < orders.length; i++) {
    try {
      return await sbGetOrThrow('tasks', filterWithSelect, orders[i], limit || 200, opts);
    } catch (err) {
      lastErr = err;
      var msg = String(err.message || err);
      if (msg.indexOf('created_at') >= 0 || msg.indexOf('42703') >= 0) continue;
      if (!orders[i]) throw err;
    }
  }
  if (lastErr) console.warn('sbGetTasksList failed:', lastErr);
  return [];
}

/** Browse page: status=open, newest first, window of 20. Returns raw page rows (no client filter). */
async function getOpenTasksPage(pageIndex, pageSize) {
  pageIndex = Math.max(0, Number(pageIndex) || 0);
  pageSize = pageSize || BROWSE_PAGE_SIZE;
  var from = pageIndex * pageSize;
  var to = from + pageSize - 1;
  var rows = await sbGetTasksList(
    'status=eq.open',
    null,
    { select: SELECT_TASKS_BROWSE, range: [from, to] }
  );
  // Until supabase/tasks-location.sql is applied, fall back without lat/lng.
  if ((!rows || !rows.length) && SELECT_TASKS_BROWSE.indexOf('lat') >= 0) {
    var legacy = SELECT_TASKS_BROWSE.replace(/,lat,lng/, '');
    rows = await sbGetTasksList(
      'status=eq.open',
      null,
      { select: legacy, range: [from, to] }
    );
  }
  return (rows || []).map(normalizeTaskRow);
}

async function countOpenTasks() {
  return await sbCount('tasks', 'status=eq.open');
}

async function sbPostReturn(table, data) {
  try {
    var headers = await getSupabaseHeaders({ 'Prefer': 'return=representation' });
    var res = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      var err = await res.text();
      throw new Error('POST failed: ' + res.status + ' ' + err);
    }
    var rows = await res.json();
    return { success: true, data: rows[0] || null };
  } catch (err) {
    console.error('Supabase POST error:', err);
    return { success: false, error: err.message };
  }
}

async function sbPost(table, data) {
  try {
    var headers = await getSupabaseHeaders({ 'Prefer': 'return=minimal' });
    var res = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      var err = await res.text();
      throw new Error('POST failed: ' + res.status + ' ' + err);
    }
    return { success: true };
  } catch (err) {
    console.error('Supabase POST error:', err);
    return { success: false, error: err.message };
  }
}

async function sbDelete(table, filters) {
  try {
    var url = SUPABASE_URL + '/rest/v1/' + table + '?' + filters;
    var headers = await getSupabaseHeaders();
    var res = await fetch(url, { method: 'DELETE', headers: headers });
    if (!res.ok) {
      var errText = await res.text();
      throw new Error('DELETE failed: ' + res.status + (errText ? ' ' + errText : ''));
    }
    return { success: true };
  } catch (err) {
    console.error('Supabase DELETE error:', err);
    return { success: false, error: err.message };
  }
}

async function sbUpdate(table, data, filters) {
  try {
    var url = SUPABASE_URL + '/rest/v1/' + table + '?' + filters;
    var headers = await getSupabaseHeaders({ 'Prefer': 'return=representation' });
    var res = await fetch(url, {
      method: 'PATCH',
      headers: headers,
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      var errText = await res.text();
      throw new Error('PATCH failed: ' + res.status + (errText ? ' ' + errText : ''));
    }
    var rows = [];
    var bodyText = '';
    try {
      bodyText = await res.text();
      if (bodyText) rows = JSON.parse(bodyText);
    } catch (parseErr) {
      rows = [];
    }
    if (Array.isArray(rows) && rows.length) {
      return { success: true, data: rows };
    }
    if (res.ok) {
      return { success: false, error: 'No matching row updated', notFound: true, minimal: true };
    }
    return { success: false, error: 'No matching row updated', notFound: true };
  } catch (err) {
    console.error('Supabase PATCH error:', err);
    return { success: false, error: err.message };
  }
}

async function tryPatchRow(table, patch, filters, verifyFn) {
  var result = await sbUpdate(table, patch, filters);
  if (result.success) {
    if (result.minimal && typeof verifyFn === 'function') {
      if (await verifyFn()) return result;
      return { success: true, unverified: true };
    }
    return result;
  }
  try {
    var url = SUPABASE_URL + '/rest/v1/' + table + '?' + filters;
    var headers = await getSupabaseHeaders({ 'Prefer': 'return=minimal' });
    var res = await fetch(url, {
      method: 'PATCH',
      headers: headers,
      body: JSON.stringify(patch)
    });
    if (res.ok && typeof verifyFn === 'function' && (await verifyFn())) {
      return { success: true };
    }
  } catch (err) {
    console.warn('PATCH verify fallback failed:', err);
  }
  return result;
}

var TASK_EXPIRY_DAYS = 30;
var _expiryRunKey = 'qg-expiry-run';

function isTaskExpiredByAge(row) {
  var created = row.created_at || row.CREATED_AT;
  if (!created) return false;
  var age = Date.now() - new Date(created).getTime();
  return age > TASK_EXPIRY_DAYS * 86400000;
}

function filterBrowseableTasks(rows) {
  return (rows || []).filter(function (row) {
    var st = String(row.status || row.STATUS || 'open').toLowerCase();
    if (st !== 'open') return false;
    if (isTaskExpiredByAge(row)) return false;
    return true;
  });
}

async function expireStaleOpenTasksOnce() {
  if (sessionStorage.getItem(_expiryRunKey)) return;
  sessionStorage.setItem(_expiryRunKey, '1');
  try {
    var cutoff = new Date(Date.now() - TASK_EXPIRY_DAYS * 86400000).toISOString();
    var stale = await sbGet(
      'tasks',
      withSelect('status=eq.open&created_at=lt.' + encodeURIComponent(cutoff), 'task_id,created_at,status'),
      'created_at.asc',
      50
    );
    if (!stale || !stale.length) return;
    for (var i = 0; i < stale.length; i++) {
      var id = stale[i].task_id || stale[i].TASK_ID || stale[i].id;
      if (!id) continue;
      await sbUpdate('tasks', { status: 'expired' }, 'task_id=eq.' + encodeURIComponent(String(id)));
    }
  } catch (e) {
    console.warn('Task expiry sweep skipped:', e);
  }
}

async function getTasks() {
  // Never block browse/My Tasks on the expiry sweep
  try { expireStaleOpenTasksOnce(); } catch (e) {}
  var rows = await getOpenTasksPage(0, BROWSE_PAGE_SIZE);
  return filterBrowseableTasks(rows);
}

async function getAllTasks() {
  return await sbGetTasksList(null, 100, { select: SELECT_TASKS_DETAIL });
}

async function fetchTasksWithCache() {
  var cached = readTasksCache();
  if (cached) {
    fetchAllTasksFresh();
    return cached;
  }
  return await fetchAllTasksFresh();
}

async function fetchAllTasksFresh(opts) {
  opts = opts || {};
  var limit = opts.limit != null ? opts.limit : 200;
  var select = opts.select || SELECT_TASKS_DETAIL;
  var stale = readTasksCache(true);
  try {
    var items = await sbGetTasksList(null, limit, { select: select });
    var list = Array.isArray(items) ? items.map(normalizeTaskRow) : [];
    writeTasksCache(list);
    window._supabaseUsingStaleCache = false;
    return list;
  } catch (err) {
    console.error('fetchAllTasksFresh failed:', err);
    if (stale && stale.length) {
      window._supabaseUsingStaleCache = true;
      window._supabaseLastFetchError = err.message || String(err);
      return stale.map(normalizeTaskRow);
    }
    throw err;
  }
}

/**
 * Dashboard first paint — role-scoped, parallel, paginated (.range 0–19).
 * No select=*. Payments skipped while QG_CONFIG.paymentsEnabled is false.
 * Returns { tasks, apps, payments, myTaskIds, needWorkerPosted }.
 *
 * Poster critical: 1 query (my tasks). Open marketplace + own apps deferred.
 * Worker critical: 2 queries in parallel (open tasks + my apps). Own posted deferred.
 * Poster applicant rows stay deferred (opts.includePosterApps).
 */
async function fetchDashboardBootstrap(userId, role, opts) {
  opts = opts || {};
  userId = String(userId || currentActorId() || '');
  var page = DASHBOARD_PAGE_SIZE;
  var range = [0, page - 1];
  var isWorker = role === 'worker';
  var paymentsOn = !!(window.QG_CONFIG && window.QG_CONFIG.paymentsEnabled);
  if (!userId) {
    return { tasks: [], apps: [], payments: [], myTaskIds: [], needWorkerPosted: false };
  }

  var myTasks = [];
  var openTasks = [];
  var myApps = [];
  var payments = [];

  if (isWorker) {
    var workerWave = [
      sbGet(
        'tasks',
        withSelect('status=eq.open', SELECT_TASKS_DASH),
        'created_at.desc',
        page,
        { range: range }
      ),
      sbGet(
        'applications',
        withSelect('worker_id=eq.' + encodeURIComponent(userId), SELECT_APPLICATIONS),
        'created_at.desc',
        page,
        { range: range }
      )
    ];
    if (paymentsOn && typeof getPaymentsForUser === 'function') {
      workerWave.push(getPaymentsForUser(userId, 'worker', { limit: page }));
    }
    var wFirst = await Promise.all(workerWave);
    openTasks = (wFirst[0] || []).map(normalizeTaskRow);
    myApps = (wFirst[1] || []).map(normalizeApplicationRow);
    if (paymentsOn) payments = Array.isArray(wFirst[2]) ? wFirst[2] : [];
  } else {
    var posterWave = [
      sbGet(
        'tasks',
        withSelect('posted_by=eq.' + encodeURIComponent(userId), SELECT_TASKS_DASH),
        'created_at.desc',
        page,
        { range: range }
      )
    ];
    if (paymentsOn && typeof getPaymentsForUser === 'function') {
      posterWave.push(getPaymentsForUser(userId, 'poster', { limit: page }));
    }
    var pFirst = await Promise.all(posterWave);
    myTasks = (pFirst[0] || []).map(normalizeTaskRow);
    if (paymentsOn) payments = Array.isArray(pFirst[1]) ? pFirst[1] : [];
  }

  var taskIds = [];
  myTasks.forEach(function (t) {
    var id = getTaskRowId(t);
    if (id != null && id !== '') taskIds.push(String(id));
  });

  var posterApps = [];
  if (opts.includePosterApps && taskIds.length) {
    var chunk = taskIds.slice(0, page);
    posterApps = await sbGet(
      'applications',
      withSelect('task_id=in.(' + postgrestInList(chunk) + ')', SELECT_APPLICATIONS),
      'created_at.desc',
      page,
      { range: range }
    );
    posterApps = (posterApps || []).map(normalizeApplicationRow);
  }

  var taskMap = {};
  myTasks.concat(openTasks).forEach(function (t) {
    var id = String(getTaskRowId(t) || '');
    if (id) taskMap[id] = t;
  });
  var appMap = {};
  myApps.concat(posterApps).forEach(function (a) {
    var id = a.app_id || a.APP_ID || a.id;
    var key = id != null && id !== ''
      ? String(id)
      : String(a.task_id || a.TASK_ID) + ':' + String(a.worker_id || a.WORKER_ID);
    appMap[key] = a;
  });

  var tasks = Object.keys(taskMap).map(function (k) { return taskMap[k]; });
  var apps = Object.keys(appMap).map(function (k) { return appMap[k]; });
  try {
    writeTasksCache(tasks);
    writeAppsCache(apps);
  } catch (e) {}
  return {
    tasks: tasks,
    apps: apps,
    payments: payments,
    myTaskIds: taskIds,
    needWorkerPosted: isWorker
  };
}

/** Background: tasks the worker themselves posted (dashboard secondary section). */
async function fetchWorkerPostedTasks(userId) {
  userId = String(userId || '');
  if (!userId) return [];
  var page = DASHBOARD_PAGE_SIZE;
  var rows = await sbGet(
    'tasks',
    withSelect('posted_by=eq.' + encodeURIComponent(userId), SELECT_TASKS_DASH),
    'created_at.desc',
    page,
    { range: [0, page - 1] }
  );
  return (rows || []).map(normalizeTaskRow);
}

/** Second-wave: applications on the current user's posted tasks (poster dashboard). */
async function fetchPosterAppsForTasks(taskIds) {
  var ids = (taskIds || []).map(String).filter(Boolean).slice(0, DASHBOARD_PAGE_SIZE);
  if (!ids.length) return [];
  var rows = await sbGet(
    'applications',
    withSelect('task_id=in.(' + postgrestInList(ids) + ')', SELECT_APPLICATIONS),
    'created_at.desc',
    DASHBOARD_PAGE_SIZE,
    { range: [0, DASHBOARD_PAGE_SIZE - 1] }
  );
  return (rows || []).map(normalizeApplicationRow);
}

function postgrestInList(ids) {
  return (ids || []).map(function (id) {
    return '"' + String(id).replace(/"/g, '') + '"';
  }).join(',');
}

/** Applications where current user is worker OR poster of the task — never the full table. */
async function fetchApplicationsForActor(userId) {
  userId = String(userId || currentActorId() || '');
  if (!userId) return [];
  var appMap = {};
  function addApp(row) {
    if (!row) return;
    row = normalizeApplicationRow(row);
    var id = row.app_id || row.APP_ID || row.id;
    var key = id != null && id !== ''
      ? String(id)
      : String(row.task_id || row.TASK_ID) + ':' + String(row.worker_id || row.WORKER_ID);
    appMap[key] = row;
  }

  var asWorker = [];
  var isCurrentWorker = window._currentUser && String(window._currentUser.uid) === userId;
  var myAppsUrl = window.QG_CONFIG && window.QG_CONFIG.myApplicationsUrl;
  if (isCurrentWorker && myAppsUrl && typeof callVerifiedFunction === 'function') {
    var ownResult = await callVerifiedFunction(myAppsUrl, {});
    asWorker = ownResult && ownResult.success ? (ownResult.data || []) : [];
  } else {
    asWorker = await sbGet(
      'applications',
      withSelect('worker_id=eq.' + encodeURIComponent(userId), SELECT_APPLICATIONS),
      'created_at.desc',
      200
    );
  }
  (asWorker || []).forEach(addApp);

  var myTasks = [];
  try {
    myTasks = await getTasksByUser(userId);
  } catch (e) {
    myTasks = [];
  }
  var taskIds = [];
  (myTasks || []).forEach(function (t) {
    var id = getTaskRowId(t);
    if (id != null && id !== '') taskIds.push(String(id));
  });
  var chunkSize = 40;
  for (var i = 0; i < taskIds.length; i += chunkSize) {
    var chunk = taskIds.slice(i, i + chunkSize);
    if (!chunk.length) continue;
    var asPoster = await sbGet(
      'applications',
      withSelect('task_id=in.(' + postgrestInList(chunk) + ')', SELECT_APPLICATIONS),
      'created_at.desc',
      200
    );
    (asPoster || []).forEach(addApp);
  }

  return Object.keys(appMap).map(function (k) { return appMap[k]; });
}

async function fetchAllApplicationsFresh() {
  var userId = currentActorId();
  var stale = readAppsCache(true);
  try {
    var list = await fetchApplicationsForActor(userId);
    writeAppsCache(list);
    return list;
  } catch (err) {
    console.error('fetchAllApplicationsFresh failed:', err);
    if (stale && stale.length) {
      window._supabaseUsingStaleCache = true;
      window._supabaseLastFetchError = err.message || String(err);
      return stale.map(normalizeApplicationRow);
    }
    return [];
  }
}

function normalizeTaskRow(row) {
  if (!row) return row;
  var id = row.task_id != null ? row.task_id : (row.TASK_ID != null ? row.TASK_ID : row.id);
  if (id != null && id !== '') {
    row.task_id = id;
    row.TASK_ID = id;
  }
  if (row.status == null && row.STATUS != null) row.status = row.STATUS;
  if (row.posted_by == null && row.POSTED_BY != null) row.posted_by = row.POSTED_BY;
  if (row.title == null && row.TITLE != null) row.title = row.TITLE;
  return row;
}

async function getTaskById(taskId, options) {
  options = options || {};
  var filters = buildTaskIdFilters(taskId, null);
  for (var i = 0; i < filters.length; i++) {
    var results = await sbGet('tasks', withSelect(filters[i], SELECT_TASKS_DETAIL));
    if (results && results[0]) return normalizeTaskRow(results[0]);
  }

  if (options.taskRow) return normalizeTaskRow(options.taskRow);

  var apps = typeof getApplicationsByTask === 'function'
    ? await getApplicationsByTask(taskId)
    : [];
  var accepted = (apps || []).find(function (a) {
    return String(a.status || a.STATUS || '').toLowerCase() === 'accepted';
  });
  if (accepted) {
    var appTaskId = accepted.task_id || accepted.TASK_ID;
    if (appTaskId != null && String(appTaskId) !== String(taskId)) {
      var fromApp = await getTaskById(appTaskId, { _depth: 1 });
      if (fromApp) return fromApp;
    }
  }

  if (options.posterId) {
    var posterTasks = await getTasksByUser(options.posterId);
    var inProgress = (posterTasks || []).filter(function (t) {
      return String(t.status || t.STATUS || '').toLowerCase() === 'in_progress';
    });
    for (var p = 0; p < inProgress.length; p++) {
      var tid = getTaskRowId(inProgress[p]);
      if (String(tid) === String(taskId)) return normalizeTaskRow(inProgress[p]);
    }
    if (options.workerId) {
      for (var j = 0; j < inProgress.length; j++) {
        var tApps = typeof getApplicationsByTask === 'function'
          ? await getApplicationsByTask(getTaskRowId(inProgress[j]))
          : [];
        var match = (tApps || []).find(function (a) {
          return String(a.status || a.STATUS || '').toLowerCase() === 'accepted' &&
            String(a.worker_id || a.WORKER_ID || '') === String(options.workerId);
        });
        if (match) return normalizeTaskRow(inProgress[j]);
      }
    }
    if (inProgress.length === 1 && !options._depth) return normalizeTaskRow(inProgress[0]);
  }

  if (options.workerId && !options._depth) {
    var workerApps = typeof getApplicationsByWorker === 'function'
      ? await getApplicationsByWorker(options.workerId)
      : [];
    var workerAccepted = (workerApps || []).filter(function (a) {
      return String(a.status || a.STATUS || '').toLowerCase() === 'accepted';
    });
    for (var w = 0; w < workerAccepted.length; w++) {
      var wTaskId = workerAccepted[w].task_id || workerAccepted[w].TASK_ID;
      if (String(wTaskId) === String(taskId) || workerAccepted.length === 1) {
        var fromWorker = await getTaskById(wTaskId, { _depth: 1 });
        if (fromWorker) return fromWorker;
      }
    }
  }

  if (typeof getPaymentByTask === 'function' && (options.posterId || options.workerId)) {
    var pay = await getPaymentByTask(taskId, options);
    if (pay && pay.task_id != null && String(pay.task_id) !== String(taskId)) {
      var fromPay = await getTaskById(pay.task_id, { _depth: 1 });
      if (fromPay) return fromPay;
    }
  }

  return null;
}

async function resolveTaskContext(taskId, actorId, options) {
  options = options || {};
  taskId = String(taskId || '');
  actorId = String(actorId || '');

  if (options.taskRow) {
    var cachedTask = normalizeTaskRow(options.taskRow);
    var cachedPosterId = String(cachedTask.posted_by || cachedTask.POSTED_BY || options.posterId || '');
    var cachedWorkerId = options.workerId ? String(options.workerId) : '';
    var cachedAccepted = options.acceptedApp ? normalizeApplicationRow(options.acceptedApp) : null;
    if (cachedAccepted) {
      cachedWorkerId = String(cachedAccepted.worker_id || cachedAccepted.WORKER_ID || cachedWorkerId);
    }
    var cachedCanonical = String(getTaskRowId(cachedTask) || taskId);
    var cachedPayment = null;
    if (typeof getPaymentByTask === 'function' && cachedPosterId) {
      try {
        cachedPayment = await getPaymentByTask(taskId, {
          posterId: cachedPosterId,
          workerId: cachedWorkerId,
          actorId: actorId || cachedPosterId,
          actorRole: 'poster'
        });
      } catch (e) { cachedPayment = null; }
    }
    if (cachedPayment) {
      if (cachedPayment.worker_id && !cachedWorkerId) {
        cachedWorkerId = String(cachedPayment.worker_id);
      }
      if (cachedPayment.poster_id && !cachedPosterId) {
        cachedPosterId = String(cachedPayment.poster_id);
      }
      if (cachedPayment.task_id && isUuidLikeId(String(cachedPayment.task_id))) {
        cachedCanonical = String(cachedPayment.task_id);
        var uuidTask = await getTaskById(cachedCanonical, { _depth: 1 });
        if (uuidTask) cachedTask = uuidTask;
      }
    }
    if (options.canonicalTaskId && isUuidLikeId(String(options.canonicalTaskId))) {
      cachedCanonical = String(options.canonicalTaskId);
    }
    var cachedIds = [taskId, cachedCanonical];
    if (cachedAccepted) {
      var atid = cachedAccepted.task_id || cachedAccepted.TASK_ID;
      if (atid != null && cachedIds.indexOf(String(atid)) === -1) cachedIds.push(String(atid));
    }
    if (cachedPayment && cachedPayment.task_id != null) {
      cachedIds.push(String(cachedPayment.task_id));
    }
    return {
      taskId: taskId,
      canonicalTaskId: cachedCanonical,
      task: cachedTask,
      posterId: cachedPosterId,
      workerId: cachedWorkerId,
      accepted: cachedAccepted,
      payment: cachedPayment,
      ids: cachedIds
    };
  }

  var apps = typeof getApplicationsByTask === 'function' ? await getApplicationsByTask(taskId) : [];
  var accepted = (apps || []).find(function (a) {
    return String(a.status || a.STATUS || '').toLowerCase() === 'accepted';
  });
  var workerId = accepted ? String(accepted.worker_id || accepted.WORKER_ID || '') : '';
  var posterId = '';

  if (accepted && actorId) {
    if (String(accepted.worker_id || accepted.WORKER_ID || '') === actorId) {
      workerId = actorId;
    }
  }

  var task = await getTaskById(taskId, { posterId: posterId, workerId: workerId, actorId: actorId });
  if (task) posterId = String(task.posted_by || task.POSTED_BY || '');

  if (!task && posterId) {
    task = await getTaskById(taskId, { posterId: posterId, workerId: workerId });
  }
  if (!task && workerId) {
    task = await getTaskById(taskId, { workerId: workerId });
    if (task) posterId = String(task.posted_by || task.POSTED_BY || posterId);
  }
  if (!task && actorId) {
    task = await getTaskById(taskId, { posterId: actorId, workerId: workerId });
    if (task) posterId = String(task.posted_by || task.POSTED_BY || actorId);
    else {
      task = await getTaskById(taskId, { workerId: actorId });
      if (task) {
        posterId = String(task.posted_by || task.POSTED_BY || '');
        workerId = actorId;
      }
    }
  }

  if (!accepted && actorId) {
    var workerApps = typeof getApplicationsByWorker === 'function'
      ? await getApplicationsByWorker(actorId)
      : [];
    accepted = (workerApps || []).find(function (a) {
      return String(a.status || a.STATUS || '').toLowerCase() === 'accepted' &&
        (String(a.task_id || a.TASK_ID || '') === taskId || !taskId);
    }) || accepted;
    if (accepted) workerId = String(accepted.worker_id || accepted.WORKER_ID || actorId);
  }

  if (!posterId && task) posterId = String(task.posted_by || task.POSTED_BY || '');

  var payment = typeof getPaymentByTask === 'function'
    ? await getPaymentByTask(taskId, { posterId: posterId, workerId: workerId, actorId: actorId })
    : null;
  if (payment) {
    if (!posterId) posterId = String(payment.poster_id || '');
    if (!workerId) workerId = String(payment.worker_id || '');
    if (!task && payment.task_id != null) {
      task = await getTaskById(payment.task_id, { _depth: 1 });
    }
  }

  var canonicalTaskId = task ? String(getTaskRowId(task) || taskId) : taskId;
  if (payment && payment.task_id != null) canonicalTaskId = String(payment.task_id);
  var ids = [];
  function addId(v) {
    if (v == null || v === '') return;
    var s = String(v);
    if (ids.indexOf(s) === -1) ids.push(s);
  }
  addId(taskId);
  addId(canonicalTaskId);
  if (task) addId(getTaskRowId(task));
  if (payment) addId(payment.task_id);
  if (accepted) addId(accepted.task_id || accepted.TASK_ID);

  return {
    taskId: taskId,
    canonicalTaskId: canonicalTaskId,
    task: task,
    posterId: posterId,
    workerId: workerId,
    accepted: accepted,
    payment: payment,
    ids: ids
  };
}

async function completeTaskViaServer(taskId, actorId, options) {
  options = options || {};
  var cfg = window.QG_CONFIG || {};
  var url = cfg.completeTaskUrl ||
    'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/complete-task';
  if (typeof getSupabaseHeaders !== 'function') {
    return { ok: false, success: false, error: 'auth_not_ready' };
  }
  try {
    var headers = await getSupabaseHeaders();
    var body = {
      task_id: String(taskId),
      actor_id: String(actorId || '')
    };
    if (options.posterId) body.poster_id = String(options.posterId);
    if (options.workerId) body.worker_id = String(options.workerId);
    if (options.canonicalTaskId) body.canonical_task_id = String(options.canonicalTaskId);
    var res = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    });
    var data = {};
    try { data = await res.json(); } catch (e) {
      data = { ok: false, success: false, error: 'Invalid response (' + res.status + ')' };
    }
    if (!res.ok && data.ok !== false) data.ok = false;
    if (data.success == null) data.success = !!data.ok;
    if (!data.success) {
      var parts = [data.error || ('HTTP ' + res.status)];
      if (data.details) parts.push(String(data.details));
      data.error = parts.join(' — ');
    }
    return data;
  } catch (err) {
    return { ok: false, success: false, error: err.message || String(err) };
  }
}

async function secureMessagingRequest(action, payload) {
  var url = window.QG_CONFIG && window.QG_CONFIG.secureMessagingUrl;
  if (!url) return { success: false, error: 'secure_messaging_unavailable' };
  return await callVerifiedFunction(
    url,
    Object.assign({ action: action }, payload || {}),
    window._currentUser
  );
}

async function getConversationsForTask(taskId) {
  var result = await secureMessagingRequest('for_task', { task_id: String(taskId || '') });
  return result.success && Array.isArray(result.data) ? result.data : [];
}

async function lockConversationsForTask(taskId) {
  var convs = await getConversationsForTask(taskId);
  if (!convs || !convs.length) return { success: true };
  var results = await Promise.all(convs.map(function(c) {
    return updateConversation(c.conv_id, { is_unlocked: false, status: 'completed' });
  }));
  return { success: results.every(function(r) { return r.success; }) };
}

async function getTasksByUser(userId) {
  userId = String(userId || '');
  if (!userId) return [];
  var rows = await sbGetTasksList(
    'posted_by=eq.' + encodeURIComponent(userId),
    100,
    { select: SELECT_TASKS_DETAIL }
  );
  if (rows && rows.length) return rows;
  // Some rows may have been saved before posted_by normalization — scan open tasks
  try {
    var all = await sbGetTasksList('status=eq.open', 200, { select: SELECT_TASKS_DETAIL });
    return (all || []).filter(function (t) {
      return String(t.posted_by || t.POSTED_BY || '') === userId;
    });
  } catch (e) {
    return rows || [];
  }
}

function taskPostedByUser(task, userId) {
  if (!task || !userId) return false;
  return String(task.posted_by || task.POSTED_BY || '') === String(userId);
}

function withTimeout(promise, ms, fallback) {
  // Must absorb rejections — otherwise Promise.race rejects immediately and
  // the timeout fallback never applies (My Tasks stuck on "Loading…").
  var guarded = Promise.resolve(promise).catch(function (err) {
    console.warn('withTimeout: promise rejected, using fallback', err);
    return fallback;
  });
  return Promise.race([
    guarded,
    new Promise(function (resolve) {
      setTimeout(function () { resolve(fallback); }, ms);
    })
  ]);
}

/** My Tasks — poster listings + worker jobs (bulk fetch, no N+1 loops). */
async function fetchMyTasksBundle(userId) {
  if (!userId) return { tasks: [], applications: [] };
  userId = String(userId);
  var taskMap = {};
  var appMap = {};

  function addTask(row) {
    if (!row) return;
    row = normalizeTaskRow(row);
    var id = getTaskRowId(row);
    if (id == null || id === '') return;
    taskMap[String(id)] = row;
  }

  function addApp(row) {
    if (!row) return;
    row = normalizeApplicationRow(row);
    var id = row.app_id || row.APP_ID || row.id;
    var key = id != null && id !== ''
      ? String(id)
      : String(row.task_id || row.TASK_ID) + ':' + String(row.worker_id || row.WORKER_ID);
    appMap[key] = row;
  }

  var allTasks = [];
  var allApps = [];
  try {
    allTasks = await withTimeout(fetchAllTasksFresh(), 10000, []);
  } catch (e) {
    console.warn('fetchMyTasksBundle tasks fetch failed:', e);
    try {
      allTasks = await getTasksByUser(userId);
    } catch (e2) {
      allTasks = [];
    }
  }
  if (!Array.isArray(allTasks)) allTasks = [];

  (allTasks || []).forEach(function (row) {
    if (taskPostedByUser(row, userId)) addTask(row);
  });

  try {
    allApps = await withTimeout(fetchApplicationsForActor(userId), 8000, []);
  } catch (e) {
    console.warn('fetchMyTasksBundle applications fetch failed:', e);
    try {
      allApps = await getApplicationsByWorker(userId);
    } catch (e2) {
      allApps = [];
    }
  }
  if (!Array.isArray(allApps)) allApps = [];

  var myTaskIds = {};
  Object.keys(taskMap).forEach(function (k) { myTaskIds[k] = true; });

  (allApps || []).forEach(function (a) {
    var wid = String(a.worker_id || a.WORKER_ID || '');
    var tid = String(a.task_id || a.TASK_ID || '');
    if (wid === userId || myTaskIds[tid]) addApp(a);
  });

  var missingIds = [];
  (allApps || []).forEach(function (a) {
    if (String(a.worker_id || a.WORKER_ID || '') !== userId) return;
    var tid = a.task_id || a.TASK_ID;
    if (!tid || taskMap[String(tid)]) return;
    var match = (allTasks || []).find(function (t) {
      return String(getTaskRowId(t)) === String(tid);
    });
    if (match) addTask(match);
    else missingIds.push(String(tid));
  });
  if (missingIds.length && typeof getTaskById === 'function') {
    var unique = {};
    missingIds.forEach(function (id) { unique[id] = true; });
    await Promise.all(Object.keys(unique).map(function (id) {
      return withTimeout(getTaskById(id), 4000, null).then(function (row) {
        if (row) addTask(row);
      });
    }));
  }

  return {
    tasks: Object.keys(taskMap).map(function (k) { return taskMap[k]; }),
    applications: Object.keys(appMap).map(function (k) { return appMap[k]; })
  };
}

var MAX_COUNTER_ROUNDS = 2;

function isTaskBudgetNegotiable(task) {
  if (!task) return false;
  return !!(task.budget_negotiable || task.BUDGET_NEGOTIABLE);
}

function parseNegotiationFields(app) {
  if (!app) return { counterPrice: null, counterBy: null, counterRound: 0 };
  var counterPrice = app.counter_price != null ? app.counter_price : app.COUNTER_PRICE;
  var counterBy = app.counter_by || app.COUNTER_BY || null;
  var counterRound = Number(app.counter_round != null ? app.counter_round : (app.COUNTER_ROUND || 0)) || 0;
  return {
    counterPrice: counterPrice != null && counterPrice !== '' ? Math.round(Number(counterPrice)) : null,
    counterBy: counterBy ? String(counterBy).toLowerCase() : null,
    counterRound: counterRound
  };
}

function hasPendingApplicationCounter(app) {
  var neg = parseNegotiationFields(app);
  return neg.counterPrice != null && !!neg.counterBy;
}

function getEffectiveApplicationPrice(app) {
  if (!app) return 0;
  return Math.round(Number(app.price != null ? app.price : (app.PRICE || 0)) || 0);
}

async function postTask(taskData) {
  var rateType = String(taskData.rate_type || 'fixed').toLowerCase() === 'hourly' ? 'hourly' : 'fixed';
  var isRecurring = !!(taskData.is_recurring === true || taskData.is_recurring === 1 ||
    String(taskData.task_mode || '').toLowerCase() === 'recurring');
  var frequency = null;
  if (isRecurring) {
    var f = String(taskData.frequency || 'weekly').toLowerCase();
    frequency = (f === 'biweekly' || f === 'monthly') ? f : 'weekly';
  }
  var hourlyRate = rateType === 'hourly' ? Number(taskData.hourly_rate) : null;
  var estHours = rateType === 'hourly' ? Number(taskData.est_hours) : null;
  var budgetNum = Number(taskData.budget) || 0;
  if (rateType === 'hourly' && hourlyRate > 0 && estHours > 0) {
    budgetNum = typeof periodTotal === 'function'
      ? periodTotal(hourlyRate, estHours)
      : Math.round(hourlyRate * estHours * 100) / 100;
  }

  var row = {
    title:       taskData.title,
    description: taskData.description || '',
    category:    String(taskData.category || 'other').toLowerCase(),
    task_mode:   taskData.task_mode,
    budget:      Math.round(budgetNum),
    location:    taskData.location || 'Calgary, AB',
    status:      String(taskData.status || 'open').toLowerCase() === 'draft' ? 'draft' : 'open',
    posted_by:   taskData.posted_by
  };

  var extras = {};
  if (taskData.poster_name) extras.poster_name = taskData.poster_name;
  if (taskData.scheduled_at) extras.scheduled_at = taskData.scheduled_at;
  if (taskData.scheduled_label) extras.scheduled_label = taskData.scheduled_label;
  if (taskData.photo_urls) extras.photo_urls = taskData.photo_urls;
  if (taskData.requires_photos) extras.requires_photos = true;
  if (taskData.budget_negotiable) extras.budget_negotiable = true;
  extras.age_preference = ['teens_welcome', 'any_with_guardian'].indexOf(String(taskData.age_preference)) >= 0
    ? String(taskData.age_preference)
    : 'adults_only';
  // Durable rate / recurring model (columns from tasks-rate-recurring.sql)
  extras.rate_type = rateType;
  extras.is_recurring = isRecurring;
  if (frequency) extras.frequency = frequency;
  if (rateType === 'hourly' && hourlyRate > 0) extras.hourly_rate = hourlyRate;
  if (rateType === 'hourly' && estHours > 0) extras.est_hours = estHours;
  // Approximate coords for distance filter (rounded). Never store the poster's live GPS stream.
  var latNum = taskData.lat != null ? Number(taskData.lat) : NaN;
  var lngNum = taskData.lng != null ? Number(taskData.lng) : NaN;
  if (isFinite(latNum) && isFinite(lngNum)) {
    extras.lat = typeof roundCoord === 'function' ? roundCoord(latNum, 2) : Math.round(latNum * 100) / 100;
    extras.lng = typeof roundCoord === 'function' ? roundCoord(lngNum, 2) : Math.round(lngNum * 100) / 100;
  }
  // Optional precise address — reveal only after accept/escrow (client + future RLS).
  // SERVER-TODO: restrict SELECT of precise_address to poster + accepted worker via RLS.
  if (taskData.precise_address) {
    extras.precise_address = String(taskData.precise_address).trim().slice(0, 200);
  }
  // FUTURE: per-period Stripe charging (subscriptions / scheduled invoices) after accept —
  // display + data model only; do not process real charges here while Stripe is disconnected.

  var withoutPhotos = Object.assign({}, row, extras);
  delete withoutPhotos.photo_urls;
  delete withoutPhotos.requires_photos;

  var withoutCoords = Object.assign({}, row, extras);
  delete withoutCoords.lat;
  delete withoutCoords.lng;
  delete withoutCoords.precise_address;

  var withSchedule = Object.assign({}, row);
  if (taskData.poster_name) withSchedule.poster_name = taskData.poster_name;
  if (taskData.scheduled_at) withSchedule.scheduled_at = taskData.scheduled_at;
  if (taskData.scheduled_label) withSchedule.scheduled_label = taskData.scheduled_label;

  var withPoster = Object.assign({}, row);
  if (taskData.poster_name) withPoster.poster_name = taskData.poster_name;

  var attempts = [
    Object.assign({}, row, extras),
    withoutPhotos,
    withoutCoords,
    withSchedule,
    withPoster,
    row
  ];
  var securePostUrl = window.QG_CONFIG && window.QG_CONFIG.postTaskUrl;
  if (securePostUrl) {
    var secureResult = await callVerifiedFunction(securePostUrl, { task: attempts[0] });
    if (secureResult.success) {
      if (secureResult.data) {
        var secureRow = normalizeTaskRow(secureResult.data);
        var secureCache = readTasksCache(true) || [];
        var secureRowId = getTaskRowId(secureRow);
        secureCache = secureCache.filter(function (t) {
          return String(getTaskRowId(t)) !== String(secureRowId);
        });
        secureCache.unshift(secureRow);
        writeTasksCache(secureCache);
      } else {
        invalidateTasksCache();
      }
    }
    return secureResult;
  }
  var seen = {};
  var result = { success: false, error: 'Could not save task — refresh and try again' };
  for (var i = 0; i < attempts.length; i++) {
    var key = JSON.stringify(attempts[i]);
    if (seen[key]) continue;
    seen[key] = true;
    result = await sbPostReturn('tasks', attempts[i]);
    if (result.success) {
      if (result.data) {
        var row = normalizeTaskRow(result.data);
        var cached = readTasksCache(true) || [];
        var rowId = getTaskRowId(row);
        cached = cached.filter(function (t) { return String(getTaskRowId(t)) !== String(rowId); });
        cached.unshift(row);
        writeTasksCache(cached);
      } else {
        invalidateTasksCache();
      }
      return result;
    }
  }
  return result;
}

async function repostTask(sourceTaskId, posterId) {
  if (!sourceTaskId || !posterId) return { success: false, error: 'missing_ids' };
  var task = await getTaskById(sourceTaskId);
  if (!task) return { success: false, error: 'not_found' };
  if (String(task.posted_by || task.POSTED_BY || '') !== String(posterId)) {
    return { success: false, error: 'not_owner' };
  }
  var st = String(task.status || task.STATUS || '').toLowerCase();
  if (st !== 'expired') return { success: false, error: 'not_expired' };
  return await postTask({
    title: task.title || task.TITLE,
    description: task.description || task.DESCRIPTION || '',
    category: task.category || task.CATEGORY || 'other',
    task_mode: task.task_mode || task.TASK_MODE || 'standard',
    budget: task.budget || task.BUDGET || 0,
    location: task.location || task.LOCATION || 'Calgary, AB',
    posted_by: posterId,
    poster_name: task.poster_name || task.POSTER_NAME,
    photo_urls: task.photo_urls || task.PHOTO_URLS,
    scheduled_at: task.scheduled_at || task.SCHEDULED_AT,
    scheduled_label: task.scheduled_label || task.SCHEDULED_LABEL,
    requires_photos: !!(task.requires_photos || task.REQUIRES_PHOTOS),
    budget_negotiable: !!(task.budget_negotiable || task.BUDGET_NEGOTIABLE),
    rate_type: task.rate_type || task.RATE_TYPE || 'fixed',
    is_recurring: !!(task.is_recurring || task.IS_RECURRING),
    frequency: task.frequency || task.FREQUENCY || null,
    hourly_rate: task.hourly_rate != null ? task.hourly_rate : task.HOURLY_RATE,
    est_hours: task.est_hours != null ? task.est_hours : task.EST_HOURS,
    lat: task.lat != null ? task.lat : task.LAT,
    lng: task.lng != null ? task.lng : task.LNG,
    precise_address: task.precise_address || task.PRECISE_ADDRESS || null
  });
}

async function uploadTaskPhoto(file, userId) {
  return await uploadStoragePhoto(file, userId, 'task-photos', String(userId));
}

async function uploadProfilePhoto(file, userId) {
  return await uploadStoragePhoto(file, userId, 'profile-photos', String(userId));
}

async function uploadChatPhoto(file, userId, convId) {
  if (!convId) return { success: false, error: 'Missing conversation' };
  return await uploadStoragePhoto(file, userId, 'chat-photos', String(convId) + '/' + String(userId));
}

function formatUploadError(err) {
  var msg = String(err || '');
  try {
    var parsed = JSON.parse(msg);
    if (parsed && parsed.message) msg = String(parsed.message);
    else if (parsed && parsed.error) msg = String(parsed.error);
  } catch (parseErr) {
    var jsonMatch = msg.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        var inner = JSON.parse(jsonMatch[0]);
        if (inner.message) msg = String(inner.message);
      } catch (innerErr) {}
    }
  }
  var lower = msg.toLowerCase();
  if (lower.indexOf('row-level') >= 0 || lower.indexOf('403') >= 0 ||
      lower.indexOf('unauthorized') >= 0 || lower.indexOf('42501') >= 0) {
    return 'Photo upload is blocked in Supabase. Open SQL Editor → run supabase/storage-beta-fix.sql (or beta-setup-all.sql).';
  }
  if (lower.indexOf('bucket') >= 0 || lower.indexOf('not found') >= 0) {
    return 'Photo storage is not set up yet. Run supabase/storage-beta-fix.sql in Supabase SQL Editor.';
  }
  if (msg.length > 120) return 'Photo upload failed. Remove the photo or run supabase/storage-beta-fix.sql in Supabase.';
  return msg || 'Photo upload failed.';
}

async function uploadStoragePhoto(file, userId, bucket, folder) {
  if (!file || !userId) return { success: false, error: 'Missing file or user' };
  var maxMb = (window.QG_CONFIG && window.QG_CONFIG.maxPhotoSizeMb) || 5;
  if (file.size > maxMb * 1024 * 1024) {
    return { success: false, error: 'Photo must be under ' + maxMb + ' MB' };
  }
  if (!file.type || file.type.indexOf('image/') !== 0) {
    return { success: false, error: 'Please choose an image file' };
  }
  // Compress before upload (posttask / profile / chat)
  if (typeof compressImage === 'function') {
    try {
      file = await compressImage(file, 800);
    } catch (compressErr) {
      console.warn('compressImage skipped:', compressErr);
    }
  }
  var ext = (file.type === 'image/webp')
    ? 'webp'
    : ((String(file.name || '').split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg');
  var folderPath = String(folder).split('/').map(function(part) {
    return encodeURIComponent(part);
  }).join('/');
  var path = folderPath + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
  try {
    var headers = await getSupabaseHeaders(null, { noContentType: true });
    headers['Content-Type'] = file.type || 'image/jpeg';
    headers['x-upsert'] = 'false';
    var res = await fetch(SUPABASE_URL + '/storage/v1/object/' + bucket + '/' + path, {
      method: 'POST',
      headers: headers,
      body: file
    });
    if (!res.ok) {
      var errText = await res.text();
      throw new Error(errText || ('Upload failed: ' + res.status));
    }
    return {
      success: true,
      url: SUPABASE_URL + '/storage/v1/object/public/' + bucket + '/' + path
    };
  } catch (err) {
    console.error('Photo upload error:', err);
    return { success: false, error: formatUploadError(err.message) };
  }
}

var CHAT_IMAGE_PREFIX = '[img]';

function isChatImageBody(body) {
  return String(body || '').indexOf(CHAT_IMAGE_PREFIX) === 0;
}

function parseChatImageUrl(body) {
  if (!isChatImageBody(body)) return null;
  var url = String(body).slice(CHAT_IMAGE_PREFIX.length).trim();
  // Never return javascript:/data: — only allowlisted storage HTTPS URLs
  if (!isAllowedChatImageUrl(url)) return null;
  return url;
}

function isAllowedChatImageUrl(url) {
  if (!url) return false;
  var u = String(url).trim();
  if (typeof safeUrl === 'function') {
    u = safeUrl(u);
    if (!u) return false;
  } else if (!/^https:\/\//i.test(u)) {
    return false;
  }
  var prefix = String(SUPABASE_URL || '').replace(/\/$/, '') + '/storage/v1/object/public/chat-photos/';
  return u.indexOf(prefix) === 0;
}

function parsePhotoUrls(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return String(raw).split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  }
}

function buildTaskIdFilters(taskId, taskRow) {
  var ids = [];
  function addId(v) {
    if (v == null || v === '') return;
    var s = String(v);
    // tasks.task_id is UUID — never PATCH with bare integers like "668"
    if (/^\d+$/.test(s) && !/^[0-9a-f]{8}-/i.test(s)) return;
    if (ids.indexOf(s) === -1) ids.push(s);
  }
  addId(taskId);
  if (taskRow) {
    addId(taskRow.task_id);
    addId(taskRow.TASK_ID);
  }
  var filters = [];
  var seen = {};
  ids.forEach(function (raw) {
    var enc = encodeURIComponent(raw);
    var f = 'task_id=eq.' + enc;
    if (!seen[f]) { seen[f] = true; filters.push(f); }
  });
  return filters;
}

function buildTaskIdOrFilter(taskId, taskRow) {
  var singles = buildTaskIdFilters(taskId, taskRow);
  var parts = [];
  var seen = {};
  singles.forEach(function (f) {
    var m = f.match(/^task_id=eq\.(.+)$/);
    if (!m) return;
    var piece = 'task_id.eq.' + m[1];
    if (!seen[piece]) { seen[piece] = true; parts.push(piece); }
  });
  if (!parts.length) return null;
  return 'or=(' + parts.join(',') + ')';
}

async function updateTaskStatus(taskId, status, options) {
  options = options || {};
  var statusVal = String(status || '').toLowerCase();
  var patch = { status: statusVal };
  var task = options.taskRow || await getTaskById(taskId, options);
  var filters = buildTaskIdFilters(taskId, task);
  if (task) {
    var canonical = getTaskRowId(task);
    if (canonical != null) {
      var cf = 'task_id=eq.' + encodeURIComponent(String(canonical));
      if (filters.indexOf(cf) === -1) filters.unshift(cf);
    }
  }
  var orFilter = buildTaskIdOrFilter(taskId, task);
  if (orFilter && filters.indexOf(orFilter) === -1) filters.unshift(orFilter);
  if (options.posterId && statusVal === 'completed') {
    var byPoster = 'posted_by=eq.' + encodeURIComponent(String(options.posterId)) +
      '&status=eq.in_progress';
    if (filters.indexOf(byPoster) === -1) filters.push(byPoster);
  }
  var result = { success: false, error: 'Could not update task — refresh and try again' };
  for (var i = 0; i < filters.length; i++) {
    result = await tryPatchRow('tasks', patch, filters[i], async function () {
      var fresh = await getTaskById(taskId, options);
      if (fresh && String(fresh.status || fresh.STATUS || '').toLowerCase() === statusVal) return true;
      if (options.posterId) {
        var posted = await sbGet(
          'tasks',
          'posted_by=eq.' + encodeURIComponent(String(options.posterId)) + '&status=eq.' + statusVal,
          'created_at.desc',
          5
        );
        return !!(posted && posted.length);
      }
      return false;
    });
    if (result.success) break;
  }
  if (!result.success && task) {
    var current = String(task.status || task.STATUS || '').toLowerCase();
    if (current === statusVal) result = { success: true };
  }
  if (!result.success) {
    var fresh = await getTaskById(taskId, options);
    if (fresh && String(fresh.status || fresh.STATUS || '').toLowerCase() === statusVal) {
      result = { success: true };
    }
  }
  if (result.success) {
    mergeTaskInCache(taskId, patch);
  }
  return result;
}

async function getUsers() {
  return await sbGet('users', withSelect(null, SELECT_USERS_PUBLIC), null, 500);
}

async function saveUser(userData) {
  return await upsertUserProfile(userData);
}

function getUserRowId(row) {
  if (!row) return null;
  return row.user_id || row.id || row.USER_ID || null;
}

function isGenericDisplayName(name) {
  if (!name) return true;
  var n = String(name).trim().toLowerCase();
  return !n || n === 'quickgigs user' || n === 'worker' || n === 'poster' || n === 'user' || n === 'tasker';
}

function normalizeAlertCategories(raw) {
  var ids = [];
  var seen = {};
  var list = Array.isArray(raw) ? raw : (typeof raw === 'string' && raw ? [raw] : []);
  list.forEach(function (item) {
    var id = String(item || '').toLowerCase().trim();
    if (!id || seen[id]) return;
    seen[id] = true;
    ids.push(id);
  });
  return ids;
}

async function upsertUserProfile(userData, opts) {
  opts = opts || {};
  var row = {
    name:         userData.name || '',
    email:        userData.email || '',
    phone:        userData.phone || '',
    role:         userData.role  || 'poster',
    firebase_uid: userData.firebase_uid || ''
  };
  if (userData.avatar_url) row.avatar_url = userData.avatar_url;
  if (userData.bio !== undefined) row.bio = String(userData.bio || '').trim();
  if (userData.skills !== undefined) row.skills = serializeUserSkills(userData.skills);
    if (userData.availability !== undefined) row.availability = userData.availability;
  if (userData.service_area !== undefined) row.service_area = String(userData.service_area || '').trim();
  if (userData.languages !== undefined) row.languages = String(userData.languages || '').trim();
  if (userData.notify_new_gigs !== undefined) row.notify_new_gigs = !!userData.notify_new_gigs;
  if (userData.notify_new_gigs_email !== undefined) row.notify_new_gigs_email = !!userData.notify_new_gigs_email;
  if (userData.alert_radius_km !== undefined) {
    var rKm = parseInt(userData.alert_radius_km, 10);
    row.alert_radius_km = [20, 50, 100].indexOf(rKm) >= 0 ? rKm : 50;
  }
  if (userData.alert_categories !== undefined) {
    row.alert_categories = normalizeAlertCategories(userData.alert_categories);
  }
  if (userData.alert_lat !== undefined) row.alert_lat = userData.alert_lat;
  if (userData.alert_lng !== undefined) row.alert_lng = userData.alert_lng;
  if (userData.alert_location !== undefined) row.alert_location = String(userData.alert_location || '').trim().slice(0, 120);
  if (userData.pronouns !== undefined) row.pronouns = String(userData.pronouns || '').trim();
  if (userData.gender !== undefined) row.gender = String(userData.gender || '').trim();
  if (userData.date_of_birth) row.date_of_birth = userData.date_of_birth;
  if (userData.identity_collected_at) row.identity_collected_at = userData.identity_collected_at;
  if (userData.guardian_name !== undefined) row.guardian_name = String(userData.guardian_name || '').trim();
  if (userData.guardian_email !== undefined) row.guardian_email = String(userData.guardian_email || '').trim();
  if (userData.guardian_phone !== undefined) row.guardian_phone = String(userData.guardian_phone || '').trim();
  if (userData.guardian_consent_status) row.guardian_consent_status = userData.guardian_consent_status;
  if (userData.guardian_consent_at) row.guardian_consent_at = userData.guardian_consent_at;
  if (userData.guardian_consent_token) row.guardian_consent_token = userData.guardian_consent_token;
  if (userData.account_status) row.account_status = userData.account_status;
  if (!row.email && !row.firebase_uid) {
    return { success: false, error: 'Missing email or firebase_uid' };
  }

  var existing = (opts && opts.existing) || null;
  if (!existing && row.firebase_uid) {
    existing = await getUserByFirebaseUid(row.firebase_uid, { fresh: true, self: true });
  }
  if (!existing && row.email) {
    var meEmail = (window._currentUser && window._currentUser.email) || '';
    if (meEmail && String(meEmail).toLowerCase() === String(row.email).toLowerCase()) {
      var byEmail = await sbGet(
        'users',
        withSelect('email=eq.' + encodeURIComponent(row.email), SELECT_USERS_SELF)
      );
      existing = byEmail && byEmail[0] ? byEmail[0] : null;
      // Never claim another account's row (different firebase_uid already set).
      if (existing && existing.firebase_uid && row.firebase_uid &&
          String(existing.firebase_uid) !== String(row.firebase_uid)) {
        existing = null;
      }
    }
  }

  if (existing) {
    var id = getUserRowId(existing);
    var patch = {};
    if (row.name) patch.name = row.name;
    if (row.phone) patch.phone = row.phone;
    // NEVER patch role on existing rows — workspace mode (poster/worker) is
    // local UI state (qg-mode / qg-role). Overwriting role wiped 'admin'.
    // Role is only set on INSERT (first-time signup) below.
    // Only attach firebase_uid when linking a legacy row (empty uid) or same uid.
    if (row.firebase_uid && (!existing.firebase_uid || String(existing.firebase_uid) === String(row.firebase_uid))) {
      patch.firebase_uid = row.firebase_uid;
    }
    if (userData.avatar_url) patch.avatar_url = userData.avatar_url;
    if (userData.bio !== undefined) patch.bio = String(userData.bio || '').trim();
    if (userData.skills !== undefined) patch.skills = serializeUserSkills(userData.skills);
    if (userData.availability !== undefined) patch.availability = userData.availability;
    if (userData.service_area !== undefined) patch.service_area = String(userData.service_area || '').trim();
    if (userData.languages !== undefined) patch.languages = String(userData.languages || '').trim();
    if (userData.notify_new_gigs !== undefined) patch.notify_new_gigs = !!userData.notify_new_gigs;
    if (userData.notify_new_gigs_email !== undefined) patch.notify_new_gigs_email = !!userData.notify_new_gigs_email;
    if (userData.alert_radius_km !== undefined) {
      var patchKm = parseInt(userData.alert_radius_km, 10);
      patch.alert_radius_km = [20, 50, 100].indexOf(patchKm) >= 0 ? patchKm : 50;
    }
    if (userData.alert_categories !== undefined) {
      patch.alert_categories = normalizeAlertCategories(userData.alert_categories);
    }
    if (userData.alert_lat !== undefined) patch.alert_lat = userData.alert_lat;
    if (userData.alert_lng !== undefined) patch.alert_lng = userData.alert_lng;
    if (userData.alert_location !== undefined) {
      patch.alert_location = String(userData.alert_location || '').trim().slice(0, 120);
    }
    if (userData.pronouns !== undefined) patch.pronouns = String(userData.pronouns || '').trim();
    if (userData.gender !== undefined) patch.gender = String(userData.gender || '').trim();
    if (userData.date_of_birth) patch.date_of_birth = userData.date_of_birth;
    if (userData.identity_collected_at) patch.identity_collected_at = userData.identity_collected_at;
    if (userData.guardian_name !== undefined) patch.guardian_name = String(userData.guardian_name || '').trim();
    if (userData.guardian_email !== undefined) patch.guardian_email = String(userData.guardian_email || '').trim();
    if (userData.guardian_phone !== undefined) patch.guardian_phone = String(userData.guardian_phone || '').trim();
    if (userData.guardian_consent_status) patch.guardian_consent_status = userData.guardian_consent_status;
    if (userData.guardian_consent_at) patch.guardian_consent_at = userData.guardian_consent_at;
    if (userData.guardian_consent_token) patch.guardian_consent_token = userData.guardian_consent_token;
    if (userData.account_status) patch.account_status = userData.account_status;
    // Identity-safe filters only — never PATCH by email alone (could overwrite another uid).
    var filters = [];
    if (id != null) {
      filters.push('user_id=eq.' + encodeURIComponent(String(id)));
    }
    if (existing.firebase_uid) {
      filters.push('firebase_uid=eq.' + encodeURIComponent(String(existing.firebase_uid)));
    } else if (row.firebase_uid) {
      filters.push('firebase_uid=eq.' + encodeURIComponent(String(row.firebase_uid)));
    }
    var result = { success: false, error: 'Could not update user' };
    for (var i = 0; i < filters.length; i++) {
      result = await sbUpdate('users', patch, filters[i]);
      if (result.success) break;
    }
    if (result.success) {
      invalidateUserProfileCache(row.firebase_uid || existing.firebase_uid);
      return { success: true, user: Object.assign({}, existing, patch) };
    }
    return result;
  }

  var created = await sbPost('users', row);
  if (created && created.success) invalidateUserProfileCache(row.firebase_uid);
  return created;
}

async function syncCurrentUserProfile(firebaseUser, opts) {
  if (!firebaseUser) return { success: false };
  opts = opts || {};
  var name = firebaseUser.displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : '');
  if (typeof formatPersonName === 'function' && name) name = formatPersonName(name);
  var payload = {
    name: name,
    email: firebaseUser.email || '',
    firebase_uid: firebaseUser.uid
  };
  var localAvatar = readLocalProfileAvatar(firebaseUser.uid);
  if (hasProfilePhotoUrl(localAvatar)) payload.avatar_url = localAvatar;
  var localExtras = readLocalProfileExtras(firebaseUser.uid);
  var existing = opts.existing || await getUserByFirebaseUid(firebaseUser.uid, { self: true });
  if (localExtras.bio && !(existing && existing.bio && String(existing.bio).trim())) {
    payload.bio = localExtras.bio;
  }
  if (localExtras.skills.length && !parseUserSkills(existing || {}).length) {
    payload.skills = localExtras.skills;
  }
  // Role only on genuine first insert — never map qg-mode onto existing users.
  if (!existing) {
    var mode = localStorage.getItem('qg-role') || localStorage.getItem('qg-session-mode') || 'poster';
    payload.role = mode === 'worker' ? 'worker' : 'poster';
  }
  var result = await upsertUserProfile(payload, { existing: existing });
  if (result && result.user) return result;
  if (result && result.success) return { success: true, user: existing || null };
  return result;
}

/** One-shot login gate: status + routing fields. Lookup is ALWAYS by firebase_uid. */
async function getUserLoginGate(firebaseUid) {
  if (!firebaseUid) return null;
  var filter = 'firebase_uid=eq.' + encodeURIComponent(String(firebaseUid));
  try {
    var rows = await sbGetOrThrow(
      'users',
      withSelect(filter, SELECT_USERS_LOGIN_GATE),
      null,
      1
    );
    return (rows && rows[0]) || null;
  } catch (err) {
    // Optional columns (guardian_*, date_of_birth) missing → still detect existing users.
    console.warn('getUserLoginGate full select failed, using minimal:', err && err.message);
    try {
      var minimal = await sbGet(
        'users',
        withSelect(filter, 'firebase_uid,status,role,account_status'),
        null,
        1
      );
      return (minimal && minimal[0]) || null;
    } catch (err2) {
      console.warn('getUserLoginGate failed:', err2);
      return null;
    }
  }
}

function invalidateUserProfileCache(firebaseUid) {
  try {
    if (firebaseUid) {
      var uid = String(firebaseUid);
      sessionStorage.removeItem('qg-cache:user-profile:' + uid);
      sessionStorage.removeItem('qg-cache:user-profile-self:' + uid);
      sessionStorage.removeItem('qg-cache:user-profile-public:' + uid);
    }
    sessionStorage.removeItem('qg-cache:users-name-map');
    sessionStorage.removeItem('qg-cache:users-avatar-map');
    sessionStorage.removeItem('qg-cache:category-open-counts');
  } catch (e) {}
}

async function getUserByFirebaseUid(firebaseUid, opts) {
  if (!firebaseUid) return null;
  opts = opts || {};
  var self = isSelfUserQuery(firebaseUid, opts);
  var cacheKey = (self ? 'user-profile-self:' : 'user-profile-public:') + String(firebaseUid);
  var fetchOne = async function () {
    var filter = 'firebase_uid=eq.' + encodeURIComponent(firebaseUid);
    if (self) {
      // Prefer full self select; fall back to completion-core if optional cols 400
      try {
        var full = await sbGetOrThrow('users', withSelect(filter, SELECT_USERS_SELF), null, 1);
        if (full && full[0]) return full[0];
      } catch (err) {
        console.warn('getUserByFirebaseUid self full select failed, using CORE:', err && err.message);
      }
      var core = await sbGet('users', withSelect(filter, SELECT_USERS_SELF_CORE), null, 1);
      return (core && core[0]) || null;
    }
    var publicRows = await sbGet('users', withSelect(filter, SELECT_USERS_PUBLIC), null, 1);
    return (publicRows && publicRows[0]) || null;
  };
  var user = (opts.fresh || typeof getCached !== 'function')
    ? await fetchOne()
    : await getCached(cacheKey, fetchOne, 300000);
  if (user && self) {
    window._qgCurrentDbUser = user;
    window._qgIsSubscriber = !!(user.is_subscriber === true || user.is_subscriber === 1 || user.IS_SUBSCRIBER === true);
  }
  return user;
}

async function getUserNameByFirebaseUid(firebaseUid) {
  if (!firebaseUid) return '';
  var user = await getUserByFirebaseUid(firebaseUid);
  if (user && user.name && !isGenericDisplayName(user.name)) return user.name;
  if (window._currentUser && window._currentUser.uid === firebaseUid) {
    return window._currentUser.displayName || (window._currentUser.email || '').split('@')[0] || '';
  }
  return '';
}

async function getUsersNameMap() {
  var fetchMap = async function () {
    var users = await sbGet('users', withSelect(null, SELECT_USERS_NAME), null, 500);
    var map = {};
    if (!Array.isArray(users)) return map;
    users.forEach(function (u) {
      if (!u.name || isGenericDisplayName(u.name)) return;
      if (u.firebase_uid) map[String(u.firebase_uid)] = u.name;
    });
    return map;
  };
  if (typeof getCached === 'function') {
    return await getCached('users-name-map', fetchMap, 300000);
  }
  return await fetchMap();
}

function hasProfilePhotoUrl(url) {
  return !!(url && String(url).trim());
}

function readLocalProfileAvatar(firebaseUid) {
  if (!firebaseUid) return '';
  try {
    var raw = localStorage.getItem('qg-profile-' + firebaseUid);
    if (!raw) return '';
    var parsed = JSON.parse(raw);
    return parsed && parsed.avatar_url ? String(parsed.avatar_url).trim() : '';
  } catch (err) {
    return '';
  }
}

function readLocalProfileExtras(firebaseUid) {
  if (!firebaseUid) return { bio: '', skills: [] };
  try {
    var raw = localStorage.getItem('qg-profile-' + firebaseUid);
    if (!raw) return { bio: '', skills: [] };
    var parsed = JSON.parse(raw) || {};
    return {
      bio: parsed.bio ? String(parsed.bio).trim() : '',
      skills: parseUserSkills(parsed)
    };
  } catch (err) {
    return { bio: '', skills: [] };
  }
}

function parseUserSkills(source) {
  if (!source) return [];
  var raw = source.skills != null ? source.skills : source.SKILLS;
  if (Array.isArray(raw)) {
    return raw.map(function (s) { return String(s).trim(); }).filter(Boolean);
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(function (s) { return String(s).trim(); }).filter(Boolean);
      }
    } catch (err) { /* plain text fallback below */ }
    return raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }
  return [];
}

function serializeUserSkills(skills) {
  var list = Array.isArray(skills)
    ? skills.map(function (s) { return String(s).trim(); }).filter(Boolean)
    : [];
  return list.length ? JSON.stringify(list) : '';
}

function applyDbUserToProfileData(dbUser, target, opts) {
  if (!dbUser || !target) return target;
  opts = opts || {};
  var self = opts.self === true || isSelfUserQuery(dbUser.firebase_uid, opts);
  if (dbUser.name) target.name = dbUser.name;
  if (dbUser.avatar_url) target.avatar_url = dbUser.avatar_url;
  if (dbUser.role) target.role = dbUser.role;
  if (dbUser.is_tasker != null) target.is_tasker = dbUser.is_tasker === true;
  if (dbUser.is_poster != null) target.is_poster = dbUser.is_poster === true;
  if (dbUser.bio != null && String(dbUser.bio).trim()) target.bio = String(dbUser.bio).trim();
  var skills = parseUserSkills(dbUser);
  if (skills.length) target.skills = skills;
  if (dbUser.created_at) target.memberSince = dbUser.created_at;
  if (dbUser.availability) target.availability = dbUser.availability;
  if (dbUser.service_area) target.service_area = String(dbUser.service_area).trim();
  if (dbUser.languages) target.languages = String(dbUser.languages).trim();
  if (dbUser.pronouns) target.pronouns = String(dbUser.pronouns).trim();
  if (dbUser.account_status) target.account_status = dbUser.account_status;
  if (self) {
    if (dbUser.email) target.email = dbUser.email;
    if (dbUser.phone) target.phone = dbUser.phone;
    if (dbUser.gender) target.gender = String(dbUser.gender).trim();
    if (dbUser.date_of_birth) target.date_of_birth = dbUser.date_of_birth;
    if (dbUser.identity_collected_at) target.identity_collected_at = dbUser.identity_collected_at;
    if (dbUser.guardian_consent_status) target.guardian_consent_status = dbUser.guardian_consent_status;
    if (dbUser.stripe_connect_id) target.stripe_connect_id = dbUser.stripe_connect_id;
    if (dbUser.stripe_payouts_enabled != null) target.stripe_payouts_enabled = dbUser.stripe_payouts_enabled;
    if (dbUser.graduated_at) target.graduated_at = dbUser.graduated_at;
    if (dbUser.payout_owner) target.payout_owner = dbUser.payout_owner;
    if (dbUser.email_verified === true || dbUser.verified === true) {
      target.email_verified = true;
      target.verified = true;
    }
  }
  return target;
}

async function getUserByGuardianToken(token) {
  if (!token) return null;
  var results = await sbGet(
    'users',
    withSelect('guardian_consent_token=eq.' + encodeURIComponent(token), SELECT_USERS_GUARDIAN)
  );
  return results && results[0] ? results[0] : null;
}

async function approveGuardianConsent(token) {
  if (!token) return { success: false, error: 'missing_token' };
  var user = await getUserByGuardianToken(token);
  if (!user) return { success: false, error: 'not_found' };
  if (user.guardian_consent_status === 'approved') return { success: true, already: true };
  var id = getUserRowId(user);
  var patch = {
    guardian_consent_status: 'approved',
    guardian_consent_at: new Date().toISOString(),
    account_status: 'active'
  };
  var filters = [];
  if (id != null) {
    filters.push('user_id=eq.' + encodeURIComponent(String(id)));
    filters.push('id=eq.' + encodeURIComponent(String(id)));
  }
  for (var i = 0; i < filters.length; i++) {
    var result = await sbUpdate('users', patch, filters[i]);
    if (result.success) return { success: true, name: user.name };
  }
  return { success: false, error: 'update_failed' };
}

function isAccountPendingGuardian(user) {
  if (!user) return false;
  return user.account_status === 'pending_guardian' || user.guardian_consent_status === 'pending';
}

async function getAccountActionPermission(firebaseUid, action) {
  var user = firebaseUid ? await getUserByFirebaseUid(firebaseUid, { fresh: true }) : null;
  var status = user && user.account_status ? String(user.account_status) : '';
  var verb = (action === 'post' || action === 'draft') ? 'post gigs' : 'apply to gigs';
  if (status !== 'active') {
    return {
      allowed: false,
      status: status || 'unknown',
      message: status === 'pending_guardian'
        ? 'A parent or guardian must approve your account before you can ' + verb + '.'
        : 'Your account is not currently allowed to ' + verb + '.'
    };
  }
  if ((action === 'post' || action === 'draft') && typeof QG_isTeenDob === 'function' && QG_isTeenDob(user.date_of_birth)) {
    return {
      allowed: false,
      status: status,
      reason: 'teen_poster_unavailable',
      message: 'Poster mode becomes available when you turn 18.'
    };
  }
  if ((action === 'post' || action === 'draft') && user.is_poster !== true) {
    return {
      allowed: false,
      status: status,
      reason: 'poster_role_required',
      message: 'Enable Poster mode before posting tasks.'
    };
  }
  if (action !== 'post' && action !== 'draft' && user.is_tasker !== true) {
    return {
      allowed: false,
      status: status,
      reason: 'tasker_role_required',
      message: 'Enable Tasker mode before applying to gigs.'
    };
  }
  if (action === 'draft') {
    return { allowed: true, status: status, draft: true };
  }
  if (action === 'post' && user.poster_verified !== true) {
    return {
      allowed: false,
      status: status,
      reason: 'poster_payment_verification_required',
      verificationRole: 'poster',
      message: 'Add a payment method to post.'
    };
  }
  if (action !== 'post' && user.tasker_verified !== true) {
    return {
      allowed: false,
      status: status,
      reason: 'tasker_identity_verification_required',
      verificationRole: 'tasker',
      message: 'Verify your email to start working.'
    };
  }
  return { allowed: true, status: status };
}

async function resolveUserAvatarUrl(firebaseUid) {
  if (!firebaseUid) return '';
  if (window._currentUser && window._currentUser.uid === firebaseUid &&
      hasProfilePhotoUrl(window._currentUserAvatarUrl)) {
    return window._currentUserAvatarUrl;
  }
  var localUrl = readLocalProfileAvatar(firebaseUid);
  if (hasProfilePhotoUrl(localUrl)) {
    if (window._currentUser && window._currentUser.uid === firebaseUid) {
      window._currentUserAvatarUrl = localUrl;
    }
    return localUrl;
  }
  var dbUrl = await getUserAvatarUrl(firebaseUid);
  if (hasProfilePhotoUrl(dbUrl)) {
    if (window._currentUser && window._currentUser.uid === firebaseUid) {
      window._currentUserAvatarUrl = dbUrl;
    }
    return dbUrl;
  }
  return '';
}

async function syncProfilePhotoToDb(firebaseUser, avatarUrl) {
  if (!firebaseUser || !hasProfilePhotoUrl(avatarUrl)) return { success: false };
  var existing = await getUserByFirebaseUid(firebaseUser.uid);
  if (existing && hasProfilePhotoUrl(existing.avatar_url)) return { success: true };
  var name = firebaseUser.displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : '');
  if (typeof formatPersonName === 'function' && name) name = formatPersonName(name);
  // Do not pass role — existing rows must keep privilege role (e.g. admin).
  return await upsertUserProfile({
    name: name,
    email: firebaseUser.email || '',
    firebase_uid: firebaseUser.uid,
    avatar_url: avatarUrl
  });
}

async function getUserAvatarUrl(firebaseUid) {
  if (!firebaseUid) return '';
  var user = await getUserByFirebaseUid(firebaseUid);
  return user && user.avatar_url ? String(user.avatar_url).trim() : '';
}

async function getUsersAvatarMap() {
  var fetchMap = async function () {
    var users = await sbGet('users', withSelect(null, SELECT_USERS_AVATAR), null, 500);
    var map = {};
    if (!Array.isArray(users)) return map;
    users.forEach(function (u) {
      if (!u.firebase_uid || !hasProfilePhotoUrl(u.avatar_url)) return;
      map[String(u.firebase_uid)] = String(u.avatar_url).trim();
    });
    return map;
  };
  if (typeof getCached === 'function') {
    return await getCached('users-avatar-map', fetchMap, 300000);
  }
  return await fetchMap();
}

async function currentUserHasProfilePhoto() {
  if (!window._currentUser) return false;
  var url = await resolveUserAvatarUrl(window._currentUser.uid);
  return hasProfilePhotoUrl(url);
}

async function ensureTaskerProfilePhoto() {
  var isTasker = (typeof isWorkerMode === 'function' && isWorkerMode()) ||
    localStorage.getItem('qg-role') === 'worker' ||
    localStorage.getItem('qg-session-mode') === 'worker';
  if (!isTasker) return { ok: true, avatar_url: window._currentUserAvatarUrl || '' };
  var url = window._currentUser ? await resolveUserAvatarUrl(window._currentUser.uid) : '';
  if (hasProfilePhotoUrl(url)) {
    if (window._currentUser) {
      var existing = await getUserByFirebaseUid(window._currentUser.uid);
      if (!existing || !hasProfilePhotoUrl(existing.avatar_url)) {
        await syncProfilePhotoToDb(window._currentUser, url);
      }
    }
    return { ok: true, avatar_url: url };
  }
  return { ok: false, error: 'profile_photo_required' };
}

function resolveUserName(uid, taskRow, userNames) {
  if (!uid) return 'User';
  var uidStr = String(uid);

  if (taskRow) {
    var workerId = taskRow.worker_id || taskRow.WORKER_ID;
    var posterId = taskRow.posted_by || taskRow.POSTED_BY || taskRow.poster_id || taskRow.POSTER_ID;
    if (uidStr === String(workerId)) {
      var wn = taskRow.worker_name || taskRow.WORKER_NAME;
      if (wn && !isGenericDisplayName(wn)) return wn;
    }
    if (uidStr === String(posterId)) {
      var pn = taskRow.poster_name || taskRow.POSTER_NAME;
      if (pn && !isGenericDisplayName(pn)) return pn;
    }
  }

  if (userNames && userNames[uidStr] && !isGenericDisplayName(userNames[uidStr])) {
    return userNames[uidStr];
  }

  if (window._currentUser && window._currentUser.uid === uidStr) {
    var me = window._currentUser.displayName || (window._currentUser.email || '').split('@')[0];
    if (me) return me;
  }

  return 'QuickGigs user';
}

async function enrichConversationNames(conv) {
  if (!conv) return conv;
  var posterName = conv.poster_name || '';
  var workerName = conv.worker_name || '';
  if ((!posterName || isGenericDisplayName(posterName)) && typeof getUserNameByFirebaseUid === 'function') {
    posterName = await getUserNameByFirebaseUid(conv.poster_id) || posterName;
  }
  if ((!workerName || isGenericDisplayName(workerName)) && typeof getUserNameByFirebaseUid === 'function') {
    workerName = await getUserNameByFirebaseUid(conv.worker_id) || workerName;
  }
  var patch = {};
  if (posterName && !isGenericDisplayName(posterName) && posterName !== conv.poster_name) {
    conv.poster_name = posterName;
    patch.poster_name = posterName;
  }
  if (workerName && !isGenericDisplayName(workerName) && workerName !== conv.worker_name) {
    conv.worker_name = workerName;
    patch.worker_name = workerName;
  }
  if (conv.conv_id && (patch.poster_name || patch.worker_name)) {
    updateConversation(conv.conv_id, patch).catch(function () {});
  }
  return conv;
}

async function getConversationsForUser(userId) {
  var actorId = window._currentUser && window._currentUser.uid;
  if (actorId) userId = String(actorId);
  var stale = readConversationsCache(userId, true);
  try {
    var result = await secureMessagingRequest('list');
    if (!result.success) throw new Error(result.error || 'conversation_list_failed');
    var rows = Array.isArray(result.data) ? result.data : [];
    writeConversationsCache(userId, rows || []);
    window._supabaseUsingStaleCache = false;
    return rows;
  } catch (err) {
    console.error('Supabase conversations GET error:', err);
    if (stale && stale.length) {
      window._supabaseUsingStaleCache = true;
      window._supabaseLastFetchError = err.message || String(err);
      return stale;
    }
    throw err;
  }
}

function normalizeTaskId(taskId) {
  var n = parseInt(taskId, 10);
  return isNaN(n) ? taskId : n;
}

async function getConversation(convId, opts) {
  opts = opts || {};
  if (!convId) return null;
  var me = currentActorId(opts);
  if (!me && opts.actorId) me = String(opts.actorId);
  var result = await secureMessagingRequest('get', { conv_id: String(convId) });
  var conv = result.success ? result.data : null;
  if (!conv) return null;
  // If actor id is not ready yet, still return the row — caller validates party.
  if (me && String(conv.poster_id) !== me && String(conv.worker_id) !== me) {
    return null;
  }
  return conv;
}

function userIsConversationParty(conv, userId) {
  if (!conv || !userId) return false;
  var uid = String(userId);
  return String(conv.poster_id) === uid || String(conv.worker_id) === uid;
}

async function getConversationForTask(taskId, posterId, workerId) {
  var ids = [];
  if (taskId != null && taskId !== '') ids.push(String(taskId));
  var n = parseInt(taskId, 10);
  if (!isNaN(n)) ids.push(String(n));
  var seen = {};
  for (var i = 0; i < ids.length; i++) {
    if (seen[ids[i]]) continue;
    seen[ids[i]] = true;
    var results = await sbGet(
      'conversations',
      withSelect(
        'task_id=eq.' + encodeURIComponent(ids[i]) +
          '&poster_id=eq.' + encodeURIComponent(posterId) +
          '&worker_id=eq.' + encodeURIComponent(workerId),
        SELECT_CONVERSATIONS
      )
    );
    if (results && results[0]) return results[0];
  }
  var byPosterWorker = await sbGet(
    'conversations',
    withSelect(
      'poster_id=eq.' + encodeURIComponent(posterId) +
        '&worker_id=eq.' + encodeURIComponent(workerId),
      SELECT_CONVERSATIONS
    ),
    'created_at.desc',
    20
  );
  if (byPosterWorker && byPosterWorker.length) {
    var tid = String(taskId);
    var match = byPosterWorker.find(function(c) {
      return String(c.task_id) === tid || String(c.task_id) === String(n);
    });
    if (match) return match;
  }
  return null;
}

function parseConversationUnlocked(conv) {
  if (!conv) return false;
  var v = conv.is_unlocked;
  return v === true || v === 1 || v === '1' || v === 'true';
}

async function forceUnlockConversationForTask(conv, taskStatus) {
  if (!conv || !conv.conv_id) return { success: false, error: 'No conversation' };
  // When Stripe is live, restore the escrow-gated contact rule — chat unlocks only after
  // escrow is funded. Currently gated on acceptance because payments are off.
  var rule = typeof window.getChatUnlockRule === 'function'
    ? window.getChatUnlockRule()
    : ((window.QG_CONFIG && window.QG_CONFIG.chatUnlockAfter) || 'accept');

  if (parseConversationUnlocked(conv) && String(conv.status || '').toLowerCase() !== 'application') {
    return { success: true, conv: conv };
  }

  async function verifyUnlocked() {
    var fresh = await getConversation(conv.conv_id);
    return !!(fresh && parseConversationUnlocked(fresh));
  }

  if (rule === 'payment') {
    var taskId = conv.task_id || conv.TASK_ID;
    if (taskId && typeof getPaymentByTask === 'function') {
      var payment = await getPaymentByTask(taskId, {
        posterId: conv.poster_id,
        workerId: conv.worker_id
      });
      var pst = payment && String(payment.status || '').toLowerCase();
      if (pst === 'held' || pst === 'paid' || pst === 'completed') {
        var patch = { is_unlocked: true, status: 'in_progress' };
        var payUnlock = await updateConversation(conv.conv_id, patch);
        if (payUnlock.success) {
          return { success: true, conv: Object.assign({}, conv, patch) };
        }
        if (typeof tryPatchRow === 'function') {
          payUnlock = await tryPatchRow(
            'conversations',
            patch,
            'conv_id=eq.' + encodeURIComponent(conv.conv_id),
            verifyUnlocked
          );
          if (payUnlock.success) {
            var verified = await getConversation(conv.conv_id);
            return { success: true, conv: verified || Object.assign({}, conv, patch) };
          }
        }
        if (await verifyUnlocked()) {
          var unlockedConv = await getConversation(conv.conv_id);
          return { success: true, conv: unlockedConv || conv };
        }
        // Paid in Stripe/DB but PATCH blocked — still allow chat client-side
        return { success: true, conv: Object.assign({}, conv, { is_unlocked: true, status: 'in_progress' }), unverified: true };
      }
    }
    return { success: parseConversationUnlocked(conv), conv: conv, skipped: !parseConversationUnlocked(conv) };
  }

  // When Stripe is live, restore the escrow-gated contact rule — chat unlocks only after
  // escrow is funded. Currently gated on acceptance because payments are off.
  var convStatus = String(conv.status || '').toLowerCase();
  var ts = String(taskStatus || '').toLowerCase();
  if (parseConversationUnlocked(conv) && convStatus !== 'application') {
    return { success: true, conv: conv };
  }
  if (typeof window.shouldUnlockChatNow === 'function' &&
      !window.shouldUnlockChatNow(convStatus, ts)) {
    return { success: false, conv: conv, skipped: true };
  }

  var patch = { is_unlocked: true };
  if (convStatus === 'application' || ts === 'in_progress') patch.status = 'in_progress';

  var result = await updateConversation(conv.conv_id, patch);
  if (result.success) {
    if (typeof clearConversationFraudBuffers === 'function') {
      clearConversationFraudBuffers(conv.conv_id, conv.poster_id, conv.worker_id);
    }
    return { success: true, conv: Object.assign({}, conv, patch) };
  }
  result = await updateConversation(conv.conv_id, { is_unlocked: true });
  if (result.success) {
    if (typeof clearConversationFraudBuffers === 'function') {
      clearConversationFraudBuffers(conv.conv_id, conv.poster_id, conv.worker_id);
    }
    return { success: true, conv: Object.assign({}, conv, { is_unlocked: true }) };
  }
  // Accept-mode: PATCH may fail (RLS / column) but parties must still chat while payments are off.
  if (rule !== 'payment') {
    console.warn('forceUnlockConversationForTask PATCH failed — opening chat client-side:', result && result.error);
    return {
      success: true,
      conv: Object.assign({}, conv, { is_unlocked: true, status: patch.status || conv.status }),
      unverified: true
    };
  }
  return { success: false, error: result.error, conv: conv };
}

async function updateConversation(convId, patch) {
  return await secureMessagingRequest('update', { conv_id: String(convId || ''), patch: patch || {} });
}

async function unlockConversationIfAllowed(convId, convStatus, taskStatus) {
  if (!convId) return { success: false };
  var conv = await getConversation(convId);
  if (!conv) return { success: false, error: 'Conversation not found' };
  return await forceUnlockConversationForTask(conv, taskStatus);
}

async function createConversation(convData) {
  var taskId = normalizeTaskId(convData.task_id);
  var status = convData.status || 'in_progress';
  var shouldUnlock = typeof convData.is_unlocked === 'boolean'
    ? convData.is_unlocked
    : (typeof resolveChatUnlockedOnCreate === 'function'
      ? resolveChatUnlockedOnCreate(status)
      : false);

  if (convData.poster_id && convData.worker_id &&
      await areUsersBlocked(convData.poster_id, convData.worker_id)) {
    return { success: false, error: 'user_blocked' };
  }

  var existing = await getConversationForTask(taskId, convData.poster_id, convData.worker_id);
  if (existing && existing.conv_id) {
    var patch = {};
    if (convData.status) patch.status = convData.status;
    if (convData.poster_name) patch.poster_name = convData.poster_name;
    if (convData.worker_name) patch.worker_name = convData.worker_name;
    if (convData.task_title) patch.task_title = convData.task_title;
    if (convData.task_category) patch.task_category = convData.task_category;
    if (shouldUnlock) patch.is_unlocked = true;
    else if (typeof window.shouldUnlockChatNow === 'function' &&
      window.shouldUnlockChatNow(convData.status || existing.status)) {
      patch.is_unlocked = true;
      if ((existing.status || '').toLowerCase() === 'application') patch.status = 'in_progress';
    }
    if (Object.keys(patch).length) {
      var upd = await updateConversation(existing.conv_id, patch);
      if (upd.success) existing = Object.assign({}, existing, patch);
    }
    return { success: true, data: existing, existing: true };
  }

  return await secureMessagingRequest('create', { conversation: {
    task_id:       taskId,
    poster_id:     convData.poster_id,
    worker_id:     convData.worker_id,
    poster_name:   convData.poster_name || '',
    worker_name:   convData.worker_name || '',
    task_title:    convData.task_title || '',
    task_category: convData.task_category || '',
    status:        status,
    is_unlocked:   shouldUnlock,
    last_message:  convData.last_message || '',
    last_message_at: convData.last_message_at || null
  }});
}

async function getMessagesForConversation(convId, opts) {
  opts = opts || {};
  var me = currentActorId(opts);
  if (!me && opts.actorId) me = String(opts.actorId);
  // trusted: true — caller already verified party (e.g. chat initChat). Avoid a second
  // getConversation that can fail and silently return [] (blank thread).
  var trusted = !!(opts.trusted || opts.skipPartyCheck);
  if (!me && !trusted) {
    console.warn('[QuickGigs] getMessagesForConversation: no actor id');
    return [];
  }
  if (!trusted) {
    var conv = await getConversation(convId, { actorId: me });
    if (!conv || !userIsConversationParty(conv, me)) {
      console.error('[QuickGigs] getMessagesForConversation: party check failed', {
        convId: convId,
        actorId: me
      });
      return [];
    }
  }
  var result = await secureMessagingRequest('messages', { conv_id: String(convId || '') });
  return result.success && Array.isArray(result.data) ? result.data : [];
}

async function sendChatMessage(convId, senderId, body, recentTexts, fraudOpts) {
  // CLIENT UX filter only — authoritative check must be a server Edge Function on insert.
  try {
    var conv = await getConversation(convId);
    if (conv) {
      var otherId = String(conv.poster_id) === String(senderId) ? conv.worker_id : conv.poster_id;
      if (otherId && await areUsersBlocked(senderId, otherId)) {
        return { success: false, error: 'user_blocked', blocked: true };
      }
    }
  } catch (blockErr) {
    console.warn('Block check skipped:', blockErr);
  }
  var opts = fraudOpts || { convId: convId, senderId: senderId };
  var isSystem = typeof isSystemChatBody === 'function' && isSystemChatBody(body);
  if (isChatImageBody(body)) {
    var imgUrl = parseChatImageUrl(body);
    if (!isAllowedChatImageUrl(imgUrl)) {
      return { success: false, error: 'invalid_image', blocked: true };
    }
  } else if (!isSystem && typeof analyzeOffPlatformContact === 'function') {
    var fraudCheck = analyzeOffPlatformContact(body, recentTexts || [], opts);
    if (fraudCheck.blocked) {
      // Hard match → admin moderation queue (reports + admin_actions) via shared logger
      if (typeof logFraudContactEvent === 'function') {
        logFraudContactEvent({
          userId: senderId,
          convId: convId,
          reason: fraudCheck.reason || 'contact',
          preview: body
        });
      }
      return {
        success: false,
        error: 'off_platform_contact',
        blocked: true,
        reason: fraudCheck.reason || 'pattern',
        message: fraudCheck.message || (typeof getOffPlatformWarning === 'function' ? getOffPlatformWarning() : ''),
        logged: true
      };
    }
  } else if (!isSystem && typeof containsOffPlatformContact === 'function' && containsOffPlatformContact(body, recentTexts || [], opts)) {
    if (typeof logFraudContactEvent === 'function') {
      logFraudContactEvent({ userId: senderId, convId: convId, reason: 'contact', preview: body });
    }
    return {
      success: false,
      error: 'off_platform_contact',
      blocked: true,
      message: typeof getOffPlatformWarning === 'function' ? getOffPlatformWarning() : '',
      logged: true
    };
  }

  // Content safety first-pass (threats / adult) — lists live in contentModeration.js
  if (!isSystem && !isChatImageBody(body) && typeof moderateText === 'function') {
    var modCheck = moderateText(body);
    if (modCheck.blocked) {
      if (typeof logModerationAttempt === 'function') {
        logModerationAttempt({
          userId: senderId,
          source: 'chat',
          targetType: 'chat_message',
          targetId: convId,
          flags: modCheck.flags,
          preview: body,
          message: modCheck.message
        });
      }
      return {
        success: false,
        error: 'content_moderation',
        blocked: true,
        reason: (modCheck.flags || []).map(function (f) { return f.type; }).join(',') || 'content',
        message: modCheck.message || '',
        flags: modCheck.flags || []
      };
    }
  }

  var result = await secureMessagingRequest('send', {
    conv_id: String(convId || ''),
    body: body
  });
  if (!result.success) return result;

  var preview = isSystem
    ? (typeof parseSystemChatBody === 'function' ? parseSystemChatBody(body) : body)
    : (isChatImageBody(body) ? '📷 Photo' : body);

  if (!isSystem) {
    notifyChatRecipientAsync(convId, senderId, preview);
  }

  return result;
}

/** Inline system event in the thread (no schema change — body prefix ⟦QG⟧). */
async function sendSystemChatMessage(convId, senderId, text) {
  var body = typeof buildSystemChatBody === 'function'
    ? buildSystemChatBody(text)
    : ('⟦QG⟧' + String(text || '').trim());
  return await sendChatMessage(convId, senderId, body, [], { convId: convId, senderId: senderId });
}

function notifyChatRecipientAsync(convId, senderId, preview) {
  if (typeof notifyNewChatMessage !== 'function' && typeof window.showQuickGigsPush !== 'function') return;
  (async function () {
    try {
      var conv = typeof getConversation === 'function'
        ? await getConversation(convId, { actorId: senderId })
        : null;
      if (!conv) return;
      var recipientId = senderId === conv.poster_id ? conv.worker_id : conv.poster_id;
      if (!recipientId || recipientId === senderId) return;
      var senderName = typeof getUserNameByFirebaseUid === 'function'
        ? await getUserNameByFirebaseUid(senderId)
        : 'QuickGigs user';
      var chatLink = 'https://quickgigs.ca/chat.html?conv=' + encodeURIComponent(convId);
      if (typeof notifyNewChatMessage === 'function') {
        // Do not fetch other users' email on the client — queue by user_id only.
        await notifyNewChatMessage(recipientId, '', {
          senderName: senderName,
          taskTitle: conv.task_title || 'your task',
          preview: String(preview || '').substring(0, 120),
          link: chatLink
        });
      }
    } catch (err) {
      console.warn('Chat notification skipped:', err);
    }
  })();
}

async function markConversationRead(convId, userId, posterId) {
  return await secureMessagingRequest('mark_read', { conv_id: String(convId || '') });
}

async function getTaskPosterIdQuick(taskId) {
  var filters = buildTaskIdFilters(taskId, null);
  for (var i = 0; i < filters.length; i++) {
    var results = await sbGet('tasks', withSelect(filters[i], 'task_id,posted_by'));
    if (results && results[0]) {
      return String(results[0].posted_by || results[0].POSTED_BY || '');
    }
  }
  return '';
}

async function getApplicationsByTask(taskId, opts) {
  opts = opts || {};
  var me = currentActorId(opts);
  var asPoster = !!opts.asPoster;
  if (!asPoster && opts.posterId && me && String(opts.posterId) === me) asPoster = true;
  if (!asPoster && opts.taskRow && me && taskPostedByUser(opts.taskRow, me)) asPoster = true;
  if (!asPoster && me) {
    var postedBy = await getTaskPosterIdQuick(taskId);
    if (postedBy && postedBy === me) asPoster = true;
  }
  var filters = buildTaskIdFilters(taskId, null).filter(function (f) {
    return f.indexOf('task_id=eq.') === 0;
  });
  for (var i = 0; i < filters.length; i++) {
    var f = filters[i];
    if (me && !asPoster) {
      f = f + '&worker_id=eq.' + encodeURIComponent(me);
    } else if (!me && !asPoster) {
      return [];
    }
    var rows = await sbGet('applications', withSelect(f, SELECT_APPLICATIONS));
    if (rows && rows.length) return rows.map(normalizeApplicationRow);
  }
  return [];
}

async function getApplicationById(appId, opts) {
  opts = opts || {};
  var appRow = null;
  var idFilters = buildApplicationIdFilters(appId, null);
  for (var i = 0; i < idFilters.length; i++) {
    var rows = await sbGet('applications', withSelect(idFilters[i], SELECT_APPLICATIONS));
    if (rows && rows[0]) {
      appRow = normalizeApplicationRow(rows[0]);
      break;
    }
  }
  if (!appRow && opts.taskId && opts.workerId) {
    var composite = buildApplicationCompositeFilters(opts.taskId, opts.workerId);
    for (var j = 0; j < composite.length; j++) {
      var byPair = await sbGet('applications', withSelect(composite[j], SELECT_APPLICATIONS));
      if (byPair && byPair[0]) {
        appRow = normalizeApplicationRow(byPair[0]);
        break;
      }
    }
  }
  if (!appRow) return null;
  var me = currentActorId(opts);
  if (!me) return null;
  if (String(appRow.worker_id || appRow.WORKER_ID) === me) return appRow;
  var tid = appRow.task_id || appRow.TASK_ID || opts.taskId;
  if (tid) {
    var postedBy = opts.posterId ? String(opts.posterId) : await getTaskPosterIdQuick(tid);
    if (postedBy && postedBy === me) return appRow;
  }
  return null;
}

async function getApplicationsByWorker(workerId) {
  var me = currentActorId();
  if (me && String(me) !== String(workerId)) return [];
  var myAppsUrl = window.QG_CONFIG && window.QG_CONFIG.myApplicationsUrl;
  if (myAppsUrl && typeof callVerifiedFunction === 'function') {
    var result = await callVerifiedFunction(myAppsUrl, {});
    return (result && result.success ? (result.data || []) : []).map(normalizeApplicationRow);
  }
  var rows = await sbGet(
    'applications',
    withSelect('worker_id=eq.' + encodeURIComponent(String(workerId)), SELECT_APPLICATIONS)
  );
  return (rows || []).map(normalizeApplicationRow);
}

function normalizeApplicationRow(row) {
  if (!row) return row;
  var id = row.app_id || row.APP_ID || row.application_id || row.APPLICATION_ID || row.id;
  if (id != null && id !== '') {
    row.app_id = id;
    row.APP_ID = id;
  }
  if (row.worker_id == null && row.WORKER_ID != null) row.worker_id = row.WORKER_ID;
  if (row.task_id == null && row.TASK_ID != null) row.task_id = row.TASK_ID;
  if (row.status == null && row.STATUS != null) row.status = row.STATUS;
  if (row.counter_price == null && row.COUNTER_PRICE != null) row.counter_price = row.COUNTER_PRICE;
  if (row.counter_by == null && row.COUNTER_BY != null) row.counter_by = row.COUNTER_BY;
  if (row.counter_round == null && row.COUNTER_ROUND != null) row.counter_round = row.COUNTER_ROUND;
  return row;
}

function applicationPatchToCache(patch) {
  var cachePatch = Object.assign({}, patch);
  if (patch.price != null) cachePatch.PRICE = patch.price;
  if (patch.counter_price != null) cachePatch.COUNTER_PRICE = patch.counter_price;
  if (patch.counter_by != null) cachePatch.COUNTER_BY = patch.counter_by;
  if (patch.counter_round != null) cachePatch.COUNTER_ROUND = patch.counter_round;
  if (patch.status != null) cachePatch.STATUS = patch.status;
  return cachePatch;
}

async function patchApplicationFields(appId, patch, opts) {
  opts = opts || {};
  var appRow = await getApplicationById(appId, opts);
  var filters = buildApplicationUpdateFilters(appId, opts, appRow);
  var result = { success: false, error: 'Could not update application' };
  for (var i = 0; i < filters.length; i++) {
    result = await tryPatchRow('applications', patch, filters[i], async function () {
      var fresh = await getApplicationById(appId, opts);
      return !!fresh;
    });
    if (result.success) break;
  }
  if (result.success) {
    mergeApplicationInCache(appId, opts.taskId, opts.workerId, applicationPatchToCache(patch));
  }
  return result;
}

async function posterSendCounterOffer(appId, posterId, amount, opts) {
  opts = opts || {};
  amount = Math.round(Number(amount));
  if (!amount || amount < 20) return { success: false, error: 'invalid_amount' };
  var app = await getApplicationById(appId, opts);
  if (!app) return { success: false, error: 'not_found' };
  var taskId = app.task_id || app.TASK_ID || opts.taskId;
  var workerId = app.worker_id || app.WORKER_ID || opts.workerId;
  var task = await getTaskById(taskId);
  if (!task || String(task.posted_by || task.POSTED_BY) !== String(posterId)) {
    return { success: false, error: 'not_owner' };
  }
  if (!isTaskBudgetNegotiable(task)) return { success: false, error: 'not_negotiable' };
  var st = String(app.status || app.STATUS || 'pending').toLowerCase();
  if (st !== 'pending') return { success: false, error: 'not_pending' };
  var neg = parseNegotiationFields(app);
  if (neg.counterBy === 'poster') return { success: false, error: 'counter_pending' };
  if (neg.counterBy === 'worker') return { success: false, error: 'respond_to_counter' };
  if (neg.counterRound >= 1) return { success: false, error: 'max_rounds' };

  var patch = {
    counter_price: amount,
    counter_by: 'poster',
    counter_round: neg.counterRound + 1,
    last_counter_at: new Date().toISOString()
  };
  var result = await patchApplicationFields(appId, patch, { taskId: taskId, workerId: workerId });
  if (result.success && typeof notifyWorkerCounterOffer === 'function') {
    try {
      var posterName = task.poster_name || task.POSTER_NAME || 'The poster';
      await notifyWorkerCounterOffer(workerId, '', task, {
        amount: amount,
        posterName: posterName,
        appId: appId,
        taskId: taskId
      });
    } catch (notifyErr) {
      console.warn('Counter notification skipped:', notifyErr);
    }
  }
  return result;
}

async function workerRespondToCounter(appId, workerId, action, amount, opts) {
  opts = opts || {};
  action = String(action || '').toLowerCase();
  var app = await getApplicationById(appId, opts);
  if (!app) return { success: false, error: 'not_found' };
  if (String(app.worker_id || app.WORKER_ID) !== String(workerId)) {
    return { success: false, error: 'not_worker' };
  }
  var st = String(app.status || app.STATUS || 'pending').toLowerCase();
  if (st !== 'pending') return { success: false, error: 'not_pending' };
  var neg = parseNegotiationFields(app);
  if (neg.counterBy !== 'poster' || neg.counterPrice == null) {
    return { success: false, error: 'no_counter' };
  }
  var taskId = app.task_id || app.TASK_ID || opts.taskId;
  var task = await getTaskById(taskId);
  var patch;
  if (action === 'accept') {
    patch = {
      price: neg.counterPrice,
      counter_price: null,
      counter_by: null
    };
  } else if (action === 'decline') {
    patch = { counter_price: null, counter_by: null };
  } else if (action === 'counter') {
    amount = Math.round(Number(amount));
    if (!amount || amount < 20) return { success: false, error: 'invalid_amount' };
    if (neg.counterRound !== 1) return { success: false, error: 'max_rounds' };
    patch = {
      counter_price: amount,
      counter_by: 'worker',
      counter_round: neg.counterRound + 1,
      last_counter_at: new Date().toISOString()
    };
  } else {
    return { success: false, error: 'invalid_action' };
  }

  var result = await patchApplicationFields(appId, patch, { taskId: taskId, workerId: workerId });
  if (!result.success) return result;

  if (action === 'counter' && typeof notifyPosterCounterReply === 'function') {
    try {
      var posterId = task && (task.posted_by || task.POSTED_BY);
      var workerName = app.worker_name || app.WORKER_NAME || 'A tasker';
      await notifyPosterCounterReply(posterId, '', task, {
        amount: amount,
        workerName: workerName,
        appId: appId,
        taskId: taskId,
        action: 'counter'
      });
    } catch (notifyErr) {
      console.warn('Counter reply notification skipped:', notifyErr);
    }
  } else if (action === 'accept' && typeof notifyPosterCounterReply === 'function') {
    try {
      var posterIdAccept = task && (task.posted_by || task.POSTED_BY);
      var workerNameAccept = app.worker_name || app.WORKER_NAME || 'A tasker';
      await notifyPosterCounterReply(posterIdAccept, '', task, {
        amount: neg.counterPrice,
        workerName: workerNameAccept,
        appId: appId,
        taskId: taskId,
        action: 'accept'
      });
    } catch (notifyErr2) {
      console.warn('Counter accept notification skipped:', notifyErr2);
    }
  }
  return result;
}

async function posterRespondToCounter(appId, posterId, action, opts) {
  opts = opts || {};
  action = String(action || '').toLowerCase();
  if (action !== 'accept' && action !== 'decline') {
    return { success: false, error: 'invalid_action' };
  }
  var app = await getApplicationById(appId, opts);
  if (!app) return { success: false, error: 'not_found' };
  var taskId = app.task_id || app.TASK_ID || opts.taskId;
  var workerId = app.worker_id || app.WORKER_ID || opts.workerId;
  var task = await getTaskById(taskId);
  if (!task || String(task.posted_by || task.POSTED_BY) !== String(posterId)) {
    return { success: false, error: 'not_owner' };
  }
  var neg = parseNegotiationFields(app);
  if (neg.counterBy !== 'worker' || neg.counterPrice == null) {
    return { success: false, error: 'no_counter' };
  }
  var patch = action === 'accept'
    ? { price: neg.counterPrice, counter_price: null, counter_by: null }
    : { counter_price: null, counter_by: null };
  var result = await patchApplicationFields(appId, patch, { taskId: taskId, workerId: workerId });
  if (result.success && action === 'accept' && typeof notifyWorkerCounterOffer === 'function') {
    try {
      await notifyWorkerCounterOffer(workerId, '', task, {
        amount: neg.counterPrice,
        posterName: task.poster_name || task.POSTER_NAME || 'The poster',
        appId: appId,
        taskId: taskId,
        accepted: true
      });
    } catch (notifyErr) {
      console.warn('Counter accept notification skipped:', notifyErr);
    }
  }
  return result;
}

async function getAllApplications() {
  return await fetchApplicationsForActor(currentActorId());
}

async function submitApplication(appData) {
  appData = appData || {};
  // applications.worker_id stores Firebase Auth uid — never users.user_id (UUID).
  var workerFirebaseUid = String(
    appData.worker_id ||
    (window._currentUser && window._currentUser.uid) ||
    currentActorId() ||
    ''
  ).trim();
  var taskId = appData.task_id != null && appData.task_id !== ''
    ? String(appData.task_id)
    : '';

  if (!taskId) {
    return { success: false, error: 'missing_task_id' };
  }
  if (!workerFirebaseUid) {
    return { success: false, error: 'missing_worker_id' };
  }

  var task = await getTaskById(taskId);
  var posterId = task && (task.posted_by || task.POSTED_BY);
  if (posterId && String(posterId) === workerFirebaseUid) {
    return { success: false, error: 'cannot_apply_own_task' };
  }

  // Duplicate guard — one application per Firebase uid + task_id (fail closed).
  // Do NOT swallow errors: a failed check must not allow another insert.
  var already = false;
  var composite = buildApplicationCompositeFilters(taskId, workerFirebaseUid);
  if (!composite.length) {
    return { success: false, error: 'invalid_duplicate_check' };
  }
  for (var ci = 0; ci < composite.length && !already; ci++) {
    var existingRows;
    try {
      existingRows = typeof sbGetOrThrow === 'function'
        ? await sbGetOrThrow(
            'applications',
            withSelect(composite[ci], SELECT_APPLICATIONS),
            null,
            20
          )
        : await sbGet(
            'applications',
            withSelect(composite[ci], SELECT_APPLICATIONS),
            null,
            20
          );
    } catch (dupGetErr) {
      console.error('Duplicate application check failed:', dupGetErr);
      return {
        success: false,
        error: 'Could not verify existing applications — try again. (' +
          (dupGetErr && dupGetErr.message ? dupGetErr.message : 'check_failed') + ')'
      };
    }
    already = (existingRows || []).some(function (a) {
      var tid = a.task_id || a.TASK_ID;
      var wid = a.worker_id || a.WORKER_ID;
      if (tid == null || tid === '' || !wid) return false;
      return String(tid) === String(taskId) && String(wid) === String(workerFirebaseUid);
    });
  }
  if (!already) {
    try {
      var existingApps = await getApplicationsByWorker(workerFirebaseUid);
      already = (existingApps || []).some(function (a) {
        var tid = a.task_id || a.TASK_ID;
        if (tid == null || tid === '') return false;
        return String(tid) === String(taskId);
      });
    } catch (workerDupErr) {
      console.warn('Worker-apps duplicate fallback skipped:', workerDupErr);
    }
  }
  if (already) return { success: false, error: 'already_applied' };

  var workerPhoto = await resolveUserAvatarUrl(workerFirebaseUid);
  if (!hasProfilePhotoUrl(workerPhoto)) {
    return { success: false, error: 'profile_photo_required' };
  }
  if (window._currentUser && window._currentUser.uid === workerFirebaseUid) {
    var existing = await getUserByFirebaseUid(workerFirebaseUid);
    if (!existing || !hasProfilePhotoUrl(existing.avatar_url)) {
      await syncProfilePhotoToDb(window._currentUser, workerPhoto);
    }
  }

  var row = {
    task_id:   taskId,
    worker_id: workerFirebaseUid,
    message:   appData.message,
    price:     appData.price,
    status:    'pending'
  };
  if (appData.worker_name) row.worker_name = appData.worker_name;

  // Security-sensitive insert goes through a Firebase-verified Edge Function.
  var secureApplyUrl = window.QG_CONFIG && window.QG_CONFIG.submitApplicationUrl;
  if (!secureApplyUrl) return { success: false, error: 'secure_application_unavailable' };
  var secureApplication = Object.assign({}, row);
  try {
    var geoRaw = sessionStorage.getItem('qg-geo-filter-pos');
    var geoPos = geoRaw ? JSON.parse(geoRaw) : null;
    if (geoPos && isFinite(Number(geoPos.lat)) && isFinite(Number(geoPos.lng))) {
      secureApplication.origin_lat = Math.round(Number(geoPos.lat) * 100) / 100;
      secureApplication.origin_lng = Math.round(Number(geoPos.lng) * 100) / 100;
    }
  } catch (geoErr) {}
  var result = await callVerifiedFunction(secureApplyUrl, { application: secureApplication });
  if (result.success && result.data) {
    console.log('[QuickGigs apply] applications row created', {
      app_id: result.data.app_id,
      task_id: result.data.task_id,
      worker_id: result.data.worker_id,
      status: result.data.status,
      price: result.data.price
    });
  } else if (!result.success) {
    console.error('[QuickGigs apply] applications insert failed', result.error);
  }

  if (result.success && result.guardian_status !== 'pending_guardian' &&
      taskId && typeof notifyPosterNewApplication === 'function') {
    try {
      var notifyTask = task || await getTaskById(taskId);
      var notifyPosterId = notifyTask && (notifyTask.posted_by || notifyTask.POSTED_BY);
      await notifyPosterNewApplication(
        notifyPosterId,
        '',
        notifyTask,
        { worker_name: appData.worker_name, price: appData.price }
      );
    } catch (notifyErr) {
      console.warn('Application notification skipped:', notifyErr);
    }
  }

  return result;
}

function buildApplicationIdFilters(appId, appRow) {
  var ids = [];
  function addId(v) {
    if (v == null || v === '') return;
    var s = String(v);
    if (ids.indexOf(s) === -1) ids.push(s);
    var n = parseInt(v, 10);
    if (!isNaN(n) && ids.indexOf(String(n)) === -1) ids.push(String(n));
  }
  addId(appId);
  if (appRow) {
    addId(appRow.app_id);
    addId(appRow.APP_ID);
    addId(appRow.application_id);
    addId(appRow.id);
  }
  var filters = [];
  var seen = {};
  ids.forEach(function (raw) {
    var enc = encodeURIComponent(raw);
    ['app_id=eq.' + enc, 'id=eq.' + enc, 'application_id=eq.' + enc].forEach(function (f) {
      if (!seen[f]) { seen[f] = true; filters.push(f); }
    });
    if (raw !== enc) {
      ['app_id=eq.' + raw, 'id=eq.' + raw, 'application_id=eq.' + raw].forEach(function (f) {
        if (!seen[f]) { seen[f] = true; filters.push(f); }
      });
    }
  });
  return filters;
}

function buildApplicationCompositeFilters(taskId, workerId) {
  if (taskId == null || taskId === '' || !workerId) return [];
  var filters = [];
  var seen = {};
  function addPair(tVal, wVal) {
    var f = 'task_id=eq.' + encodeURIComponent(String(tVal)) +
      '&worker_id=eq.' + encodeURIComponent(String(wVal));
    if (!seen[f]) { seen[f] = true; filters.push(f); }
  }
  addPair(taskId, workerId);
  // Only add numeric twin for pure integer task ids — never parseInt a UUID
  // (parseInt('8c1c2ff2-…') === 8 and would query the wrong task).
  if (/^\d+$/.test(String(taskId))) {
    addPair(String(parseInt(taskId, 10)), workerId);
  }
  return filters;
}

function buildApplicationUpdateFilters(appId, opts, appRow) {
  opts = opts || {};
  var filters = buildApplicationIdFilters(appId, appRow);
  buildApplicationCompositeFilters(opts.taskId, opts.workerId).forEach(function (f) {
    if (filters.indexOf(f) === -1) filters.push(f);
  });
  return filters;
}

async function updateApplicationStatus(appId, status, opts) {
  opts = opts || {};
  var statusVal = String(status || '').toLowerCase();
  var patch = { status: statusVal };
  var appRow = await getApplicationById(appId, opts);
  var filters = buildApplicationUpdateFilters(appId, opts, appRow);
  var result = { success: false, error: 'Could not update application' };
  for (var i = 0; i < filters.length; i++) {
    result = await tryPatchRow('applications', patch, filters[i], async function () {
      var fresh = await getApplicationById(appId, opts);
      return !!(fresh && String(fresh.status || fresh.STATUS || '').toLowerCase() === statusVal);
    });
    if (result.success) break;
  }
  if (result.success) {
    mergeApplicationInCache(appId, opts.taskId, opts.workerId, { status: statusVal, STATUS: statusVal });
  }
  return result;
}

function formatSupabaseActionError(action, err) {
  var msg = '';
  if (err == null || err === '') msg = '';
  else if (typeof err === 'string') msg = err;
  else if (err instanceof Error) msg = err.message || '';
  else if (typeof err === 'object') {
    if (typeof err.message === 'string' && err.message) msg = err.message;
    else if (typeof err.error === 'string' && err.error) msg = err.error;
    else if (typeof err.details === 'string' && err.details) msg = err.details;
    else if (typeof err.code === 'string' && err.code) msg = err.code;
    else {
      try {
        var raw = JSON.stringify(err);
        if (raw && raw !== '{}') msg = raw;
      } catch (e) { msg = ''; }
    }
  } else msg = String(err);
  if (msg === '[object Object]') msg = '';
  var lower = msg.toLowerCase();
  var act = String(action || '').toLowerCase();
  if (lower.indexOf('tasker_identity_verification_required') >= 0) {
    return 'Verify your email to start working.';
  }
  if (lower.indexOf('poster_payment_verification_required') >= 0) {
    return 'Add a payment method to post.';
  }
  if (lower.indexOf('poster_role_required') >= 0) {
    return 'Enable Poster mode before posting tasks.';
  }
  if (lower.indexOf('tasker_role_required') >= 0) {
    return 'Enable Tasker mode before applying to gigs.';
  }
  if (lower.indexOf('teen_poster_unavailable') >= 0) {
    return 'Poster mode becomes available when you turn 18.';
  }
  if (lower.indexOf('location_geocode_failed') >= 0) {
    return 'Choose a valid Canadian city or area.';
  }
  var isReviewAction = act.indexOf('review') >= 0;
  if (isReviewAction || lower.indexOf('reviews') >= 0) {
    if (lower.indexOf('already') >= 0 || lower.indexOf('duplicate') >= 0 || lower.indexOf('23505') >= 0) {
      return 'You already reviewed this task.';
    }
    return 'Could not ' + action + ' — run supabase/reviews.sql in Supabase SQL Editor, then refresh.';
  }
  if (lower.indexOf('401') >= 0 || lower.indexOf('403') >= 0 || lower.indexOf('42501') >= 0 || lower.indexOf('row-level') >= 0) {
    return 'Could not ' + action + ' — run supabase/beta-setup-all.sql in Supabase SQL Editor, then refresh.';
  }
  if (lower.indexOf('photo_urls') >= 0 || lower.indexOf('requires_photos') >= 0 ||
      lower.indexOf('scheduled_at') >= 0 || lower.indexOf('scheduled_label') >= 0 ||
      lower.indexOf('poster_name') >= 0 || lower.indexOf('column') >= 0) {
    return 'Could not ' + action + ' — run supabase/beta-setup-all.sql in Supabase SQL Editor, then refresh.';
  }
  if (lower.indexOf('no matching row') >= 0) {
    return 'Could not ' + action + ' — refresh the page and try again.';
  }
  if (msg && msg.length < 120) return 'Could not ' + action + ' — ' + msg;
  if (msg.indexOf('worker_payout_setup_required') >= 0) {
    return 'Task marked complete, but the tasker must set up Stripe payouts in Profile before funds release.';
  }
  if (msg.indexOf('task_not_found') >= 0) {
    return 'Could not ' + action + ' — task not found. Hard refresh and try again.';
  }
  return 'Could not ' + action + ' — run supabase/tasks-beta-fix.sql in Supabase SQL Editor, then refresh.';
}

async function cancelApplication(appId, opts) {
  return await updateApplicationStatus(appId, 'cancelled', opts);
}

async function declineApplication(appId, opts) {
  return await updateApplicationStatus(appId, 'declined', opts);
}

async function cancelTask(taskId, opts) {
  opts = opts || {};
  taskId = String(taskId);

  if (typeof getPaymentByTask === 'function') {
    var payment = await getPaymentByTask(taskId);
    if (payment) {
      var pst = String(payment.status || payment.STATUS || '').toLowerCase();
      if (pst === 'paid') {
        return { success: false, error: 'paid_task_needs_dispute', needsDispute: true };
      }
      if (pst === 'held' && opts.refundHeld !== false) {
        var refund = await refundTaskPayment(taskId, opts.actorId);
        if (!refund.ok && !refund.skipped) {
          return { success: false, error: refund.error || 'refund_failed' };
        }
      }
    }
  }

  var result = await updateTaskStatus(taskId, 'cancelled');
  if (!result.success) return result;

  var apps = await getApplicationsByTask(taskId);
  await Promise.all((apps || []).map(function (a) {
    var st = String(a.status || a.STATUS || 'pending').toLowerCase();
    if (st !== 'pending' && st !== 'accepted') return Promise.resolve({ success: true });
    return updateApplicationStatus(a.app_id || a.APP_ID || a.id, 'cancelled', {
      taskId: taskId,
      workerId: a.worker_id || a.WORKER_ID
    });
  }));

  if (typeof lockConversationsForTask === 'function') {
    await lockConversationsForTask(taskId);
  }
  invalidateTasksCache();
  invalidateAppsCache();
  mergeTaskInCache(taskId, { status: 'cancelled', STATUS: 'cancelled' });
  return result;
}

/** Admin moderation — cancel task and email poster + applicants with reason. */
async function adminRemoveTaskWithReason(taskId, reason) {
  taskId = String(taskId || '');
  reason = String(reason || '').trim();
  if (!taskId) return { success: false, error: 'missing_task' };
  if (reason.length < 5) return { success: false, error: 'reason_required' };

  var task = await getTaskById(taskId);
  if (!task) return { success: false, error: 'not_found' };

  var apps = await getApplicationsByTask(taskId);
  var result = await cancelTask(taskId);
  if (!result.success) return result;

  if (typeof notifyAdminTaskRemoved === 'function') {
    try {
      await notifyAdminTaskRemoved(task, apps || [], reason);
    } catch (notifyErr) {
      console.warn('Admin task removal notification skipped:', notifyErr);
    }
  }
  return { success: true };
}

/** Mark task + accepted application completed — releases escrow payout when payment is held. */
async function completeTask(taskId, actorId, options) {
  options = options || {};
  taskId = String(taskId);
  actorId = String(actorId || '');
  if (!taskId) return { success: false, error: 'Missing task id' };

  try {
    console.log('[completeTask] start', { taskId: taskId, actorId: actorId, options: options });
    var ctx = typeof resolveTaskContext === 'function'
      ? await resolveTaskContext(taskId, actorId, options)
      : { taskId: taskId, canonicalTaskId: taskId, ids: [taskId], accepted: null, posterId: '', workerId: '' };

    if (options.posterId && !ctx.posterId) ctx.posterId = String(options.posterId);
    if (options.workerId && !ctx.workerId) ctx.workerId = String(options.workerId);
    if (options.taskRow && !ctx.task) ctx.task = options.taskRow;
    console.log('[completeTask] context', {
      canonicalTaskId: ctx.canonicalTaskId,
      posterId: ctx.posterId,
      workerId: ctx.workerId,
      ids: ctx.ids,
      hasTask: !!ctx.task,
      hasAccepted: !!ctx.accepted
    });

    var serverResult = await completeTaskViaServer(taskId, actorId, {
      posterId: ctx.posterId || options.posterId || '',
      workerId: ctx.workerId || options.workerId || '',
      // Only send canonical when it looks like a real DB task_id (UUID), not legacy 668
      canonicalTaskId: /^[0-9a-f]{8}-/i.test(String(ctx.canonicalTaskId || ''))
        ? ctx.canonicalTaskId
        : ''
    });
    console.log('[completeTask] serverResult', serverResult);

    if (!serverResult.success) {
      var idsToTry = (ctx.ids && ctx.ids.length) ? ctx.ids.slice() : [taskId];
      if (ctx.canonicalTaskId && idsToTry.indexOf(String(ctx.canonicalTaskId)) === -1) {
        idsToTry.unshift(String(ctx.canonicalTaskId));
      }

      var taskResult = { success: false, error: serverResult.error || 'Could not update task — refresh and try again' };
      for (var i = 0; i < idsToTry.length; i++) {
        taskResult = await updateTaskStatus(idsToTry[i], 'completed', {
          taskRow: ctx.task,
          posterId: ctx.posterId,
          workerId: ctx.workerId
        });
        if (taskResult.success) break;
      }
      if (!taskResult.success) return taskResult;

      var accepted = ctx.accepted;
      if (!accepted && typeof getApplicationsByTask === 'function') {
        for (var j = 0; j < idsToTry.length; j++) {
          var apps = await getApplicationsByTask(idsToTry[j]);
          accepted = (apps || []).find(function (a) {
            return String(a.status || a.STATUS || '').toLowerCase() === 'accepted';
          });
          if (accepted) break;
        }
      }
      if (accepted) {
        var appId = accepted.app_id || accepted.APP_ID || accepted.id;
        var appWorkerId = accepted.worker_id || accepted.WORKER_ID;
        var appTaskId = accepted.task_id || accepted.TASK_ID || idsToTry[0];
        await updateApplicationStatus(appId, 'completed', {
          taskId: appTaskId,
          workerId: appWorkerId
        });
      }

      if (typeof lockConversationsForTask === 'function') {
        for (var k = 0; k < idsToTry.length; k++) {
          try { await lockConversationsForTask(idsToTry[k]); } catch (lockErr) {}
        }
      }
    } else if (typeof lockConversationsForTask === 'function') {
      try { await lockConversationsForTask(serverResult.task_id || ctx.canonicalTaskId || taskId); } catch (lockErr2) {}
    }

    invalidateTasksCache();
    mergeTaskInCache(taskId, { status: 'completed', STATUS: 'completed' });
    if (ctx.canonicalTaskId && String(ctx.canonicalTaskId) !== String(taskId)) {
      mergeTaskInCache(ctx.canonicalTaskId, { status: 'completed', STATUS: 'completed' });
    }

    var release = { ok: true, skipped: true };
    var releaseId = (serverResult && serverResult.task_id) || ctx.canonicalTaskId || taskId;
    try {
      release = await releaseTaskPayout(releaseId, actorId, {
        posterId: ctx.posterId,
        workerId: ctx.workerId
      });
    } catch (releaseErr) {
      release = { ok: false, error: releaseErr.message || String(releaseErr) };
    }

    var pendingPayout = !!(release && release.error === 'worker_payout_setup_required');
    var payoutFailed = !!(release && !release.ok && !release.skipped && !pendingPayout);

    return {
      success: true,
      task_id: (serverResult && serverResult.task_id) || ctx.canonicalTaskId || taskId,
      release: release,
      pendingPayout: pendingPayout,
      payoutFailed: payoutFailed
    };
  } catch (err) {
    console.error('completeTask failed:', err);
    return { success: false, error: err.message || String(err) };
  }
}

/** Poster releases current tasker — task reopens for other applicants. */
async function releaseAcceptedTasker(taskId, appId) {
  taskId = String(taskId);
  appId = String(appId);
  if (!taskId || !appId) {
    return { success: false, error: 'Missing task or application' };
  }

  var apps = await getApplicationsByTask(taskId);
  var accepted = (apps || []).find(function (a) {
    var id = String(a.app_id || a.APP_ID || a.id || '');
    var st = String(a.status || a.STATUS || '').toLowerCase();
    return id === appId || st === 'accepted';
  });
  var workerId = accepted ? String(accepted.worker_id || accepted.WORKER_ID || '') : '';

  var appResult = await updateApplicationStatus(appId, 'declined', {
    taskId: taskId,
    workerId: workerId
  });
  if (!appResult.success) return appResult;

  var taskResult = await updateTaskStatus(taskId, 'open');
  if (!taskResult.success) return taskResult;

  var convs = await getConversationsForTask(taskId);
  if (convs && convs.length) {
    await Promise.all(convs.map(function (c) {
      return updateConversation(c.conv_id, { is_unlocked: false, status: 'application' });
    }));
  }

  invalidateTasksCache();
  invalidateAppsCache();
  mergeTaskInCache(taskId, { status: 'open', STATUS: 'open' });

  return { success: true };
}

async function declinePendingApplicationsForTask(taskId, exceptAppId) {
  var apps = await getApplicationsByTask(taskId);
  var pending = (apps || []).filter(function (a) {
    var status = (a.status || a.STATUS || 'pending').toLowerCase();
    var appId = String(a.app_id || a.APP_ID || a.id || '');
    if (exceptAppId && appId === String(exceptAppId)) return false;
    return status === 'pending';
  });
  var results = await Promise.all(pending.map(function (a) {
    return declineApplication(a.app_id || a.APP_ID || a.id, {
      taskId: taskId,
      workerId: a.worker_id || a.WORKER_ID
    });
  }));
  return results.every(function (r) { return r.success; });
}

var REVIEWS_CACHE_PREFIX = 'qg-reviews-cache-v1-';

function readReviewsCache(userId) {
  try {
    var raw = localStorage.getItem(REVIEWS_CACHE_PREFIX + String(userId));
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function writeReviewsCache(userId, reviews) {
  try {
    localStorage.setItem(REVIEWS_CACHE_PREFIX + String(userId), JSON.stringify(reviews || []));
  } catch (err) {}
}

function mergeReviewInCache(review) {
  if (!review || !review.reviewee_id) return;
  var list = readReviewsCache(review.reviewee_id);
  var key = String(review.task_id || '') + '|' + String(review.reviewer_id || '') + '|' + String(review.created_at || '');
  var next = [review].concat(list.filter(function(r) {
    var k = String(r.task_id || '') + '|' + String(r.reviewer_id || '') + '|' + String(r.created_at || '');
    return k !== key;
  }));
  writeReviewsCache(review.reviewee_id, next.slice(0, 100));
}

async function getReviewsForUser(userId) {
  var uid = encodeURIComponent(String(userId));
  var rows = await sbGet(
    'reviews',
    withSelect('reviewee_id=eq.' + uid, 'reviewee_id,rating,review_comment,reviewer_id,reviewer_name,task_id,task_title,created_at'),
    'created_at.desc',
    100
  );
  if (rows && rows.length) {
    writeReviewsCache(userId, rows);
    return rows;
  }
  return readReviewsCache(userId);
}

/**
 * Tasks a worker was hired on that reached status=completed.
 * Uses applications (accepted / completed / in_progress) + tasks.status.
 */
async function countCompletedJobsForWorker(workerId) {
  var uid = String(workerId || '');
  if (!uid || typeof sbGet !== 'function') return 0;

  var apps = typeof getApplicationsByWorker === 'function'
    ? await getApplicationsByWorker(uid)
    : await sbGet(
        'applications',
        withSelect('worker_id=eq.' + encodeURIComponent(uid), 'task_id,status'),
        null,
        500
      );
  if (!Array.isArray(apps) || !apps.length) return 0;

  var taskIds = [];
  var seen = {};
  var appCompletedFallback = 0;
  apps.forEach(function (a) {
    var st = String(a.status || a.STATUS || '').toLowerCase();
    if (st === 'completed') appCompletedFallback += 1;
    if (st !== 'accepted' && st !== 'completed' && st !== 'in_progress') return;
    var tid = String(a.task_id || a.TASK_ID || '');
    if (!tid || seen[tid]) return;
    seen[tid] = true;
    taskIds.push(tid);
  });
  if (!taskIds.length) return 0;

  var completed = 0;
  var CHUNK = 80;
  for (var i = 0; i < taskIds.length; i += CHUNK) {
    var chunk = taskIds.slice(i, i + CHUNK);
    var rows = await sbGet(
      'tasks',
      withSelect(
        'task_id=in.(' + postgrestInList(chunk) + ')&status=eq.completed',
        'task_id,status'
      ),
      null,
      chunk.length
    );
    if (Array.isArray(rows)) completed += rows.length;
  }
  // If tasks are unreadable (RLS) but apps were marked completed, use that count.
  if (completed === 0 && appCompletedFallback > 0) return appCompletedFallback;
  return completed;
}

/**
 * Public reputation for a tasker: avg rating (1 decimal), review count, completed jobs.
 */
var _taskerRepCache = {};
var TASKER_REP_CACHE_MS = 30000;

async function getTaskerReputation(userId) {
  var uid = String(userId || '');
  var empty = { avgRating: null, reviewCount: 0, completedJobs: 0, reviews: [] };
  if (!uid) return empty;

  var cached = _taskerRepCache[uid];
  if (cached && (Date.now() - cached.at) < TASKER_REP_CACHE_MS) {
    return cached.data;
  }

  var reviews = await getReviewsForUser(uid);
  if (!Array.isArray(reviews)) reviews = [];

  var sum = 0;
  var n = 0;
  reviews.forEach(function (r) {
    var rating = Number(r.rating);
    if (!rating || rating < 1) return;
    sum += rating;
    n += 1;
  });

  var completedJobs = await countCompletedJobsForWorker(uid);
  var data = {
    avgRating: n > 0 ? Math.round((sum / n) * 10) / 10 : null,
    reviewCount: n,
    completedJobs: completedJobs,
    reviews: reviews
  };
  _taskerRepCache[uid] = { at: Date.now(), data: data };
  return data;
}

/**
 * One query for many users → { [uid]: { avgRating, reviewCount } }.
 * Prefer this over N per-card review fetches.
 */
async function fetchRatingsMap(userIds) {
  var map = {};
  var ids = [];
  var seen = {};
  (userIds || []).forEach(function (id) {
    if (id == null || id === '') return;
    var key = String(id);
    if (seen[key]) return;
    seen[key] = true;
    ids.push(key);
    map[key] = { avgRating: null, reviewCount: 0 };
  });
  if (!ids.length || typeof sbGet !== 'function') return map;

  // PostgREST in.() batches — keep URL length sane
  var CHUNK = 80;
  for (var i = 0; i < ids.length; i += CHUNK) {
    var chunk = ids.slice(i, i + CHUNK);
    var filter = 'reviewee_id=in.(' + chunk.join(',') + ')';
    var rows = await sbGet(
      'reviews',
      withSelect(filter, 'reviewee_id,rating'),
      null,
      5000
    );
    (rows || []).forEach(function (r) {
      var uid = String(r.reviewee_id || '');
      if (!uid || !map[uid]) return;
      var rating = Number(r.rating);
      if (!rating) return;
      if (!map[uid]._sum) map[uid]._sum = 0;
      map[uid]._sum += rating;
      map[uid].reviewCount += 1;
    });
  }
  Object.keys(map).forEach(function (uid) {
    if (map[uid].reviewCount > 0) {
      map[uid].avgRating = Math.round((map[uid]._sum / map[uid].reviewCount) * 10) / 10;
    }
    delete map[uid]._sum;
  });
  return map;
}

/** "4.9 ★ · 12 jobs completed" or "New" when no reviews. */
function formatUserRatingLabel(avgRating, reviewCount, completedJobs) {
  var reviews = Number(reviewCount) || 0;
  var jobs = completedJobs != null && completedJobs !== ''
    ? (Number(completedJobs) || 0)
    : reviews;
  if (reviews <= 0 || avgRating == null || isNaN(Number(avgRating))) {
    if (jobs > 0) {
      return 'New \u00B7 ' + jobs + ' job' + (jobs === 1 ? '' : 's') + ' completed';
    }
    return 'New';
  }
  var a = (Math.round(Number(avgRating) * 10) / 10).toFixed(1);
  return a + ' \u2605 \u00B7 ' + jobs + ' job' + (jobs === 1 ? '' : 's') + ' completed';
}

function formatUserRatingHtml(avgRating, reviewCount, opts) {
  opts = opts || {};
  var completedJobs = opts.completedJobs;
  var label = formatUserRatingLabel(avgRating, reviewCount, completedJobs);
  var cls = 'qg-trust-rating' + (label === 'New' || label.indexOf('New') === 0 ? ' is-new' : '');
  if (opts.className) cls += ' ' + opts.className;
  return '<span class="' + cls + '">' + label + '</span>';
}

// ── User blocks ──────────────────────────────────────────────────
var _blockedIdsCache = { at: 0, userId: '', ids: null };
var BLOCKS_CACHE_MS = 120000;

async function getBlockedUserIds(userId) {
  userId = String(userId || '');
  if (!userId) return [];
  if (_blockedIdsCache.userId === userId && _blockedIdsCache.ids &&
      (Date.now() - _blockedIdsCache.at) < BLOCKS_CACHE_MS) {
    return _blockedIdsCache.ids.slice();
  }
  var set = {};
  // Canonical `blocks` + legacy `user_blocks` (merge whichever exist)
  var tables = ['blocks', 'user_blocks'];
  try {
    for (var ti = 0; ti < tables.length; ti++) {
      var table = tables[ti];
      var out = await sbGet(
        table,
        withSelect('blocker_id=eq.' + encodeURIComponent(userId), 'blocked_id'),
        null,
        500
      );
      (out || []).forEach(function (r) {
        if (r.blocked_id) set[String(r.blocked_id)] = true;
      });
      var inbound = await sbGet(
        table,
        withSelect('blocked_id=eq.' + encodeURIComponent(userId), 'blocker_id'),
        null,
        500
      );
      (inbound || []).forEach(function (r) {
        if (r.blocker_id) set[String(r.blocker_id)] = true;
      });
    }
  } catch (err) {
    console.warn('getBlockedUserIds:', err);
  }
  var ids = Object.keys(set);
  _blockedIdsCache = { at: Date.now(), userId: userId, ids: ids };
  return ids.slice();
}

function invalidateBlocksCache() {
  _blockedIdsCache = { at: 0, userId: '', ids: null };
}

function isUserBlockedLocal(userId, otherId) {
  if (!userId || !otherId) return false;
  if (_blockedIdsCache.userId !== String(userId) || !_blockedIdsCache.ids) return false;
  return _blockedIdsCache.ids.indexOf(String(otherId)) >= 0;
}

async function areUsersBlocked(userA, userB) {
  if (!userA || !userB || String(userA) === String(userB)) return false;
  var ids = await getBlockedUserIds(userA);
  return ids.indexOf(String(userB)) >= 0;
}

/**
 * Insert a user report into `reports` (do not rename columns).
 * reason must be: spam|scam|inappropriate|off_platform|other
 * target_type must be: task|user
 */
async function createReport(reportData) {
  var ALLOWED_REASONS = { spam: 1, scam: 1, inappropriate: 1, off_platform: 1, other: 1 };
  var reporterId = String((reportData && reportData.reporter_id) || '');
  var targetType = String((reportData && reportData.target_type) || '').toLowerCase();
  if (targetType === 'profile') targetType = 'user';
  var targetId = String((reportData && reportData.target_id) || '');
  var reason = String((reportData && reportData.reason) || 'other').toLowerCase();
  if (!ALLOWED_REASONS[reason]) reason = 'other';
  if (!reporterId || !targetId) return { success: false, error: 'missing_report_fields' };
  if (targetType !== 'task' && targetType !== 'user') {
    return { success: false, error: 'invalid_target_type' };
  }
  var row = {
    reporter_id: reporterId,
    target_type: targetType,
    target_id: targetId,
    reason: reason,
    detail: String((reportData && reportData.detail) || '').trim() || null,
    status: 'open',
    created_at: new Date().toISOString()
  };
  var result = await sbPost('reports', row);
  if (!result.success) {
    // Some older schemas used `details` instead of `detail`
    var alt = Object.assign({}, row);
    alt.details = alt.detail;
    delete alt.detail;
    result = await sbPost('reports', alt);
  }
  return result;
}

async function blockUser(blockerId, blockedId) {
  blockerId = String(blockerId || '');
  blockedId = String(blockedId || '');
  if (!blockerId || !blockedId) return { success: false, error: 'missing_ids' };
  if (blockerId === blockedId) return { success: false, error: 'cannot_block_self' };
  var row = { blocker_id: blockerId, blocked_id: blockedId };
  var result = await sbPost('blocks', row);
  if (!result.success) {
    var err = String(result.error || '');
    if (err.indexOf('23505') >= 0 || err.toLowerCase().indexOf('duplicate') >= 0) {
      invalidateBlocksCache();
      return { success: true, already: true };
    }
    // Legacy table name
    if (err.indexOf('42P01') >= 0 || err.toLowerCase().indexOf('blocks') >= 0) {
      result = await sbPost('user_blocks', row);
      err = String(result.error || '');
      if (result.success) {
        invalidateBlocksCache();
        return result;
      }
      if (err.indexOf('23505') >= 0 || err.toLowerCase().indexOf('duplicate') >= 0) {
        invalidateBlocksCache();
        return { success: true, already: true };
      }
      if (err.indexOf('42P01') >= 0 || err.indexOf('user_blocks') >= 0) {
        return { success: false, error: 'blocks_table_missing' };
      }
    }
  }
  invalidateBlocksCache();
  return result;
}

async function unblockUser(blockerId, blockedId) {
  blockerId = String(blockerId || '');
  blockedId = String(blockedId || '');
  if (!blockerId || !blockedId) return { success: false, error: 'missing_ids' };
  var filter =
    'blocker_id=eq.' + encodeURIComponent(blockerId) +
    '&blocked_id=eq.' + encodeURIComponent(blockedId);
  var result = await sbDelete('blocks', filter);
  if (!result.success) {
    result = await sbDelete('user_blocks', filter);
  }
  invalidateBlocksCache();
  return result;
}

async function submitReview(reviewData) {
  if (!reviewData || !reviewData.reviewer_id || !reviewData.reviewee_id || !reviewData.task_id) {
    return { success: false, error: 'missing_review_fields' };
  }
  // FIRST-PASS content moderation (lists in contentModeration.js). Server + API later.
  var commentCheck = String(reviewData.review_comment || '');
  if (commentCheck && typeof moderateText === 'function') {
    var modCheck = moderateText(commentCheck);
    if (modCheck.blocked) {
      if (typeof logModerationAttempt === 'function') {
        logModerationAttempt({
          userId: reviewData.reviewer_id,
          source: 'review',
          targetType: 'review',
          targetId: reviewData.task_id,
          flags: modCheck.flags,
          preview: commentCheck,
          message: modCheck.message
        });
      }
      return {
        success: false,
        error: 'content_moderation',
        blocked: true,
        message: modCheck.message || '',
        flags: modCheck.flags || []
      };
    }
  }
  var taskId = String(reviewData.task_id).trim();
  // Prefer canonical UUID when the UI still has a legacy numeric id
  if (taskId && !isUuidLikeId(taskId) && typeof getTaskById === 'function') {
    try {
      var taskRow = await getTaskById(taskId);
      var resolved = taskRow && (taskRow.task_id || taskRow.TASK_ID || taskRow.id);
      if (resolved) taskId = String(resolved);
    } catch (e) {}
  }
  var rating = Number(reviewData.rating);
  if (!rating || rating < 1 || rating > 5) {
    return { success: false, error: 'invalid_rating' };
  }
  var tags = Array.isArray(reviewData.tags) ? reviewData.tags.filter(Boolean) : [];
  var row = {
    task_id:        taskId,
    reviewer_id:    String(reviewData.reviewer_id),
    reviewee_id:    String(reviewData.reviewee_id),
    rating:         rating,
    review_comment: String(reviewData.review_comment || ''),
    reviewer_name:  reviewData.reviewer_name || '',
    task_title:     reviewData.task_title || '',
    tags:           tags.length ? tags.join(', ') : null
  };
  var result = await sbPost('reviews', row);
  if (!result.success) {
    var errText = String(result.error || '');
    if (errText.indexOf('column') >= 0 || errText.indexOf('PGRST204') >= 0) {
      result = await sbPost('reviews', {
        task_id: row.task_id,
        reviewer_id: row.reviewer_id,
        reviewee_id: row.reviewee_id,
        rating: row.rating,
        review_comment: row.review_comment
      });
    }
  }
  if (result.success) {
    mergeReviewInCache(Object.assign({}, row, {
      created_at: new Date().toISOString()
    }));
    return result;
  }
  var err = String(result.error || '');
  var errLower = err.toLowerCase();
  if (err.indexOf('reviews_task_reviewer_uniq') >= 0 || errLower.indexOf('duplicate') >= 0 || err.indexOf('23505') >= 0) {
    return { success: false, error: 'already_reviewed' };
  }
  if (err.indexOf('401') >= 0 || err.indexOf('403') >= 0 ||
      err.indexOf('42501') >= 0 || errLower.indexOf('row-level') >= 0) {
    return { success: false, error: 'reviews_rls_blocked' };
  }
  if (err.indexOf('relation "reviews" does not exist') >= 0 || err.indexOf('42P01') >= 0 ||
      err.indexOf('PGRST205') >= 0 || errLower.indexOf("could not find the table") >= 0) {
    return { success: false, error: 'reviews_table_missing' };
  }
  if (err.indexOf('22P02') >= 0 || errLower.indexOf('invalid input syntax for type uuid') >= 0) {
    return { success: false, error: 'reviews_task_id_type' };
  }
  if (err.indexOf('23503') >= 0 || errLower.indexOf('foreign key') >= 0 || errLower.indexOf('reviews_task_id_fkey') >= 0) {
    return { success: false, error: 'reviews_task_id_type' };
  }
  // Any other reviews insert failure → point at reviews.sql (not tasks-beta-fix)
  return { success: false, error: 'reviews_save_failed' };
}

function pickBestPaymentRow(rows) {
  if (!rows || !rows.length) return null;
  var rank = function (p) {
    var st = String(p.status || '').toLowerCase();
    if (st === 'paid' || st === 'completed') return 4;
    if (st === 'held') return 3;
    if (st === 'pending') return 1;
    return 0;
  };
  var best = rows[0];
  for (var i = 1; i < rows.length; i++) {
    if (rank(rows[i]) > rank(best)) best = rows[i];
  }
  return best;
}

function isUuidLikeId(val) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(val || '').trim()
  );
}

async function getPaymentByTask(taskId, options) {
  options = options || {};
  var rank = function (p) {
    var st = String(p.status || '').toLowerCase();
    if (st === 'paid' || st === 'completed') return 4;
    if (st === 'held') return 3;
    if (st === 'pending') return 1;
    return 0;
  };
  var best = null;

  // Prefer poster+worker lookup — payments.task_id is UUID in production; UI often has legacy numeric ids
  if (options.posterId && options.workerId) {
    var byPair = await sbGet(
      'payments',
      withSelect(
        'poster_id=eq.' + encodeURIComponent(options.posterId) +
          '&worker_id=eq.' + encodeURIComponent(options.workerId),
        SELECT_PAYMENTS
      ),
      'created_at.desc',
      20
    );
    best = pickBestPaymentRow(byPair);
    if (best) return best;
  }

  if (options.posterId && typeof getPaymentsForUser === 'function') {
    var posterPays = await getPaymentsForUser(options.posterId, 'poster');
    var filtered = (posterPays || []).filter(function (p) {
      if (options.workerId && String(p.worker_id) !== String(options.workerId)) return false;
      return true;
    });
    best = pickBestPaymentRow(filtered);
    // Return when worker matched, or poster has exactly one payment row
    if (best && (options.workerId || filtered.length === 1)) return best;
  }

  var ids = [];
  function addId(v) {
    if (v == null || v === '') return;
    var s = String(v);
    // Live payments.task_id is UUID — never query it with bare integers like "668"
    if (!isUuidLikeId(s) && /^\d+$/.test(s)) return;
    if (ids.indexOf(s) === -1) ids.push(s);
  }
  addId(taskId);
  if (typeof getTaskById === 'function') {
    var task = await getTaskById(taskId, {
      posterId: options.posterId,
      workerId: options.workerId
    });
    if (task) {
      addId(task.task_id);
      addId(task.TASK_ID);
    }
  }
  for (var i = 0; i < ids.length; i++) {
    var mePay = currentActorId(options);
    var payFilter = 'task_id=eq.' + encodeURIComponent(ids[i]);
    if (mePay) {
      payFilter += '&or=(poster_id.eq.' + encodeURIComponent(mePay) + ',worker_id.eq.' + encodeURIComponent(mePay) + ')';
    } else if (options.posterId || options.workerId) {
      var parts = [];
      if (options.posterId) parts.push('poster_id.eq.' + encodeURIComponent(options.posterId));
      if (options.workerId) parts.push('worker_id.eq.' + encodeURIComponent(options.workerId));
      if (parts.length) payFilter += '&or=(' + parts.join(',') + ')';
    } else {
      continue;
    }
    var results = await sbGet('payments', withSelect(payFilter, SELECT_PAYMENTS), 'created_at.desc', 20);
    var row = pickBestPaymentRow(results);
    if (row && (!best || rank(row) > rank(best))) best = row;
  }
  if (!best && options.actorId && typeof getPaymentsForUser === 'function') {
    var userRows = await getPaymentsForUser(options.actorId, options.actorRole || 'poster');
    var pairRows = (userRows || []).filter(function (p) {
      if (options.posterId && String(p.poster_id) !== String(options.posterId)) return false;
      if (options.workerId && String(p.worker_id) !== String(options.workerId)) return false;
      return true;
    });
    best = pickBestPaymentRow(pairRows);
  }
  return best;
}

async function syncConversationUnlock(convId, actorId) {
  var cfg = window.QG_CONFIG || {};
  var url = cfg.confirmCheckoutUrl ||
    'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/confirm-checkout';
  if (!convId || typeof getSupabaseHeaders !== 'function') {
    return { ok: false, error: 'missing_conv_or_auth' };
  }
  try {
    var headers = await getSupabaseHeaders();
    var res = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        conv_id: String(convId),
        actor_id: String(actorId || '')
      })
    });
    var data = {};
    try { data = await res.json(); } catch (e) { data = { ok: false, error: 'Invalid response' }; }
    if (!res.ok && data.ok !== false) data.ok = false;
    return data;
  } catch (err) {
    console.error('syncConversationUnlock failed:', err);
    return { ok: false, error: err.message || String(err) };
  }
}

function isPaymentStatusComplete(status) {
  var st = String(status || '').toLowerCase();
  return st === 'held' || st === 'disputed' || st === 'paid' || st === 'completed';
}

async function isTaskPaymentComplete(taskId) {
  if (typeof getPaymentByTask !== 'function') return false;
  var row = await getPaymentByTask(taskId);
  return row && isPaymentStatusComplete(row.status);
}

async function ensureChatReadyForTask(taskId, actorId, options) {
  options = options || {};
  taskId = String(taskId || '');
  if (!taskId) return { ok: false, error: 'missing_task' };

  if (options.sessionId && typeof window.QG_confirmCheckoutSession === 'function') {
    await window.QG_confirmCheckoutSession(options.sessionId);
  } else if (!options.skipSync && typeof window.QG_syncPendingPayments === 'function' && actorId) {
    if (typeof withTimeout === 'function') {
      await withTimeout(window.QG_syncPendingPayments(actorId), 2000, null);
    } else {
      await window.QG_syncPendingPayments(actorId);
    }
  }

  var task = typeof getTaskById === 'function' ? await getTaskById(taskId) : null;
  if (!task) return { ok: false, error: 'task_not_found' };

  var posterId = task.posted_by || task.POSTED_BY;
  var apps = typeof getApplicationsByTask === 'function' ? await getApplicationsByTask(taskId) : [];
  var accepted = (apps || []).find(function (a) {
    return String(a.status || a.STATUS || '').toLowerCase() === 'accepted';
  });
  if (!accepted) return { ok: false, error: 'no_accepted_worker' };

  var workerId = accepted.worker_id || accepted.WORKER_ID;
  if (String(workerId) === String(posterId)) {
    return { ok: false, error: 'self_task' };
  }

  var paid = await isTaskPaymentComplete(taskId);
  if (!paid && options.sessionId && typeof window.QG_confirmCheckoutSession === 'function') {
    await window.QG_confirmCheckoutSession(options.sessionId);
    paid = await isTaskPaymentComplete(taskId);
  }
  if (!paid && typeof window.QG_waitForPaymentHeld === 'function') {
    paid = await window.QG_waitForPaymentHeld(taskId, options.sessionId ? 3000 : 4000);
  }
  if (!paid) {
    var convExisting = typeof getConversationForTask === 'function'
      ? await getConversationForTask(taskId, posterId, workerId)
      : null;
    return {
      ok: false,
      error: 'not_paid',
      posterId: posterId,
      workerId: workerId,
      conv_id: convExisting && convExisting.conv_id ? convExisting.conv_id : undefined
    };
  }

  var conv = typeof getConversationForTask === 'function'
    ? await getConversationForTask(taskId, posterId, workerId)
    : null;

  if ((!conv || !conv.conv_id) && typeof createConversation === 'function') {
    var created = await createConversation({
      task_id: taskId,
      poster_id: posterId,
      worker_id: workerId,
      task_title: task.title || task.TITLE,
      task_category: task.category || task.CATEGORY,
      status: 'in_progress',
      is_unlocked: false
    });
    if (created && created.data) conv = created.data;
    if (!conv || !conv.conv_id) {
      conv = await getConversationForTask(taskId, posterId, workerId);
    }
  }

  if (!conv || !conv.conv_id) return { ok: false, error: 'no_conversation', paid: true };

  var unlock = typeof forceUnlockConversationForTask === 'function'
    ? await forceUnlockConversationForTask(conv, 'in_progress')
    : { success: true, conv: conv };

  return {
    ok: true,
    paid: true,
    conv_id: conv.conv_id,
    unlocked: !!(unlock && unlock.success),
    conv: (unlock && unlock.conv) || conv,
    posterId: posterId,
    workerId: workerId
  };
}

async function getPaymentsForUser(userId, role, opts) {
  if (!userId) return [];
  opts = opts || {};
  var me = currentActorId();
  if (me && String(me) !== String(userId)) return [];
  var col = role === 'poster' ? 'poster_id' : 'worker_id';
  var limit = opts.limit != null ? opts.limit : 20;
  return await sbGet(
    'payments',
    withSelect(col + '=eq.' + encodeURIComponent(String(userId)), SELECT_PAYMENTS),
    'created_at.desc',
    limit
  );
}

async function refundTaskPayment(taskId, actorId) {
  var cfg = window.QG_CONFIG || {};
  if (!cfg.paymentsEnabled) return { ok: true, skipped: true };

  var payment = await getPaymentByTask(taskId);
  if (!payment) return { ok: true, skipped: true };

  var st = String(payment.status || '').toLowerCase();
  if (st === 'refunded') return { ok: true, already: true };
  if (st === 'paid') return { ok: false, error: 'already_released_use_dispute' };
  if (st !== 'held') return { ok: true, skipped: true };

  if (typeof getSupabaseHeaders !== 'function') {
    return { ok: false, error: 'Database not loaded' };
  }

  var url = cfg.refundPaymentUrl ||
    'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/refund-payment';
  try {
    var headers = await getSupabaseHeaders();
    var res = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        task_id: String(taskId),
        actor_id: String(actorId || '')
      })
    });
    var data = {};
    try { data = await res.json(); } catch (e) { data = { ok: false, error: 'Invalid response' }; }
    if (!res.ok && data.ok !== false) data.ok = false;
    return data;
  } catch (err) {
    console.error('refundTaskPayment failed:', err);
    return { ok: false, error: err.message || String(err) };
  }
}

async function releaseTaskPayout(taskId, actorId, options) {
  options = options || {};
  var cfg = window.QG_CONFIG || {};
  if (!cfg.paymentsEnabled) return { ok: true, skipped: true };

  var payment = await getPaymentByTask(taskId, {
    posterId: options.posterId,
    workerId: options.workerId,
    actorId: actorId
  });
  if (!payment) return { ok: true, skipped: true };

  var st = String(payment.status || '').toLowerCase();
  if (st === 'paid' || st === 'completed') return { ok: true, already: true };
  if (st === 'disputed') {
    return {
      ok: false,
      error: 'payment_disputed',
      message: 'Escrow is frozen while a dispute is open.'
    };
  }
  if (st !== 'held') return { ok: true, skipped: true };

  if (typeof getSupabaseHeaders !== 'function') {
    return { ok: false, error: 'Database not loaded' };
  }

  var url = cfg.releasePayoutUrl ||
    'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/release-payout';
  try {
    if (typeof callVerifiedFunction === 'function') {
      var verifiedRelease = await callVerifiedFunction(url, {
        task_id: String(payment.task_id || taskId),
        poster_id: String(options.posterId || payment.poster_id || ''),
        worker_id: String(options.workerId || payment.worker_id || '')
      });
      if (verifiedRelease.ok == null) verifiedRelease.ok = verifiedRelease.success === true;
      return verifiedRelease;
    }
    var headers = await getSupabaseHeaders();
    var res = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        task_id: String(payment.task_id || taskId),
        actor_id: String(actorId || ''),
        poster_id: String(options.posterId || payment.poster_id || ''),
        worker_id: String(options.workerId || payment.worker_id || '')
      })
    });
    var data = {};
    try { data = await res.json(); } catch (e) { data = { ok: false, error: 'Invalid response' }; }
    if (!res.ok && data.ok !== false) data.ok = false;
    if (data.error && typeof data.error === 'object') {
      data.error = data.error.message || data.error.error || JSON.stringify(data.error);
    }
    return data;
  } catch (err) {
    console.error('releaseTaskPayout failed:', err);
    return { ok: false, error: err.message || String(err) };
  }
}

async function savePayment(paymentData) {
  var result = await sbPost('payments', {
    task_id:       paymentData.task_id,
    poster_id:     paymentData.poster_id,
    worker_id:     paymentData.worker_id,
    amount:        paymentData.amount,
    platform_fee:  paymentData.platform_fee,
    worker_payout: paymentData.worker_payout,
    stripe_id:     paymentData.stripe_id || '',
    status:        paymentData.status || 'completed'
  });
  if (result.success && paymentData.task_id && paymentData.poster_id && paymentData.worker_id) {
    await unlockChatForTask(paymentData.task_id, paymentData.poster_id, paymentData.worker_id);
  }
  return result;
}

async function unlockChatForTask(taskId, posterId, workerId) {
  var conv = await getConversationForTask(taskId, posterId, workerId);
  if (!conv || !conv.conv_id) return { success: false, error: 'No conversation' };
  var taskRow = typeof getTaskById === 'function' ? await getTaskById(taskId) : null;
  var taskStatus = taskRow ? (taskRow.status || taskRow.STATUS || '') : 'in_progress';
  var result = await forceUnlockConversationForTask(conv, taskStatus);
  // Escrow/unlock: clear sliding-window contact buffers (legitimate open chat)
  if (result && result.success && typeof clearConversationFraudBuffers === 'function') {
    clearConversationFraudBuffers(conv.conv_id, posterId || conv.poster_id, workerId || conv.worker_id);
  } else if (result && result.success && typeof clearBuffer === 'function') {
    clearBuffer(conv.conv_id, posterId || conv.poster_id);
    clearBuffer(conv.conv_id, workerId || conv.worker_id);
  }
  return result;
}

var INAPP_BODY = {
  application_received: function (p) {
    return (p.workerName || 'A tasker') + ' applied' + (p.offer ? ' · $' + p.offer : '') + '. Tap to review.';
  },
  application_accepted: function (p) {
    return (p.posterName || 'The poster') + ' accepted you for “' + (p.taskTitle || 'a task') + '”.';
  },
  task_completed: function (p) {
    return '“' + (p.taskTitle || 'Your task') + '” is done — leave a review when you can.';
  },
  new_message: function (p) {
    return (p.senderName || 'Someone') + ': “' + (p.preview || 'New message') + '”';
  },
  counter_offer_received: function (p) {
    return (p.posterName || 'The poster') + ' countered at $' + (p.amount || '?') + ' for “' + (p.taskTitle || 'a task') + '”. Tap to respond.';
  },
  counter_offer_reply: function (p) {
    return (p.workerName || 'A tasker') + ' countered back at $' + (p.amount || '?') + ' on “' + (p.taskTitle || 'a task') + '”.';
  },
  counter_offer_accepted: function (p) {
    return (p.partyName || 'They') + ' accepted $' + (p.amount || '?') + ' for “' + (p.taskTitle || 'a task') + '”.';
  },
  task_removed_admin: function (p) {
    return 'Your task “' + (p.taskTitle || '') + '” was removed. Reason: ' + (p.reason || 'See email for details');
  },
  task_removed_applicant: function (p) {
    return '“' + (p.taskTitle || 'A task') + '” was removed — ' + (p.reason || 'see email for details');
  },
  new_gig_match: function (p) {
    var bits = [];
    if (p.location) bits.push(p.location);
    if (p.budget) bits.push('$' + p.budget);
    if (p.distanceKm != null) bits.push('~' + p.distanceKm + ' km');
    return '“' + (p.taskTitle || 'New gig') + '”' + (bits.length ? ' · ' + bits.join(' · ') : '') + '. Tap to view.';
  }
};

var INAPP_TITLE = {
  application_received: function (p) { return '👤 New applicant'; },
  application_accepted: function (p) { return '🎉 You were hired!'; },
  task_completed: function (p) { return '✅ Task complete'; },
  new_message: function (p) { return '💬 New message'; },
  counter_offer_received: function (p) { return '💰 Counter offer'; },
  counter_offer_reply: function (p) { return '↩️ Counter back'; },
  counter_offer_accepted: function (p) { return '✓ Price agreed'; },
  task_removed_admin: function (p) { return '🚫 Task removed'; },
  task_removed_applicant: function (p) { return '🚫 Task removed'; },
  new_gig_match: function (p) { return '📍 New gig near you'; }
};

async function pushInAppNotification(opts) {
  if (!opts || !opts.userId || !opts.type) return { success: false };
  var payload = opts.payload || {};
  var titleFn = INAPP_TITLE[opts.type];
  var bodyFn = INAPP_BODY[opts.type];
  var row = {
    user_id: opts.userId,
    type: opts.type,
    title: opts.title || (titleFn ? titleFn(payload) : opts.type),
    body: opts.body || (bodyFn ? bodyFn(payload) : ''),
    link: opts.link || payload.link || '',
    payload: payload
  };
  if (typeof sbPostReturn === 'function') {
    return await sbPostReturn('user_notifications', row);
  }
  if (typeof sbPost === 'function') {
    return await sbPost('user_notifications', row);
  }
  return { success: false, error: 'no_db' };
}

async function fetchUserNotifications(userId, limit) {
  if (!userId) return [];
  var rows = await sbGet(
    'user_notifications',
    'user_id=eq.' + encodeURIComponent(userId),
    'created_at.desc',
    limit || 40
  );
  return Array.isArray(rows) ? rows : [];
}

async function getUnreadNotificationCount(userId) {
  if (!userId) return 0;
  var rows = await sbGet(
    'user_notifications',
    'user_id=eq.' + encodeURIComponent(userId) + '&read_at=is.null',
    'created_at.desc',
    99
  );
  return Array.isArray(rows) ? rows.length : 0;
}

async function markNotificationRead(notificationId) {
  if (!notificationId) return { success: false };
  return await sbUpdate(
    'user_notifications',
    { read_at: new Date().toISOString() },
    'notification_id=eq.' + encodeURIComponent(String(notificationId))
  );
}

async function markAllNotificationsRead(userId) {
  if (!userId) return { success: false };
  return await sbUpdate(
    'user_notifications',
    { read_at: new Date().toISOString() },
    'user_id=eq.' + encodeURIComponent(userId) + '&read_at=is.null'
  );
}

async function getSavedTaskIds(userId) {
  if (!userId) return [];
  var rows = await sbGet(
    'saved_tasks',
    'user_id=eq.' + encodeURIComponent(userId),
    'created_at.desc',
    200
  );
  if (!Array.isArray(rows)) return [];
  return rows.map(function (r) { return r.task_id || r.TASK_ID; }).filter(Boolean);
}

async function saveTask(userId, taskId) {
  if (!userId || !taskId) return { success: false };
  var result = await sbPostReturn('saved_tasks', {
    user_id: userId,
    task_id: String(taskId)
  });
  if (!result.success && /duplicate|unique|23505/i.test(String(result.error || ''))) {
    return { success: true, duplicate: true };
  }
  return result;
}

async function unsaveTask(userId, taskId) {
  if (!userId || !taskId) return { success: false };
  return await sbDelete(
    'saved_tasks',
    'user_id=eq.' + encodeURIComponent(userId) + '&task_id=eq.' + encodeURIComponent(String(taskId))
  );
}

window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
window.getSupabaseHeaders = getSupabaseHeaders;
window.refreshSupabaseAuth = refreshSupabaseAuth;
window.callVerifiedFunction = callVerifiedFunction;
window.SELECT_TASKS_BROWSE = SELECT_TASKS_BROWSE;
window.SELECT_TASKS_DASH = SELECT_TASKS_DASH;
window.SELECT_TASKS_DETAIL = SELECT_TASKS_DETAIL;
window.SELECT_APPLICATIONS = SELECT_APPLICATIONS;
window.SELECT_USERS_PUBLIC = SELECT_USERS_PUBLIC;
window.SELECT_USERS_PUBLIC_CARD = SELECT_USERS_PUBLIC_CARD;
window.SELECT_USERS_SELF = SELECT_USERS_SELF;
window.SELECT_USERS_SELF_CORE = SELECT_USERS_SELF_CORE;
window.SELECT_REVIEWS = SELECT_REVIEWS;
window.withSelect = withSelect;
window.SUPABASE_HEADERS = SUPABASE_HEADERS;
window.SB_HEADERS = SUPABASE_HEADERS;
window.HEADERS = SUPABASE_HEADERS;
window.sbGet = sbGet;
window.sbGetOrThrow = sbGetOrThrow;
window.sbCount = sbCount;
window.getOpenTasksPage = getOpenTasksPage;
window.countOpenTasks = countOpenTasks;
window.BROWSE_PAGE_SIZE = BROWSE_PAGE_SIZE;
window.getTasks = getTasks;
window.getAllTasks = getAllTasks;
window.fetchTasksWithCache = fetchTasksWithCache;
window.fetchAllTasksFresh = fetchAllTasksFresh;
window.fetchDashboardBootstrap = fetchDashboardBootstrap;
window.fetchPosterAppsForTasks = fetchPosterAppsForTasks;
window.fetchWorkerPostedTasks = fetchWorkerPostedTasks;
window.fetchMyTasksBundle = fetchMyTasksBundle;
window.taskPostedByUser = taskPostedByUser;
window.withTimeout = withTimeout;
window.mergeTaskLists = mergeTaskLists;
window.mergeApplicationLists = mergeApplicationLists;
window.fetchAllApplicationsFresh = fetchAllApplicationsFresh;
window.fetchApplicationsForActor = fetchApplicationsForActor;
window.readTasksCache = readTasksCache;
window.readAppsCache = readAppsCache;
window.writeAppsCache = writeAppsCache;
window.writeTasksCache = writeTasksCache;
window.invalidateUserProfileCache = invalidateUserProfileCache;
window.mergeTaskInCache = mergeTaskInCache;
window.mergeApplicationInCache = mergeApplicationInCache;
window.invalidateTasksCache = invalidateTasksCache;
window.isSupabaseUsingStaleCache = function() { return !!window._supabaseUsingStaleCache; };
window.getTasksByUser = getTasksByUser;
window.getTaskById = getTaskById;
window.lockConversationsForTask = lockConversationsForTask;
window.postTask = postTask;
window.repostTask = repostTask;
window.uploadTaskPhoto = uploadTaskPhoto;
window.uploadProfilePhoto = uploadProfilePhoto;
window.uploadChatPhoto = uploadChatPhoto;
window.isChatImageBody = isChatImageBody;
window.parseChatImageUrl = parseChatImageUrl;
window.CHAT_IMAGE_PREFIX = CHAT_IMAGE_PREFIX;
window.parsePhotoUrls = parsePhotoUrls;
window.updateTaskStatus = updateTaskStatus;
window.getUsers = getUsers;
window.saveUser = saveUser;
window.normalizeAlertCategories = normalizeAlertCategories;
window.upsertUserProfile = upsertUserProfile;
window.syncCurrentUserProfile = syncCurrentUserProfile;
window.getUserLoginGate = getUserLoginGate;
window.getUserByFirebaseUid = getUserByFirebaseUid;
window.getUserNameByFirebaseUid = getUserNameByFirebaseUid;
window.getUsersNameMap = getUsersNameMap;
window.getUserAvatarUrl = getUserAvatarUrl;
window.getUsersAvatarMap = getUsersAvatarMap;
window.currentUserHasProfilePhoto = currentUserHasProfilePhoto;
window.ensureTaskerProfilePhoto = ensureTaskerProfilePhoto;
window.resolveUserAvatarUrl = resolveUserAvatarUrl;
window.readLocalProfileAvatar = readLocalProfileAvatar;
window.readLocalProfileExtras = readLocalProfileExtras;
window.parseUserSkills = parseUserSkills;
window.applyDbUserToProfileData = applyDbUserToProfileData;
window.getUserByGuardianToken = getUserByGuardianToken;
window.approveGuardianConsent = approveGuardianConsent;
window.isAccountPendingGuardian = isAccountPendingGuardian;
window.getAccountActionPermission = getAccountActionPermission;
window.syncProfilePhotoToDb = syncProfilePhotoToDb;
window.resolveUserName = resolveUserName;
window.isGenericDisplayName = isGenericDisplayName;
window.enrichConversationNames = enrichConversationNames;
window.getConversationsForUser = getConversationsForUser;
window.getConversation = getConversation;
window.getConversationForTask = getConversationForTask;
window.createConversation = createConversation;
window.unlockConversationIfAllowed = unlockConversationIfAllowed;
window.forceUnlockConversationForTask = forceUnlockConversationForTask;
window.parseConversationUnlocked = parseConversationUnlocked;
window.updateConversation = updateConversation;
window.getMessagesForConversation = getMessagesForConversation;
window.sendChatMessage = sendChatMessage;
window.sendSystemChatMessage = sendSystemChatMessage;
window.markConversationRead = markConversationRead;
window.getApplicationsByTask = getApplicationsByTask;
window.getApplicationsByWorker = getApplicationsByWorker;
window.getAllApplications = getAllApplications;
window.submitApplication = submitApplication;
window.submitApplicationToDb = submitApplication;
window.updateApplicationStatus = updateApplicationStatus;
window.patchApplicationFields = patchApplicationFields;
window.posterSendCounterOffer = posterSendCounterOffer;
window.workerRespondToCounter = workerRespondToCounter;
window.posterRespondToCounter = posterRespondToCounter;
window.isTaskBudgetNegotiable = isTaskBudgetNegotiable;
window.parseNegotiationFields = parseNegotiationFields;
window.hasPendingApplicationCounter = hasPendingApplicationCounter;
window.getEffectiveApplicationPrice = getEffectiveApplicationPrice;
window.formatSupabaseActionError = formatSupabaseActionError;
window.formatUploadError = formatUploadError;
window.cancelApplication = cancelApplication;
window.declineApplication = declineApplication;
window.cancelTask = cancelTask;
window.adminRemoveTaskWithReason = adminRemoveTaskWithReason;
window.completeTask = completeTask;
window.completeTaskViaServer = completeTaskViaServer;
window.resolveTaskContext = resolveTaskContext;
window.releaseAcceptedTasker = releaseAcceptedTasker;
window.declinePendingApplicationsForTask = declinePendingApplicationsForTask;
window.getReviewsForUser = getReviewsForUser;
window.countCompletedJobsForWorker = countCompletedJobsForWorker;
window.getTaskerReputation = getTaskerReputation;
window.fetchRatingsMap = fetchRatingsMap;
window.formatUserRatingLabel = formatUserRatingLabel;
window.formatUserRatingHtml = formatUserRatingHtml;
window.createReport = createReport;
window.getBlockedUserIds = getBlockedUserIds;
window.areUsersBlocked = areUsersBlocked;
window.blockUser = blockUser;
window.unblockUser = unblockUser;
window.invalidateBlocksCache = invalidateBlocksCache;
window.isUserBlockedLocal = isUserBlockedLocal;
window.submitReview = submitReview;
window.readReviewsCache = readReviewsCache;
window.mergeReviewInCache = mergeReviewInCache;
window.getPaymentByTask = getPaymentByTask;
window.syncConversationUnlock = syncConversationUnlock;
window.getPaymentsForUser = getPaymentsForUser;
window.isTaskPaymentComplete = isTaskPaymentComplete;
window.isPaymentStatusComplete = isPaymentStatusComplete;
window.ensureChatReadyForTask = ensureChatReadyForTask;
window.releaseTaskPayout = releaseTaskPayout;
window.refundTaskPayment = refundTaskPayment;
window.savePayment = savePayment;
window.unlockChatForTask = unlockChatForTask;
window.pushInAppNotification = pushInAppNotification;
window.fetchUserNotifications = fetchUserNotifications;
window.getUnreadNotificationCount = getUnreadNotificationCount;
window.markNotificationRead = markNotificationRead;
window.markAllNotificationsRead = markAllNotificationsRead;
window.getSavedTaskIds = getSavedTaskIds;
window.saveTask = saveTask;
window.unsaveTask = unsaveTask;
window.sbDelete = sbDelete;
window.sbPost = sbPost;
window.sbPostReturn = sbPostReturn;
window.sbUpdate = sbUpdate;
