/**
 * QuickGigs — in-person Safety / emergency tools (tokens only).
 * Call emergency services via config number (911 in Canada).
 * QuickGigs does NOT monitor or respond to emergencies.
 */
(function (global) {
  'use strict';

  var SETTINGS_PREFIX = 'qg-safety-settings:';
  var DISCLAIMER =
    '911 connects you to public emergency services. QuickGigs is not an emergency responder.';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ico(name, size, cls) {
    if (typeof qgIcon === 'function') {
      return qgIcon(name, { size: size || 18, className: cls || 'qg-safety-ico' });
    }
    return '';
  }

  function emergencyNumber() {
    var c = global.QG_CONFIG || {};
    var n = String(c.emergencyNumber || '911').replace(/[^\d+]/g, '');
    return n || '911';
  }

  function emergencyLabel() {
    var c = global.QG_CONFIG || {};
    return String(c.emergencyNumberLabel || c.emergencyNumber || '911');
  }

  function disclaimerText() {
    var label = emergencyLabel();
    if (label === '911') return DISCLAIMER;
    return (
      label +
      ' connects you to public emergency services. QuickGigs is not an emergency responder.'
    );
  }

  function currentUid() {
    return (global._currentUser && global._currentUser.uid) || '';
  }

  function settingsKey() {
    var uid = currentUid();
    return SETTINGS_PREFIX + (uid || 'anon');
  }

  function defaultSettings() {
    return { contactName: '', contactPhone: '', checkInEnabled: false };
  }

  function loadSettings() {
    try {
      var raw = localStorage.getItem(settingsKey());
      if (!raw) return defaultSettings();
      var parsed = JSON.parse(raw);
      return {
        contactName: String(parsed.contactName || '').trim(),
        contactPhone: String(parsed.contactPhone || '').trim(),
        checkInEnabled: !!parsed.checkInEnabled
      };
    } catch (e) {
      return defaultSettings();
    }
  }

  function saveSettings(next) {
    var data = {
      contactName: String((next && next.contactName) || '').trim(),
      contactPhone: String((next && next.contactPhone) || '').trim(),
      checkInEnabled: !!(next && next.checkInEnabled)
    };
    try {
      localStorage.setItem(settingsKey(), JSON.stringify(data));
    } catch (e) {}
    return data;
  }

  function toast(msg, color) {
    if (typeof showToast === 'function') showToast(msg, color || '#f87171');
    else if (typeof qgNotify === 'function') qgNotify(msg, color);
    else alert(msg);
  }

  function normalizePhone(phone) {
    return String(phone || '').replace(/[^\d+]/g, '');
  }

  function ensureOverlay() {
    var el = document.getElementById('qgSafetyOverlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'qgSafetyOverlay';
    el.className = 'qg-safety-overlay';
    el.setAttribute('hidden', '');
    el.innerHTML =
      '<div class="qg-safety-sheet" role="dialog" aria-modal="true" aria-labelledby="qgSafetySheetTitle" tabindex="-1">' +
      '<div class="qg-safety-handle" aria-hidden="true"></div>' +
      '<div class="qg-safety-sheet-body" id="qgSafetySheetBody"></div>' +
      '</div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) {
      if (e.target === el) closeSheet();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !el.hasAttribute('hidden')) closeSheet();
    });
    return el;
  }

  function openSheet(html) {
    var overlay = ensureOverlay();
    var body = document.getElementById('qgSafetySheetBody');
    if (body) body.innerHTML = html;
    overlay.removeAttribute('hidden');
    document.body.style.overflow = 'hidden';
    var sheet = overlay.querySelector('.qg-safety-sheet');
    if (sheet) {
      try { sheet.focus(); } catch (e) {}
    }
  }

  function closeSheet() {
    var overlay = document.getElementById('qgSafetyOverlay');
    if (overlay) overlay.setAttribute('hidden', '');
    document.body.style.overflow = '';
  }

  function openDialConfirm(opts) {
    opts = opts || {};
    var num = emergencyNumber();
    var label = emergencyLabel();
    var teenDual =
      opts.taskId &&
      global.QGTeenSafety &&
      typeof global.QGTeenSafety.isTeen === 'function' &&
      global.QGTeenSafety.isTeen();
    openSheet(
      '<div class="qg-safety-sheet-head">' +
      '<h2 class="qg-safety-sheet-title" id="qgSafetySheetTitle">Call ' +
      esc(label) +
      '?</h2>' +
      '<button type="button" class="qg-safety-sheet-close" data-safety-close aria-label="Close">&times;</button>' +
      '</div>' +
      '<p class="qg-safety-confirm-copy">This dials public emergency services on this device. Only continue if you need immediate help.' +
      (teenDual
        ? ' Your guardian will also be alerted and get your live location.'
        : '') +
      '</p>' +
      '<p class="qg-safety-disclaimer">' +
      esc(disclaimerText()) +
      '</p>' +
      '<div class="qg-safety-sheet-actions">' +
      '<button type="button" class="qg-safety-btn qg-safety-btn-muted" data-safety-close>Cancel</button>' +
      '<a class="qg-safety-btn qg-safety-btn-danger" id="qgSafetyDialConfirm" href="tel:' +
      esc(num) +
      '">Call ' +
      esc(label) +
      '</a>' +
      '</div>'
    );
    var dial = document.getElementById('qgSafetyDialConfirm');
    if (dial) {
      dial.addEventListener('click', function () {
        if (typeof haptic === 'function') haptic(12);
        if (teenDual && typeof global.QGTeenSafety.safetyAlert === 'function') {
          try {
            global.QGTeenSafety.safetyAlert(opts.taskId);
          } catch (e) {}
        }
        if (typeof opts.onConfirm === 'function') {
          try { opts.onConfirm(); } catch (e2) {}
        }
        setTimeout(closeSheet, 200);
      });
    }
    bindSheetChrome();
  }

  function bindSheetChrome() {
    document.querySelectorAll('[data-safety-close]').forEach(function (btn) {
      btn.addEventListener('click', closeSheet);
    });
  }

  function openSettings() {
    var s = loadSettings();
    openSheet(
      '<div class="qg-safety-sheet-head">' +
      '<h2 class="qg-safety-sheet-title" id="qgSafetySheetTitle">Safety settings</h2>' +
      '<button type="button" class="qg-safety-sheet-close" data-safety-close aria-label="Close">&times;</button>' +
      '</div>' +
      '<p class="qg-safety-settings-lead">Set who to reach in an emergency. Stored on this device only.</p>' +
      '<label class="qg-safety-field">' +
      '<span class="qg-safety-field-lbl">Emergency contact name</span>' +
      '<input class="qg-safety-input" id="qgSafetyName" type="text" maxlength="80" autocomplete="name" value="' +
      esc(s.contactName) +
      '" placeholder="Name">' +
      '</label>' +
      '<label class="qg-safety-field">' +
      '<span class="qg-safety-field-lbl">Phone number</span>' +
      '<input class="qg-safety-input" id="qgSafetyPhone" type="tel" maxlength="24" autocomplete="tel" value="' +
      esc(s.contactPhone) +
      '" placeholder="+1 …">' +
      '</label>' +
      '<label class="qg-safety-check">' +
      '<input type="checkbox" id="qgSafetyCheckIn"' +
      (s.checkInEnabled ? ' checked' : '') +
      '>' +
      '<span>Optional check-in reminders on active jobs</span>' +
      '</label>' +
      '<p class="qg-safety-disclaimer">' +
      esc(disclaimerText()) +
      '</p>' +
      '<div class="qg-safety-sheet-actions">' +
      '<button type="button" class="qg-safety-btn qg-safety-btn-muted" data-safety-close>Cancel</button>' +
      '<button type="button" class="qg-safety-btn qg-safety-btn-accent" id="qgSafetySave">Save</button>' +
      '</div>'
    );
    bindSheetChrome();
    var save = document.getElementById('qgSafetySave');
    if (save) {
      save.addEventListener('click', function () {
        var nameEl = document.getElementById('qgSafetyName');
        var phoneEl = document.getElementById('qgSafetyPhone');
        var checkEl = document.getElementById('qgSafetyCheckIn');
        var phone = normalizePhone(phoneEl && phoneEl.value);
        var name = (nameEl && nameEl.value) || '';
        if (name && !phone) {
          toast('Add a phone number for your emergency contact', '#fbbf24');
          return;
        }
        if (phone && phone.replace(/\D/g, '').length < 7) {
          toast('Enter a valid phone number', '#fbbf24');
          return;
        }
        saveSettings({
          contactName: name,
          contactPhone: phone,
          checkInEnabled: !!(checkEl && checkEl.checked)
        });
        toast('Safety settings saved', '#4ade80');
        closeSheet();
        refreshSafetyBlocks();
      });
    }
  }

  function mapsUrl(lat, lng) {
    return 'https://maps.google.com/?q=' + encodeURIComponent(lat + ',' + lng);
  }

  function shareMyLocation(opts) {
    opts = opts || {};
    var teenTaskId = opts.taskId;
    var isTeenJob =
      teenTaskId &&
      global.QGTeenSafety &&
      typeof global.QGTeenSafety.isTeen === 'function' &&
      global.QGTeenSafety.isTeen();
    if (isTeenJob && typeof global.QGTeenSafety.shareLocationWithGuardian === 'function') {
      global.QGTeenSafety.shareLocationWithGuardian(teenTaskId);
      // Also continue with local share to emergency contact if set.
    }
    if (!navigator.geolocation) {
      if (!isTeenJob) toast('Location is not available on this device', '#fbbf24');
      return;
    }
    toast('Getting your location…', '#9b6fc4');
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        var lat = pos.coords.latitude;
        var lng = pos.coords.longitude;
        var link = mapsUrl(lat, lng);
        var s = loadSettings();
        var text =
          'QuickGigs safety share — my current location: ' + link;
        var phone = normalizePhone(s.contactPhone);

        function doneCopied() {
          toast('Location link copied', '#4ade80');
        }

        if (isTeenJob && !phone) {
          // Guardian already notified via teen-safety; avoid redundant share sheet noise.
          return;
        }

        if (phone) {
          var sms =
            'sms:' +
            phone +
            ( /iPhone|iPad|iPod/i.test(navigator.userAgent) ? '&' : '?') +
            'body=' +
            encodeURIComponent(text);
          window.location.href = sms;
          return;
        }

        if (navigator.share) {
          navigator
            .share({ title: 'My location', text: text, url: link })
            .catch(function () {
              copyText(link, doneCopied);
            });
          return;
        }
        copyText(link, doneCopied);
      },
      function () {
        if (!isTeenJob) toast('Could not get location — check permissions', '#f87171');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  }

  function copyText(text, onOk) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onOk).catch(function () {
        fallbackCopy(text, onOk);
      });
    } else {
      fallbackCopy(text, onOk);
    }
  }

  function fallbackCopy(text, onOk) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      if (onOk) onOk();
    } catch (e) {
      toast(text, '#9b6fc4');
    }
  }

  function callEmergencyContact() {
    var s = loadSettings();
    var phone = normalizePhone(s.contactPhone);
    if (!phone) {
      openSettings();
      toast('Set an emergency contact first', '#fbbf24');
      return;
    }
    window.location.href = 'tel:' + phone;
  }

  function checkInNow() {
    var when = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    toast('Checked in at ' + when + ' — tell your contact if you need help', '#4ade80');
  }

  /**
   * Safety block for active / in-progress task cards (poster + tasker).
   */
  function renderSafetyBlockHtml(opts) {
    opts = opts || {};
    var taskId = opts.taskId ? String(opts.taskId) : '';
    var label = emergencyLabel();
    var s = loadSettings();
    var hasContact = !!(s.contactName || s.contactPhone);
    var contactLine = hasContact
      ? esc(s.contactName || 'Emergency contact') +
        (s.contactPhone ? ' · ' + esc(s.contactPhone) : '')
      : 'Not set — add in Safety settings';
    var teen =
      !opts.isPoster &&
      global.QGTeenSafety &&
      typeof global.QGTeenSafety.isTeen === 'function' &&
      global.QGTeenSafety.isTeen();
    // Teens use guardian check-ins instead of the optional local reminder.
    var checkIn =
      !teen && s.checkInEnabled
        ? '<button type="button" class="qg-safety-btn qg-safety-btn-muted qg-safety-checkin" data-safety-checkin>I\'m OK — check in</button>'
        : '';
    var teenWatch =
      teen && taskId && typeof global.QGTeenSafety.watchingBannerHtml === 'function'
        ? global.QGTeenSafety.watchingBannerHtml(taskId)
        : '';

    return (
      '<section class="qg-safety-block" data-safety-block' +
      (taskId ? ' data-safety-task="' + esc(taskId) + '"' : '') +
      ' aria-label="Safety">' +
      teenWatch +
      '<div class="qg-safety-block-head">' +
      '<span class="qg-safety-shield" aria-hidden="true">' +
      ico('shield', 20, 'qg-safety-shield-ico') +
      '</span>' +
      '<div class="qg-safety-block-titles">' +
      '<h3 class="qg-safety-block-title">Safety</h3>' +
      '<p class="qg-safety-block-sub">' +
      (teen ? 'Emergency + guardian alerts' : 'In-person meetup tools') +
      '</p>' +
      '</div>' +
      '</div>' +
      '<button type="button" class="qg-safety-btn qg-safety-btn-danger qg-safety-call911" data-safety-call-911>' +
      ico('smartphone', 16) +
      ' Call ' +
      esc(label) +
      (teen ? ' + alert guardian' : '') +
      '</button>' +
      '<div class="qg-safety-btn-row">' +
      '<button type="button" class="qg-safety-btn qg-safety-btn-muted" data-safety-share-loc>' +
      ico('mapPin', 14) +
      (teen ? ' Share with guardian' : ' Share my location') +
      '</button>' +
      '<button type="button" class="qg-safety-btn qg-safety-btn-muted" data-safety-contact>' +
      ico('users', 14) +
      (hasContact ? ' Call contact' : ' Emergency contact') +
      '</button>' +
      '</div>' +
      checkIn +
      '<p class="qg-safety-contact-line">' +
      contactLine +
      (hasContact
        ? ' <button type="button" class="qg-safety-edit-link" data-safety-settings>Edit</button>'
        : ' <button type="button" class="qg-safety-edit-link" data-safety-settings>Set up</button>') +
      '</p>' +
      '<p class="qg-safety-disclaimer">' +
      esc(disclaimerText()) +
      '</p>' +
      '</section>'
    );
  }

  function bindSafetyRoot(root) {
    if (!root) return;
    root.querySelectorAll('[data-safety-call-911]').forEach(function (btn) {
      if (btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', function () {
        var block = btn.closest('[data-safety-block]');
        var taskId = (block && block.getAttribute('data-safety-task')) || '';
        openDialConfirm({ taskId: taskId });
      });
    });
    root.querySelectorAll('[data-safety-share-loc]').forEach(function (btn) {
      if (btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', function () {
        var block = btn.closest('[data-safety-block]');
        var taskId = (block && block.getAttribute('data-safety-task')) || '';
        shareMyLocation({ taskId: taskId });
      });
    });
    root.querySelectorAll('[data-safety-contact]').forEach(function (btn) {
      if (btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', callEmergencyContact);
    });
    root.querySelectorAll('[data-safety-settings]').forEach(function (btn) {
      if (btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', openSettings);
    });
    root.querySelectorAll('[data-safety-checkin]').forEach(function (btn) {
      if (btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', checkInNow);
    });
  }

  function refreshSafetyBlocks() {
    document.querySelectorAll('[data-safety-block]').forEach(function (el) {
      var taskId = el.getAttribute('data-safety-task') || '';
      var wrap = document.createElement('div');
      wrap.innerHTML = renderSafetyBlockHtml({ taskId: taskId });
      var next = wrap.firstChild;
      if (next) {
        el.replaceWith(next);
        bindSafetyRoot(next.parentNode || document);
      }
    });
    bindSafetyRoot(document);
  }

  function mountSafetyInto(container) {
    if (!container) return;
    bindSafetyRoot(container);
  }

  // Preserve safety prefs across logout clears (uid-scoped).
  try {
    if (typeof qgAuthLsKeyShouldKeep === 'function') {
      /* patched via utils keep list below */
    }
  } catch (e) {}

  global.QGSafety = {
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    openSettings: openSettings,
    openDialConfirm: openDialConfirm,
    shareMyLocation: shareMyLocation,
    renderSafetyBlockHtml: renderSafetyBlockHtml,
    bindSafetyRoot: bindSafetyRoot,
    mountSafetyInto: mountSafetyInto,
    refreshSafetyBlocks: refreshSafetyBlocks,
    emergencyNumber: emergencyNumber,
    disclaimerText: disclaimerText,
    closeSheet: closeSheet
  };
  global.openSafetySettings = openSettings;
})(window);
