/**
 * QuickGigs — teen active-job safety (guardian watching, check-ins, dual alerts).
 * Adds monitoring on top of existing guardian consent / per-application approval.
 * Location is shared with the linked guardian only while a job session is active.
 */
(function (global) {
  'use strict';

  var sessionsByTask = {};
  var tickTimer = null;
  var pingTimer = null;
  var promptOpenFor = '';
  var responseTimers = {};
  var missedReported = {};

  function cfg() {
    return global.QG_CONFIG || {};
  }

  function safetyCfg() {
    return cfg().teenSafety || {};
  }

  function meetupCfg() {
    return cfg().teenMeetup || {};
  }

  function endpoint() {
    return cfg().teenSafetyUrl || '';
  }

  function intervalMs() {
    var m = Number(safetyCfg().checkInIntervalMinutes);
    return (isFinite(m) && m > 0 ? m : 20) * 60 * 1000;
  }

  function responseMs() {
    var m = Number(safetyCfg().checkInResponseMinutes);
    return (isFinite(m) && m > 0 ? m : 5) * 60 * 1000;
  }

  function pingMs() {
    var m = Number(safetyCfg().locationPingMinutes);
    return (isFinite(m) && m > 0 ? m : 10) * 60 * 1000;
  }

  function isTeen() {
    if (global._qgAgeTier === 'teen') return true;
    var access = global._qgRoleAccessState || global._qgRoleAccess;
    if (access && access.is_teen === true) return true;
    if (typeof QG_isTeenDob === 'function' && global._qgAgeProfile) {
      return !!QG_isTeenDob(global._qgAgeProfile.date_of_birth);
    }
    try {
      var user = typeof getCurrentUser === 'function' ? getCurrentUser() : global._currentUser;
      var uid = user && user.uid;
      if (uid) {
        var raw = localStorage.getItem('qg-role-access:' + uid);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && parsed.is_teen === true) return true;
        }
      }
    } catch (e) {}
    return false;
  }

  function toast(msg, color) {
    if (typeof showToast === 'function') showToast(msg, color || '#4ade80');
    else if (typeof qgNotify === 'function') qgNotify(msg, color);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ico(name, size) {
    if (typeof qgIcon === 'function') return qgIcon(name, { size: size || 16, className: 'qg-teen-safety-ico' });
    return '';
  }

  function normalizeCat(task) {
    return String(
      (task && (task.category || task.CATEGORY || task.cat || '')) || ''
    ).toLowerCase().trim();
  }

  /**
   * Config-driven meetup policy for a task. Does not replace guardian approval.
   */
  function meetupPolicyForTask(task) {
    var m = meetupCfg();
    var cat = normalizeCat(task);
    var flagList = Array.isArray(m.flagHomeVisitCategories) ? m.flagHomeVisitCategories : [];
    var blockList = Array.isArray(m.blockHomeVisitCategories) ? m.blockHomeVisitCategories : [];
    var flagged = flagList.indexOf(cat) >= 0;
    var blocked = blockList.indexOf(cat) >= 0;
    return {
      category: cat,
      preferPublicMeetup: m.preferPublicMeetup !== false,
      flagged: flagged,
      blocked: blocked,
      warning: blocked || flagged
        ? String(m.homeVisitWarning || 'This may be a private-home meetup. Prefer a public place when possible.')
        : (m.preferPublicMeetup !== false
          ? String(m.publicMeetupHint || '')
          : ''),
      allowApply: !blocked
    };
  }

  function meetupBannerHtml(task) {
    if (!isTeen()) return '';
    var policy = meetupPolicyForTask(task);
    if (!policy.warning) return '';
    var cls = policy.blocked ? 'qg-teen-meetup-banner is-block' : 'qg-teen-meetup-banner';
    return (
      '<div class="' + cls + '" role="status">' +
      ico('shield', 14) +
      '<span>' + esc(policy.warning) + '</span></div>'
    );
  }

  async function api(action, body) {
    var url = endpoint();
    var user = typeof getCurrentUser === 'function' ? getCurrentUser() : global._currentUser;
    if (!url) return { ok: false, error: 'teen_safety_not_configured' };
    if (!user || typeof callVerifiedFunction !== 'function') {
      return { ok: false, error: 'auth_required' };
    }
    var result = await callVerifiedFunction(
      url,
      Object.assign({ action: action }, body || {}),
      user
    );
    if (result && result.ok == null) result.ok = result.success === true;
    return result;
  }

  function getPosition() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        function () { resolve(null); },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 20000 }
      );
    });
  }

  async function startSession(taskId, opts) {
    if (!isTeen() || !taskId) return null;
    opts = opts || {};
    var result = await api('start_session', {
      task_id: String(taskId),
      home_distance_km: opts.home_distance_km != null ? opts.home_distance_km : undefined
    });
    if (result && result.ok && result.session) {
      sessionsByTask[String(taskId)] = result.session;
      ensureTimers();
      refreshWatchingUi();
      return result.session;
    }
    return null;
  }

  async function ensureSessionsForTasks(taskIds) {
    if (!isTeen()) return;
    var ids = (taskIds || []).map(String).filter(Boolean);
    if (!ids.length) return;
    await Promise.all(ids.map(function (id) {
      if (sessionsByTask[id]) return Promise.resolve();
      return startSession(id);
    }));
  }

  function watchingBannerHtml(taskId) {
    if (!isTeen()) return '';
    return (
      '<div class="qg-teen-watching" data-teen-watching="' + esc(taskId) + '" role="status">' +
      '<span class="qg-teen-watching-dot" aria-hidden="true"></span>' +
      '<div class="qg-teen-watching-copy">' +
      '<strong>Guardian safety cover is on</strong>' +
      '<span>Your guardian can see check-ins and live location for this job only — so help is one tap away.</span>' +
      '</div></div>'
    );
  }

  function ensureCheckInOverlay() {
    var el = document.getElementById('qgTeenCheckInOverlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'qgTeenCheckInOverlay';
    el.className = 'qg-teen-checkin-overlay';
    el.setAttribute('hidden', '');
    el.innerHTML =
      '<div class="qg-teen-checkin-sheet" role="dialog" aria-modal="true" aria-labelledby="qgTeenCheckInTitle">' +
      '<h2 class="qg-teen-checkin-title" id="qgTeenCheckInTitle">Are you OK?</h2>' +
      '<p class="qg-teen-checkin-sub">Quick safety check-in for your guardian. Respond so they know you\'re fine.</p>' +
      '<div class="qg-teen-checkin-actions">' +
      '<button type="button" class="qg-teen-checkin-btn is-ok" data-teen-ok>Yes, I\'m fine</button>' +
      '<button type="button" class="qg-teen-checkin-btn is-help" data-teen-help>Need help</button>' +
      '</div>' +
      '<p class="qg-teen-checkin-note">No response within the timeout alerts your guardian automatically.</p>' +
      '</div>';
    document.body.appendChild(el);
    el.querySelector('[data-teen-ok]').addEventListener('click', function () {
      respondCheckIn(true);
    });
    el.querySelector('[data-teen-help]').addEventListener('click', function () {
      respondCheckIn(false);
    });
    return el;
  }

  function showCheckInPrompt(taskId) {
    if (promptOpenFor === String(taskId)) return;
    promptOpenFor = String(taskId);
    var overlay = ensureCheckInOverlay();
    overlay.removeAttribute('hidden');
    overlay.setAttribute('data-task-id', String(taskId));
    document.body.style.overflow = 'hidden';
    api('awaiting_check_in', { task_id: String(taskId) }).catch(function () {});

    if (responseTimers[taskId]) clearTimeout(responseTimers[taskId]);
    responseTimers[taskId] = setTimeout(function () {
      if (promptOpenFor !== String(taskId)) return;
      closeCheckInPrompt();
      reportMissed(taskId);
    }, responseMs());
  }

  function closeCheckInPrompt() {
    var overlay = document.getElementById('qgTeenCheckInOverlay');
    if (overlay) overlay.setAttribute('hidden', '');
    document.body.style.overflow = '';
    var tid = promptOpenFor;
    promptOpenFor = '';
    if (tid && responseTimers[tid]) {
      clearTimeout(responseTimers[tid]);
      delete responseTimers[tid];
    }
  }

  async function respondCheckIn(ok) {
    var overlay = document.getElementById('qgTeenCheckInOverlay');
    var taskId = (overlay && overlay.getAttribute('data-task-id')) || promptOpenFor;
    closeCheckInPrompt();
    if (!taskId) return;
    var coords = await getPosition();
    var result = await api('check_in', {
      task_id: String(taskId),
      ok: !!ok,
      need_help: !ok,
      lat: coords && coords.lat,
      lng: coords && coords.lng
    });
    if (result && result.session) sessionsByTask[String(taskId)] = result.session;
    if (!ok) {
      toast('Help request sent to your guardian', '#f87171');
    } else {
      toast('Checked in — you\'re all set', '#4ade80');
      missedReported[String(taskId)] = false;
    }
  }

  async function reportMissed(taskId) {
    if (!taskId || missedReported[String(taskId)]) return;
    missedReported[String(taskId)] = true;
    var coords = await getPosition();
    var result = await api('report_missed', {
      task_id: String(taskId),
      lat: coords && coords.lat,
      lng: coords && coords.lng
    });
    if (result && result.ok) {
      toast('Guardian alerted — missed check-in', '#fbbf24');
    }
  }

  function evaluateDue() {
    if (!isTeen()) return;
    var now = Date.now();
    Object.keys(sessionsByTask).forEach(function (taskId) {
      var s = sessionsByTask[taskId];
      if (!s || String(s.status) !== 'active') return;
      var due = s.next_check_in_due_at ? new Date(s.next_check_in_due_at).getTime() : 0;
      if (!due) return;
      var state = String(s.check_in_state || '');
      if (state === 'need_help' || state === 'safety_alert') return;
      if (now >= due) showCheckInPrompt(taskId);
    });
  }

  async function pingLocations() {
    if (!isTeen() || document.visibilityState === 'hidden') return;
    var ids = Object.keys(sessionsByTask).filter(function (id) {
      var s = sessionsByTask[id];
      return s && String(s.status) === 'active' && s.location_share_active !== false;
    });
    if (!ids.length) return;
    var coords = await getPosition();
    if (!coords) return;
    await Promise.all(ids.map(function (id) {
      return api('ping_location', {
        task_id: id,
        lat: coords.lat,
        lng: coords.lng
      }).then(function (res) {
        if (res && res.session) sessionsByTask[id] = res.session;
      }).catch(function () {});
    }));
  }

  function ensureTimers() {
    if (!tickTimer) {
      tickTimer = setInterval(evaluateDue, 10000);
    }
    if (!pingTimer) {
      pingTimer = setInterval(pingLocations, pingMs());
    }
  }

  function refreshWatchingUi() {
    document.querySelectorAll('[data-teen-watching]').forEach(function (el) {
      el.classList.add('is-live');
    });
  }

  async function syncStamp(taskId, stamp) {
    if (!isTeen() || !taskId || !stamp) return;
    if (!sessionsByTask[String(taskId)]) await startSession(taskId);
    var result = await api('sync_stamp', { task_id: String(taskId), stamp: stamp });
    if (result && result.session) sessionsByTask[String(taskId)] = result.session;
  }

  async function safetyAlert(taskId) {
    if (!isTeen() || !taskId) return { ok: false };
    if (!sessionsByTask[String(taskId)]) await startSession(taskId);
    var coords = await getPosition();
    var result = await api('safety_alert', {
      task_id: String(taskId),
      lat: coords && coords.lat,
      lng: coords && coords.lng
    });
    if (result && result.ok) toast('Guardian alerted with your location', '#f87171');
    return result;
  }

  async function shareLocationWithGuardian(taskId) {
    if (!isTeen() || !taskId) return;
    var coords = await getPosition();
    if (!coords) {
      toast('Could not get location', '#fbbf24');
      return;
    }
    if (!sessionsByTask[String(taskId)]) await startSession(taskId);
    var result = await api('ping_location', {
      task_id: String(taskId),
      lat: coords.lat,
      lng: coords.lng
    });
    if (result && result.ok) toast('Location shared with your guardian', '#4ade80');
  }

  async function endSession(taskId, reason) {
    if (!taskId) return;
    await api('end_session', { task_id: String(taskId), reason: reason || 'ended_complete' });
    delete sessionsByTask[String(taskId)];
  }

  function bindRoot(root) {
    if (!root || !isTeen()) return;
    root.querySelectorAll('[data-teen-watching]').forEach(function (el) {
      var taskId = el.getAttribute('data-teen-watching');
      if (taskId) startSession(taskId);
    });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      evaluateDue();
      pingLocations();
    }
  });

  document.addEventListener('qg-age-tier-ready', function () {
    if (typeof global.QGSafety !== 'undefined' && typeof global.QGSafety.refreshSafetyBlocks === 'function') {
      global.QGSafety.refreshSafetyBlocks();
    }
  });
  document.addEventListener('qg-role-access-changed', function () {
    if (typeof global.QGSafety !== 'undefined' && typeof global.QGSafety.refreshSafetyBlocks === 'function') {
      global.QGSafety.refreshSafetyBlocks();
    }
  });

  global.QGTeenSafety = {
    isTeen: isTeen,
    meetupPolicyForTask: meetupPolicyForTask,
    meetupBannerHtml: meetupBannerHtml,
    watchingBannerHtml: watchingBannerHtml,
    ensureSessionsForTasks: ensureSessionsForTasks,
    startSession: startSession,
    syncStamp: syncStamp,
    safetyAlert: safetyAlert,
    shareLocationWithGuardian: shareLocationWithGuardian,
    endSession: endSession,
    bindRoot: bindRoot,
    intervalMs: intervalMs,
    responseMs: responseMs
  };
})(window);
