/* QuickGigs — report user / task / message (modal UI) */
(function () {
  var REASONS = [
    { value: 'spam', label: 'Spam or misleading listing' },
    { value: 'harassment', label: 'Harassment or abusive behaviour' },
    { value: 'scam', label: 'Suspected scam or fraud' },
    { value: 'inappropriate', label: 'Inappropriate content' },
    { value: 'no_show', label: 'No-show or unreliable' },
    { value: 'other', label: 'Other' }
  ];

  var overlay = null;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'qg-report-overlay';
    overlay.id = 'qgReportOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'qgReportTitle');
    overlay.innerHTML =
      '<div class="qg-report-sheet">' +
        '<div class="qg-report-handle" aria-hidden="true"></div>' +
        '<h2 class="qg-report-title" id="qgReportTitle">Report</h2>' +
        '<p class="qg-report-sub" id="qgReportSub">Help keep QuickGigs safe. Reports are reviewed by our team.</p>' +
        '<label class="qg-report-label" for="qgReportReason">Reason</label>' +
        '<select class="qg-report-select" id="qgReportReason" aria-required="true">' +
          REASONS.map(function (r) {
            return '<option value="' + r.value + '">' + r.label + '</option>';
          }).join('') +
        '</select>' +
        '<label class="qg-report-label" for="qgReportDetails">Details (optional)</label>' +
        '<textarea class="qg-report-textarea" id="qgReportDetails" maxlength="1000" placeholder="What happened? Include dates or message context if helpful."></textarea>' +
        '<div class="qg-report-actions">' +
          '<button type="button" class="qg-report-cancel" id="qgReportCancel">Cancel</button>' +
          '<button type="button" class="qg-report-submit" id="qgReportSubmit">Submit report</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeReportModal();
    });
    document.getElementById('qgReportCancel').onclick = closeReportModal;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('open')) closeReportModal();
    });

    return overlay;
  }

  var currentContext = null;

  function openReportModal(ctx) {
    currentContext = ctx || {};
    var el = ensureOverlay();
    document.getElementById('qgReportSub').textContent =
      'Reporting: ' + (ctx.targetLabel || ctx.targetType || 'content') + '. Our team reviews every report.';
    document.getElementById('qgReportDetails').value = '';
    document.getElementById('qgReportReason').selectedIndex = 0;
    el.classList.add('open');
    document.getElementById('qgReportReason').focus();
  }

  function closeReportModal() {
    if (overlay) overlay.classList.remove('open');
    currentContext = null;
  }

  async function submitReport() {
    var user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
    if (!user) {
      alert('Please sign in to submit a report.');
      window.location.href = 'login.html';
      return;
    }
    if (!currentContext) return;

    var reasonEl = document.getElementById('qgReportReason');
    var detailsEl = document.getElementById('qgReportDetails');
    var submitBtn = document.getElementById('qgReportSubmit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    var row = {
      reporter_id: user.uid,
      reporter_email: user.email || '',
      target_type: currentContext.targetType || 'unknown',
      target_id: String(currentContext.targetId || ''),
      target_label: currentContext.targetLabel || '',
      reason: reasonEl.value,
      details: (detailsEl.value || '').trim(),
      status: 'open'
    };

    var result = { success: false };
    if (typeof sbPost === 'function') {
      result = await sbPost('reports', row);
    }

    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit report';

    if (result.success) {
      closeReportModal();
      if (typeof showToast === 'function') {
        showToast('Report submitted. Thank you for helping keep QuickGigs safe.');
      } else {
        alert('Report submitted. Thank you.');
      }
    } else {
      alert('Could not submit report. Please try again or email support@quickgigs.ca');
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    ensureOverlay();
    document.getElementById('qgReportSubmit').onclick = submitReport;
  });

  function reportButtonHtml(targetType, targetId, targetLabel) {
    var safeLabel = (targetLabel || '').replace(/"/g, '&quot;');
    return '<button type="button" class="qg-chip-btn is-danger qg-report-trigger" ' +
      'data-target-type="' + (targetType || '') + '" ' +
      'data-target-id="' + (targetId || '') + '" ' +
      'data-target-label="' + safeLabel + '" ' +
      'aria-label="Report ' + safeLabel + '">🚩 Report</button>';
  }

  function bindReportTriggers(root) {
    var scope = root || document;
    scope.querySelectorAll('.qg-report-trigger').forEach(function (btn) {
      if (btn._qgReportBound) return;
      btn._qgReportBound = true;
      btn.onclick = function () {
        openReportModal({
          targetType: btn.getAttribute('data-target-type'),
          targetId: btn.getAttribute('data-target-id'),
          targetLabel: btn.getAttribute('data-target-label')
        });
      };
    });
  }

  window.openReportModal = openReportModal;
  window.closeReportModal = closeReportModal;
  window.reportButtonHtml = reportButtonHtml;
  window.bindReportTriggers = bindReportTriggers;
})();
