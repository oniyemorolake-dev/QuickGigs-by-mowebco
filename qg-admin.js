/* QuickGigs — admin console Phase 1 (drawers, edit, flag, notes, moderation) */
(function () {
  var TEMP_EMAIL_DOMAINS = [
    'mailinator.com', 'guerrillamail.com', 'tempmail.com', '10minutemail.com',
    'throwaway.email', 'yopmail.com', 'sharklasers.com', 'getnada.com',
    'maildrop.cc', 'temp-mail.org', 'fakeinbox.com', 'trashmail.com'
  ];

  var drawerState = { type: null, id: null };
  var reportFilter = 'open';

  function esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function adminEmail() {
    return (window._auth && window._auth.currentUser && window._auth.currentUser.email) || 'mowebsiteco@gmail.com';
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
    var rows = await sbGet('admin_notes', 'user_id=eq.' + encodeURIComponent(uid), 'created_at.desc', 30);
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
        }).join('') : '<div style="font-size:12px;color:rgba(255,255,255,0.35);margin-bottom:8px">No notes yet.</div>') +
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
          (u.firebase_uid ? '<a class="admin-drawer-btn ghost" href="profile.html?user=' + encodeURIComponent(u.firebase_uid) + '" target="_blank" rel="noopener">Open profile ↗</a>' : '') +
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

    var statusOpts = ['open', 'in_progress', 'completed', 'cancelled', 'expired'];
    var curStatus = (t.status || 'open').toLowerCase();

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
        }).join('') : '<div style="font-size:12px;color:rgba(255,255,255,0.35)">No applications yet.</div>') +
      '</div>' +
      '<div class="admin-drawer-section"><div class="admin-drawer-section-title">Actions</div>' +
        '<div class="admin-drawer-actions">' +
          '<button type="button" class="admin-drawer-btn primary" onclick="adminSaveTask()">Save changes</button>' +
          '<button type="button" class="admin-drawer-btn warn" onclick="adminExpireTask()">Mark expired</button>' +
          '<button type="button" class="admin-drawer-btn danger" onclick="adminRemoveTask()">Remove task</button>' +
          '<a class="admin-drawer-btn ghost" href="browsetask.html?task=' + encodeURIComponent(tid) + '" target="_blank" rel="noopener">View on browse ↗</a>' +
        '</div>' +
      '</div>';

    document.getElementById('adminDrawerOverlay').classList.add('open');
  }

  async function adminSaveUser() {
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

  async function adminRemoveTask() {
    var t = findTask(drawerState.id);
    if (!t || !confirm('Cancel/remove "' + (t.title || 'this task') + '"?')) return;
    var tid = String(t.task_id || t.id);
    if (typeof updateTaskStatus === 'function') {
      await updateTaskStatus(tid, 'cancelled');
    } else {
      await sbUpdate('tasks', { status: 'cancelled' }, 'task_id=eq.' + encodeURIComponent(tid));
    }
    t.status = 'cancelled';
    await logAdminAction('task_remove', 'task', tid, {});
    window.tasks = window.tasks.filter(function (x) { return String(x.task_id || x.id) !== tid; });
    showToast('Task removed', 'red');
    renderTasks(window.tasks);
    closeAdminDrawer();
  }

  async function adminResolveReport(reportId, newStatus) {
    if (typeof sbUpdate !== 'function') return;
    await sbUpdate('reports', { status: newStatus }, 'report_id=eq.' + encodeURIComponent(String(reportId)));
    var r = (window.reports || []).find(function (x) { return String(x.report_id || x.id) === String(reportId); });
    if (r) r.status = newStatus;
    await logAdminAction('report_' + newStatus, 'report', reportId, {});
    showToast('Report ' + newStatus, 'green');
    renderReports();
    renderOverview();
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
      el.innerHTML = '<div style="padding:24px;text-align:center;color:rgba(255,255,255,0.35);font-size:13px">Admin actions will appear here once you edit users or tasks.</div>';
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
    if (!items.length) {
      el.innerHTML = '<div style="padding:24px;text-align:center;color:rgba(255,255,255,0.35);font-size:13px">No fraud alerts right now.</div>';
      return;
    }
    el.innerHTML = items.slice(0, 30).map(function (e) {
      return '<div class="sec-item"><span class="sec-type sec-blocked">⚠ Alert</span>' +
        '<div class="sec-text">' + esc(e.text) + '</div>' +
        '<div class="sec-time">' + (e.time ? new Date(e.time).toLocaleDateString('en-CA') : '') + '</div></div>';
    }).join('');
  }

  function setReportFilter(f) {
    reportFilter = f;
    document.querySelectorAll('.report-filter-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-filter') === f);
    });
    renderReports();
  }

  function renderReportsEnhanced() {
    var open = (window.reports || []).filter(function (r) { return (r.status || 'open') === 'open'; }).length;
    var countEl = document.getElementById('reportsCount');
    if (countEl) countEl.textContent = '· ' + (window.reports || []).length + ' total · ' + open + ' open';
    var badge = document.getElementById('reportBadge');
    if (badge) badge.textContent = open;

    var list = (window.reports || []).slice();
    if (reportFilter === 'open') list = list.filter(function (r) { return (r.status || 'open') === 'open'; });
    else if (reportFilter === 'task') list = list.filter(function (r) { return (r.target_type || '') === 'task'; });
    else if (reportFilter === 'user') list = list.filter(function (r) { return (r.target_type || '') === 'profile' || (r.target_type || '') === 'user'; });

    var body = document.getElementById('reportsBody');
    if (!body) return;
    if (!list.length) {
      body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-faint);font-size:13px">No reports in this queue</div>';
      return;
    }
    body.innerHTML = list.map(function (r) {
      var rid = r.report_id || r.id;
      var target = (r.target_type || '?') + ': ' + (r.target_label || r.target_id || '—');
      var when = r.created_at ? new Date(r.created_at).toLocaleDateString('en-CA') : '—';
      var st = r.status || 'open';
      return '<div class="data-row g-disputes">' +
        '<div class="cell" style="cursor:pointer" onclick="adminOpenReportTarget(\'' + esc(String(r.target_type)) + '\',\'' + esc(String(r.target_id || '')) + '\')">' + esc(target) + '</div>' +
        '<div class="cell">' + esc(r.reason || '—') + '</div>' +
        '<div class="cell">' + esc(r.reporter_email || r.reporter_id || '—') + '</div>' +
        '<div class="cell"><span class="status-pill ' + (st === 'open' ? 's-open' : 's-resolved') + '">' + esc(st) + '</span></div>' +
        '<div class="cell">' + when + '</div>' +
        '<div class="act-btns">' +
          (st === 'open' ? '<button class="act-btn btn-resolve" onclick="adminResolveReport(\'' + rid + '\',\'resolved\')">Resolve</button>' +
          '<button class="act-btn btn-view" onclick="adminResolveReport(\'' + rid + '\',\'dismissed\')">Dismiss</button>' : '') +
        '</div></div>';
    }).join('');
  }

  function adminOpenReportTarget(type, id) {
    if (type === 'task') openTaskDrawer(id);
    else openUserDrawer(id);
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
  window.adminResolveReport = adminResolveReport;
  window.adminOpenReportTarget = adminOpenReportTarget;
  window.exportCSV = exportCSV;
  window.renderSecurityFromActions = renderSecurityFromActions;
  window.renderFraudAlerts = renderFraudAlerts;
  window.setReportFilter = setReportFilter;
  window.renderReportsEnhanced = renderReportsEnhanced;
  window.isTempEmail = isTempEmail;
  window.findUser = findUser;
  window.userKey = userKey;
})();
