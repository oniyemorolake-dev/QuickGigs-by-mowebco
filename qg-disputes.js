/* QuickGigs — dispute resolution UI (Profile Studio–style sheet) */
(function () {
  if (typeof ensureQgSheetStyles === 'function') ensureQgSheetStyles();
  var REASONS = [
    { value: 'work_not_done', label: 'Work not completed', icon: '📋' },
    { value: 'quality', label: 'Quality mismatch', icon: '⭐' },
    { value: 'no_show', label: 'No-show / abandoned', icon: '👻' },
    { value: 'payment', label: 'Payment issue', icon: '💳' },
    { value: 'safety', label: 'Safety concern', icon: '🛡️' },
    { value: 'other', label: 'Other', icon: '💬' }
  ];

  var overlay = null;
  var ctx = null;
  var selectedReason = REASONS[0].value;

  function reasonPillsHtml() {
    return REASONS.map(function (r, i) {
      return '<button type="button" class="qg-report-reason' + (i === 0 ? ' is-selected' : '') + '" ' +
        'data-value="' + r.value + '" role="radio" aria-checked="' + (i === 0 ? 'true' : 'false') + '">' +
        '<span class="qg-report-reason-icon" aria-hidden="true">' + r.icon + '</span>' +
        '<span class="qg-report-reason-label">' + r.label + '</span>' +
      '</button>';
    }).join('');
  }

  function ensureOverlay() {
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.className = 'qg-report-overlay qg-dispute-overlay';
    overlay.id = 'qgDisputeOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'qgDisputeTitle');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.display = 'none';

    overlay.innerHTML =
      '<div class="qg-report-sheet qg-dispute-sheet" role="document">' +
        '<div class="qg-report-handle" aria-hidden="true"></div>' +
        '<div class="qg-report-header">' +
          '<div class="qg-report-header-glow" aria-hidden="true"></div>' +
          '<button type="button" class="qg-report-close" id="qgDisputeClose" aria-label="Close dispute">✕</button>' +
          '<div class="qg-report-kicker">Resolution</div>' +
          '<h2 class="qg-report-title" id="qgDisputeTitle">Open a dispute</h2>' +
          '<p class="qg-report-sub">We review disputes within 48 hours and email both parties an outcome.</p>' +
        '</div>' +
        '<div class="qg-report-body">' +
          '<div class="qg-dispute-steps" aria-label="How disputes work">' +
            '<div class="qg-dispute-step"><span class="qg-dispute-num">1</span><div><strong>Tell us what happened</strong><p>Share your version. Keep messages on QuickGigs when possible.</p></div></div>' +
            '<div class="qg-dispute-step"><span class="qg-dispute-num">2</span><div><strong>We review within 48 hours</strong><p>Our team reads the task, chat, and payment status (when live).</p></div></div>' +
            '<div class="qg-dispute-step"><span class="qg-dispute-num">3</span><div><strong>Outcome</strong><p>We may release payment, refund, reopen the task, or take account action.</p></div></div>' +
          '</div>' +
          '<div class="qg-report-target" id="qgDisputeTarget">' +
            '<span class="qg-report-target-icon" aria-hidden="true">⚖️</span>' +
            '<div class="qg-report-target-text">' +
              '<span class="qg-report-target-label">Dispute for</span>' +
              '<strong id="qgDisputeSub">This task</strong>' +
            '</div>' +
          '</div>' +
          '<div class="qg-report-field">' +
            '<span class="qg-report-label" id="qgDisputeReasonLabel">What went wrong?</span>' +
            '<div class="qg-report-reasons" id="qgDisputeReasons" role="radiogroup" aria-labelledby="qgDisputeReasonLabel">' +
              reasonPillsHtml() +
            '</div>' +
          '</div>' +
          '<div class="qg-report-field">' +
            '<label class="qg-report-label" for="qgDisputeDetails">Details</label>' +
            '<div class="qg-report-textarea-wrap">' +
              '<textarea class="qg-report-textarea" id="qgDisputeDetails" maxlength="1500" ' +
                'placeholder="Describe what happened, dates, and what outcome you need." rows="4"></textarea>' +
              '<span class="qg-report-char" id="qgDisputeCharCount">0 / 1500</span>' +
            '</div>' +
          '</div>' +
          '<p class="qg-dispute-note">Beta: payments are not live yet — disputes are logged and reviewed by support@quickgigs.ca.</p>' +
        '</div>' +
        '<div class="qg-report-footer">' +
          '<button type="button" class="qg-report-cancel" id="qgDisputeCancel">Cancel</button>' +
          '<button type="button" class="qg-report-submit" id="qgDisputeSubmit">Submit dispute</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeDisputeModal();
    });

    document.getElementById('qgDisputeClose').onclick = closeDisputeModal;
    document.getElementById('qgDisputeCancel').onclick = closeDisputeModal;
    document.getElementById('qgDisputeSubmit').onclick = submitDispute;

    document.getElementById('qgDisputeReasons').addEventListener('click', function (e) {
      var btn = e.target.closest('.qg-report-reason');
      if (!btn) return;
      selectReason(btn.getAttribute('data-value'));
    });

    document.getElementById('qgDisputeDetails').addEventListener('input', updateCharCount);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('open')) closeDisputeModal();
    });

    return overlay;
  }

  function selectReason(value) {
    selectedReason = value || REASONS[0].value;
    var wrap = document.getElementById('qgDisputeReasons');
    if (!wrap) return;
    wrap.querySelectorAll('.qg-report-reason').forEach(function (btn) {
      var on = btn.getAttribute('data-value') === selectedReason;
      btn.classList.toggle('is-selected', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  function updateCharCount() {
    var detailsEl = document.getElementById('qgDisputeDetails');
    var countEl = document.getElementById('qgDisputeCharCount');
    if (!detailsEl || !countEl) return;
    var len = (detailsEl.value || '').length;
    countEl.textContent = len + ' / 1500';
    countEl.classList.toggle('is-near', len > 1300);
    countEl.classList.toggle('is-over', len >= 1500);
  }

  function openDisputeModal(options) {
    ctx = options || {};
    ensureOverlay();

    document.getElementById('qgDisputeSub').textContent =
      '“' + (ctx.taskTitle || 'Untitled') + '”' +
      (ctx.otherName ? ' · with ' + ctx.otherName : '');

    document.getElementById('qgDisputeDetails').value = '';
    selectReason(REASONS[0].value);
    updateCharCount();

    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    var firstReason = document.querySelector('#qgDisputeReasons .qg-report-reason');
    if (firstReason) firstReason.focus();
  }

  function closeDisputeModal() {
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.display = 'none';
    document.body.style.overflow = '';
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
      reason: selectedReason,
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
