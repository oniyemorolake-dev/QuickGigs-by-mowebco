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
var TASKS_CACHE_MS = 60000;

function readTasksCache() {
  try {
    var raw = sessionStorage.getItem(TASKS_CACHE_KEY);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    if (!parsed || !parsed.at || (Date.now() - parsed.at) > TASKS_CACHE_MS) return null;
    return parsed.items || null;
  } catch (err) {
    return null;
  }
}

function writeTasksCache(items) {
  try {
    sessionStorage.setItem(TASKS_CACHE_KEY, JSON.stringify({ at: Date.now(), items: items || [] }));
  } catch (err) {}
}

function invalidateTasksCache() {
  try { sessionStorage.removeItem(TASKS_CACHE_KEY); } catch (err) {}
}

async function sbGet(table, filters, order, limit) {
  var controller = new AbortController();
  var timeoutId = setTimeout(function () { controller.abort(); }, 8000);
  try {
    var url = SUPABASE_URL + '/rest/v1/' + table + '?order=' + (order || 'created_at.desc');
    if (filters) url += '&' + filters;
    if (limit) url += '&limit=' + limit;
    var headers = await getSupabaseHeaders();
    var res = await fetch(url, { method: 'GET', headers: headers, signal: controller.signal });
    if (!res.ok) throw new Error('GET failed: ' + res.status);
    return await res.json();
  } catch (err) {
    console.error('Supabase GET error:', err);
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
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
    try {
      rows = await res.json();
    } catch (parseErr) {
      rows = [];
    }
    if (rows && rows.length) {
      return { success: true, data: rows };
    }
    var minimalHeaders = await getSupabaseHeaders({ 'Prefer': 'return=minimal' });
    var res2 = await fetch(url, {
      method: 'PATCH',
      headers: minimalHeaders,
      body: JSON.stringify(data)
    });
    if (res2.ok) {
      return { success: true };
    }
    var err2 = await res2.text();
    return { success: false, error: 'No matching row updated' + (err2 ? ': ' + err2 : ''), notFound: true };
  } catch (err) {
    console.error('Supabase PATCH error:', err);
    return { success: false, error: err.message };
  }
}

async function getTasks() {
  return await sbGet('tasks', 'status=eq.open', 'created_at.desc', 100);
}

async function getAllTasks() {
  return await sbGet('tasks', null, 'created_at.desc', 100);
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
  var items = await getAllTasks();
  if (Array.isArray(items) && items.length) writeTasksCache(items);
  return items;
}

async function getTaskById(taskId) {
  var id = encodeURIComponent(String(taskId));
  var filters = ['task_id=eq.' + id, 'id=eq.' + id];
  for (var i = 0; i < filters.length; i++) {
    var results = await sbGet('tasks', filters[i]);
    if (results && results[0]) return results[0];
  }
  return null;
}

async function lockConversationsForTask(taskId) {
  var tid = encodeURIComponent(String(taskId));
  var convs = await sbGet('conversations', 'task_id=eq.' + tid);
  if (!convs || !convs.length) return { success: true };
  var results = await Promise.all(convs.map(function(c) {
    return updateConversation(c.conv_id, { is_unlocked: false, status: 'completed' });
  }));
  return { success: results.every(function(r) { return r.success; }) };
}

