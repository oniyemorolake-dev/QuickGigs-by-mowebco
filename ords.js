// ================================================================
// QuickGigs — Oracle ORDS API Utility
// All pages import this file to read/write real data to Oracle
// Base URL: https://iacademy2.oracle.com/ords/ca_a832_sql_s12/quickgigs/
// ================================================================

const ORDS_BASE = 'https://iacademy2.oracle.com/ords/ca_a832_sql_s12/quickgigs/';

// ── GENERIC FETCH HELPERS ──────────────────────────────────────

async function ordsGet(endpoint) {
  try {
    const res = await fetch(ORDS_BASE + endpoint, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) throw new Error('GET failed: ' + res.status);
    const data = await res.json();
    // ORDS returns items in data.items array
    return data.items || [];
  } catch (err) {
    console.error('ORDS GET error:', err);
    return [];
  }
}

async function ordsPost(endpoint, body) {
  try {
    const res = await fetch(ORDS_BASE + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('POST failed: ' + res.status);
    return { success: true };
  } catch (err) {
    console.error('ORDS POST error:', err);
    return { success: false, error: err.message };
  }
}

// ── TASKS ──────────────────────────────────────────────────────

// Get all tasks (for browse-tasks page)
async function getTasks() {
  return await ordsGet('task/');
}

// Get tasks posted by a specific user (for my-tasks page)
async function getTasksByUser(userId) {
  const all = await ordsGet('task/');
  return all.filter(t => t.posted_by == userId);
}

// Post a new task (from post-task page)
async function postTask(taskData) {
  return await ordsPost('task/', {
    title:       taskData.title,
    description: taskData.description,
    category:    taskData.category,
    task_mode:   taskData.task_mode,   // NOT mode — reserved word
    budget:      taskData.budget,
    location:    taskData.location,
    posted_by:   taskData.posted_by
  });
}

// ── USERS ──────────────────────────────────────────────────────

// Get all users (for admin dashboard)
async function getUsers() {
  return await ordsGet('users/');
}

// Save a new user to Oracle after Firebase signup
async function saveUser(userData) {
  return await ordsPost('users/', {
    name:  userData.name,
    email: userData.email,
    phone: userData.phone || '',
    role:  userData.role
  });
}

// ── APPLICATIONS ───────────────────────────────────────────────

// Get all applications for a specific task (poster sees who applied)
async function getApplicationsByTask(taskId) {
  const all = await ordsGet('applications/');
  return all.filter(a => a.task_id == taskId);
}

// Get all applications by a specific worker (worker sees their bids)
async function getApplicationsByWorker(workerId) {
  const all = await ordsGet('applications/');
  return all.filter(a => a.worker_id == workerId);
}

// Submit an application (from browse-tasks apply modal)
async function submitApplication(appData) {
  return await ordsPost('applications/', {
    task_id:   appData.task_id,
    worker_id: appData.worker_id,
    message:   appData.message,
    price:     appData.price
  });
}

// ── REVIEWS ────────────────────────────────────────────────────

// Get all reviews for a specific user
async function getReviewsForUser(userId) {
  const all = await ordsGet('reviews/');
  return all.filter(r => r.reviewee_id == userId);
}

// Submit a review (from review page)
async function submitReview(reviewData) {
  return await ordsPost('reviews/', {
    task_id:        reviewData.task_id,
    reviewer_id:    reviewData.reviewer_id,
    reviewee_id:    reviewData.reviewee_id,
    rating:         reviewData.rating,
    review_comment: reviewData.review_comment  // NOT comment — reserved word
  });
}

// ── PAYMENTS ───────────────────────────────────────────────────

// Get payment for a specific task
async function getPaymentByTask(taskId) {
  const all = await ordsGet('payments/');
  return all.find(p => p.task_id == taskId) || null;
}

// Save a payment record (called after Stripe escrow is confirmed)
async function savePayment(paymentData) {
  return await ordsPost('payments/', {
    task_id:       paymentData.task_id,
    poster_id:     paymentData.poster_id,
    worker_id:     paymentData.worker_id,
    amount:        paymentData.amount,
    platform_fee:  paymentData.platform_fee,
    worker_payout: paymentData.worker_payout,
    stripe_id:     paymentData.stripe_id
  });
}

// ── EXPORT ─────────────────────────────────────────────────────
// All pages can import these functions like:
// <script src="ords.js"></script>
// then call: const tasks = await getTasks();

export {
  getTasks,
  getTasksByUser,
  postTask,
  getUsers,
  saveUser,
  getApplicationsByTask,
  getApplicationsByWorker,
  submitApplication,
  getReviewsForUser,
  submitReview,
  getPaymentByTask,
  savePayment
};