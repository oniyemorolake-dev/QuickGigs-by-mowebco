/* QuickGigs — admin console Phase 1 (drawers, edit, flag, notes, moderation)
 *
 * SECURITY: isAdmin() / requireAdmin() are UX only (qg-admin-gate.js).
 * Real enforcement = RLS + service-role backend. Never put secrets here.
 */
(function () {
  var TEMP_EMAIL_DOMAINS = [
    'mailinator.com', 'guerrillamail.com', 'tempmail.com', '10minutemail.com',
    'throwaway.email', 'yopmail.com', 'sharklasers.com', 'getnada.com',
    'maildrop.cc', 'temp-mail.org', 'fakeinbox.com', 'trashmail.com'
  ];

  var drawerState = { type: null, id: null };
  var reportFilter = 'open';
  var disputeFilter = 'open';

  /**
   * Human labels for reports.reason / disputes.reason (and related enums).
   * Keep keys in sync with supabase/reports-blocks-disputes.sql CHECK constraints.
   */
  var ADMIN_REASON_LABELS = {
    // reports.reason
    spam: 'Spam',
    scam: 'Scam',
    inappropriate: 'Inappropriate',
    off_platform: 'Off-platform contact',
    other: 'Other',
    // disputes.reason
    not_done: 'Task not completed',
    not_as_described: 'Not as described',
    no_show: 'No-show',
    payment: 'Payment issue',
    // statuses (display)
    open: 'Open',
    reviewing: 'In review',
    resolved: 'Resolved',
    rejected: 'Rejected',
    reviewed: 'Reviewed',
    dismissed: 'Dismissed',
    actioned: 'Actioned'
  };

  function adminReasonLabel(raw) {
    var key = String(raw || '').toLowerCase().trim();
    if (!key) return '—';
    if (ADMIN_REASON_LABELS[key]) return ADMIN_REASON_LABELS[key];
    return key.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function adminTimeAgo(iso) {
    if (!iso) return '—';
    if (typeof timeAgo === 'function') return timeAgo(iso) || '—';
    if (typeof formatRelativeTime === 'function') return formatRelativeTime(iso) || '—';
    try { return new Date(iso).toLocaleString('en-CA'); } catch (e) { return '—'; }
  }

  /* Task list UI state — search + filters + bulk selection */
  var taskUI = {
    search: '',
    status: 'all',
    mode: 'all',
    selected: {},
    searchTimer: null,
    filteredIds: []
  };

  function esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function isAdmin(user) {
    return typeof window.isAdmin === 'function' ? window.isAdmin(user) : false;
  }

  function requireAdmin() {
    if (typeof window.requireAdmin === 'function') return window.requireAdmin();
    return isAdmin();
  }

  /** Prefer shared adminConfirm modal; never use window.confirm for destructive ops. */
  function confirmAdmin(opts) {
    if (typeof window.adminConfirm === 'function') return window.adminConfirm(opts);
    return Promise.resolve(false);
  }

  function adminEmail() {
    var u = (window._auth && window._auth.currentUser) || window._currentUser || null;
    return (u && u.email) || '';
  }

  function userKey(u) {
    if (!u) return '';
    return String(u.firebase_uid || u.user_id || u.id || '');
  }

  function findUser(key) {
    if (!key || !window.users) return null;
    key = String(key);
    return window.users.find(function (u) {
      return String(u.firebase_uid || '') === key ||
        String(u.user_id || u.id || '') === key ||
        String(u.email || '').toLowerCase() === key.toLowerCase();
    }) || null;
  }

  function findTask(id) {
    if (!id || !window.tasks) return null;
    id = String(id);
    return window.tasks.find(function (t) {
      return String(t.task_id || t.TASK_ID || t.id || '') === id;
    }) || null;
  }

  function isTempEmail(email) {
    if (!email) return false;
    var domain = String(email).split('@')[1];
    if (!domain) return false;
    domain = domain.toLowerCase();
    return TEMP_EMAIL_DOMAINS.some(function (d) { return domain === d || domain.endsWith('.' + d); });
  }

  async function adminHeaders() {
    if (typeof getSupabaseHeaders === 'function') return await getSupabaseHeaders();
    return window.SB_HEADERS || window.SUPABASE_HEADERS;
  }

  async function patchUser(user, patch) {
    if (!user) return { success: false };
    var filters = [];
    if (user.user_id != null) filters.push('user_id=eq.' + encodeURIComponent(String(user.user_id)));
    if (user.id != null && String(user.id) !== String(user.user_id)) {
      filters.push('id=eq.' + encodeURIComponent(String(user.id)));
    }
    if (user.firebase_uid) filters.push('firebase_uid=eq.' + encodeURIComponent(user.firebase_uid));
    if (user.email) filters.push('email=eq.' + encodeURIComponent(user.email));
    for (var i = 0; i < filters.length; i++) {
      var result = await sbUpdate('users', patch, filters[i]);
      if (result.success) {
        Object.assign(user, patch);
        return result;
      }
    }
    return { success: false, error: 'Could not update user' };
  }

  async function logAdminAction(actionType, targetType, targetId, detail) {
    if (typeof sbPost !== 'function') return;
    await sbPost('admin_actions', {
      admin_email: adminEmail(),
      action_type: actionType,
      target_type: targetType || '',
      target_id: String(targetId || ''),
      detail: detail || {}
    });
    if (typeof window.loadAdminMeta === 'function') await window.loadAdminMeta();
  }

  async function loadAdminNotesForUser(uid) {
    if (!uid || typeof sbGet !== 'function') return [];
    var rows = await sbGet('admin_notes', 'user_id=eq.' + encodeURIComponent(uid) + '&select=note_id,user_id,admin_email,body,created_at', 'created_at.desc', 30);
    return Array.isArray(rows) ? rows : [];
  }

  function countUserTasks(uid) {
    if (!uid || !window.tasks) return { posted: 0, apps: 0 };
    var posted = window.tasks.filter(function (t) {
      return String(t.posted_by || t.POSTED_BY || t.poster_id || '') === uid;
    }).length;
    var apps = (window.applications || []).filter(function (a) {
      return String(a.worker_id || a.WORKER_ID || '') === uid;
    }).length;
    return { posted: posted, apps: apps };
  }

  function closeAdminDrawer() {
    var overlay = document.getElementById('adminDrawerOverlay');
    if (overlay) overlay.classList.remove('open');
    drawerState = { type: null, id: null };
  }

  function bindDrawerClose() {
    var overlay = document.getElementById('adminDrawerOverlay');
    if (!overlay || overlay._qgBound) return;
    overlay._qgBound = true;
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeAdminDrawer();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAdminDrawer();
    });
  }

  async function openUserDrawer(key) {
    bindDrawerClose();
    var u = findUser(key);
    if (!u) return;
    drawerState = { type: 'user', id: userKey(u) };
    var uid = userKey(u);
    var notes = await loadAdminNotesForUser(uid);
    var counts = countUserTasks(uid);
    var warnings = typeof fetchUserWarnings === 'function' ? await fetchUserWarnings(uid) : [];
    var st = (u.status || 'active').toLowerCase();
    var tempFlag = isTempEmail(u.email);

    document.getElementById('adminDrawerHead').innerHTML =
      '<div><div class="admin-drawer-title">' + esc(u.name || 'User') +
      (u.review_flag ? ' <span class="admin-flag-pill">⚑ Under review</span>' : '') +
      (tempFlag ? '<span class="admin-temp-email">Temp email</span>' : '') +
      '</div><div class="admin-drawer-sub">' + esc(u.email || '—') + '</div></div>' +
      '<button type="button" class="admin-drawer-close" onclick="closeAdminDrawer()" aria-label="Close">×</button>';

    document.getElementById('adminDrawerBody').innerHTML =
      '<div class="admin-drawer-section"><div class="admin-drawer-section-title">Edit details</div>' +
        '<div class="admin-field"><label>Name</label><input id="admUserName" value="' + esc(u.name || '') + '"></div>' +
        '<div class="admin-field"><label>Email (display only — Firebase owns login)</label><input id="admUserEmail" value="' + esc(u.email || '') + '"></div>' +
        '<div class="admin-field"><label>Role</label><select id="admUserRole">' +
          ['poster', 'worker', 'both'].map(function (r) {
            return '<option value="' + r + '"' + ((u.role || '').toLowerCase() === r ? ' selected' : '') + '>' + r + '</option>';
          }).join('') +
        '</select></div>' +
        '<div class="admin-field"><label>Status</label><select id="admUserStatus">' +
          ['active', 'warned', 'banned'].map(function (s) {
            return '<option value="' + s + '"' + (st === s ? ' selected' : '') + '>' + s + '</option>';
          }).join('') +
        '</select></div>' +
      '</div>' +
      '<div class="admin-drawer-section"><div class="admin-drawer-section-title">Overview</div>' +
        '<div class="admin-meta-grid">' +
          '<div class="admin-meta-item"><div class="admin-meta-label">Tasks posted</div><div class="admin-meta-val">' + counts.posted + '</div></div>' +
          '<div class="admin-meta-item"><div class="admin-meta-label">Applications</div><div class="admin-meta-val">' + counts.apps + '</div></div>' +
          '<div class="admin-meta-item"><div class="admin-meta-label">Warnings</div><div class="admin-meta-val">' + warnings.length + '</div></div>' +
          '<div class="admin-meta-item"><div class="admin-meta-label">Joined</div><div class="admin-meta-val">' + (u.created_at ? new Date(u.created_at).toLocaleDateString('en-CA') : '—') + '</div></div>' +
          '<div class="admin-meta-item" style="grid-column:1/-1"><div class="admin-meta-label">Firebase UID</div><div class="admin-meta-val">' + esc(uid || '—') + '</div></div>' +
          (u.service_area ? '<div class="admin-meta-item" style="grid-column:1/-1"><div class="admin-meta-label">Service area</div><div class="admin-meta-val">' + esc(u.service_area) + '</div></div>' : '') +
        '</div>' +
      '</div>' +
      '<div class="admin-drawer-section"><div class="admin-drawer-section-title">Internal notes</div>' +
        (notes.length ? notes.map(function (n) {
          return '<div class="admin-note-item">' + esc(n.body) + '<div class="admin-note-time">' +
            (n.created_at ? new Date(n.created_at).toLocaleString('en-CA') : '') + '</div></div>';
        }).join('') : '<div style="font-size:12px;color:rgba(255,255,255,0.62);margin-bottom:8px">No notes yet.</div>') +
        '<div class="admin-field"><label>Add note</label><textarea id="admNewNote" placeholder="Internal note — only visible in admin"></textarea></div>' +
      '</div>' +
      '<div class="admin-drawer-section"><div class="admin-drawer-section-title">Actions</div>' +
        '<div class="admin-drawer-actions">' +
          '<button type="button" class="admin-drawer-btn primary" onclick="adminSaveUser()">Save changes</button>' +
          '<button type="button" class="admin-drawer-btn ghost" onclick="adminAddUserNote()">Add note</button>' +
          '<button type="button" class="admin-drawer-btn warn" onclick="adminFlagUser()">' + (u.review_flag ? 'Clear review flag' : 'Flag for review') + '</button>' +
          '<button type="button" class="admin-drawer-btn warn" onclick="adminWarnUser()">Issue warning</button>' +
          (st === 'banned'
            ? '<button type="button" class="admin-drawer-btn success" onclick="adminUnbanUser()">Unban</button>'
            : '<button type="button" class="admin-drawer-btn danger" onclick="adminBanUser()">Ban user</button>') +
          (isAdmin()
            ? '<button type="button" class="admin-drawer-btn danger" onclick="adminDeleteUser()">Delete user</button>' +
              '<p style="font-size:10px;color:rgba(255,255,255,0.4);margin:8px 0 0;line-height:1.4">Delete removes their tasks (and children), applications, then the user row. Cannot be undone.</p>'
            : '') +
          (u.firebase_uid ? '<a class="admin-drawer-btn ghost" href="profile.html?user=' + encodeURIComponent(u.firebase_uid) + '" target="_blank" rel="noopener">View public profile</a>' : '') +
        '</div>' +
      '</div>';

    document.getElementById('adminDrawerOverlay').classList.add('open');
  }

  async function openTaskDrawer(taskId) {
    bindDrawerClose();
    var t = findTask(taskId);
    if (!t) return;
    drawerState = { type: 'task', id: String(t.task_id || t.id) };
    var tid = drawerState.id;
    var apps = (window.applications || []).filter(function (a) {
      return String(a.task_id || a.TASK_ID || '') === tid;
    });
    var firstApp = apps.length && t.created_at && apps[0].created_at
      ? Math.round((new Date(apps[0].created_at) - new Date(t.created_at)) / 60000)
      : null;

    document.getElementById('adminDrawerHead').innerHTML =
      '<div><div class="admin-drawer-title">' + esc(t.title || 'Task') + '</div>' +
      '<div class="admin-drawer-sub">' + esc(t.poster_name || t.posted_by || 'Poster') + ' · $' + (t.budget || 0) + '</div></div>' +
      '<button type="button" class="admin-drawer-close" onclick="closeAdminDrawer()" aria-label="Close">×</button>';

    var statusOpts = ['open', 'in_progress', 'completed', 'cancelled', 'expired', 'removed'];
    var curStatus = (t.status || 'open').toLowerCase();
    var isRemoved = curStatus === 'removed';
    var adminActions = '';
    if (isAdmin()) {
      adminActions =
        '<button type="button" class="admin-drawer-btn warn" onclick="adminHideTask(\'' + tid.replace(/'/g, '') + '\')">' +
          (isRemoved ? 'Unhide task' : 'Hide task') + '</button>' +
        '<div class="admin-more-wrap" id="admTaskMoreWrap">' +
          '<button type="button" class="admin-drawer-btn ghost" onclick="event.stopPropagation();toggleAdminMoreMenu(\'admTaskMoreWrap\')">⋯ More</button>' +
          '<div class="admin-more-menu">' +
            '<button type="button" class="admin-more-item" onclick="adminHardDeleteTask(\'' + tid.replace(/'/g, '') + '\')">Delete permanently</button>' +
          '</div>' +
        '</div>' +
        '<p style="font-size:10px;color:rgba(255,255,255,0.4);margin:8px 0 0;line-height:1.4">Hide sets status to removed (keeps the record). Delete removes the task and related applications/messages/reviews/disputes.</p>';
    }

    document.getElementById('adminDrawerBody').innerHTML =
      '<div class="admin-drawer-section"><div class="admin-drawer-section-title">Edit task</div>' +
        '<div class="admin-field"><label>Title</label><input id="admTaskTitle" value="' + esc(t.title || '') + '"></div>' +
        '<div class="admin-field"><label>Budget ($)</label><input id="admTaskBudget" type="number" min="0" value="' + esc(String(t.budget || 0)) + '"></div>' +
        '<div class="admin-field"><label>Description</label><textarea id="admTaskDesc">' + esc(t.description || t.DESCRIPTION || '') + '</textarea></div>' +
        '<div class="admin-field"><label>Status</label><select id="admTaskStatus">' +
          statusOpts.map(function (s) {
            return '<option value="' + s + '"' + (curStatus === s ? ' selected' : '') + '>' + s + '</option>';
          }).join('') +
        '</select></div>' +
      '</div>' +
      '<div class="admin-drawer-section"><div class="admin-drawer-section-title">Details</div>' +
        '<div class="admin-meta-grid">' +
          '<div class="admin-meta-item"><div class="admin-meta-label">Mode</div><div class="admin-meta-val">' + esc(t.task_mode || 'standard') + '</div></div>' +
          '<div class="admin-meta-item"><div class="admin-meta-label">Category</div><div class="admin-meta-val">' + esc(t.category || '—') + '</div></div>' +
          '<div class="admin-meta-item"><div class="admin-meta-label">Location</div><div class="admin-meta-val">' + esc(t.location || '—') + '</div></div>' +
          '<div class="admin-meta-item"><div class="admin-meta-label">Applicants</div><div class="admin-meta-val">' + apps.length + '</div></div>' +
          (firstApp != null ? '<div class="admin-meta-item"><div class="admin-meta-label">Time to 1st apply</div><div class="admin-meta-val">' + firstApp + ' min</div></div>' : '') +
        '</div>' +
      '</div>' +
      '<div class="admin-drawer-section"><div class="admin-drawer-section-title">Applicants (' + apps.length + ')</div>' +
        (apps.length ? apps.map(function (a) {
          var wname = a.worker_name || a.WORKER_NAME || a.worker_id || 'Tasker';
          var st = (a.status || a.STATUS || 'pending').toLowerCase();
          return '<div class="admin-applicant-row"><span>' + esc(wname) +
            (a.price || a.PRICE ? ' · $' + (a.price || a.PRICE) : '') +
            '</span><span class="status-pill s-' + (st === 'accepted' ? 'progress' : st === 'completed' ? 'done' : 'posted') + '">' + st + '</span></div>';
        }).join('') : '<div style="font-size:12px;color:rgba(255,255,255,0.62)">No applications yet.</div>') +
      '</div>' +
      '<div class="admin-drawer-section"><div class="admin-drawer-section-title">Actions</div>' +
        '<div class="admin-drawer-actions">' +
          '<button type="button" class="admin-drawer-btn primary" onclick="adminSaveTask()">Save changes</button>' +
          '<button type="button" class="admin-drawer-btn warn" onclick="adminExpireTask()">Mark expired</button>' +
          adminActions +
          '<a class="admin-drawer-btn ghost" href="browsetask.html?task=' + encodeURIComponent(tid) + '" target="_blank" rel="noopener">View on browse ↗</a>' +
        '</div>' +
      '</div>';

    document.getElementById('adminDrawerOverlay').classList.add('open');
  }

  async function adminSaveUser() {
    if (!requireAdmin()) return;
    var u = findUser(drawerState.id);
    if (!u) return;
    var patch = {
      name: document.getElementById('admUserName').value.trim(),
      email: document.getElementById('admUserEmail').value.trim(),
      role: document.getElementById('admUserRole').value,
      status: document.getElementById('admUserStatus').value
    };
    var result = await patchUser(u, patch);
    if (result.success) {
      await logAdminAction('user_edit', 'user', userKey(u), patch);
      showToast('User updated', 'green');
      renderUsers(window.users);
      openUserDrawer(userKey(u));
    } else {
      showToast('Update failed', 'red');
    }
  }

  async function adminAddUserNote() {
    if (!requireAdmin()) return;
    var u = findUser(drawerState.id);
    if (!u) return;
    var body = (document.getElementById('admNewNote') && document.getElementById('admNewNote').value || '').trim();
    if (!body) return;
    var uid = userKey(u);
    if (typeof sbPostReturn === 'function') {
      await sbPostReturn('admin_notes', { user_id: uid, body: body, admin_email: adminEmail() });
    } else if (typeof sbPost === 'function') {
      await sbPost('admin_notes', { user_id: uid, body: body, admin_email: adminEmail() });
    }
    await logAdminAction('user_note', 'user', uid, { body: body });
    showToast('Note saved', 'green');
    openUserDrawer(uid);
  }

  async function adminFlagUser() {
    if (!requireAdmin()) return;
    var u = findUser(drawerState.id);
    if (!u) return;
    var next = !u.review_flag;
    var result = await patchUser(u, { review_flag: next });
    if (result.success) {
      u.review_flag = next;
      await logAdminAction(next ? 'user_flag' : 'user_unflag', 'user', userKey(u), {});
      showToast(next ? 'Flagged for review' : 'Review flag cleared', 'amber');
      renderUsers(window.users);
      openUserDrawer(userKey(u));
    }
  }

  async function adminWarnUser() {
    if (!requireAdmin()) return;
    var u = findUser(drawerState.id);
    if (!u) return;
    var uid = userKey(u);
    if (typeof addUserWarning === 'function') {
      await addUserWarning(uid, 'Admin warning from console', 'admin');
      await patchUser(u, { status: 'warned' });
      await logAdminAction('user_warn', 'user', uid, {});
      showToast('Warning issued', 'amber');
      renderUsers(window.users);
      openUserDrawer(uid);
    }
  }

  async function adminBanUser() {
    if (!requireAdmin()) return;
    var u = findUser(drawerState.id);
    if (!u || !confirm('Ban ' + (u.name || 'this user') + '? They will not be able to log in.')) return;
    var result = await patchUser(u, { status: 'banned' });
    if (result.success) {
      await logAdminAction('user_ban', 'user', userKey(u), {});
      showToast('User banned', 'red');
      renderUsers(window.users);
      closeAdminDrawer();
    }
  }

  async function adminUnbanUser() {
    if (!requireAdmin()) return;
    var u = findUser(drawerState.id);
    if (!u) return;
    var result = await patchUser(u, { status: 'active' });
    if (result.success) {
      await logAdminAction('user_unban', 'user', userKey(u), {});
      showToast('User unbanned', 'green');
      renderUsers(window.users);
      openUserDrawer(userKey(u));
    }
  }

  async function adminSaveTask() {
    if (!requireAdmin()) return;
    var t = findTask(drawerState.id);
    if (!t) return;
    var tid = String(t.task_id || t.id);
    var patch = {
      title: document.getElementById('admTaskTitle').value.trim(),
      budget: Math.round(Number(document.getElementById('admTaskBudget').value) || 0),
      description: document.getElementById('admTaskDesc').value.trim(),
      status: document.getElementById('admTaskStatus').value
    };
    var result = await sbUpdate('tasks', patch, 'task_id=eq.' + encodeURIComponent(tid));
    if (!result.success && t.id) {
      result = await sbUpdate('tasks', patch, 'id=eq.' + encodeURIComponent(String(t.id)));
    }
    if (result.success) {
      Object.assign(t, patch);
      if (typeof mergeTaskInCache === 'function') mergeTaskInCache(tid, patch);
      await logAdminAction('task_edit', 'task', tid, patch);
      showToast('Task updated', 'green');
      renderTasks(window.tasks);
      openTaskDrawer(tid);
    } else {
      showToast('Task update failed', 'red');
    }
  }

  async function adminExpireTask() {
    if (!requireAdmin()) return;
    var t = findTask(drawerState.id);
    if (!t) return;
    var tid = String(t.task_id || t.id);
    if (typeof updateTaskStatus === 'function') {
      await updateTaskStatus(tid, 'expired');
    } else {
      await sbUpdate('tasks', { status: 'expired' }, 'task_id=eq.' + encodeURIComponent(tid));
    }
    t.status = 'expired';
    await logAdminAction('task_expire', 'task', tid, {});
    showToast('Task marked expired', 'amber');
    renderTasks(window.tasks);
    openTaskDrawer(tid);
  }

  function toggleAdminMoreMenu(wrapId) {
    document.querySelectorAll('.admin-more-wrap.open').forEach(function (el) {
      if (el.id !== wrapId) el.classList.remove('open');
    });
    var wrap = document.getElementById(wrapId);
    if (wrap) wrap.classList.toggle('open');
  }

  if (!window._qgAdminMoreBound) {
    window._qgAdminMoreBound = true;
    document.addEventListener('click', function () {
      document.querySelectorAll('.admin-more-wrap.open').forEach(function (el) {
        el.classList.remove('open');
      });
    });
  }

  async function deleteRowsByTaskId(table, taskId) {
    if (typeof sbDelete !== 'function') return { success: false };
    return sbDelete(table, 'task_id=eq.' + encodeURIComponent(String(taskId)));
  }

  async function deleteMessagesForTask(taskId) {
    taskId = String(taskId || '');
    var convs = [];
    if (typeof getConversationsForTask === 'function') {
      try { convs = await getConversationsForTask(taskId) || []; } catch (e) { convs = []; }
    }
    if ((!convs || !convs.length) && typeof sbGet === 'function') {
      try {
        var rows = await sbGet('conversations', 'task_id=eq.' + encodeURIComponent(taskId) + '&select=conv_id,task_id,poster_id,worker_id,poster_name,worker_name,task_title,status,last_message,last_message_at,created_at', null, 100);
        if (Array.isArray(rows)) convs = rows;
      } catch (e2) { /* ignore */ }
    }
    for (var i = 0; i < (convs || []).length; i++) {
      var cid = convs[i].conv_id || convs[i].id;
      if (!cid) continue;
      await sbDelete('messages', 'conv_id=eq.' + encodeURIComponent(String(cid)));
      await sbDelete('conversations', 'conv_id=eq.' + encodeURIComponent(String(cid)));
    }
    return { success: true };
  }

  /**
   * Hard-delete a task and child rows. Client isAdmin is UX only —
   * server-side enforcement required when RLS is enabled (LAUNCH-PREP Phase 5).
   */
  async function hardDeleteTaskCascade(taskId) {
    if (!isAdmin()) return { success: false, error: 'not_admin' };
    taskId = String(taskId || '');
    if (!taskId || typeof sbDelete !== 'function') return { success: false, error: 'missing' };

    await deleteRowsByTaskId('applications', taskId);
    await deleteMessagesForTask(taskId);
    await deleteRowsByTaskId('reviews', taskId);
    await deleteRowsByTaskId('disputes', taskId);

    var result = await sbDelete('tasks', 'task_id=eq.' + encodeURIComponent(taskId));
    if (!result.success) {
      var t = findTask(taskId);
      if (t && t.id != null) {
        result = await sbDelete('tasks', 'id=eq.' + encodeURIComponent(String(t.id)));
      }
    }
    return result;
  }

  async function adminHideTask(taskId) {
    if (!requireAdmin()) return { success: false, error: 'not_admin' };
    var tid = String(taskId || drawerState.id || '');
    var t = findTask(tid);
    if (!t) return { success: false, error: 'not_found' };
    var cur = String(t.status || 'open').toLowerCase();
    var next = cur === 'removed' ? 'open' : 'removed';
    var result;
    if (typeof updateTaskStatus === 'function' && next !== 'removed') {
      result = await updateTaskStatus(tid, next);
    } else {
      result = await sbUpdate('tasks', { status: next }, 'task_id=eq.' + encodeURIComponent(tid));
    }
    if (!result || !result.success) {
      showToast('Could not update task', 'red');
      return result || { success: false };
    }
    t.status = next;
    if (typeof mergeTaskInCache === 'function') mergeTaskInCache(tid, { status: next });
    await logAdminAction(next === 'removed' ? 'task_hide' : 'task_unhide', 'task', tid, {});
    showToast(next === 'removed' ? 'Task hidden (status=removed)' : 'Task unhidden', 'amber');
    applyAdminTasksView();
    if (typeof renderOverview === 'function') renderOverview();
    if (typeof renderModerationQueue === 'function') renderModerationQueue();
    if (drawerState.type === 'task') openTaskDrawer(tid);
    return { success: true };
  }

  async function adminHardDeleteTask(taskId, opts) {
    opts = opts || {};
    if (!requireAdmin()) return { success: false, error: 'not_admin' };
    var tid = String(taskId || drawerState.id || '');
    var t = findTask(tid);
    if (!t) return { success: false, error: 'not_found' };

    if (!opts.skipConfirm) {
      var ok = await confirmAdmin({
        title: 'Delete this task?',
        message: 'Delete this task and all its applications/messages? This cannot be undone.',
        confirmLabel: 'Delete permanently',
        confirmClass: 'danger'
      });
      if (!ok) return { success: false, cancelled: true };
    }

    var result = await hardDeleteTaskCascade(tid);
    if (!result.success) {
      if (!opts.silent) showToast('Could not delete task', 'red');
      return result;
    }

    await logAdminAction('task_hard_delete', 'task', tid, { title: t.title || '' });
    window.tasks = (window.tasks || []).filter(function (x) {
      return String(x.task_id || x.id) !== tid;
    });
    window.applications = (window.applications || []).filter(function (a) {
      return String(a.task_id || a.TASK_ID || '') !== tid;
    });
    window.disputes = (window.disputes || []).filter(function (d) {
      return String(d.task_id || '') !== tid;
    });
    delete taskUI.selected[tid];
    if (!opts.silent) {
      showToast('Task permanently deleted', 'red');
      applyAdminTasksView();
      if (typeof renderOverview === 'function') renderOverview();
      if (typeof renderModerationQueue === 'function') renderModerationQueue();
      closeAdminDrawer();
    }
    return { success: true };
  }

  /** Legacy entry point — hard delete (kept for moderation shortcuts). */
  async function adminRemoveTask() {
    return adminHardDeleteTask(drawerState.id);
  }

  /**
   * Delete a user + their posted tasks/children.
   * Bulk delete is powerful — client isAdmin() is UX only; real enforcement = RLS + service-role.
   */
  async function adminDeleteUserById(uidOrKey, opts) {
    opts = opts || {};
    if (!requireAdmin()) return { success: false, error: 'not_admin' };
    var u = findUser(uidOrKey);
    if (!u) return { success: false, error: 'not_found' };
    var uid = userKey(u);
    if (isAdmin({ email: u.email, uid: u.firebase_uid || u.uid || uid })) {
      if (!opts.silent) showToast('Cannot delete an admin account', 'red');
      return { success: false, error: 'cannot_delete_admin' };
    }
    var label = u.name || u.email || 'this user';
    if (!opts.skipConfirm) {
      var ok = await confirmAdmin({
        title: 'Delete ' + label + '?',
        message: 'Delete ' + label + ' and all their tasks/applications? This cannot be undone.',
        confirmLabel: 'Delete user',
        confirmClass: 'danger'
      });
      if (!ok) return { success: false, cancelled: true };
    }

    var posted = (window.tasks || []).filter(function (t) {
      return String(t.posted_by || t.POSTED_BY || t.poster_id || '') === uid;
    });
    for (var i = 0; i < posted.length; i++) {
      var tid = String(posted[i].task_id || posted[i].id || '');
      if (tid) await hardDeleteTaskCascade(tid);
    }

    if (typeof sbDelete === 'function') {
      await sbDelete('applications', 'worker_id=eq.' + encodeURIComponent(uid));
      await sbDelete('applications', 'WORKER_ID=eq.' + encodeURIComponent(uid));
    }

    var deletedUser = false;
    var filters = [];
    if (u.user_id != null) filters.push('user_id=eq.' + encodeURIComponent(String(u.user_id)));
    if (u.firebase_uid) filters.push('firebase_uid=eq.' + encodeURIComponent(u.firebase_uid));
    if (u.email) filters.push('email=eq.' + encodeURIComponent(u.email));
    for (var fi = 0; fi < filters.length; fi++) {
      var ur = await sbDelete('users', filters[fi]);
      if (ur.success) { deletedUser = true; break; }
    }

    if (!deletedUser) {
      if (!opts.silent) showToast('Could not delete user row', 'red');
      return { success: false };
    }

    await logAdminAction('user_hard_delete', 'user', uid, { email: u.email || '' });
    window.users = (window.users || []).filter(function (x) {
      return userKey(x) !== uid;
    });
    window.tasks = (window.tasks || []).filter(function (t) {
      return String(t.posted_by || t.POSTED_BY || t.poster_id || '') !== uid;
    });
    window.applications = (window.applications || []).filter(function (a) {
      return String(a.worker_id || a.WORKER_ID || '') !== uid;
    });
    if (!opts.silent) {
      showToast('User deleted', 'red');
      if (typeof applyUsersView === 'function') applyUsersView();
      else if (typeof renderUsers === 'function') renderUsers(window.users);
      applyAdminTasksView();
      if (typeof renderOverview === 'function') renderOverview();
      closeAdminDrawer();
    }
    return { success: true };
  }

  async function adminDeleteUser() {
    return adminDeleteUserById(drawerState.id);
  }

  function taskPosterSearchName(t) {
    var uid = t.posted_by || t.POSTED_BY || '';
    if (typeof adminResolveUserName === 'function') {
      return adminResolveUserName(uid, t.poster_name || '');
    }
    return String(t.poster_name || '').trim();
  }

  function getFilteredTasks() {
    var q = String(taskUI.search || '').toLowerCase().trim();
    var status = String(taskUI.status || 'all').toLowerCase();
    var mode = String(taskUI.mode || 'all').toLowerCase();
    return (window.tasks || []).filter(function (t) {
      var st = String(t.status || 'open').toLowerCase();
      var md = String(t.task_mode || t.TASK_MODE || 'standard').toLowerCase();
      if (status !== 'all' && st !== status) return false;
      if (mode !== 'all' && md !== mode) return false;
      if (!q) return true;
      var title = String(t.title || '').toLowerCase();
      var posterName = taskPosterSearchName(t).toLowerCase();
      return title.indexOf(q) >= 0 || posterName.indexOf(q) >= 0;
    });
  }

  function syncTaskFilterChips() {
    document.querySelectorAll('[data-task-status]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-task-status') === taskUI.status);
    });
    document.querySelectorAll('[data-task-mode]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-task-mode') === taskUI.mode);
    });
  }

  function updateTasksBulkBar() {
    var ids = Object.keys(taskUI.selected).filter(function (id) { return taskUI.selected[id]; });
    var bulk = document.getElementById('tasksBulkActions');
    var label = document.getElementById('tasksBulkLabel');
    if (bulk) {
      if (ids.length) bulk.classList.add('show');
      else bulk.classList.remove('show');
    }
    if (label) label.textContent = ids.length + ' selected';
    var all = document.querySelectorAll('#tasksBody .task-select-cb');
    var selAll = document.getElementById('tasksSelectAll');
    if (selAll && all.length) {
      var checked = 0;
      all.forEach(function (c) { if (c.checked) checked++; });
      selAll.checked = checked === all.length;
      selAll.indeterminate = checked > 0 && checked < all.length;
    }
  }

  function applyAdminTasksView() {
    syncTaskFilterChips();
    var filtered = getFilteredTasks();
    taskUI.filteredIds = filtered.map(function (t) { return String(t.task_id || t.id || ''); });
    // Drop selections that are no longer in the filtered set
    Object.keys(taskUI.selected).forEach(function (id) {
      if (taskUI.filteredIds.indexOf(id) < 0) delete taskUI.selected[id];
    });
    renderTasksEnhanced(filtered);
    updateTasksBulkBar();
  }

  function onTasksSearchInput(q) {
    taskUI.search = q || '';
    if (taskUI.searchTimer) clearTimeout(taskUI.searchTimer);
    taskUI.searchTimer = setTimeout(function () { applyAdminTasksView(); }, 300);
  }

  function setTaskStatusFilter(status) {
    taskUI.status = status || 'all';
    applyAdminTasksView();
  }

  function setTaskModeFilter(mode) {
    taskUI.mode = mode || 'all';
    applyAdminTasksView();
  }

  function toggleTaskSelected(tid, checked) {
    tid = String(tid || '');
    if (!tid) return;
    if (checked) taskUI.selected[tid] = true;
    else delete taskUI.selected[tid];
    updateTasksBulkBar();
  }

  function selectAllTasks(cb) {
    var on = !!(cb && cb.checked);
    taskUI.filteredIds.forEach(function (id) {
      if (on) taskUI.selected[id] = true;
      else delete taskUI.selected[id];
    });
    document.querySelectorAll('#tasksBody .task-select-cb').forEach(function (c) {
      c.checked = on;
    });
    updateTasksBulkBar();
  }

  /**
   * Bulk hide — primary/safer action.
   * Bulk delete is powerful; client isAdmin() is UX only until RLS + service-role backend.
   */
  async function bulkHideTasks() {
    if (!requireAdmin()) return;
    var ids = Object.keys(taskUI.selected).filter(function (id) { return taskUI.selected[id]; });
    if (!ids.length) return;
    var ok = await confirmAdmin({
      title: 'Hide ' + ids.length + ' task' + (ids.length === 1 ? '' : 's') + '?',
      message: 'Hide ' + ids.length + ' selected task' + (ids.length === 1 ? '' : 's') + ' (status → removed). They can be unhidden later.',
      confirmLabel: 'Hide selected',
      confirmClass: 'warn'
    });
    if (!ok) return;
    var n = 0;
    for (var i = 0; i < ids.length; i++) {
      var t = findTask(ids[i]);
      if (!t) continue;
      var cur = String(t.status || 'open').toLowerCase();
      if (cur === 'removed') continue;
      var result = await sbUpdate('tasks', { status: 'removed' }, 'task_id=eq.' + encodeURIComponent(ids[i]));
      if (result && result.success) {
        t.status = 'removed';
        n++;
        await logAdminAction('task_hide', 'task', ids[i], { bulk: true });
      }
    }
    taskUI.selected = {};
    applyAdminTasksView();
    if (typeof renderOverview === 'function') renderOverview();
    if (typeof renderModerationQueue === 'function') renderModerationQueue();
    showToast(n + ' task' + (n === 1 ? '' : 's') + ' hidden', 'amber');
  }

  async function bulkDeleteTasks() {
    if (!requireAdmin()) return;
    var ids = Object.keys(taskUI.selected).filter(function (id) { return taskUI.selected[id]; });
    if (!ids.length) return;
    var ok = await confirmAdmin({
      title: 'Delete ' + ids.length + ' task' + (ids.length === 1 ? '' : 's') + '?',
      message: 'Delete ' + ids.length + ' tasks and their applications/messages/reviews/disputes? This cannot be undone.',
      confirmLabel: 'Delete selected',
      confirmClass: 'danger'
    });
    if (!ok) return;
    var n = 0;
    for (var i = 0; i < ids.length; i++) {
      var result = await adminHardDeleteTask(ids[i], { skipConfirm: true, silent: true });
      if (result && result.success) n++;
    }
    taskUI.selected = {};
    applyAdminTasksView();
    if (typeof renderOverview === 'function') renderOverview();
    if (typeof renderModerationQueue === 'function') renderModerationQueue();
    showToast(n + ' task' + (n === 1 ? '' : 's') + ' deleted', 'red');
  }

  function renderTasksEnhanced(data) {
    // When called with full list from legacy paths, re-apply filters
    if (!data || data === window.tasks) {
      data = getFilteredTasks();
    }
    var totalAll = (window.tasks || []).length;
    var countEl = document.getElementById('tasksCount');
    if (countEl) {
      countEl.textContent = data.length === totalAll
        ? ('· ' + data.length + ' total')
        : ('· ' + data.length + ' shown · ' + totalAll + ' total');
    }
    var body = document.getElementById('tasksBody');
    if (!body) return;
    if (!data.length) {
      body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-faint);font-size:13px">No tasks match these filters</div>';
      updateTasksBulkBar();
      return;
    }
    var adminOk = isAdmin();
    body.innerHTML = data.map(function (t, i) {
      var tid = String(t.task_id || t.id || '');
      var st = (t.status || 'open').toLowerCase();
      var sc = st === 'completed' ? 's-done'
        : st === 'in_progress' ? 's-progress'
        : st === 'expired' ? 's-expired'
        : st === 'removed' ? 's-removed'
        : st === 'cancelled' ? 's-banned'
        : 's-posted';
      var sl = st === 'in_progress' ? 'In progress'
        : st === 'removed' ? 'Hidden'
        : st.charAt(0).toUpperCase() + st.slice(1);
      var appCount = (window.applications || []).filter(function (a) {
        return String(a.task_id || a.TASK_ID || '') === tid;
      }).length;
      var safeTid = tid.replace(/'/g, '');
      var menuId = 'taskMore_' + i;
      var checked = !!taskUI.selected[tid];
      var actions =
        '<button type="button" class="act-btn btn-view" onclick="event.stopPropagation();openTaskDrawer(\'' + safeTid + '\')">Open</button>';
      if (adminOk) {
        actions +=
          '<button type="button" class="act-btn btn-hide" onclick="event.stopPropagation();adminHideTask(\'' + safeTid + '\')">' +
            (st === 'removed' ? 'Unhide' : 'Hide') + '</button>' +
          '<div class="admin-more-wrap" id="' + menuId + '" onclick="event.stopPropagation()">' +
            '<button type="button" class="act-btn btn-more" onclick="event.stopPropagation();toggleAdminMoreMenu(\'' + menuId + '\')" aria-label="More actions">⋯</button>' +
            '<div class="admin-more-menu">' +
              '<button type="button" class="admin-more-item" onclick="event.stopPropagation();adminHardDeleteTask(\'' + safeTid + '\')">Delete</button>' +
            '</div>' +
          '</div>';
      }
      var posterHtml = typeof adminResolveUserHtml === 'function'
        ? adminResolveUserHtml(t.posted_by || t.POSTED_BY, t.poster_name)
        : esc(t.poster_name || t.posted_by || '—');
      var money = typeof adminFormatMoney === 'function'
        ? adminFormatMoney(t.budget)
        : ('$' + Number(t.budget || 0).toFixed(2));
      return '<div class="data-row g-tasks" onclick="openTaskDrawer(\'' + safeTid + '\')">' +
        '<div><input type="checkbox" class="checkbox task-select-cb" value="' + esc(tid) + '"' +
          (checked ? ' checked' : '') +
          ' onclick="event.stopPropagation()" onchange="toggleTaskSelected(this.value, this.checked)" aria-label="Select task"></div>' +
        '<div class="user-cell"><div style="min-width:0"><div class="u-name">' + esc(t.title || 'Untitled') + '</div>' +
        '<div class="u-meta">' + appCount + ' applicant' + (appCount !== 1 ? 's' : '') +
        ' · ' + (t.created_at ? new Date(t.created_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : '') +
        '</div></div></div>' +
        '<div class="cell">' + posterHtml + '</div>' +
        '<div class="cell cell-num">' + money + '</div>' +
        '<div class="cell-pill"><span class="mode-pill">' + esc(t.task_mode || 'standard') + '</span></div>' +
        '<div class="cell-pill"><span class="status-pill ' + sc + '">' + esc(sl) + '</span></div>' +
        '<div class="act-btns">' + actions + '</div></div>';
    }).join('');
    updateTasksBulkBar();
  }

  /**
   * Update a report status (reviewed / dismissed / actioned).
   * ADMIN-NOTE: uses anon client today. Once RLS is on, this write (and reading
   * OTHER users' reports) must go through a service-role Edge Function —
   * never put a service-role key in the frontend.
   */
  async function adminResolveReport(reportId, newStatus) {
    if (!requireAdmin()) return;
    if (typeof sbUpdate !== 'function') return;
    var rid = String(reportId || '');
    var st = String(newStatus || '').toLowerCase();
    if (!rid || ['reviewed', 'dismissed', 'actioned'].indexOf(st) < 0) return;
    var result = await sbUpdate('reports', { status: st }, 'report_id=eq.' + encodeURIComponent(rid));
    if (!result || !result.success) {
      showToast('Could not update report', 'red');
      return;
    }
    var r = (window.reports || []).find(function (x) { return String(x.report_id || x.id) === rid; });
    if (r) r.status = st;
    await logAdminAction('report_' + st, 'report', rid, {});
    showToast('Report marked ' + adminReasonLabel(st), 'green');
    renderReportsEnhanced();
    if (typeof renderOverview === 'function') renderOverview();
  }

  function csvEscape(val) {
    var s = String(val == null ? '' : val);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCSV(type) {
    var data, filename, rows;
    if (type === 'users') {
      filename = 'quickgigs-users.csv';
      rows = (window.users || []).map(function (u) {
        return [
          u.name, u.email, u.role, u.status, u.review_flag ? 'yes' : 'no',
          u.firebase_uid || u.user_id, u.created_at, isTempEmail(u.email) ? 'temp' : ''
        ].map(csvEscape).join(',');
      });
      rows.unshift(['Name', 'Email', 'Role', 'Status', 'Review flag', 'UID', 'Joined', 'Email type'].join(','));
    } else if (type === 'tasks') {
      filename = 'quickgigs-tasks.csv';
      rows = (window.tasks || []).map(function (t) {
        return [
          t.title, t.poster_name || t.posted_by, t.budget, t.task_mode, t.status,
          t.category, t.location, t.created_at, t.task_id || t.id
        ].map(csvEscape).join(',');
      });
      rows.unshift(['Title', 'Poster', 'Budget', 'Mode', 'Status', 'Category', 'Location', 'Created', 'Task ID'].join(','));
    } else if (type === 'security') {
      filename = 'quickgigs-admin-actions.csv';
      rows = (window.adminActions || []).map(function (a) {
        return [a.created_at, a.admin_email, a.action_type, a.target_type, a.target_id, JSON.stringify(a.detail || {})].map(csvEscape).join(',');
      });
      rows.unshift(['When', 'Admin', 'Action', 'Target type', 'Target ID', 'Detail'].join(','));
    } else if (type === 'payments') {
      filename = 'quickgigs-payments.csv';
      rows = (window.payments || []).map(function (p) {
        return [
          p.task_id, p.poster_id, p.worker_id, p.amount, p.platform_fee, p.worker_payout,
          p.status, p.stripe_id, p.transfer_id, p.created_at, p.completed_at
        ].map(csvEscape).join(',');
      });
      rows.unshift(['Task ID', 'Poster', 'Worker', 'Amount', 'Platform fee', 'Worker payout', 'Status', 'Stripe ID', 'Transfer ID', 'Created', 'Completed'].join(','));
    } else {
      showToast('Nothing to export', 'amber');
      return;
    }
    var blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported ' + (rows.length - 1) + ' rows', 'green');
  }

  function renderSecurityFromActions() {
    var el = document.getElementById('securityLog');
    if (!el) return;
    var actions = (window.adminActions || []).slice(0, 50);
    if (!actions.length) {
      el.innerHTML = '<div style="padding:24px;text-align:center;color:rgba(255,255,255,0.62);font-size:13px">Admin actions will appear here once you edit users or tasks.</div>';
      return;
    }
    el.innerHTML = actions.map(function (a) {
      var label = (a.action_type || 'action').replace(/_/g, ' ');
      var text = (a.target_type || '') + (a.target_id ? ' · ' + a.target_id : '');
      if (a.detail && a.detail.body) text += ' — ' + a.detail.body;
      var when = a.created_at ? new Date(a.created_at).toLocaleString('en-CA') : '';
      return '<div class="sec-item"><span class="sec-type sec-signup">' + esc(label) + '</span>' +
        '<div class="sec-text">' + esc(text) + '</div><div class="sec-time">' + esc(when) + '</div></div>';
    }).join('');
  }

  function renderFraudAlerts() {
    var el = document.getElementById('fraudLog');
    if (!el) return;
    var items = [];
    (window.adminActions || []).forEach(function (a) {
      if (String(a.action_type || '') !== 'fraud_contact_attempt') return;
      var d = a.detail || {};
      var who = d.user_id || a.target_id || '';
      var why = d.reason || 'contact';
      var n = d.violation ? (' #' + d.violation) : '';
      items.push({
        text: 'Contact sharing attempt' + n + ' (' + why + ')' + (who ? ' · user ' + who : '') +
          (d.preview ? ' — "' + String(d.preview).slice(0, 40) + '"' : ''),
        time: a.created_at,
        kind: 'fraud'
      });
    });
    (window.users || []).forEach(function (u) {
      if (isTempEmail(u.email)) {
        items.push({ text: 'Temp email signup: ' + (u.email || ''), user: u.name, time: u.created_at });
      }
      if (u.review_flag) {
        items.push({ text: 'Flagged for review: ' + (u.name || u.email), user: '', time: u.created_at });
      }
    });
    (window.applications || []).forEach(function (a) {
      var wid = a.worker_id || a.WORKER_ID;
      if (!wid) return;
      var count = (window.applications || []).filter(function (x) {
        return String(x.worker_id || x.WORKER_ID) === String(wid);
      }).length;
      if (count >= 20) {
        items.push({ text: wid + ' has ' + count + ' applications (high volume)', user: a.worker_name || '', time: a.created_at });
      }
    });
    items.sort(function (a, b) {
      return String(b.time || '').localeCompare(String(a.time || ''));
    });
    if (!items.length) {
      el.innerHTML = '<div style="padding:24px;text-align:center;color:rgba(255,255,255,0.62);font-size:13px">No fraud alerts right now.</div>';
      return;
    }
    el.innerHTML = items.slice(0, 40).map(function (e) {
      var badge = e.kind === 'fraud' ? '🚫 Contact' : '⚠ Alert';
      return '<div class="sec-item"><span class="sec-type sec-blocked">' + badge + '</span>' +
        '<div class="sec-text">' + esc(e.text) + '</div>' +
        '<div class="sec-time">' + (e.time ? new Date(e.time).toLocaleString('en-CA') : '') + '</div></div>';
    }).join('');
  }

  function setReportFilter(f) {
    reportFilter = f === 'all' ? 'all' : 'open';
    document.querySelectorAll('#section-reports .report-filter-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-filter') === reportFilter);
    });
    renderReportsEnhanced();
  }

  function setDisputeFilter(f) {
    disputeFilter = f === 'all' ? 'all' : 'open';
    document.querySelectorAll('#section-disputes .report-filter-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-dispute-filter') === disputeFilter);
    });
    renderDisputesEnhanced();
  }

  function countOpenReports() {
    return (window.reports || []).filter(function (r) {
      return String(r.status || 'open').toLowerCase() === 'open';
    }).length;
  }

  /** Active dispute queue: open + reviewing (not resolved/rejected). */
  function countOpenDisputes() {
    return (window.disputes || []).filter(function (d) {
      var st = String(d.status || 'open').toLowerCase();
      return st === 'open' || st === 'reviewing';
    }).length;
  }

  function syncModerationBadges() {
    var openR = countOpenReports();
    var openD = countOpenDisputes();
    var rb = document.getElementById('reportBadge');
    var db = document.getElementById('disputeBadge');
    if (rb) rb.textContent = String(openR);
    if (db) db.textContent = String(openD);
    var modBadge = document.getElementById('moderationReportBadge');
    if (modBadge) modBadge.textContent = String(openR);
  }

  /**
   * Reports queue — open first (newest), human reason labels, linked target.
   * Loaded via anon client (see loadData ADMIN-NOTE). After RLS: service-role backend only.
   */
  function renderReportsEnhanced() {
    var open = countOpenReports();
    var countEl = document.getElementById('reportsCount');
    if (countEl) {
      countEl.textContent = reportFilter === 'open'
        ? ('· ' + open + ' open')
        : ('· ' + (window.reports || []).length + ' total · ' + open + ' open');
    }
    syncModerationBadges();

    var list = (window.reports || []).slice().sort(function (a, b) {
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
    if (reportFilter === 'open') {
      list = list.filter(function (r) { return String(r.status || 'open').toLowerCase() === 'open'; });
    }

    var body = document.getElementById('reportsBody');
    if (!body) return;
    if (!list.length) {
      body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-faint);font-size:13px">' +
        (reportFilter === 'open' ? 'No open reports' : 'No reports yet') + '</div>';
      return;
    }

    var attr = typeof escAttr === 'function' ? escAttr : function (s) {
      return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    };

    body.innerHTML = list.map(function (r) {
      var rid = String(r.report_id || r.id || '');
      var tt = String(r.target_type || '').toLowerCase();
      var tid = String(r.target_id || '');
      var targetLabel = (tt === 'task' ? 'Task' : tt === 'user' || tt === 'profile' ? 'User' : (tt || 'Target')) +
        (tid ? ' · ' + (tid.length > 18 ? tid.slice(0, 10) + '…' : tid) : '');
      var detail = String(r.detail || r.details || '').trim();
      var detailShort = detail.length > 100 ? detail.slice(0, 100) + '…' : detail;
      var st = String(r.status || 'open').toLowerCase();
      var reporterHtml = typeof adminResolveUserHtml === 'function'
        ? adminResolveUserHtml(r.reporter_id)
        : esc(r.reporter_id || '—');

      return '<div class="data-row g-disputes">' +
        '<div class="cell">' + esc(adminReasonLabel(r.reason)) + '</div>' +
        '<div class="cell">' +
          (tid
            ? '<a href="#" class="admin-uid-name" title="' + attr(tt + ': ' + tid) + '" data-tt="' + attr(tt) + '" data-tid="' + attr(tid) + '" onclick="event.preventDefault();adminOpenReportTarget(this.getAttribute(\'data-tt\'),this.getAttribute(\'data-tid\'))">' + esc(targetLabel) + '</a>'
            : esc(targetLabel || '—')) +
        '</div>' +
        '<div class="cell">' + reporterHtml + '</div>' +
        '<div class="cell cell-wrap" title="' + attr(detail) + '">' + esc(detailShort || '—') + '</div>' +
        '<div class="cell">' + esc(adminTimeAgo(r.created_at)) + '</div>' +
        '<div class="act-btns">' +
          (st === 'open'
            ? '<button type="button" class="act-btn btn-resolve" data-rid="' + attr(rid) + '" onclick="adminResolveReport(this.getAttribute(\'data-rid\'),\'reviewed\')">Mark reviewed</button>' +
              '<button type="button" class="act-btn btn-view" data-rid="' + attr(rid) + '" onclick="adminResolveReport(this.getAttribute(\'data-rid\'),\'dismissed\')">Dismiss</button>' +
              '<button type="button" class="act-btn btn-warn" data-rid="' + attr(rid) + '" onclick="adminResolveReport(this.getAttribute(\'data-rid\'),\'actioned\')">Actioned</button>'
            : '<span class="status-pill ' + (st === 'actioned' ? 's-progress' : 's-resolved') + '">' + esc(adminReasonLabel(st)) + '</span>') +
        '</div></div>';
    }).join('');
  }

  function adminOpenReportTarget(type, id) {
    type = String(type || '').toLowerCase();
    id = String(id || '');
    if (!id) return;
    if (type === 'task') openTaskDrawer(id);
    else openUserDrawer(id);
  }

  /**
   * Disputes queue — evidence drawer + Stripe resolve (release / refund / split).
   */
  function renderDisputesEnhanced() {
    var open = countOpenDisputes();
    var countEl = document.getElementById('disputesCount');
    if (countEl) {
      countEl.textContent = disputeFilter === 'open'
        ? ('· ' + open + ' open')
        : ('· ' + (window.disputes || []).length + ' total · ' + open + ' open');
    }
    syncModerationBadges();

    var list = (window.disputes || []).slice().sort(function (a, b) {
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
    if (disputeFilter === 'open') {
      list = list.filter(function (d) {
        var st = String(d.status || 'open').toLowerCase();
        return st === 'open' || st === 'reviewing';
      });
    }

    var body = document.getElementById('disputesBody');
    if (!body) return;
    if (!list.length) {
      body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-faint);font-size:13px">' +
        (disputeFilter === 'open' ? 'No open disputes' : 'No disputes yet') + '</div>';
      return;
    }

    var attr = typeof escAttr === 'function' ? escAttr : function (s) {
      return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    };

    body.innerHTML = list.map(function (d) {
      var did = String(d.dispute_id || d.id || '');
      var tid = String(d.task_id || '');
      var task = (window.tasks || []).find(function (t) {
        return String(t.task_id || t.id) === tid;
      });
      var taskTitle = task ? (task.title || tid) : tid;
      var taskLabel = taskTitle
        ? (String(taskTitle).length > 36 ? String(taskTitle).slice(0, 34) + '…' : taskTitle)
        : '—';
      var detail = String(d.detail || d.details || '').trim();
      var detailShort = detail.length > 100 ? detail.slice(0, 100) + '…' : detail;
      var st = String(d.status || 'open').toLowerCase();
      var raisedHtml = typeof adminResolveUserHtml === 'function'
        ? adminResolveUserHtml(d.raised_by)
        : esc(d.raised_by || '—');
      var stPill = st === 'open' ? 's-open'
        : st === 'reviewing' ? 's-progress'
        : st === 'rejected' ? 's-banned'
        : 's-resolved';

      var actions = '';
      if (st === 'open' || st === 'reviewing') {
        actions =
          '<button type="button" class="act-btn btn-view" data-did="' + attr(did) + '" data-tid="' + attr(tid) + '" onclick="adminOpenDisputeEvidence(this.getAttribute(\'data-did\'),this.getAttribute(\'data-tid\'))">Evidence</button>' +
          (st === 'open'
            ? '<button type="button" class="act-btn btn-view" data-did="' + attr(did) + '" onclick="adminUpdateDisputeStatus(this.getAttribute(\'data-did\'),\'reviewing\')">Start review</button>'
            : '') +
          '<button type="button" class="act-btn btn-resolve" data-did="' + attr(did) + '" onclick="adminResolveDisputeMoney(this.getAttribute(\'data-did\'))">Resolve $</button>' +
          '<button type="button" class="act-btn btn-remove" data-did="' + attr(did) + '" onclick="adminUpdateDisputeStatus(this.getAttribute(\'data-did\'),\'rejected\')">Reject</button>';
      } else {
        actions = '<span class="status-pill ' + stPill + '">' + esc(adminReasonLabel(st)) +
          (d.resolution ? ' · ' + esc(d.resolution) : '') + '</span>' +
          '<button type="button" class="act-btn btn-view" data-did="' + attr(did) + '" data-tid="' + attr(tid) + '" onclick="adminOpenDisputeEvidence(this.getAttribute(\'data-did\'),this.getAttribute(\'data-tid\'))">Evidence</button>';
      }

      return '<div class="data-row g-disputes">' +
        '<div class="cell">' + esc(adminReasonLabel(d.reason)) +
          (st === 'reviewing' ? ' <span class="status-pill s-progress">In review</span>' : '') +
        '</div>' +
        '<div class="cell">' +
          (tid
            ? '<a href="#" class="admin-uid-name" title="' + attr(tid) + '" data-tid="' + attr(tid) + '" onclick="event.preventDefault();openTaskDrawer(this.getAttribute(\'data-tid\'))">' + esc(taskLabel) + '</a>'
            : '—') +
        '</div>' +
        '<div class="cell">' + raisedHtml + '</div>' +
        '<div class="cell cell-wrap" title="' + attr(detail) + '">' + esc(detailShort || '—') + '</div>' +
        '<div class="cell">' + esc(adminTimeAgo(d.created_at)) + '</div>' +
        '<div class="act-btns">' + actions + '</div></div>';
    }).join('');
  }

  async function adminOpenDisputeEvidence(disputeId, taskId) {
    if (!requireAdmin()) return;
    var url = (window.QG_CONFIG && window.QG_CONFIG.taskEvidenceUrl) ||
      'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/task-evidence';
    var user = typeof getCurrentUser === 'function' ? getCurrentUser() : window._currentUser;
    if (!user || typeof callVerifiedFunction !== 'function') {
      showToast('Sign in required', 'red');
      return;
    }
    showToast('Loading evidence…', 'amber');
    var data = await callVerifiedFunction(url, { action: 'get', task_id: String(taskId) }, user);
    if (!data || !data.ok) {
      showToast((data && data.error) || 'Could not load evidence', 'red');
      return;
    }
    var stamps = (data.stamps || []).map(function (s) {
      var loc = '';
      if (s.stamp_type === 'arrived') {
        if (s.location_status === 'ok' && s.distance_m != null) loc = ' · ' + Math.round(s.distance_m) + 'm from address';
        else loc = ' · location ' + (s.location_status || 'n/a');
      }
      return '<div><strong>' + esc(s.stamp_type) + '</strong> ' + esc(s.stamped_at || '') + esc(loc) + '</div>';
    }).join('') || '<div>No stamps</div>';
    var photos = (data.evidence_photos || []).map(function (p) {
      return '<div><a href="' + attrUrl(p.url) + '" target="_blank" rel="noopener">' + esc(p.kind) + '</a> · ' + esc(p.created_at || '') + '</div>';
    }).join('') || '<div>No evidence photos</div>';
    var msgs = (data.messages || []).slice(-30).map(function (m) {
      return '<div style="font-size:12px;margin:4px 0"><strong>' + esc(String(m.sender_id || '').slice(0, 8)) + '</strong>: ' + esc(String(m.body || '').slice(0, 160)) + '</div>';
    }).join('') || '<div>No chat</div>';
    var reviews = (data.reviews || []).map(function (r) {
      return '<div>' + esc(String(r.rating)) + '★ · ' + esc(r.review_comment || '') + '</div>';
    }).join('') || '<div>No reviews yet</div>';
    var pays = (data.payments || []).map(function (p) {
      return '<div>$' + esc(String(p.amount)) + ' · ' + esc(p.status) + ' · fee $' + esc(String(p.platform_fee)) + '</div>';
    }).join('') || '<div>No payment</div>';

    function attrUrl(u) {
      return String(u || '').replace(/"/g, '&quot;');
    }

    openModal(
      'Evidence — ' + esc((data.task && data.task.title) || taskId),
      'Dispute ' + String(disputeId).slice(0, 8) + '… · decide from evidence, not claims.',
      '<div style="display:grid;gap:14px;max-height:60vh;overflow:auto;text-align:left">' +
        '<div><div class="modal-label">Payment</div>' + pays + '</div>' +
        '<div><div class="modal-label">Status stamps</div>' + stamps + '</div>' +
        '<div><div class="modal-label">Photos</div>' + photos + '</div>' +
        '<div><div class="modal-label">Chat (recent)</div>' + msgs + '</div>' +
        '<div><div class="modal-label">Reviews</div>' + reviews + '</div>' +
      '</div>',
      'Close',
      'purple',
      function () {},
      true
    );
  }

  async function adminResolveDisputeMoney(disputeId) {
    if (!requireAdmin()) return;
    var d = (window.disputes || []).find(function (x) {
      return String(x.dispute_id || x.id) === String(disputeId);
    });
    if (!d) return;
    var tid = String(d.task_id || '');
    var pay = (window.payments || []).find(function (p) {
      return String(p.task_id) === tid && ['held', 'disputed'].indexOf(String(p.status || '').toLowerCase()) >= 0;
    });
    var amount = pay ? Number(pay.amount || 0) : 0;
    var workerPay = pay ? Number(pay.worker_payout || 0) : 0;

    openModal(
      'Resolve escrow',
      'Release to tasker, refund poster, or split. Runs server-side via Stripe.',
      '<div style="display:grid;gap:10px;text-align:left">' +
        '<div class="modal-label">Task total $' + amount.toFixed(2) + ' · tasker payout $' + workerPay.toFixed(2) + '</div>' +
        '<label>Outcome<select id="qgResolveOutcome" style="width:100%;margin-top:6px;padding:10px;border-radius:10px">' +
          '<option value="release">Release to tasker</option>' +
          '<option value="refund">Refund poster</option>' +
          '<option value="split">Split</option>' +
        '</select></label>' +
        '<label>Release amount (CAD, split only)<input id="qgResolveRelease" type="number" step="0.01" min="0" value="' + workerPay.toFixed(2) + '" style="width:100%;margin-top:6px;padding:10px;border-radius:10px"></label>' +
        '<label>Refund amount (CAD, split only)<input id="qgResolveRefund" type="number" step="0.01" min="0" value="0" style="width:100%;margin-top:6px;padding:10px;border-radius:10px"></label>' +
        '<label>Reason<textarea id="qgResolveReason" rows="3" style="width:100%;margin-top:6px;padding:10px;border-radius:10px" placeholder="Why this outcome?"></textarea></label>' +
      '</div>',
      'Execute',
      'success',
      async function () {
        var outcome = (document.getElementById('qgResolveOutcome') || {}).value || 'release';
        var reason = ((document.getElementById('qgResolveReason') || {}).value || '').trim();
        var releaseAmt = Number((document.getElementById('qgResolveRelease') || {}).value || 0);
        var refundAmt = Number((document.getElementById('qgResolveRefund') || {}).value || 0);
        if (reason.length < 3) {
          showToast('Add a short reason', 'amber');
          return;
        }
        var url = (window.QG_CONFIG && window.QG_CONFIG.resolveDisputeUrl) ||
          'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/resolve-dispute';
        var user = typeof getCurrentUser === 'function' ? getCurrentUser() : window._currentUser;
        if (!user || typeof callVerifiedFunction !== 'function') {
          showToast('Sign in required', 'red');
          return;
        }
        var payload = {
          dispute_id: String(disputeId),
          resolution: outcome,
          reason: reason
        };
        if (outcome === 'split') {
          payload.release_amount = releaseAmt;
          payload.refund_amount = refundAmt;
        }
        var result = await callVerifiedFunction(url, payload, user);
        if (!result || !result.ok) {
          showToast((result && (result.message || result.error)) || 'Resolve failed', 'red');
          return;
        }
        d.status = 'resolved';
        d.resolution = outcome;
        d.resolved_at = new Date().toISOString();
        if (pay) {
          pay.status = result.payment_status || (outcome === 'refund' ? 'refunded' : 'paid');
        }
        await logAdminAction('dispute_money_' + outcome, 'dispute', disputeId, {
          release_amount: result.release_amount,
          refund_amount: result.refund_amount
        });
        showToast('Dispute resolved · ' + outcome, 'green');
        renderDisputesEnhanced();
        if (typeof renderOverview === 'function') renderOverview();
      },
      true
    );
  }

  /**
   * Dispute status only — never moves money / escrow.
   * reviewing | resolved | rejected (+ resolved_at when closed).
   */
  async function adminUpdateDisputeStatus(disputeId, newStatus) {
    if (!requireAdmin()) return;
    if (typeof sbUpdate !== 'function') return;
    var did = String(disputeId || '');
    var st = String(newStatus || '').toLowerCase();
    if (!did || ['reviewing', 'resolved', 'rejected'].indexOf(st) < 0) return;

    if (st === 'resolved') {
      showToast('Use Resolve $ to move escrow, or Reject to close without payout change', 'amber');
      return;
    }

    var patch = { status: st };
    if (st === 'rejected') {
      patch.resolved_at = new Date().toISOString();
    }

    var result = await sbUpdate('disputes', patch, 'dispute_id=eq.' + encodeURIComponent(did));
    if (!result || !result.success) {
      showToast('Could not update dispute', 'red');
      return;
    }
    var d = (window.disputes || []).find(function (x) {
      return String(x.dispute_id || x.id) === did;
    });
    if (d) {
      d.status = st;
      if (patch.resolved_at) d.resolved_at = patch.resolved_at;
    }
    await logAdminAction('dispute_' + st, 'dispute', did, { money: false });
    showToast('Dispute ' + adminReasonLabel(st), st === 'rejected' ? 'amber' : 'green');
    renderDisputesEnhanced();
    if (typeof renderOverview === 'function') renderOverview();
  }

  function syncWaitlistSignups() {
    if (!window.waitlist || !window.users) return;
    var emails = {};
    (window.users || []).forEach(function (u) {
      if (u.email) emails[String(u.email).toLowerCase()] = u.created_at || new Date().toISOString();
    });
    window.waitlist.forEach(function (w) {
      var em = String(w.email || '').toLowerCase();
      if (emails[em] && !w.signed_up) {
        w.signed_up = true;
        w.signed_up_at = emails[em];
        if (typeof sbUpdate === 'function') {
          sbUpdate('waitlist', { signed_up: true, signed_up_at: w.signed_up_at }, 'waitlist_id=eq.' + encodeURIComponent(String(w.waitlist_id)));
        }
      }
    });
  }

  function renderWaitlist() {
    syncWaitlistSignups();
    var list = window.waitlist || [];
    var total = list.length;
    var signed = list.filter(function (w) { return w.signed_up; }).length;
    var invited = list.filter(function (w) { return w.invited_at; }).length;
    var pending = list.filter(function (w) { return !w.signed_up; }).length;

    var statsEl = document.getElementById('waitlistStats');
    if (statsEl) {
      statsEl.className = 'stats-grid';
      function wlCard(val, label, sub, accent, valClass) {
        if (typeof adminStatCardHtml === 'function') {
          return adminStatCardHtml({ val: val, label: label, sub: sub, accent: accent, valClass: valClass });
        }
        // Fallback — same Revenue-style card markup (never loose stacked text)
        return '<div class="stat-card"><div class="stat-accent ' + accent + '"></div>' +
          '<div class="stat-val ' + valClass + '">' + val + '</div>' +
          '<div class="stat-label">' + label + '</div>' +
          '<div class="stat-sub">' + sub + '</div></div>';
      }
      statsEl.innerHTML = [
        wlCard(total, 'Total', 'On waitlist', 'accent-purple', 'c-purple'),
        wlCard(signed, 'Signed up', 'Already joined', 'accent-green', 'c-green'),
        wlCard(invited, 'Invited', 'Invite sent', 'accent-amber', 'c-amber'),
        wlCard(pending, 'Not yet joined', 'Still waiting', 'accent-red', 'c-red')
      ].join('');
    }

    var countEl = document.getElementById('waitlistCount');
    if (countEl) countEl.textContent = '· ' + total + ' emails';

    var body = document.getElementById('waitlistBody');
    if (!body) return;
    if (!list.length) {
      body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-faint);font-size:13px">No waitlist emails yet — paste emails below to import.</div>';
      return;
    }

    body.innerHTML = list.map(function (w) {
      var wid = w.waitlist_id;
      var st = w.signed_up ? 's-done' : (w.invited_at ? 's-progress' : 's-posted');
      var sl = w.signed_up ? '✓ Joined' : (w.invited_at ? '📨 Invited' : '⏳ Waiting');
      return '<div class="data-row g-waitlist">' +
        '<div class="cell">' + esc(w.email) + '</div>' +
        '<div class="cell">' + esc(w.name || '—') + '</div>' +
        '<div class="cell-pill"><span class="status-pill ' + st + '">' + sl + '</span></div>' +
        '<div class="cell">' + (w.invited_at ? new Date(w.invited_at).toLocaleDateString('en-CA') : '—') + '</div>' +
        '<div class="cell">' + (w.signed_up_at ? new Date(w.signed_up_at).toLocaleDateString('en-CA') : '—') + '</div>' +
        '<div class="act-btns">' +
          (!w.signed_up ? '<button type="button" class="act-btn btn-view" onclick="adminMarkInvited(\'' + wid + '\')">Send invite</button>' : '') +
          (!w.signed_up && w.invited_at ? '<button type="button" class="act-btn btn-warn" onclick="adminMarkReminder(\'' + wid + '\')">Send reminder</button>' : '') +
          '<button type="button" class="act-btn btn-remove" onclick="adminDeleteWaitlist(\'' + wid + '\')">Remove</button>' +
        '</div></div>';
    }).join('');
  }

  async function adminImportWaitlist() {
    if (!requireAdmin()) return;
    var box = document.getElementById('waitlistImport');
    if (!box) return;
    var raw = box.value || '';
    var lines = raw.split(/[\n,;]+/).map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
    var emails = [];
    lines.forEach(function (line) {
      var m = line.match(/[\w.+-]+@[\w.-]+\.\w+/);
      if (m) emails.push(m[0]);
    });
    emails = emails.filter(function (e, i) { return emails.indexOf(e) === i; });
    if (!emails.length) {
      showToast('No valid emails found', 'amber');
      return;
    }
    var added = 0;
    for (var i = 0; i < emails.length; i++) {
      var result = typeof sbPostReturn === 'function'
        ? await sbPostReturn('waitlist', { email: emails[i] })
        : await sbPost('waitlist', { email: emails[i] });
      if (result.success) added++;
      else if (/duplicate|unique/i.test(String(result.error || ''))) { /* skip */ }
    }
    box.value = '';
    if (typeof window.loadWaitlist === 'function') await window.loadWaitlist();
    renderWaitlist();
    await logAdminAction('waitlist_import', 'waitlist', String(added), { count: added });
    showToast('Imported ' + added + ' email(s)', 'green');
  }

  async function adminMarkInvited(id) {
    if (!requireAdmin()) return;
    var w = (window.waitlist || []).find(function (x) { return String(x.waitlist_id) === String(id); });
    if (!w) return;
    if (typeof sendWaitlistEmail === 'function') {
      var sent = await sendWaitlistEmail(w.email, 'waitlist_invite');
      if (!sent.success && !sent.skipped) {
        showToast('Could not send invite — deploy send-notification Edge Function + Resend API key', 'red');
        return;
      }
    }
    var now = new Date().toISOString();
    await sbUpdate('waitlist', { invited_at: now }, 'waitlist_id=eq.' + encodeURIComponent(String(id)));
    w.invited_at = now;
    await logAdminAction('waitlist_invite', 'waitlist', w.email, {});
    showToast('Invite email sent to ' + w.email, 'green');
    renderWaitlist();
  }

  async function adminMarkReminder(id) {
    if (!requireAdmin()) return;
    var w = (window.waitlist || []).find(function (x) { return String(x.waitlist_id) === String(id); });
    if (!w) return;
    if (typeof sendWaitlistEmail === 'function') {
      var sent = await sendWaitlistEmail(w.email, 'waitlist_reminder');
      if (!sent.success && !sent.skipped) {
        showToast('Could not send reminder — check Resend setup', 'red');
        return;
      }
    }
    var now = new Date().toISOString();
    await sbUpdate('waitlist', { reminder_sent_at: now }, 'waitlist_id=eq.' + encodeURIComponent(String(id)));
    w.reminder_sent_at = now;
    await logAdminAction('waitlist_reminder', 'waitlist', w.email, {});
    showToast('Reminder email sent to ' + w.email, 'amber');
    renderWaitlist();
  }

  async function adminDeleteWaitlist(id) {
    if (!requireAdmin()) return;
    if (!confirm('Remove this waitlist entry?')) return;
    if (typeof sbDelete === 'function') {
      await sbDelete('waitlist', 'waitlist_id=eq.' + encodeURIComponent(String(id)));
    }
    window.waitlist = (window.waitlist || []).filter(function (w) { return String(w.waitlist_id) !== String(id); });
    renderWaitlist();
    showToast('Removed from waitlist', 'red');
  }

  function exportWaitlistCSV() {
    var rows = (window.waitlist || []).map(function (w) {
      return [w.email, w.name, w.signed_up ? 'yes' : 'no', w.invited_at, w.signed_up_at, w.reminder_sent_at].map(csvEscape).join(',');
    });
    rows.unshift(['Email', 'Name', 'Signed up', 'Invited at', 'Signed up at', 'Reminder sent'].join(','));
    var blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'quickgigs-waitlist.csv';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Waitlist exported', 'green');
  }

  async function loadPlatformBannerForm() {
    if (typeof sbGet !== 'function') return;
    var rows = await sbGet('platform_banner', 'id=eq.1&select=id,message,link,style,active,soft_close,updated_at', 'id.asc', 1);
    var statusEl = document.getElementById('bannerDbStatus');
    if (!rows || !rows.length) {
      if (statusEl) {
        statusEl.textContent = 'Database not ready — run supabase/soft-close.sql in Supabase SQL Editor, then refresh.';
        statusEl.style.color = 'var(--red, #f87171)';
      }
      return;
    }
    var b = rows[0];
    if (statusEl) {
      statusEl.textContent = b.soft_close
        ? 'Live: soft close ON (homepage sign-up hidden)'
        : (b.active ? 'Live: announcement banner only' : 'Saved: banner off');
      statusEl.style.color = b.soft_close ? 'var(--amber, #fbbf24)' : 'var(--text-faint)';
    }
    var msg = document.getElementById('bannerMessage');
    var link = document.getElementById('bannerLink');
    var style = document.getElementById('bannerStyle');
    var active = document.getElementById('bannerActive');
    var softClose = document.getElementById('bannerSoftClose');
    if (msg) msg.value = b.message || '';
    if (link) link.value = b.link || '';
    if (style) style.value = b.style || 'info';
    if (active) active.checked = !!b.active;
    if (softClose) softClose.checked = !!b.soft_close;
  }

  async function adminSaveBanner() {
    if (!requireAdmin()) return;
    var patch = {
      message: (document.getElementById('bannerMessage').value || '').trim(),
      link: (document.getElementById('bannerLink').value || '').trim(),
      style: document.getElementById('bannerStyle').value || 'info',
      active: !!document.getElementById('bannerActive').checked,
      soft_close: !!document.getElementById('bannerSoftClose').checked,
      updated_at: new Date().toISOString()
    };
    if (!patch.message && (patch.active || patch.soft_close)) {
      showToast('Add a message before publishing', 'red');
      return;
    }
    if (patch.soft_close) patch.active = true;

    var result = await sbUpdate('platform_banner', patch, 'id=eq.1');
    if (!result.success || result.notFound) {
      if (typeof sbPostReturn === 'function') {
        result = await sbPostReturn('platform_banner', Object.assign({ id: 1 }, patch));
      } else if (typeof sbPost === 'function') {
        result = await sbPost('platform_banner', Object.assign({ id: 1 }, patch));
      }
    }

    var savedRows = await sbGet('platform_banner', 'id=eq.1&select=id,message,link,style,active,soft_close,updated_at', 'id.asc', 1);
    var saved = savedRows && savedRows[0] ? savedRows[0] : null;
    if (!saved) {
      showToast('Save failed — run supabase/soft-close.sql in Supabase SQL Editor, then try again', 'red');
      return;
    }
    if (patch.soft_close && !saved.soft_close) {
      showToast('Soft close did not save — run supabase/soft-close.sql in Supabase, then try again', 'red');
      return;
    }
    if (patch.active && !saved.active && !patch.soft_close) {
      showToast('Banner did not save — check Supabase platform_banner table', 'red');
      return;
    }

    if (result.success || saved) {
      await logAdminAction('banner_update', 'platform', '1', patch);
      var label = saved.soft_close ? 'Soft close is LIVE' : (saved.active ? 'Banner published' : 'Banner saved (off)');
      showToast(label, 'green');
      var activeEl = document.getElementById('bannerActive');
      var softCloseEl = document.getElementById('bannerSoftClose');
      if (softCloseEl) softCloseEl.checked = !!saved.soft_close;
      if (activeEl) activeEl.checked = !!saved.active;
      await loadPlatformBannerForm();
    } else {
      showToast('Could not save — run supabase/soft-close.sql in Supabase SQL Editor', 'red');
    }
  }

  window.closeAdminDrawer = closeAdminDrawer;
  window.openUserDrawer = openUserDrawer;
  window.openTaskDrawer = openTaskDrawer;
  window.adminSaveUser = adminSaveUser;
  window.adminAddUserNote = adminAddUserNote;
  window.adminFlagUser = adminFlagUser;
  window.adminWarnUser = adminWarnUser;
  window.adminBanUser = adminBanUser;
  window.adminUnbanUser = adminUnbanUser;
  window.adminSaveTask = adminSaveTask;
  window.adminExpireTask = adminExpireTask;
  window.adminRemoveTask = adminRemoveTask;
  window.adminHideTask = adminHideTask;
  window.adminHardDeleteTask = adminHardDeleteTask;
  window.adminDeleteUser = adminDeleteUser;
  window.adminDeleteUserById = adminDeleteUserById;
  window.toggleAdminMoreMenu = toggleAdminMoreMenu;
  // Do not overwrite window.isAdmin from qg-admin-gate.js
  window.renderTasksEnhanced = renderTasksEnhanced;
  window.applyAdminTasksView = applyAdminTasksView;
  window.onTasksSearchInput = onTasksSearchInput;
  window.setTaskStatusFilter = setTaskStatusFilter;
  window.setTaskModeFilter = setTaskModeFilter;
  window.toggleTaskSelected = toggleTaskSelected;
  window.selectAllTasks = selectAllTasks;
  window.bulkHideTasks = bulkHideTasks;
  window.bulkDeleteTasks = bulkDeleteTasks;
  window.adminResolveReport = adminResolveReport;
  window.adminOpenReportTarget = adminOpenReportTarget;
  window.exportCSV = exportCSV;
  window.renderSecurityFromActions = renderSecurityFromActions;
  window.renderFraudAlerts = renderFraudAlerts;
  window.setReportFilter = setReportFilter;
  window.setDisputeFilter = setDisputeFilter;
  window.renderReportsEnhanced = renderReportsEnhanced;
  window.renderDisputesEnhanced = renderDisputesEnhanced;
  window.adminUpdateDisputeStatus = adminUpdateDisputeStatus;
  window.adminOpenDisputeEvidence = adminOpenDisputeEvidence;
  window.adminResolveDisputeMoney = adminResolveDisputeMoney;
  window.adminReasonLabel = adminReasonLabel;
  window.isTempEmail = isTempEmail;
  window.findUser = findUser;
  window.userKey = userKey;
  window.renderWaitlist = renderWaitlist;
  window.adminImportWaitlist = adminImportWaitlist;
  window.adminMarkInvited = adminMarkInvited;
  window.adminMarkReminder = adminMarkReminder;
  window.adminDeleteWaitlist = adminDeleteWaitlist;
  window.exportWaitlistCSV = exportWaitlistCSV;
  window.loadPlatformBannerForm = loadPlatformBannerForm;
  window.adminSaveBanner = adminSaveBanner;
})();
