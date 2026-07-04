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

async function sbGet(table, filters) {
  try {
    var url = SUPABASE_URL + '/rest/v1/' + table + '?order=created_at.desc';
    if (filters) url += '&' + filters;
    var res = await fetch(url, { method: 'GET', headers: SUPABASE_HEADERS });
    if (!res.ok) throw new Error('GET failed: ' + res.status);
    return await res.json();
  } catch (err) {
    console.error('Supabase GET error:', err);
    return [];
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
  return await sbGet('tasks', 'status=eq.open');
}

async function getTasksByUser(userId) {
  return await sbGet('tasks', 'posted_by=eq.' + userId);
}

async function postTask(taskData) {
  return await sbPost('tasks', {
    title:       taskData.title,
    description: taskData.description || '',
    category:    taskData.category,
    task_mode:   taskData.task_mode,
    budget:      taskData.budget,
    location:    taskData.location || 'Calgary, AB',
    status:      'open',
    posted_by:   taskData.posted_by
  });
}

async function updateTaskStatus(taskId, status) {
  return await sbUpdate('tasks', { status: status }, 'task_id=eq.' + taskId);
}

async function getUsers() {
  return await sbGet('users');
}

async function saveUser(userData) {
  return await sbPost('users', {
    name:     userData.name,
    email:    userData.email,
    phone:    userData.phone || '',
    role:     userData.role  || 'poster'
  });
}

async function getApplicationsByTask(taskId) {
  return await sbGet('applications', 'task_id=eq.' + taskId);
}

async function getApplicationsByWorker(workerId) {
  return await sbGet('applications', 'worker_id=eq.' + workerId);
}

async function submitApplication(appData) {
  return await sbPost('applications', {
    task_id:   appData.task_id,
    worker_id: appData.worker_id,
    message:   appData.message,
    price:     appData.price,
    status:    'pending'
  });
}

async function updateApplicationStatus(appId, status) {
  return await sbUpdate('applications', { status: status }, 'app_id=eq.' + appId);
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
window.getTasksByUser = getTasksByUser;
window.postTask = postTask;
window.updateTaskStatus = updateTaskStatus;
window.getUsers = getUsers;
window.saveUser = saveUser;
window.getApplicationsByTask = getApplicationsByTask;
window.getApplicationsByWorker = getApplicationsByWorker;
window.submitApplication = submitApplication;
window.updateApplicationStatus = updateApplicationStatus;
window.getReviewsForUser = getReviewsForUser;
window.submitReview = submitReview;
window.getPaymentByTask = getPaymentByTask;
window.savePayment = savePayment;
