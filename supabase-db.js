// ================================================================
// QuickGigs — Supabase Database Utility
// All data pages import this file via <script src="supabase-db.js">
// Project URL: https://nuyfqsxstsrbloztzgau.supabase.co
// ================================================================

const SUPABASE_URL = 'https://nuyfqsxstsrbloztzgau.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51eWZxc3hzdHNyYmxvenR6Z2F1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NzkyNjUsImV4cCI6MjA5ODU1NTI2NX0.UpagWLifoxHmWu30lNnBO89gNYKIh4KxtYu28DKlSBM';

const SUPABASE_HEADERS = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
};

/** Supabase REST auth — anon key by default; Firebase JWT only when configured. */
async function getSupabaseHeaders(extra, opts) {
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
  return await getSupabaseHeaders();
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

async function sbGetOrThrow(table, filters, order, limit) {
  var controller = new AbortController();
  var timeoutId = setTimeout(function () { controller.abort(); }, 8000);
  try {
    var qs = [];
    if (filters) qs.push(filters);
    if (order === undefined) qs.push('order=created_at.desc');
    else if (order) qs.push('order=' + order);
    if (limit) qs.push('limit=' + limit);
    var url = SUPABASE_URL + '/rest/v1/' + table + (qs.length ? '?' + qs.join('&') : '');
    var headers = await getSupabaseHeaders();
    var res = await fetch(url, { method: 'GET', headers: headers, signal: controller.signal });
    if (!res.ok) {
      var errText = await res.text();
      throw new Error('GET ' + table + ' failed: ' + res.status + (errText ? ' ' + errText : ''));
    }
    return await res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function sbGet(table, filters, order, limit) {
  try {
    return await sbGetOrThrow(table, filters, order, limit);
  } catch (err) {
    console.error('Supabase GET error:', err);
    return [];
  }
}

async function sbGetTasksList(filters, limit) {
  var orders = ['created_at.desc', 'task_id.desc', null];
  var lastErr = null;
  for (var i = 0; i < orders.length; i++) {
    try {
      return await sbGetOrThrow('tasks', filters, orders[i], limit || 200);
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
    var stale = await sbGet('tasks', 'status=eq.open&created_at=lt.' + encodeURIComponent(cutoff), 'created_at.asc', 50);
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
  await expireStaleOpenTasksOnce();
  var rows = await sbGetTasksList('status=eq.open', 100);
  return filterBrowseableTasks(rows);
}

async function getAllTasks() {
  return await sbGetTasksList(null, 100);
}

async function fetchTasksWithCache() {
  var cached = readTasksCache();
  if (cached) {
    fetchAllTasksFresh();
    return cached;
  }
  return await fetchAllTasksFresh();
}

async function fetchAllTasksFresh() {
  var stale = readTasksCache(true);
  try {
    var items = await sbGetTasksList(null, 200);
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

async function fetchAllApplicationsFresh() {
  var stale = readAppsCache(true);
  try {
    var rows = await sbGetOrThrow('applications', null, 'created_at.desc', 200);
    var list = (rows || []).map(normalizeApplicationRow);
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

async function getTaskById(taskId) {
  var filters = buildTaskIdFilters(taskId, null);
  for (var i = 0; i < filters.length; i++) {
    var results = await sbGet('tasks', filters[i]);
    if (results && results[0]) return normalizeTaskRow(results[0]);
  }
  return null;
}

async function getConversationsForTask(taskId) {
  var filters = buildTaskIdFilters(taskId, null).filter(function (f) {
    return f.indexOf('task_id=eq.') === 0;
  });
  for (var i = 0; i < filters.length; i++) {
    var convs = await sbGet('conversations', filters[i]);
    if (convs && convs.length) return convs;
  }
  return [];
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
  return await sbGetTasksList('posted_by=eq.' + encodeURIComponent(String(userId)), 50);
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
  var row = {
    title:       taskData.title,
    description: taskData.description || '',
    category:    String(taskData.category || 'other').toLowerCase(),
    task_mode:   taskData.task_mode,
    budget:      Math.round(Number(taskData.budget) || 0),
    location:    taskData.location || 'Calgary, AB',
    status:      'open',
    posted_by:   taskData.posted_by
  };

  var extras = {};
  if (taskData.poster_name) extras.poster_name = taskData.poster_name;
  if (taskData.scheduled_at) extras.scheduled_at = taskData.scheduled_at;
  if (taskData.scheduled_label) extras.scheduled_label = taskData.scheduled_label;
  if (taskData.photo_urls) extras.photo_urls = taskData.photo_urls;
  if (taskData.requires_photos) extras.requires_photos = true;
  if (taskData.budget_negotiable) extras.budget_negotiable = true;

  var withoutPhotos = Object.assign({}, row, extras);
  delete withoutPhotos.photo_urls;
  delete withoutPhotos.requires_photos;

  var withSchedule = Object.assign({}, row);
  if (taskData.poster_name) withSchedule.poster_name = taskData.poster_name;
  if (taskData.scheduled_at) withSchedule.scheduled_at = taskData.scheduled_at;
  if (taskData.scheduled_label) withSchedule.scheduled_label = taskData.scheduled_label;

  var withPoster = Object.assign({}, row);
  if (taskData.poster_name) withPoster.poster_name = taskData.poster_name;

  var attempts = [
    Object.assign({}, row, extras),
    withoutPhotos,
    withSchedule,
    withPoster,
    row
  ];
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
    budget_negotiable: !!(task.budget_negotiable || task.BUDGET_NEGOTIABLE)
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
  var ext = (String(file.name || '').split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
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
  return String(body).slice(CHAT_IMAGE_PREFIX.length);
}

function isAllowedChatImageUrl(url) {
  if (!url) return false;
  var prefix = SUPABASE_URL + '/storage/v1/object/public/chat-photos/';
  return String(url).indexOf(prefix) === 0;
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
    if (ids.indexOf(s) === -1) ids.push(s);
    var n = parseInt(v, 10);
    if (!isNaN(n) && ids.indexOf(String(n)) === -1) ids.push(String(n));
  }
  addId(taskId);
  if (taskRow) {
    addId(taskRow.task_id);
    addId(taskRow.TASK_ID);
    addId(taskRow.id);
    addId(taskRow.ID);
  }
  var filters = [];
  var seen = {};
  ids.forEach(function (raw) {
    var enc = encodeURIComponent(raw);
    ['task_id=eq.' + enc, 'id=eq.' + enc].forEach(function (f) {
      if (!seen[f]) { seen[f] = true; filters.push(f); }
    });
    if (raw !== enc) {
      ['task_id=eq.' + raw, 'id=eq.' + raw].forEach(function (f) {
        if (!seen[f]) { seen[f] = true; filters.push(f); }
      });
    }
  });
  return filters;
}

function buildTaskIdOrFilter(taskId, taskRow) {
  var singles = buildTaskIdFilters(taskId, taskRow);
  var parts = [];
  var seen = {};
  singles.forEach(function (f) {
    var m = f.match(/^(task_id|id)=eq\.(.+)$/);
    if (!m) return;
    var piece = m[1] + '.eq.' + m[2];
    if (!seen[piece]) { seen[piece] = true; parts.push(piece); }
  });
  if (!parts.length) return null;
  return 'or=(' + parts.join(',') + ')';
}

async function updateTaskStatus(taskId, status) {
  var statusVal = String(status || '').toLowerCase();
  var patch = { status: statusVal };
  var task = await getTaskById(taskId);
  var filters = buildTaskIdFilters(taskId, task);
  var orFilter = buildTaskIdOrFilter(taskId, task);
  if (orFilter && filters.indexOf(orFilter) === -1) filters.unshift(orFilter);
  var result = { success: false, error: 'Could not update task — refresh and try again' };
  for (var i = 0; i < filters.length; i++) {
    result = await tryPatchRow('tasks', patch, filters[i], async function () {
      var fresh = await getTaskById(taskId);
      return !!(fresh && String(fresh.status || fresh.STATUS || '').toLowerCase() === statusVal);
    });
    if (result.success) break;
  }
  if (!result.success && task) {
    var current = String(task.status || task.STATUS || '').toLowerCase();
    if (current === statusVal) result = { success: true };
  }
  if (!result.success) {
    var fresh = await getTaskById(taskId);
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
  return await sbGet('users');
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

async function upsertUserProfile(userData) {
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

  var existing = null;
  if (row.firebase_uid) {
    existing = await getUserByFirebaseUid(row.firebase_uid);
  }
  if (!existing && row.email) {
    var byEmail = await sbGet('users', 'email=eq.' + encodeURIComponent(row.email));
    existing = byEmail && byEmail[0] ? byEmail[0] : null;
  }

  if (existing) {
    var id = getUserRowId(existing);
    var patch = {};
    if (row.name) patch.name = row.name;
    if (row.phone) patch.phone = row.phone;
    if (row.role) patch.role = row.role;
    if (row.firebase_uid) patch.firebase_uid = row.firebase_uid;
    if (userData.avatar_url) patch.avatar_url = userData.avatar_url;
    if (userData.bio !== undefined) patch.bio = String(userData.bio || '').trim();
    if (userData.skills !== undefined) patch.skills = serializeUserSkills(userData.skills);
    if (userData.availability !== undefined) patch.availability = userData.availability;
    if (userData.service_area !== undefined) patch.service_area = String(userData.service_area || '').trim();
    if (userData.languages !== undefined) patch.languages = String(userData.languages || '').trim();
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
    var filters = [];
    if (id != null) {
      filters.push('user_id=eq.' + encodeURIComponent(String(id)));
      filters.push('id=eq.' + encodeURIComponent(String(id)));
    }
    if (row.email) filters.push('email=eq.' + encodeURIComponent(row.email));
    var result = { success: false, error: 'Could not update user' };
    for (var i = 0; i < filters.length; i++) {
      result = await sbUpdate('users', patch, filters[i]);
      if (result.success) break;
    }
    return result;
  }

  return await sbPost('users', row);
}

async function syncCurrentUserProfile(firebaseUser) {
  if (!firebaseUser) return { success: false };
  var name = firebaseUser.displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : '');
  if (typeof formatPersonName === 'function' && name) name = formatPersonName(name);
  var role = localStorage.getItem('qg-role') || localStorage.getItem('qg-session-mode') || 'poster';
  var payload = {
    name: name,
    email: firebaseUser.email || '',
    firebase_uid: firebaseUser.uid,
    role: role === 'worker' ? 'worker' : 'poster'
  };
  var localAvatar = readLocalProfileAvatar(firebaseUser.uid);
  if (hasProfilePhotoUrl(localAvatar)) payload.avatar_url = localAvatar;
  var localExtras = readLocalProfileExtras(firebaseUser.uid);
  var existing = await getUserByFirebaseUid(firebaseUser.uid);
  if (localExtras.bio && !(existing && existing.bio && String(existing.bio).trim())) {
    payload.bio = localExtras.bio;
  }
  if (localExtras.skills.length && !parseUserSkills(existing || {}).length) {
    payload.skills = localExtras.skills;
  }
  return await upsertUserProfile(payload);
}

async function getUserByFirebaseUid(firebaseUid) {
  var results = await sbGet('users', 'firebase_uid=eq.' + encodeURIComponent(firebaseUid));
  return results[0] || null;
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
  var users = await getUsers();
  var map = {};
  if (!Array.isArray(users)) return map;
  users.forEach(function (u) {
    if (!u.name || isGenericDisplayName(u.name)) return;
    if (u.firebase_uid) map[String(u.firebase_uid)] = u.name;
  });
  return map;
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

function applyDbUserToProfileData(dbUser, target) {
  if (!dbUser || !target) return target;
  if (dbUser.name) target.name = dbUser.name;
  if (dbUser.avatar_url) target.avatar_url = dbUser.avatar_url;
  if (dbUser.role) target.role = dbUser.role;
  if (dbUser.bio != null && String(dbUser.bio).trim()) target.bio = String(dbUser.bio).trim();
  var skills = parseUserSkills(dbUser);
  if (skills.length) target.skills = skills;
    if (dbUser.created_at) target.memberSince = dbUser.created_at;
  if (dbUser.availability) target.availability = dbUser.availability;
  if (dbUser.service_area) target.service_area = String(dbUser.service_area).trim();
  if (dbUser.languages) target.languages = String(dbUser.languages).trim();
  if (dbUser.pronouns) target.pronouns = String(dbUser.pronouns).trim();
  if (dbUser.gender) target.gender = String(dbUser.gender).trim();
  if (dbUser.date_of_birth) target.date_of_birth = dbUser.date_of_birth;
  if (dbUser.identity_collected_at) target.identity_collected_at = dbUser.identity_collected_at;
  if (dbUser.guardian_consent_status) target.guardian_consent_status = dbUser.guardian_consent_status;
  if (dbUser.account_status) target.account_status = dbUser.account_status;
  return target;
}

async function getUserByGuardianToken(token) {
  if (!token) return null;
  var results = await sbGet('users', 'guardian_consent_token=eq.' + encodeURIComponent(token));
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
  var role = localStorage.getItem('qg-role') || localStorage.getItem('qg-session-mode') || 'worker';
  return await upsertUserProfile({
    name: name,
    email: firebaseUser.email || '',
    firebase_uid: firebaseUser.uid,
    role: role === 'worker' ? 'worker' : 'poster',
    avatar_url: avatarUrl
  });
}

async function getUserAvatarUrl(firebaseUid) {
  if (!firebaseUid) return '';
  var user = await getUserByFirebaseUid(firebaseUid);
  return user && user.avatar_url ? String(user.avatar_url).trim() : '';
}

async function getUsersAvatarMap() {
  var users = await getUsers();
  var map = {};
  if (!Array.isArray(users)) return map;
  users.forEach(function (u) {
    if (!u.firebase_uid || !hasProfilePhotoUrl(u.avatar_url)) return;
    map[String(u.firebase_uid)] = String(u.avatar_url).trim();
  });
  return map;
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
  var map = await getUsersNameMap();
  var posterName = resolveUserName(conv.poster_id, {
    poster_id: conv.poster_id,
    poster_name: conv.poster_name
  }, map);
  var workerName = resolveUserName(conv.worker_id, {
    worker_id: conv.worker_id,
    worker_name: conv.worker_name
  }, map);

  if (!posterName || isGenericDisplayName(posterName)) {
    posterName = await getUserNameByFirebaseUid(conv.poster_id);
  }
  if (!workerName || isGenericDisplayName(workerName)) {
    workerName = await getUserNameByFirebaseUid(conv.worker_id);
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
    await updateConversation(conv.conv_id, patch);
  }
  return conv;
}

async function getConversationsForUser(userId) {
  var stale = readConversationsCache(userId, true);
  var controller = new AbortController();
  var timeoutId = setTimeout(function () { controller.abort(); }, 8000);
  try {
    var url = SUPABASE_URL + '/rest/v1/conversations?order=last_message_at.desc.nullslast,created_at.desc';
    url += '&or=(poster_id.eq.' + encodeURIComponent(userId) + ',worker_id.eq.' + encodeURIComponent(userId) + ')';
    var headers = await getSupabaseHeaders();
    var res = await fetch(url, { method: 'GET', headers: headers, signal: controller.signal });
    if (!res.ok) {
      var errText = await res.text();
      throw new Error('GET conversations failed: ' + res.status + ' ' + errText);
    }
    var rows = await res.json();
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
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeTaskId(taskId) {
  var n = parseInt(taskId, 10);
  return isNaN(n) ? taskId : n;
}

async function getConversation(convId) {
  var results = await sbGet('conversations', 'conv_id=eq.' + encodeURIComponent(convId));
  return results[0] || null;
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
      'task_id=eq.' + encodeURIComponent(ids[i]) +
        '&poster_id=eq.' + encodeURIComponent(posterId) +
        '&worker_id=eq.' + encodeURIComponent(workerId)
    );
    if (results && results[0]) return results[0];
  }
  var byPosterWorker = await sbGet(
    'conversations',
    'poster_id=eq.' + encodeURIComponent(posterId) +
      '&worker_id=eq.' + encodeURIComponent(workerId),
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
  var rule = (window.QG_CONFIG && window.QG_CONFIG.chatUnlockAfter) || 'payment';

  if (parseConversationUnlocked(conv) && String(conv.status || '').toLowerCase() !== 'application') {
    return { success: true, conv: conv };
  }

  if (rule === 'payment') {
    var taskId = conv.task_id || conv.TASK_ID;
    if (taskId && typeof getPaymentByTask === 'function') {
      var payment = await getPaymentByTask(taskId);
      var pst = payment && String(payment.status || '').toLowerCase();
      if (pst === 'held' || pst === 'paid' || pst === 'completed') {
        var payUnlock = await updateConversation(conv.conv_id, { is_unlocked: true, status: 'in_progress' });
        if (payUnlock.success) {
          return { success: true, conv: Object.assign({}, conv, { is_unlocked: true, status: 'in_progress' }) };
        }
      }
    }
    return { success: parseConversationUnlocked(conv), conv: conv, skipped: !parseConversationUnlocked(conv) };
  }

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
    return { success: true, conv: Object.assign({}, conv, patch) };
  }
  result = await updateConversation(conv.conv_id, { is_unlocked: true });
  if (result.success) {
    return { success: true, conv: Object.assign({}, conv, { is_unlocked: true }) };
  }
  return { success: false, error: result.error, conv: conv };
}

async function updateConversation(convId, patch) {
  return await sbUpdate('conversations', patch, 'conv_id=eq.' + encodeURIComponent(convId));
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

  return await sbPostReturn('conversations', {
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
  });
}

async function getMessagesForConversation(convId) {
  return await sbGet('messages', 'conv_id=eq.' + encodeURIComponent(convId), 'created_at.asc');
}

async function sendChatMessage(convId, senderId, body) {
  if (isChatImageBody(body)) {
    var imgUrl = parseChatImageUrl(body);
    if (!isAllowedChatImageUrl(imgUrl)) {
      return { success: false, error: 'invalid_image', blocked: true };
    }
  } else if (typeof containsOffPlatformContact === 'function' && containsOffPlatformContact(body)) {
    return { success: false, error: 'off_platform_contact', blocked: true };
  }

  var result = await sbPostReturn('messages', {
    conv_id:   convId,
    sender_id: senderId,
    body:      body
  });
  if (!result.success) return result;

  await sbUpdate('conversations', {
    last_message:    isChatImageBody(body) ? '📷 Photo' : body,
    last_message_at: new Date().toISOString()
  }, 'conv_id=eq.' + encodeURIComponent(convId));

  notifyChatRecipientAsync(convId, senderId, isChatImageBody(body) ? '📷 Photo' : body);

  return result;
}

function notifyChatRecipientAsync(convId, senderId, preview) {
  if (typeof notifyNewChatMessage !== 'function' && typeof window.showQuickGigsPush !== 'function') return;
  (async function () {
    try {
      var conv = typeof getConversation === 'function' ? await getConversation(convId) : null;
      if (!conv) return;
      var recipientId = senderId === conv.poster_id ? conv.worker_id : conv.poster_id;
      if (!recipientId || recipientId === senderId) return;
      var recipient = typeof getUserByFirebaseUid === 'function' ? await getUserByFirebaseUid(recipientId) : null;
      var senderName = typeof getUserNameByFirebaseUid === 'function'
        ? await getUserNameByFirebaseUid(senderId)
        : 'QuickGigs user';
      var chatLink = 'https://quickgigs.ca/chat.html?conv=' + encodeURIComponent(convId);
      if (typeof notifyNewChatMessage === 'function') {
        await notifyNewChatMessage(recipientId, recipient && recipient.email, {
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
  var field = userId === posterId ? 'poster_last_read_at' : 'worker_last_read_at';
  var patch = {};
  patch[field] = new Date().toISOString();
  return await sbUpdate('conversations', patch, 'conv_id=eq.' + encodeURIComponent(convId));
}

async function getApplicationsByTask(taskId) {
  var filters = buildTaskIdFilters(taskId, null).filter(function (f) {
    return f.indexOf('task_id=eq.') === 0;
  });
  for (var i = 0; i < filters.length; i++) {
    var rows = await sbGet('applications', filters[i]);
    if (rows && rows.length) return rows.map(normalizeApplicationRow);
  }
  return [];
}

async function getApplicationById(appId, opts) {
  opts = opts || {};
  var appRow = null;
  var idFilters = buildApplicationIdFilters(appId, null);
  for (var i = 0; i < idFilters.length; i++) {
    var rows = await sbGet('applications', idFilters[i]);
    if (rows && rows[0]) {
      appRow = normalizeApplicationRow(rows[0]);
      break;
    }
  }
  if (!appRow && opts.taskId && opts.workerId) {
    var composite = buildApplicationCompositeFilters(opts.taskId, opts.workerId);
    for (var j = 0; j < composite.length; j++) {
      var byPair = await sbGet('applications', composite[j]);
      if (byPair && byPair[0]) {
        appRow = normalizeApplicationRow(byPair[0]);
        break;
      }
    }
  }
  return appRow;
}

async function getApplicationsByWorker(workerId) {
  var rows = await sbGet('applications', 'worker_id=eq.' + workerId);
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
      var workerUser = workerId ? await getUserByFirebaseUid(workerId) : null;
      var posterName = task.poster_name || task.POSTER_NAME || 'The poster';
      await notifyWorkerCounterOffer(workerId, workerUser && workerUser.email, task, {
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
      var posterUser = posterId ? await getUserByFirebaseUid(posterId) : null;
      var workerName = app.worker_name || app.WORKER_NAME || 'A tasker';
      await notifyPosterCounterReply(posterId, posterUser && posterUser.email, task, {
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
      var posterUserAccept = posterIdAccept ? await getUserByFirebaseUid(posterIdAccept) : null;
      var workerNameAccept = app.worker_name || app.WORKER_NAME || 'A tasker';
      await notifyPosterCounterReply(posterIdAccept, posterUserAccept && posterUserAccept.email, task, {
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
      var workerUser = workerId ? await getUserByFirebaseUid(workerId) : null;
      await notifyWorkerCounterOffer(workerId, workerUser && workerUser.email, task, {
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
  var rows = await sbGet('applications', null, 'created_at.desc', 200);
  return (rows || []).map(normalizeApplicationRow);
}

async function submitApplication(appData) {
  if (appData.task_id && appData.worker_id) {
    var task = await getTaskById(appData.task_id);
    var posterId = task && (task.posted_by || task.POSTED_BY);
    if (posterId && String(posterId) === String(appData.worker_id)) {
      return { success: false, error: 'cannot_apply_own_task' };
    }
    var workerPhoto = await resolveUserAvatarUrl(appData.worker_id);
    if (!hasProfilePhotoUrl(workerPhoto)) {
      return { success: false, error: 'profile_photo_required' };
    }
    if (window._currentUser && window._currentUser.uid === appData.worker_id) {
      var existing = await getUserByFirebaseUid(appData.worker_id);
      if (!existing || !hasProfilePhotoUrl(existing.avatar_url)) {
        await syncProfilePhotoToDb(window._currentUser, workerPhoto);
      }
    }
  }

  var row = {
    task_id:   appData.task_id,
    worker_id: appData.worker_id,
    message:   appData.message,
    price:     appData.price,
    status:    'pending'
  };
  if (appData.worker_name) row.worker_name = appData.worker_name;

  var result = await sbPost('applications', row);
  if (!result.success && appData.worker_name) {
    var fallback = {
      task_id:   appData.task_id,
      worker_id: appData.worker_id,
      message:   appData.message,
      price:     appData.price,
      status:    'pending'
    };
    result = await sbPost('applications', fallback);
  }

  if (result.success && appData.task_id && typeof notifyPosterNewApplication === 'function') {
    try {
      var notifyTask = await getTaskById(appData.task_id);
      var posterId = notifyTask && (notifyTask.posted_by || notifyTask.POSTED_BY);
      var posterUser = posterId ? await getUserByFirebaseUid(posterId) : null;
      await notifyPosterNewApplication(
        posterId,
        posterUser && posterUser.email,
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
  var tn = parseInt(taskId, 10);
  if (!isNaN(tn)) addPair(tn, workerId);
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
  var msg = String(err || '');
  var lower = msg.toLowerCase();
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
  if (msg && msg.length < 100) return 'Could not ' + action + ' — ' + msg;
  return 'Could not ' + action + ' — run supabase/tasks-beta-fix.sql in Supabase SQL Editor, then refresh.';
}

async function cancelApplication(appId, opts) {
  return await updateApplicationStatus(appId, 'cancelled', opts);
}

async function declineApplication(appId, opts) {
  return await updateApplicationStatus(appId, 'declined', opts);
}

async function cancelTask(taskId) {
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
async function completeTask(taskId, actorId) {
  taskId = String(taskId);
  if (!taskId) return { success: false, error: 'Missing task id' };

  var release = await releaseTaskPayout(taskId, actorId);
  if (!release.ok && !release.skipped) {
    var releaseErr = release.error || 'payout_release_failed';
    if (releaseErr === 'worker_payout_setup_required') {
      releaseErr = 'Tasker must set up payouts in Profile before funds can be released';
    }
    return { success: false, error: releaseErr, release: release };
  }

  var taskResult = await updateTaskStatus(taskId, 'completed');
  if (!taskResult.success) return taskResult;

  var apps = await getApplicationsByTask(taskId);
  var accepted = (apps || []).find(function (a) {
    return String(a.status || a.STATUS || '').toLowerCase() === 'accepted';
  });
  if (accepted) {
    var appId = accepted.app_id || accepted.APP_ID || accepted.id;
    var workerId = accepted.worker_id || accepted.WORKER_ID;
    await updateApplicationStatus(appId, 'completed', {
      taskId: taskId,
      workerId: workerId
    });
  }

  if (typeof lockConversationsForTask === 'function') {
    await lockConversationsForTask(taskId);
  }
  invalidateTasksCache();
  mergeTaskInCache(taskId, { status: 'completed', STATUS: 'completed' });
  return { success: true, release: release };
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
  var rows = await sbGet('reviews', 'reviewee_id=eq.' + uid, 'created_at.desc', 100);
  if (rows && rows.length) {
    writeReviewsCache(userId, rows);
    return rows;
  }
  return readReviewsCache(userId);
}

async function submitReview(reviewData) {
  var row = {
    task_id:        reviewData.task_id,
    reviewer_id:    reviewData.reviewer_id,
    reviewee_id:    reviewData.reviewee_id,
    rating:         reviewData.rating,
    review_comment: reviewData.review_comment || ''
  };
  var result = await sbPost('reviews', row);
  if (result.success) {
    mergeReviewInCache(Object.assign({}, row, {
      created_at: new Date().toISOString(),
      reviewer_name: reviewData.reviewer_name || '',
      task_title: reviewData.task_title || ''
    }));
  }
  return result;
}

async function getPaymentByTask(taskId) {
  var results = await sbGet('payments', 'task_id=eq.' + encodeURIComponent(String(taskId)), 'created_at.desc', 5);
  if (!results || !results.length) return null;
  var paid = results.find(function (p) {
    var st = String(p.status || '').toLowerCase();
    return st === 'held' || st === 'completed' || st === 'paid';
  });
  return paid || results[0];
}

async function getPaymentsForUser(userId, role) {
  if (!userId) return [];
  var col = role === 'poster' ? 'poster_id' : 'worker_id';
  return await sbGet('payments', col + '=eq.' + encodeURIComponent(String(userId)), 'created_at.desc', 100);
}

async function releaseTaskPayout(taskId, actorId) {
  var cfg = window.QG_CONFIG || {};
  if (!cfg.paymentsEnabled) return { ok: true, skipped: true };

  var payment = await getPaymentByTask(taskId);
  if (!payment) return { ok: true, skipped: true };

  var st = String(payment.status || '').toLowerCase();
  if (st === 'paid') return { ok: true, already: true };
  if (st !== 'held') return { ok: true, skipped: true };

  if (typeof getSupabaseHeaders !== 'function') {
    return { ok: false, error: 'Database not loaded' };
  }

  var url = cfg.releasePayoutUrl ||
    'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/release-payout';
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
  return await forceUnlockConversationForTask(conv, taskStatus);
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
  task_removed_applicant: function (p) { return '🚫 Task removed'; }
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
window.SUPABASE_HEADERS = SUPABASE_HEADERS;
window.SB_HEADERS = SUPABASE_HEADERS;
window.HEADERS = SUPABASE_HEADERS;
window.getTasks = getTasks;
window.getAllTasks = getAllTasks;
window.fetchTasksWithCache = fetchTasksWithCache;
window.fetchAllTasksFresh = fetchAllTasksFresh;
window.fetchAllApplicationsFresh = fetchAllApplicationsFresh;
window.readTasksCache = readTasksCache;
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
window.upsertUserProfile = upsertUserProfile;
window.syncCurrentUserProfile = syncCurrentUserProfile;
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
window.markConversationRead = markConversationRead;
window.getApplicationsByTask = getApplicationsByTask;
window.getApplicationsByWorker = getApplicationsByWorker;
window.getAllApplications = getAllApplications;
window.submitApplication = submitApplication;
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
window.releaseAcceptedTasker = releaseAcceptedTasker;
window.declinePendingApplicationsForTask = declinePendingApplicationsForTask;
window.getReviewsForUser = getReviewsForUser;
window.submitReview = submitReview;
window.readReviewsCache = readReviewsCache;
window.mergeReviewInCache = mergeReviewInCache;
window.getPaymentByTask = getPaymentByTask;
window.getPaymentsForUser = getPaymentsForUser;
window.releaseTaskPayout = releaseTaskPayout;
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
window.sbGet = sbGet;
window.sbPost = sbPost;
window.sbPostReturn = sbPostReturn;
window.sbUpdate = sbUpdate;
