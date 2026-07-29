/* QuickGigs — Report & Block (client-side). Do not rename reports/blocks columns.
 * Report → reports (reporter_id, target_type task|user, target_id, reason, detail).
 * Block → blocks (blocker_id, blocked_id). Browse hides blocked posters; chat blocked both ways.
 */
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
  if (document && document.readyState === 'loading' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', purgeStaleReportDom);
  }

  var SHEET_VER = '20260727trust';

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
  /* reports.reason CHECK: spam|scam|inappropriate|off_platform|other — do not rename */
  var REASONS = [
    { value: 'spam', label: 'Spam', icon: '📢' },
    { value: 'scam', label: 'Scam', icon: '⚠️' },
    { value: 'inappropriate', label: 'Inappropriate', icon: '🔞' },
    { value: 'off_platform', label: 'Off-platform contact', icon: '📵' },
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
            '<label class="qg-report-label" for="qgReportReasonSelect">What&apos;s the issue?</label>' +
            '<select class="qg-report-select" id="qgReportReasonSelect" aria-label="Report reason">' +
              REASONS.map(function (r) {
                return '<option value="' + r.value + '">' + r.label + '</option>';
              }).join('') +
            '</select>' +
            '<div class="qg-report-reasons" id="qgReportReasons" role="radiogroup" aria-label="Report reason" style="margin-top:10px">' +
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

    if (overlay && overlay.addEventListener) overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeReportModal();
    });

    var closeBtn = document.getElementById('qgReportClose');
    var cancelBtn = document.getElementById('qgReportCancel');
    if (closeBtn) closeBtn.onclick = closeReportModal;
    if (cancelBtn) cancelBtn.onclick = closeReportModal;

    var reasons = document.getElementById('qgReportReasons');
    if (reasons && reasons.addEventListener) reasons.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.qg-report-reason') : null;
      if (!btn) return;
      selectReason(btn.getAttribute('data-value'));
    });

    var reasonSelect = document.getElementById('qgReportReasonSelect');
    if (reasonSelect && reasonSelect.addEventListener) {
      reasonSelect.addEventListener('change', function () {
        selectReason(reasonSelect.value);
      });
    }

    var detailsEl = document.getElementById('qgReportDetails');
    if (detailsEl && detailsEl.addEventListener) detailsEl.addEventListener('input', updateCharCount);

    if (document && document.addEventListener) document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('open')) closeReportModal();
    });

    var submit = document.getElementById('qgReportSubmit');
    if (submit) submit.onclick = submitReport;

    return overlay;
  }

  function selectReason(value) {
    selectedReason = value || REASONS[0].value;
    var wrap = document.getElementById('qgReportReasons');
    if (wrap) {
      wrap.querySelectorAll('.qg-report-reason').forEach(function (btn) {
        var on = btn.getAttribute('data-value') === selectedReason;
        btn.classList.toggle('is-selected', on);
        btn.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    }
    var sel = document.getElementById('qgReportReasonSelect');
    if (sel && sel.value !== selectedReason) sel.value = selectedReason;
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

    var targetName = currentContext.targetLabel || currentContext.targetType || 'content';
    var targetNameEl = document.getElementById('qgReportTargetName');
    var subEl = document.getElementById('qgReportSub');
    if (targetNameEl) targetNameEl.textContent = targetName;
    if (subEl) subEl.textContent =
      'Our team reviews every report. You will not be visible to the person you report.';

    var detailsEl = document.getElementById('qgReportDetails');
    if (detailsEl) detailsEl.value = String(currentContext.initialDetail || '').slice(0, 1000);
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
    var user = (typeof getCurrentUser === 'function' ? getCurrentUser() : null) || window._currentUser || null;
    if (!user || !user.uid) {
      qgNotify('Please sign in to submit a report.', '#f59e0b');
      window.location.href = 'login.html';
      return;
    }
    if (!currentContext) return;

    var detailsEl = document.getElementById('qgReportDetails');
    var submitBtn = document.getElementById('qgReportSubmit');
    var reasonSel = document.getElementById('qgReportReasonSelect');
    if (reasonSel && reasonSel.value) selectedReason = reasonSel.value;
    if (!detailsEl || !submitBtn) return;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    var rawType = String(currentContext.targetType || '').toLowerCase();
    var targetType = (rawType === 'profile' || rawType === 'user') ? 'user'
      : (rawType === 'task' ? 'task' : '');
    var targetId = String(currentContext.targetId || '');
    var detail = (detailsEl.value || '').trim();
    var requiredContext = String(currentContext.initialDetail || '').trim();
    if (requiredContext && detail.indexOf(requiredContext) !== 0) {
      detail = (requiredContext + (detail ? '\n\nUser details:\n' + detail : '')).slice(0, 1000);
    }
    var row = {
      reporter_id: user.uid,
      target_type: targetType,
      target_id: targetId,
      reason: selectedReason,
      detail: detail
    };

    var result = { success: false };
    if (typeof createReport === 'function') {
      result = await createReport(row);
    } else if (typeof sbPost === 'function' && targetType && targetId) {
      result = await sbPost('reports', Object.assign({}, row, {
        status: 'open',
        created_at: new Date().toISOString()
      }));
    }

    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit report';

    if (result.success) {
      closeReportModal();
      // Confirm toast — row feeds the admin Reports queue (reports table)
      if (typeof showToast === 'function') {
        showToast('Report submitted. Thanks — our team will review it.');
      } else {
        qgNotify('Report submitted. Thanks — our team will review it.', '#4ade80');
      }
    } else {
      var mailSubject = encodeURIComponent('QuickGigs report: ' + (currentContext.targetType || 'item'));
      var mailBody = encodeURIComponent(
        'Reason: ' + selectedReason + '\n' +
        'Target: ' + (currentContext.targetLabel || '') + ' (' + targetType + ' #' + targetId + ')\n\n' +
        'Details:\n' + (detail || '(none)') + '\n\n' +
        'Reporter: ' + (user.email || user.uid)
      );
      if (confirm('Could not save your report online (database may not be set up yet). Send it by email instead?')) {
        closeReportModal();
        window.location.href = 'mailto:support@quickgigs.ca?subject=' + mailSubject + '&body=' + mailBody;
      } else {
        qgNotify('Could not submit report. Please email support@quickgigs.ca', '#ef4444');
      }
    }
  }

  if (document && document.addEventListener) document.addEventListener('DOMContentLoaded', purgeStaleReportDom);

  function reportButtonHtml(targetType, targetId, targetLabel) {
    var attr = typeof escAttr === 'function' ? escAttr : function (s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\r?\n/g, ' ');
    };
    var safeLabel = attr(targetLabel || '');
    return '<button type="button" class="qg-chip-btn is-danger qg-report-trigger" ' +
      'data-target-type="' + attr(targetType || '') + '" ' +
      'data-target-id="' + attr(targetId || '') + '" ' +
      'data-target-label="' + safeLabel + '" ' +
      'aria-label="Report ' + safeLabel + '">🚩 Report</button>';
  }

  function bindReportTriggers(root) {
    var scope = root || document;
    scope.querySelectorAll('.qg-report-trigger').forEach(function (btn) {
      if (btn._qgReportBound) return;
      btn._qgReportBound = true;
      btn.onclick = function (e) {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        openReportModal({
          targetType: btn.getAttribute('data-target-type'),
          targetId: btn.getAttribute('data-target-id'),
          targetLabel: btn.getAttribute('data-target-label')
        });
      };
    });
  }

  function blockButtonHtml(userId, userName) {
    if (!userId) return '';
    var attr = typeof escAttr === 'function' ? escAttr : function (s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\r?\n/g, ' ');
    };
    var safeName = attr(userName || 'this user');
    return '<button type="button" class="qg-chip-btn is-danger qg-block-trigger" ' +
      'data-block-id="' + attr(userId) + '" ' +
      'data-block-name="' + safeName + '" ' +
      'aria-label="Block ' + safeName + '">Block user</button>';
  }

  async function confirmAndBlockUser(userId, userName) {
    var me = window._currentUser;
    if (!me || !me.uid) {
      qgNotify('Please sign in to block someone.', '#f59e0b');
      window.location.href = 'login.html';
      return { success: false };
    }
    if (String(me.uid) === String(userId)) {
      qgNotify('You cannot block yourself.', '#f59e0b');
      return { success: false };
    }
    var label = userName || 'this user';
    if (!confirm('Block ' + label + '? Their tasks will be hidden from you, and you will not be able to message each other.')) {
      return { success: false, cancelled: true };
    }
    if (typeof blockUser !== 'function') {
      qgNotify('Blocking is not available yet. Run supabase/reports-blocks-disputes.sql in Supabase.', '#ef4444');
      return { success: false };
    }
    var result = await blockUser(me.uid, userId);
    if (result && result.success) {
      if (typeof showToast === 'function') showToast('User blocked. You will not see their tasks or messages.');
      else qgNotify('User blocked.', '#4ade80');
      if (typeof window.onUserBlocked === 'function') window.onUserBlocked(userId);
    } else if (result && result.error === 'blocks_table_missing') {
      qgNotify('Run supabase/reports-blocks-disputes.sql in the Supabase SQL Editor first.', '#ef4444');
    } else {
      qgNotify('Could not block user. Try again.', '#ef4444');
    }
    return result || { success: false };
  }

  function bindBlockTriggers(root) {
    var scope = root || document;
    scope.querySelectorAll('.qg-block-trigger').forEach(function (btn) {
      if (btn._qgBlockBound) return;
      btn._qgBlockBound = true;
      btn.onclick = function (e) {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        confirmAndBlockUser(btn.getAttribute('data-block-id'), btn.getAttribute('data-block-name'));
      };
    });
  }

  window.openReportModal = openReportModal;
  window.closeReportModal = closeReportModal;
  window.reportButtonHtml = reportButtonHtml;
  window.bindReportTriggers = bindReportTriggers;
  window.blockButtonHtml = blockButtonHtml;
  window.bindBlockTriggers = bindBlockTriggers;
  window.confirmAndBlockUser = confirmAndBlockUser;
})();

/* Minimal select styling for report reason dropdown */
(function () {
  if (document.getElementById('qg-report-select-css')) return;
  var s = document.createElement('style');
  s.id = 'qg-report-select-css';
  s.textContent =
    '.qg-report-select{width:100%;padding:12px 14px;border-radius:12px;border:0.5px solid rgba(200,168,233,0.25);' +
    'background:rgba(255,255,255,0.06);color:inherit;font:inherit;font-size:14px;margin-top:6px}' +
    'body.light .qg-report-select{background:#fff;border-color:#e8e4f5}' +
    '.qg-trust-rating{font-size:12px;color:var(--text-muted,#a89bb8);font-weight:500}' +
    '.qg-trust-rating.is-new{color:var(--lavender,#c8a8e9)}';
  (document.head || document.documentElement).appendChild(s);
})();
