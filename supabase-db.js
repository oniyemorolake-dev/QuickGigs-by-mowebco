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
  return await sbPost('users', {
    name:         userData.name,
    email:        userData.email,
    phone:        userData.phone || '',
    role:         userData.role  || 'poster',
    firebase_uid: userData.firebase_uid || ''
  });
}

async function getUserByFirebaseUid(firebaseUid) {
  var results = await sbGet('users', 'firebase_uid=eq.' + encodeURIComponent(firebaseUid));
  return results[0] || null;
}

async function getUsersNameMap() {
  var users = await getUsers();
  var map = {};
  if (!Array.isArray(users)) return map;
  users.forEach(function (u) {
    if (u.firebase_uid && u.name) map[u.firebase_uid] = u.name;
  });
  return map;
}

function resolveUserName(uid, taskRow, userNames) {
  if (!uid) return 'User';
  if (taskRow) {
    var wn = taskRow.worker_name || taskRow.WORKER_NAME;
    if (wn) return wn;
    var pn = taskRow.poster_name || taskRow.POSTER_NAME;
    if (pn) return pn;
  }
  if (userNames && userNames[uid]) return userNames[uid];
  return 'QuickGigs user';
}

async function getConversationsForUser(userId) {
  return await sbGet(
    'conversations',
    'or=(poster_id.eq.' + encodeURIComponent(userId) + ',worker_id.eq.' + encodeURIComponent(userId) + ')',
    'last_message_at.desc.nullslast,created_at.desc'
  );
}

async function getConversation(convId) {
  var results = await sbGet('conversations', 'conv_id=eq.' + encodeURIComponent(convId));
  return results[0] || null;
}

async function getConversationForTask(taskId, posterId, workerId) {
  var results = await sbGet(
    'conversations',
    'task_id=eq.' + taskId + '&poster_id=eq.' + encodeURIComponent(posterId) + '&worker_id=eq.' + encodeURIComponent(workerId)
  );
  return results[0] || null;
}

async function createConversation(convData) {
  var existing = await getConversationForTask(convData.task_id, convData.poster_id, convData.worker_id);
  if (existing) return { success: true, data: existing, existing: true };

  return await sbPostReturn('conversations', {
    task_id:       convData.task_id,
    poster_id:     convData.poster_id,
    worker_id:     convData.worker_id,
    poster_name:   convData.poster_name || '',
    worker_name:   convData.worker_name || '',
    task_title:    convData.task_title || '',
    task_category: convData.task_category || '',
    status:        convData.status || 'in_progress',
    is_unlocked:   convData.is_unlocked !== false
  });
}

async function getMessagesForConversation(convId) {
  return await sbGet('messages', 'conv_id=eq.' + encodeURIComponent(convId), 'created_at.asc');
}

async function sendChatMessage(convId, senderId, body) {
  var result = await sbPostReturn('messages', {
    conv_id:   convId,
    sender_id: senderId,
    body:      body
  });
  if (!result.success) return result;

  await sbUpdate('conversations', {
    last_message:    body,
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
  return await sbPost('payments', {
    task_id:       paymentData.task_id,
    poster_id:     paymentData.poster_id,
    worker_id:     paymentData.worker_id,
    amount:        paymentData.amount,
    platform_fee:  paymentData.platform_fee,
    worker_payout: paymentData.worker_payout,
    stripe_id:     paymentData.stripe_id || '',
    status:        'pending'
  });
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
window.postTask = postTask;
window.updateTaskStatus = updateTaskStatus;
window.getUsers = getUsers;
window.saveUser = saveUser;
window.getUserByFirebaseUid = getUserByFirebaseUid;
window.getUsersNameMap = getUsersNameMap;
window.resolveUserName = resolveUserName;
window.getConversationsForUser = getConversationsForUser;
window.getConversation = getConversation;
window.getConversationForTask = getConversationForTask;
window.createConversation = createConversation;
window.getMessagesForConversation = getMessagesForConversation;
window.sendChatMessage = sendChatMessage;
window.markConversationRead = markConversationRead;
window.getApplicationsByTask = getApplicationsByTask;
window.getApplicationsByWorker = getApplicationsByWorker;
window.getAllApplications = getAllApplications;
window.submitApplication = submitApplication;
window.updateApplicationStatus = updateApplicationStatus;
window.getReviewsForUser = getReviewsForUser;
window.submitReview = submitReview;
window.getPaymentByTask = getPaymentByTask;
window.savePayment = savePayment;