async function getTasksByUser(userId) {
  return await sbGet('tasks', 'posted_by=eq.' + userId, 'created_at.desc', 50);
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
  if (taskData.photo_urls) row.photo_urls = taskData.photo_urls;
  if (taskData.requires_photos) row.requires_photos = true;

  var result;
  if (taskData.poster_name) {
    var withName = Object.assign({}, row, { poster_name: taskData.poster_name });
    result = await sbPost('tasks', withName);
    if (!result.success) result = await sbPost('tasks', row);
  } else {
    result = await sbPost('tasks', row);
  }

  if (result.success) invalidateTasksCache();
  return result;
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
    return { success: false, error: err.message };
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

async function updateTaskStatus(taskId, status) {
  var raw = String(taskId);
  var enc = encodeURIComponent(raw);
  var filters = ['task_id=eq.' + enc, 'id=eq.' + enc];
  if (raw !== enc) filters.push('task_id=eq.' + raw, 'id=eq.' + raw);
  var result = { success: false, error: 'Could not update task — refresh and try again' };
  for (var i = 0; i < filters.length; i++) {
    result = await sbUpdate('tasks', { status: status }, filters[i]);
    if (result.success) break;
  }
  if (result.success) invalidateTasksCache();
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
  return await upsertUserProfile({
    name: name,
    email: firebaseUser.email || '',
    firebase_uid: firebaseUser.uid,
    role: role === 'worker' ? 'worker' : 'poster'
  });
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
  if (hasProfilePhotoUrl(window._currentUserAvatarUrl)) return true;
  var url = await getUserAvatarUrl(window._currentUser.uid);
  if (url) window._currentUserAvatarUrl = url;
  return hasProfilePhotoUrl(url);
}

async function ensureTaskerProfilePhoto() {
  var isTasker = (typeof isWorkerMode === 'function' && isWorkerMode()) ||
    localStorage.getItem('qg-role') === 'worker' ||
    localStorage.getItem('qg-session-mode') === 'worker';
  if (!isTasker) return { ok: true, avatar_url: window._currentUserAvatarUrl || '' };
  var has = await currentUserHasProfilePhoto();
  if (has) return { ok: true, avatar_url: window._currentUserAvatarUrl || '' };
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
    return await res.json();
  } catch (err) {
    console.error('Supabase conversations GET error:', err);
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
  var tid = normalizeTaskId(taskId);
  var results = await sbGet(
    'conversations',
    'task_id=eq.' + encodeURIComponent(String(tid)) + '&poster_id=eq.' + encodeURIComponent(posterId) + '&worker_id=eq.' + encodeURIComponent(workerId)
  );
  return results[0] || null;
}

async function updateConversation(convId, patch) {
  return await sbUpdate('conversations', patch, 'conv_id=eq.' + encodeURIComponent(convId));
}

async function createConversation(convData) {
  var taskId = normalizeTaskId(convData.task_id);
  var existing = await getConversationForTask(taskId, convData.poster_id, convData.worker_id);
  if (existing) return { success: true, data: existing, existing: true };

  return await sbPostReturn('conversations', {
    task_id:       taskId,
    poster_id:     convData.poster_id,
    worker_id:     convData.worker_id,
    poster_name:   convData.poster_name || '',
    worker_name:   convData.worker_name || '',
    task_title:    convData.task_title || '',
    task_category: convData.task_category || '',
    status:        convData.status || 'in_progress',
    is_unlocked:   typeof convData.is_unlocked === 'boolean'
      ? convData.is_unlocked
      : (typeof resolveChatUnlockedOnCreate === 'function'
        ? resolveChatUnlockedOnCreate(convData.status || 'application')
        : false),
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

  return result;
}

async function markConversationRead(convId, userId, posterId) {
  var field = userId === posterId ? 'poster_last_read_at' : 'worker_last_read_at';
  var patch = {};
  patch[field] = new Date().toISOString();
  return await sbUpdate('conversations', patch, 'conv_id=eq.' + encodeURIComponent(convId));
}

async function getApplicationsByTask(taskId) {
  var rows = await sbGet('applications', 'task_id=eq.' + encodeURIComponent(taskId));
  return (rows || []).map(normalizeApplicationRow);
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
  return row;
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
    var workerPhoto = await getUserAvatarUrl(appData.worker_id);
    if (!hasProfilePhotoUrl(workerPhoto)) {
      return { success: false, error: 'profile_photo_required' };
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
  return result;
}

function buildApplicationUpdateFilters(appId, opts) {
  opts = opts || {};
  var filters = [];
  if (appId != null && String(appId) !== '') {
    var id = encodeURIComponent(String(appId));
    filters.push('app_id=eq.' + id);
    filters.push('id=eq.' + id);
    filters.push('application_id=eq.' + id);
  }
  if (opts.taskId && opts.workerId) {
    filters.push(
      'task_id=eq.' + encodeURIComponent(String(opts.taskId)) +
      '&worker_id=eq.' + encodeURIComponent(String(opts.workerId))
    );
  }
  return filters;
}

async function updateApplicationStatus(appId, status, opts) {
  opts = opts || {};
  var filters = buildApplicationUpdateFilters(appId, opts);
  var result = { success: false, error: 'Could not update application' };
  for (var i = 0; i < filters.length; i++) {
    result = await sbUpdate('applications', { status: status }, filters[i]);
    if (result.success) break;
  }
  if (result.success || !opts.taskId || !opts.workerId) return result;

  var lookup = await sbGet(
    'applications',
    'task_id=eq.' + encodeURIComponent(String(opts.taskId)) +
      '&worker_id=eq.' + encodeURIComponent(String(opts.workerId)) +
      '&limit=1'
  );
  if (!lookup || !lookup[0]) return result;

  var row = normalizeApplicationRow(lookup[0]);
  var resolvedId = row.app_id || row.id || row.application_id;
  if (!resolvedId) return result;

  var retryFilters = buildApplicationUpdateFilters(resolvedId, {
    taskId: opts.taskId,
    workerId: opts.workerId
  });
  for (var j = 0; j < retryFilters.length; j++) {
    result = await sbUpdate('applications', { status: status }, retryFilters[j]);
    if (result.success) break;
  }
  return result;
}

function formatSupabaseActionError(action, err) {
  var msg = String(err || '');
  var lower = msg.toLowerCase();
  if (lower.indexOf('401') >= 0 || lower.indexOf('403') >= 0 || lower.indexOf('42501') >= 0 || lower.indexOf('row-level') >= 0) {
    return 'Could not ' + action + ' — run supabase/tasks-beta-fix.sql in Supabase SQL Editor, then refresh.';
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
  return await updateTaskStatus(taskId, 'cancelled');
}

/** Poster releases current tasker — task reopens for other applicants. */
async function releaseAcceptedTasker(taskId, appId) {
  taskId = String(taskId);
  appId = String(appId);
  if (!taskId || !appId) {
    return { success: false, error: 'Missing task or application' };
  }

  var appResult = await updateApplicationStatus(appId, 'declined');
  if (!appResult.success) return appResult;

  var taskResult = await updateTaskStatus(taskId, 'open');
  if (!taskResult.success) return taskResult;

  var tid = encodeURIComponent(taskId);
  var convs = await sbGet('conversations', 'task_id=eq.' + tid);
  if (convs && convs.length) {
    await Promise.all(convs.map(function (c) {
      return updateConversation(c.conv_id, { is_unlocked: false, status: 'application' });
    }));
  }

  invalidateTasksCache();
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

async function getReviewsForUser(userId) {
  return await sbGet('reviews', 'reviewee_id=eq.' + userId);
}

async function submitReview(reviewData) {
  return await sbPost('reviews', {
    task_id:        reviewData.task_id,
    reviewer_id:    reviewData.reviewer_id,
    reviewee_id:    reviewData.reviewee_id,
    rating:         reviewData.rating,
    review_comment: reviewData.review_comment
  });
}

async function getPaymentByTask(taskId) {
  var results = await sbGet('payments', 'task_id=eq.' + taskId);
  return results[0] || null;
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
  return await updateConversation(conv.conv_id, { is_unlocked: true, status: 'in_progress' });
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
window.readTasksCache = readTasksCache;
window.invalidateTasksCache = invalidateTasksCache;
window.getTasksByUser = getTasksByUser;
window.getTaskById = getTaskById;
window.lockConversationsForTask = lockConversationsForTask;
window.postTask = postTask;
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
window.resolveUserName = resolveUserName;
window.isGenericDisplayName = isGenericDisplayName;
window.enrichConversationNames = enrichConversationNames;
window.getConversationsForUser = getConversationsForUser;
window.getConversation = getConversation;
window.getConversationForTask = getConversationForTask;
window.createConversation = createConversation;
window.updateConversation = updateConversation;
window.getMessagesForConversation = getMessagesForConversation;
window.sendChatMessage = sendChatMessage;
window.markConversationRead = markConversationRead;
window.getApplicationsByTask = getApplicationsByTask;
window.getApplicationsByWorker = getApplicationsByWorker;
window.getAllApplications = getAllApplications;
window.submitApplication = submitApplication;
window.updateApplicationStatus = updateApplicationStatus;
window.formatSupabaseActionError = formatSupabaseActionError;
window.cancelApplication = cancelApplication;
window.declineApplication = declineApplication;
window.cancelTask = cancelTask;
window.releaseAcceptedTasker = releaseAcceptedTasker;
window.declinePendingApplicationsForTask = declinePendingApplicationsForTask;
window.getReviewsForUser = getReviewsForUser;
window.submitReview = submitReview;
window.getPaymentByTask = getPaymentByTask;
window.savePayment = savePayment;
window.unlockChatForTask = unlockChatForTask;
