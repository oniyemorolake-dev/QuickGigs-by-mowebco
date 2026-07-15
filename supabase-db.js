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
    var res = await fetch(url, { method: 'GET', headers: SUPABASE_HEADERS, signal: controller.signal });
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
    var res = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
      method: 'POST',
      headers: Object.assign({}, SUPABASE_HEADERS, { 'Prefer': 'return=representation' }),
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
    var res = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
      method: 'POST',
      headers: Object.assign({}, SUPABASE_HEADERS, { 'Prefer': 'return=minimal' }),
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
    var res = await fetch(url, {
      method: 'PATCH',
      headers: Object.assign({}, SUPABASE_HEADERS, { 'Prefer': 'return=minimal' }),
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('PATCH failed: ' + res.status);
    return { success: true };
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
    var res = await fetch(SUPABASE_URL + '/storage/v1/object/' + bucket + '/' + path, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': file.type || 'image/jpeg',
        'x-upsert': 'false'
      },
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
  var id = encodeURIComponent(String(taskId));
  var filters = ['task_id=eq.' + id, 'id=eq.' + id];
  var result = { success: false, error: 'Could not update task' };
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
    var res = await fetch(url, { method: 'GET', headers: SUPABASE_HEADERS, signal: controller.signal });
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
  return await sbGet('applications', 'task_id=eq.' + encodeURIComponent(taskId));
}

async function getApplicationsByWorker(workerId) {
  return await sbGet('applications', 'worker_id=eq.' + workerId);
}

async function getAllApplications() {
  return await sbGet('applications', null, 'created_at.desc', 200);
}

async function submitApplication(appData) {
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

async function updateApplicationStatus(appId, status) {
  var id = encodeURIComponent(String(appId));
  var filters = ['app_id=eq.' + id, 'id=eq.' + id, 'application_id=eq.' + id];
  var result = { success: false, error: 'Could not update application' };
  for (var i = 0; i < filters.length; i++) {
    result = await sbUpdate('applications', { status: status }, filters[i]);
    if (result.success) break;
  }
  return result;
}

async function cancelApplication(appId) {
  return await updateApplicationStatus(appId, 'cancelled');
}

async function declineApplication(appId) {
  return await updateApplicationStatus(appId, 'declined');
}

async function cancelTask(taskId) {
  return await updateTaskStatus(taskId, 'cancelled');
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
    return declineApplication(a.app_id || a.APP_ID || a.id);
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
window.cancelApplication = cancelApplication;
window.declineApplication = declineApplication;
window.cancelTask = cancelTask;
window.declinePendingApplicationsForTask = declinePendingApplicationsForTask;
window.getReviewsForUser = getReviewsForUser;
window.submitReview = submitReview;
window.getPaymentByTask = getPaymentByTask;
window.savePayment = savePayment;
window.unlockChatForTask = unlockChatForTask;
