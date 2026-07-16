/* QuickGigs — report user / task / message (Profile Studio–style sheet) v3 */
(function () {
  /* Remove any stale report/dispute DOM from cached old scripts */
  function purgeStaleReportDom() {
    try {
      document.querySelectorAll('#qgReportOverlay, #qgDisputeOverlay, .qg-report-overlay').forEach(function (node) {
        node.remove();
      });
    } catch (e) { /* ignore */ }
  }
  purgeStaleReportDom();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', purgeStaleReportDom);
  }

  var SHEET_VER = '20260716d';

  function ensureQgSheetStyles() {
    var head = document.head || document.documentElement;
    if (!document.getElementById('qg-sheet-critical')) {
      var critical = document.createElement('style');
      critical.id = 'qg-sheet-critical';
      critical.textContent =
        '#qgReportOverlay,#qgDisputeOverlay{position:fixed!important;inset:0!important;z-index:9999!important;' +
        'display:none!important;align-items:flex-end!important;justify-content:center!important;' +
        'background:rgba(5,0,15,.85)!important;backdrop-filter:blur(10px)!important;-webkit-backdrop-filter:blur(10px)!important}' +
        '#qgReportOverlay.open,#qgDisputeOverlay.open{display:flex!important}';
      head.appendChild(critical);
    }
    if (!document.getElementById('qg-sheet-css')) {
      var link = document.createElement('link');
      link.id = 'qg-sheet-css';
      link.rel = 'stylesheet';
      link.href = 'qg-sheet.css?v=' + SHEET_VER;
      head.appendChild(link);
    }
  }

  ensureQgSheetStyles();
  window.ensureQgSheetStyles = ensureQgSheetStyles;
  var REASONS = [
    { value: 'spam', label: 'Spam or misleading', icon: '📢' },
    { value: 'harassment', label: 'Harassment or abuse', icon: '🚫' },
    { value: 'scam', label: 'Scam or fraud', icon: '⚠️' },
    { value: 'inappropriate', label: 'Inappropriate content', icon: '🔞' },
    { value: 'no_show', label: 'No-show or unreliable', icon: '👻' },
    { value: 'other', label: 'Other', icon: '💬' }
  ];

  var overlay = null;
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
    overlay.className = 'qg-report-overlay';
    overlay.id = 'qgReportOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'qgReportTitle');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.display = 'none';

    overlay.innerHTML =
      '<div class="qg-report-sheet" role="document">' +
        '<div class="qg-report-handle" aria-hidden="true"></div>' +
        '<div class="qg-report-header">' +
          '<div class="qg-report-header-glow" aria-hidden="true"></div>' +
          '<button type="button" class="qg-report-close" id="qgReportClose" aria-label="Close report">✕</button>' +
          '<div class="qg-report-kicker">Safety</div>' +
          '<h2 class="qg-report-title" id="qgReportTitle">Report</h2>' +
          '<p class="qg-report-sub" id="qgReportSub">Help keep QuickGigs safe. Reports are reviewed by our team.</p>' +
        '</div>' +
        '<div class="qg-report-body">' +
          '<div class="qg-report-target" id="qgReportTarget" aria-live="polite">' +
            '<span class="qg-report-target-icon" aria-hidden="true">🚩</span>' +
            '<div class="qg-report-target-text">' +
              '<span class="qg-report-target-label">Reporting</span>' +
              '<strong id="qgReportTargetName">content</strong>' +
            '</div>' +
          '</div>' +
          '<div class="qg-report-field">' +
            '<span class="qg-report-label" id="qgReportReasonLabel">What&apos;s the issue?</span>' +
            '<div class="qg-report-reasons" id="qgReportReasons" role="radiogroup" aria-labelledby="qgReportReasonLabel">' +
              reasonPillsHtml() +
            '</div>' +
          '</div>' +
          '<div class="qg-report-field">' +
            '<label class="qg-report-label" for="qgReportDetails">Details <span class="qg-report-optional">(optional)</span></label>' +
            '<div class="qg-report-textarea-wrap">' +
              '<textarea class="qg-report-textarea" id="qgReportDetails" maxlength="1000" ' +
                'placeholder="What happened? Include dates or message context if helpful." rows="4"></textarea>' +
              '<span class="qg-report-char" id="qgReportCharCount">0 / 1000</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="qg-report-footer">' +
          '<button type="button" class="qg-report-cancel" id="qgReportCancel">Cancel</button>' +
          '<button type="button" class="qg-report-submit" id="qgReportSubmit">Submit report</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeReportModal();
    });

    document.getElementById('qgReportClose').onclick = closeReportModal;
    document.getElementById('qgReportCancel').onclick = closeReportModal;

    document.getElementById('qgReportReasons').addEventListener('click', function (e) {
      var btn = e.target.closest('.qg-report-reason');
      if (!btn) return;
      selectReason(btn.getAttribute('data-value'));
    });

    var detailsEl = document.getElementById('qgReportDetails');
    detailsEl.addEventListener('input', updateCharCount);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('open')) closeReportModal();
    });

    document.getElementById('qgReportSubmit').onclick = submitReport;

    return overlay;
  }

  function selectReason(value) {
    selectedReason = value || REASONS[0].value;
    var wrap = document.getElementById('qgReportReasons');
    if (!wrap) return;
    wrap.querySelectorAll('.qg-report-reason').forEach(function (btn) {
      var on = btn.getAttribute('data-value') === selectedReason;
      btn.classList.toggle('is-selected', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  function updateCharCount() {
    var detailsEl = document.getElementById('qgReportDetails');
    var countEl = document.getElementById('qgReportCharCount');
    if (!detailsEl || !countEl) return;
    var len = (detailsEl.value || '').length;
    countEl.textContent = len + ' / 1000';
    countEl.classList.toggle('is-near', len > 850);
    countEl.classList.toggle('is-over', len >= 1000);
  }

  var currentContext = null;

  function openReportModal(ctx) {
    currentContext = ctx || {};
    var el = ensureOverlay();

    var targetName = ctx.targetLabel || ctx.targetType || 'content';
    document.getElementById('qgReportTargetName').textContent = targetName;
    document.getElementById('qgReportSub').textContent =
      'Our team reviews every report. You will not be visible to the person you report.';

    var detailsEl = document.getElementById('qgReportDetails');
    detailsEl.value = '';
    selectReason(REASONS[0].value);
    updateCharCount();

    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    el.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    var firstReason = document.querySelector('#qgReportReasons .qg-report-reason');
    if (firstReason) firstReason.focus();
  }

  function closeReportModal() {
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.display = 'none';
    document.body.style.overflow = '';
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
      reason: selectedReason,
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
      var details = (detailsEl.value || '').trim();
      var mailSubject = encodeURIComponent('QuickGigs report: ' + (currentContext.targetType || 'item'));
      var mailBody = encodeURIComponent(
        'Reason: ' + selectedReason + '\n' +
        'Target: ' + (currentContext.targetLabel || '') + ' (' + (currentContext.targetType || '') + ' #' + (currentContext.targetId || '') + ')\n\n' +
        'Details:\n' + (details || '(none)') + '\n\n' +
        'Reporter: ' + (user.email || user.uid)
      );
      if (confirm('Could not save your report online (database may not be set up yet). Send it by email instead?')) {
        closeReportModal();
        window.location.href = 'mailto:support@quickgigs.ca?subject=' + mailSubject + '&body=' + mailBody;
      } else {
        alert('Could not submit report. Please email support@quickgigs.ca with what happened.');
      }
    }
  }

  document.addEventListener('DOMContentLoaded', purgeStaleReportDom);

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
