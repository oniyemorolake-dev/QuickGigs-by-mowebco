/* QuickGigs — save / bookmark tasks for later */
(function () {
  var savedIds = {};

  async function loadSavedTaskIds(userId) {
    savedIds = {};
    if (!userId || typeof getSavedTaskIds !== 'function') return savedIds;
    try {
      var ids = await getSavedTaskIds(userId);
      (ids || []).forEach(function (id) {
        savedIds[String(id)] = true;
      });
    } catch (err) {
      console.warn('Load saved tasks failed:', err);
    }
    return savedIds;
  }

  function isTaskSaved(taskId) {
    return !!savedIds[String(taskId)];
  }

  function bookmarkButtonHtml(taskId) {
    var saved = isTaskSaved(taskId);
    return '<button type="button" class="qg-chip-btn qg-save-trigger' + (saved ? ' is-saved' : '') + '" ' +
      'data-task-id="' + String(taskId || '').replace(/"/g, '&quot;') + '" ' +
      'aria-label="' + (saved ? 'Remove from saved' : 'Save task') + '" ' +
      'aria-pressed="' + (saved ? 'true' : 'false') + '">' +
      (saved ? '★ Saved' : '☆ Save') + '</button>';
  }

  async function toggleSavedTask(taskId) {
    var uid = window._currentUser && window._currentUser.uid;
    if (!uid) {
      if (confirm('Sign in to save tasks for later?')) {
        window.location.href = 'login.html?return=' + encodeURIComponent(window.location.pathname + window.location.search);
      }
      return { success: false, needLogin: true };
    }
    var tid = String(taskId);
    if (isTaskSaved(tid)) {
      if (typeof unsaveTask === 'function') await unsaveTask(uid, tid);
      delete savedIds[tid];
      return { success: true, saved: false };
    }
    if (typeof saveTask === 'function') {
      var result = await saveTask(uid, tid);
      if (!result.success) return result;
    }
    savedIds[tid] = true;
    return { success: true, saved: true };
  }

  function bindSavedTriggers(root, onChange) {
    (root || document).querySelectorAll('.qg-save-trigger').forEach(function (btn) {
      if (btn._qgSaveBound) return;
      btn._qgSaveBound = true;
      btn.onclick = async function (e) {
        e.preventDefault();
        e.stopPropagation();
        var tid = btn.getAttribute('data-task-id');
        var result = await toggleSavedTask(tid);
        if (!result.success) return;
        var saved = !!result.saved;
        btn.classList.toggle('is-saved', saved);
        btn.setAttribute('aria-pressed', saved ? 'true' : 'false');
        btn.setAttribute('aria-label', saved ? 'Remove from saved' : 'Save task');
        btn.textContent = saved ? '★ Saved' : '☆ Save';
        if (typeof onChange === 'function') onChange(tid, saved);
      };
    });
  }

  window.loadSavedTaskIds = loadSavedTaskIds;
  window.isTaskSaved = isTaskSaved;
  window.bookmarkButtonHtml = bookmarkButtonHtml;
  window.bindSavedTriggers = bindSavedTriggers;
  window.toggleSavedTask = toggleSavedTask;
})();
