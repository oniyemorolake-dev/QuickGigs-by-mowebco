/* QuickGigs — dispute resolution UI (clear steps, not buried in Terms) */
(function () {
  var REASONS = [
    { value: 'work_not_done', label: 'Work was not completed as agreed' },
    { value: 'quality', label: 'Quality did not match the listing' },
    { value: 'no_show', label: 'No-show or abandoned task' },
    { value: 'payment', label: 'Payment or refund issue' },
    { value: 'safety', label: 'Safety or conduct concern' },
    { value: 'other', label: 'Other' }
  ];

  var overlay = null;
  var ctx = null;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'qg-report-overlay qg-dispute-overlay';
    overlay.id = 'qgDisputeOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML =
      '<div class="qg-report-sheet qg-dispute-sheet">' +
        '<div class="qg-report-handle" aria-hidden="true"></div>' +
        '<h2 class="qg-report-title">Open a dispute</h2>' +
        '<div class="qg-dispute-steps" aria-label="How disputes work">' +
          '<div class="qg-dispute-step"><span class="qg-dispute-num">1</span><div><strong>Tell us what happened</strong><p>Both sides can share their version. Keep messages on QuickGigs when possible.</p></div></div>' +
          '<div class="qg-dispute-step"><span class="qg-dispute-num">2</span><div><strong>We review within 48 hours</strong><p>Our team reads the task, chat, and payment status (when live).</p></div></div>' +
          '<div class="qg-dispute-step"><span class="qg-dispute-num">3</span><div><strong>Outcome</strong><p>We may release payment, issue a partial refund, reopen the task, or take action on accounts.</p></div></div>' +
        '</div>' +
        '<p class="qg-report-sub" id="qgDisputeSub">Dispute for this task</p>' +
        '<label class="qg-report-label" for="qgDisputeReason">What went wrong?</label>' +
        '<select class="qg-report-select" id="qgDisputeReason">' +
          REASONS.map(function (r) { return '<option value="' + r.value + '">' + r.label + '</option>'; }).join('') +
        '</select>' +
        '<label class="qg-report-label" for="qgDisputeDetails">Details</label>' +
        '<textarea class="qg-report-textarea" id="qgDisputeDetails" maxlength="1500" placeholder="Describe what happened, dates, and what outcome you need."></textarea>' +
        '<p class="qg-dispute-note">Beta: payments are not live yet — disputes are logged and reviewed by support@quickgigs.ca. You will get an email update.</p>' +
        '<div class="qg-report-actions">' +
          '<button type="button" class="qg-report-cancel" id="qgDisputeCancel">Cancel</button>' +
          '<button type="button" class="qg-report-submit" id="qgDisputeSubmit">Submit dispute</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeDisputeModal(); });
    document.getElementById('qgDisputeCancel').onclick = closeDisputeModal;
    document.getElementById('qgDisputeSubmit').onclick = submitDispute;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('open')) closeDisputeModal();
    });
    return overlay;
  }

  function openDisputeModal(options) {
    ctx = options || {};
    ensureOverlay();
    document.getElementById('qgDisputeSub').textContent =
      'Task: “' + (ctx.taskTitle || 'Untitled') + '”' +
      (ctx.otherName ? ' · with ' + ctx.otherName : '');
    document.getElementById('qgDisputeDetails').value = '';
    document.getElementById('qgDisputeReason').selectedIndex = 0;
    overlay.classList.add('open');
    document.getElementById('qgDisputeReason').focus();
  }

  function closeDisputeModal() {
    if (overlay) overlay.classList.remove('open');
    ctx = null;
  }

  async function submitDispute() {
    var user = typeof getCurrentUser === 'function' ? getCurrentUser() : window._currentUser;
    if (!user) {
      alert('Please sign in to open a dispute.');
      window.location.href = 'login.html';
      return;
    }
    if (!ctx || !ctx.taskId) return;

    var btn = document.getElementById('qgDisputeSubmit');
    btn.disabled = true;
    btn.textContent = 'Submitting…';

    var reason = document.getElementById('qgDisputeReason').value;
    var details = (document.getElementById('qgDisputeDetails').value || '').trim();
    if (!details) {
      alert('Please describe what happened so we can review.');
      btn.disabled = false;
      btn.textContent = 'Submit dispute';
      return;
    }

    var row = {
      task_id: String(ctx.taskId),
      opened_by: user.uid,
      opened_by_email: user.email || '',
      against_user_id: ctx.otherUserId || '',
      reason: reason,
      details: details,
      status: 'open'
    };

    var result = { success: false };
    if (typeof sbPostReturn === 'function') {
      result = await sbPostReturn('disputes', row);
    } else if (typeof sbPost === 'function') {
      result = await sbPost('disputes', row);
    }

    btn.disabled = false;
    btn.textContent = 'Submit dispute';

    if (result.success) {
      closeDisputeModal();
      if (typeof showToast === 'function') {
        showToast('Dispute submitted — we will review within 48 hours.');
      } else {
        alert('Dispute submitted. We will review within 48 hours and email you.');
      }
    } else {
      alert('Could not submit dispute. Run supabase/disputes.sql in Supabase, then try again.');
    }
  }

  function disputeButtonHtml(taskId, taskTitle, otherUserId, otherName) {
    return '<button type="button" class="qg-chip-btn qg-dispute-trigger" ' +
      'data-task-id="' + (taskId || '') + '" ' +
      'data-task-title="' + String(taskTitle || '').replace(/"/g, '&quot;') + '" ' +
      'data-other-id="' + (otherUserId || '') + '" ' +
      'data-other-name="' + String(otherName || '').replace(/"/g, '&quot;') + '" ' +
      'aria-label="Open dispute for ' + String(taskTitle || 'task').replace(/"/g, '&quot;') + '">⚖ Dispute</button>';
  }

  function bindDisputeTriggers(root) {
    var scope = root || document;
    scope.querySelectorAll('.qg-dispute-trigger').forEach(function (btn) {
      if (btn._qgDisputeBound) return;
      btn._qgDisputeBound = true;
      btn.onclick = function () {
        openDisputeModal({
          taskId: btn.getAttribute('data-task-id'),
          taskTitle: btn.getAttribute('data-task-title'),
          otherUserId: btn.getAttribute('data-other-id'),
          otherName: btn.getAttribute('data-other-name')
        });
      };
    });
  }

  window.openDisputeModal = openDisputeModal;
  window.closeDisputeModal = closeDisputeModal;
  window.disputeButtonHtml = disputeButtonHtml;
  window.bindDisputeTriggers = bindDisputeTriggers;
})();
