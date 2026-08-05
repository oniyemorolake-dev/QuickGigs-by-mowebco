/* QuickGigs — Report a problem / dispute sheet */
(function () {
  if (typeof ensureQgSheetStyles === 'function') ensureQgSheetStyles();

  var REASONS = [
    { value: 'not_done', label: 'Work not done' },
    { value: 'not_as_described', label: 'Not as described' },
    { value: 'no_show', label: 'No-show' },
    { value: 'payment', label: 'Payment issue' },
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
    overlay.setAttribute('aria-labelledby', 'qgDisputeTitle');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.display = 'none';

    overlay.innerHTML =
      '<div class="qg-report-sheet qg-dispute-sheet" role="document">' +
        '<div class="qg-report-handle" aria-hidden="true"></div>' +
        '<div class="qg-report-header">' +
          '<div class="qg-report-header-glow" aria-hidden="true"></div>' +
          '<button type="button" class="qg-report-close" id="qgDisputeClose" aria-label="Close">✕</button>' +
          '<div class="qg-report-kicker">Safety</div>' +
          '<h2 class="qg-report-title" id="qgDisputeTitle">Report a problem</h2>' +
          '<p class="qg-report-sub">Escrow freezes immediately. An admin reviews stamps, location check-in, photos, chat, and reviews before releasing or refunding.</p>' +
        '</div>' +
        '<div class="qg-report-body">' +
          '<div class="qg-report-target" id="qgDisputeTarget">' +
            '<span class="qg-report-target-icon" aria-hidden="true">⚠</span>' +
            '<div class="qg-report-target-text">' +
              '<span class="qg-report-target-label">Task</span>' +
              '<strong id="qgDisputeSub">This task</strong>' +
            '</div>' +
          '</div>' +
          '<div class="qg-report-field">' +
            '<label class="qg-report-label" for="qgDisputeReasonSelect">Reason</label>' +
            '<select class="qg-report-select" id="qgDisputeReasonSelect" aria-label="Dispute reason">' +
              REASONS.map(function (r) {
                return '<option value="' + r.value + '">' + r.label + '</option>';
              }).join('') +
            '</select>' +
          '</div>' +
          '<div class="qg-report-field">' +
            '<label class="qg-report-label" for="qgDisputeDetails">Details</label>' +
            '<div class="qg-report-textarea-wrap">' +
              '<textarea class="qg-report-textarea" id="qgDisputeDetails" maxlength="1500" ' +
                'placeholder="What happened? Include dates or chat context if helpful." rows="4"></textarea>' +
              '<span class="qg-report-char" id="qgDisputeCharCount">0 / 1500</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="qg-report-footer">' +
          '<button type="button" class="qg-report-cancel" id="qgDisputeCancel">Cancel</button>' +
          '<button type="button" class="qg-report-submit" id="qgDisputeSubmit">Submit</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    if (!document.getElementById('qg-dispute-select-css')) {
      var s = document.createElement('style');
      s.id = 'qg-dispute-select-css';
      s.textContent =
        '.qg-report-select{width:100%;padding:12px 14px;border-radius:12px;border:0.5px solid rgba(200,168,233,0.25);' +
        'background:rgba(255,255,255,0.06);color:inherit;font:inherit;font-size:14px;margin-top:6px}' +
        'body.light .qg-report-select{background:#fff;border-color:#e8e4f5}';
      (document.head || document.documentElement).appendChild(s);
    }

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeDisputeModal();
    });
    document.getElementById('qgDisputeClose').onclick = closeDisputeModal;
    document.getElementById('qgDisputeCancel').onclick = closeDisputeModal;
    document.getElementById('qgDisputeSubmit').onclick = submitDispute;
    document.getElementById('qgDisputeDetails').addEventListener('input', updateCharCount);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('open')) closeDisputeModal();
    });

    return overlay;
  }

  function updateCharCount() {
    var detailsEl = document.getElementById('qgDisputeDetails');
    var countEl = document.getElementById('qgDisputeCharCount');
    if (!detailsEl || !countEl) return;
    var len = (detailsEl.value || '').length;
    countEl.textContent = len + ' / 1500';
  }

  function openDisputeModal(options) {
    ctx = options || {};
    ensureOverlay();
    document.getElementById('qgDisputeSub').textContent =
      (ctx.taskTitle || 'Untitled task') + (ctx.otherName ? ' · with ' + ctx.otherName : '');
    document.getElementById('qgDisputeDetails').value = '';
    document.getElementById('qgDisputeReasonSelect').value = REASONS[0].value;
    updateCharCount();
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    document.getElementById('qgDisputeReasonSelect').focus();
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
    var user = (typeof getCurrentUser === 'function' ? getCurrentUser() : null) || window._currentUser;
    if (!user || !user.uid) {
      qgNotify('Please sign in to report a problem.', '#f59e0b');
      window.location.href = 'login.html';
      return;
    }
    if (!ctx || !ctx.taskId) return;

    var btn = document.getElementById('qgDisputeSubmit');
    var reason = (document.getElementById('qgDisputeReasonSelect') || {}).value || REASONS[0].value;
    var detail = (document.getElementById('qgDisputeDetails').value || '').trim();
    if (!detail) {
      qgNotify('Please add a short description so we can review.', '#f59e0b');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Submitting…';

    var result = { success: false, ok: false };
    var raiseUrl = (window.QG_CONFIG && window.QG_CONFIG.raiseDisputeUrl) ||
      'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/raise-dispute';
    if (typeof callVerifiedFunction === 'function') {
      result = await callVerifiedFunction(raiseUrl, {
        task_id: String(ctx.taskId),
        reason: reason,
        detail: detail
      }, user);
      if (result && (result.ok || result.success || result.already)) {
        result.success = true;
      }
    } else if (typeof sbPostReturn === 'function') {
      // Fallback without freeze — prefer Edge Function
      result = await sbPostReturn('disputes', {
        task_id: String(ctx.taskId),
        raised_by: user.uid,
        reason: reason,
        detail: detail,
        status: 'open',
        created_at: new Date().toISOString()
      });
    }

    btn.disabled = false;
    btn.textContent = 'Submit';

    if (result.success || result.ok) {
      closeDisputeModal();
      var msg = result.already
        ? 'A dispute is already open — escrow stays frozen.'
        : "Escrow frozen. We've notified admin with the evidence record.";
      if (typeof showToast === 'function') showToast(msg);
      else qgNotify(msg, '#4ade80');
      if (typeof window.onDisputeRaised === 'function') {
        try { window.onDisputeRaised(ctx.taskId, result); } catch (e) {}
      }
    } else {
      var err = result.error || result.message || 'Could not submit';
      if (err === 'no_funded_payment') {
        err = 'Disputes need a funded escrow payment on this task.';
      }
      qgNotify(err, '#ef4444');
    }
  }

  function disputeButtonHtml(taskId, taskTitle, otherUserId, otherName) {
    var attr = typeof escAttr === 'function' ? escAttr : function (s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\r?\n/g, ' ');
    };
    return '<button type="button" class="qg-chip-btn is-danger qg-dispute-trigger" ' +
      'data-task-id="' + attr(taskId || '') + '" ' +
      'data-task-title="' + attr(taskTitle || '') + '" ' +
      'data-other-id="' + attr(otherUserId || '') + '" ' +
      'data-other-name="' + attr(otherName || '') + '" ' +
      'aria-label="Report a problem">Report a problem</button>';
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
