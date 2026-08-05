/* QuickGigs — poster / tasker role switch (Profile + quick actions) */
(function () {
  function getCurrentMode() {
    if (typeof getMode === 'function') return getMode();
    if (typeof getSessionMode === 'function') {
      return getSessionMode() === 'worker' ? 'tasker' : 'poster';
    }
    return 'poster';
  }

  function isPosterModeLocal() {
    return getCurrentMode() !== 'tasker';
  }

  function showRoleToast(mode) {
    var label = mode === 'tasker' || mode === 'worker' ? 'Tasker' : 'Poster';
    var msg = (mode === 'tasker' || mode === 'worker')
      ? "You're in Tasker mode — browse tasks and apply."
      : "You're in Poster mode — post tasks and hire.";
    if (typeof showToast === 'function') showToast(msg);
    else if (typeof qgNotify === 'function') qgNotify(msg);
    else alert(msg);
  }

  function showRoleError(error, mode, httpStatus) {
    var label = mode === 'tasker' || mode === 'worker' ? 'Tasker' : 'Poster';
    var msg = error === 'teen_poster_unavailable'
      ? 'Poster mode becomes available when you turn 18.'
      : (error === 'tasker_consent_required' || error === 'poster_consent_required'
        ? 'Agree to the required terms to enable ' + label + ' mode.'
        : (error === 'role_access_unavailable' || error === 'function_not_configured'
          ? 'Mode switching is temporarily unavailable. Please refresh and try again.'
          : 'Could not switch to ' + label + ' mode — ' + String(error || 'unknown_error') +
            (httpStatus ? ' (HTTP ' + httpStatus + ')' : '') + '.'));
    if (typeof showToast === 'function') showToast(msg, '#ef4444');
    else if (typeof qgNotify === 'function') qgNotify(msg, '#ef4444');
    else alert(msg);
  }

  // Workspace mode (poster/tasker) is local UI state only — never write to
  // users.role (that column holds privilege roles like admin).
  async function persistWorkspaceModeLocal(mode) {
    try {
      localStorage.setItem('qg-mode', mode === 'tasker' || mode === 'worker' ? 'tasker' : 'poster');
      localStorage.setItem('qg-session-mode', mode === 'tasker' || mode === 'worker' ? 'worker' : 'poster');
      // Legacy key — UI mode only, not users.role
      localStorage.setItem('qg-role', mode === 'tasker' || mode === 'worker' ? 'worker' : 'poster');
    } catch (e) {}
  }

  async function setQuickGigsMode(mode, options) {
    options = options || {};
    mode = (mode === 'worker' || mode === 'tasker') ? 'tasker' : 'poster';
    var current = getCurrentMode();
    if (mode === current && !options.force) return { changed: false, mode: mode };
    document.documentElement.classList.add('qg-role-transitioning');

    if (typeof window.QG_setActiveRoleMode === 'function') {
      var roleResult = await window.QG_setActiveRoleMode(mode);
      if (!roleResult.success) {
        document.documentElement.classList.remove('qg-role-transitioning');
        if (roleResult.error === mode + '_role_required' && typeof window.QG_offerRoleOptIn === 'function') {
          window.QG_offerRoleOptIn(mode);
        } else {
          showRoleError(roleResult.error, mode, roleResult.http_status);
        }
        return { changed: false, mode: current, error: roleResult.error };
      }
    } else if (typeof setMode === 'function') setMode(mode);
    else if (typeof setSessionMode === 'function') setSessionMode(mode === 'tasker' ? 'worker' : 'poster');
    else {
      await persistWorkspaceModeLocal(mode);
    }

    // Explicit: do NOT upsert users.role when flipping poster <-> tasker.

    if (typeof applyRoleTheme === 'function') applyRoleTheme();
    document.documentElement.setAttribute('data-mode', mode);
    if (typeof renderQuickGigsTabBar === 'function') {
      var active = document.querySelector('.tab-item.active');
      var activeId = 'home';
      if (active) {
        var label = (active.getAttribute('aria-label') || '').toLowerCase();
        if (label.indexOf('browse') >= 0) activeId = 'browse';
        else if (label.indexOf('post') >= 0 && label.indexOf('poster') < 0) activeId = 'post';
        else if (label.indexOf('job') >= 0) activeId = 'jobs';
        else if (label.indexOf('task') >= 0) activeId = mode === 'tasker' ? 'jobs' : 'tasks';
        else if (label.indexOf('message') >= 0) activeId = 'messages';
      }
      renderQuickGigsTabBar(activeId);
    }

    document.dispatchEvent(new CustomEvent('qg-mode-changed', { detail: { mode: mode } }));
    setTimeout(function () {
      document.documentElement.classList.remove('qg-role-transitioning');
    }, 260);

    if (options.toast !== false) showRoleToast(mode);

    // Prefer staying on the current page (user requirement). Only redirect if asked.
    if (options.redirect === 'dashboard') {
      window.location.href = 'dashboard.html';
      return { changed: true, mode: mode };
    }
    if (options.redirect === 'reload' || options.reload) {
      window.location.reload();
      return { changed: true, mode: mode };
    }
    if (typeof window.onQuickGigsModeChange === 'function') {
      try { window.onQuickGigsModeChange(mode); } catch (e) {}
    }
    return { changed: true, mode: mode };
  }

  function renderRoleFlip(containerId, options) {
    options = options || {};
    var el = document.getElementById(containerId);
    if (!el) return;
    var access = typeof window.QG_getRoleAccess === 'function' ? window.QG_getRoleAccess() : null;
    if (!access) {
      el.innerHTML = '<div class="qg-role-flip"><p class="qg-role-flip-note">Loading account modes…</p></div>';
      if (typeof window.QG_loadRoleAccess === 'function') {
        window.QG_loadRoleAccess(true).then(function () { renderRoleFlip(containerId, options); });
      }
      return;
    }
    var mode = getCurrentMode();
    var isWorker = mode === 'tasker';
    var both = access.is_tasker && access.is_poster && !access.is_teen;
    if (both) {
      el.innerHTML =
        '<div class="qg-role-flip" role="group" aria-label="Switch between Tasker and Poster mode">' +
          '<p class="qg-role-flip-kicker">Your QuickGigs mode</p>' +
          '<div class="qg-role-flip-track' + (isWorker ? ' is-worker' : '') + '">' +
            '<button type="button" class="qg-role-flip-opt' + (isWorker ? ' active' : '') + '" data-mode="tasker" aria-pressed="' + isWorker + '">' +
              '<span class="qg-role-flip-icon">💼</span><span class="qg-role-flip-label">Tasker</span><span class="qg-role-flip-desc">Find work</span>' +
            '</button>' +
            '<button type="button" class="qg-role-flip-opt' + (!isWorker ? ' active' : '') + '" data-mode="poster" aria-pressed="' + (!isWorker) + '">' +
              '<span class="qg-role-flip-icon">📋</span><span class="qg-role-flip-label">Poster</span><span class="qg-role-flip-desc">Post tasks</span>' +
            '</button>' +
            '<span class="qg-role-flip-slider" aria-hidden="true"></span>' +
          '</div>' +
          '<p class="qg-role-flip-note">Your navigation and accent change with the selected mode.</p>' +
        '</div>';
      el.querySelectorAll('.qg-role-flip-opt').forEach(function (btn) {
        btn.onclick = async function () {
          btn.disabled = true;
          try {
            await setQuickGigsMode(btn.getAttribute('data-mode'), { toast: true, redirect: 'dashboard' });
          } finally {
            if (btn.isConnected) btn.disabled = false;
          }
        };
      });
      return;
    }

    var canAddPoster = access.is_tasker && !access.is_poster && !access.is_teen;
    var addMode = canAddPoster ? 'poster' : 'tasker';
    var title = canAddPoster ? 'Become a Poster' : 'Start finding work';
    var description = canAddPoster
      ? 'Enable Poster mode to publish tasks and hire local taskers.'
      : 'Enable Tasker mode to browse gigs, apply, and earn.';
    if (access.is_teen && !access.is_poster) {
      title = 'Tasker account';
      description = 'Poster mode becomes available when you turn 18.';
    }
    el.innerHTML =
      '<div class="qg-role-flip qg-role-opt-in">' +
        '<p class="qg-role-flip-kicker">Your QuickGigs account</p>' +
        '<strong class="qg-role-opt-in-title">' + title + '</strong>' +
        '<p class="qg-role-flip-note">' + description + '</p>' +
        (access.is_teen ? '' : '<button type="button" class="qg-role-enable-btn" data-enable-role="' + addMode + '">' + title + '</button>') +
      '</div>';
    var enable = el.querySelector('[data-enable-role]');
    if (enable) enable.onclick = function () { offerRoleOptIn(enable.getAttribute('data-enable-role')); };
  }

  function offerRoleOptIn(mode) {
    mode = mode === 'poster' ? 'poster' : 'tasker';
    var access = typeof window.QG_getRoleAccess === 'function' ? window.QG_getRoleAccess() : null;
    // Already enabled → instant switch (no first-time screen).
    if (access && ((mode === 'poster' && access.is_poster) || (mode === 'tasker' && access.is_tasker))) {
      setQuickGigsMode(mode, { toast: true, redirect: 'dashboard' });
      return;
    }
    if (mode === 'poster' && access && access.is_teen) {
      var teenMessage = 'Poster mode becomes available when you turn 18.';
      if (typeof qgNotify === 'function') qgNotify(teenMessage, '#f59e0b');
      else if (typeof showToast === 'function') showToast(teenMessage);
      else alert(teenMessage);
      return;
    }
    var existing = document.getElementById('qgRoleOptInOverlay');
    if (existing) existing.remove();
    var overlay = document.createElement('div');
    overlay.id = 'qgRoleOptInOverlay';
    overlay.className = 'qg-role-opt-in-overlay open';
    var poster = mode === 'poster';
    var roleLabel = poster ? 'Poster' : 'Tasker';
    var points = poster
      ? [
          'Post local tasks in under a minute',
          'Review applicants and hire who you trust',
          'Pay securely — funds stay in escrow until the job is done'
        ]
      : [
          'Browse and apply to gigs near you',
          'Get paid through escrow when the poster confirms',
          'Build your rating and get hired again'
        ];
    var agreementHref = poster ? 'poster-terms.html' : 'contractor-agreement.html';
    var agreementName = poster ? 'Poster &amp; Payment Terms' : 'Independent Contractor Agreement';
    overlay.innerHTML =
      '<div class="qg-role-opt-in-dialog qg-role-first-enable" data-enable-role="' + mode + '" role="dialog" aria-modal="true" aria-labelledby="qgRoleOptInTitle">' +
        '<p class="qg-role-first-kicker">' + roleLabel + ' mode</p>' +
        '<h2 id="qgRoleOptInTitle">' + (poster ? 'Need something done?' : 'Want to earn from tasks?') + '</h2>' +
        '<p class="qg-role-first-sub">' + (poster
          ? 'Post tasks and hire taskers near you. Your poster profile is set up automatically.'
          : 'Apply to gigs near you and get paid for completed work. Your tasker profile is set up automatically.') + '</p>' +
        '<ul class="qg-role-first-points">' +
          points.map(function (p) { return '<li>' + p + '</li>'; }).join('') +
        '</ul>' +
        '<label class="qg-role-first-agree">' +
          '<input type="checkbox" data-role-agree>' +
          '<span>I agree to the QuickGigs <a href="terms.html" target="_blank" rel="noopener">Terms</a> AND the <a href="' + agreementHref + '" target="_blank" rel="noopener">' + agreementName + '</a>.</span>' +
        '</label>' +
        '<div class="qg-role-opt-in-actions">' +
          '<button type="button" data-role-cancel>Maybe later</button>' +
          '<button type="button" class="primary" data-role-confirm disabled>Enable ' + roleLabel + ' mode</button>' +
        '</div>' +
        '<p class="qg-role-opt-in-error" data-role-error role="alert" hidden></p>' +
      '</div>';
    document.body.appendChild(overlay);
    var agree = overlay.querySelector('[data-role-agree]');
    var confirmBtn = overlay.querySelector('[data-role-confirm]');
    function syncConfirm() {
      confirmBtn.disabled = !(agree && agree.checked);
    }
    agree.addEventListener('change', syncConfirm);
    syncConfirm();
    function close() { overlay.remove(); }
    overlay.onclick = function (e) { if (e.target === overlay) close(); };
    overlay.querySelector('[data-role-cancel]').onclick = close;
    confirmBtn.onclick = async function () {
      if (!agree.checked) return;
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Enabling…';
      var versions = (window.QG_CONFIG && window.QG_CONFIG.termsVersions) || {};
      var result = typeof window.QG_enableRole === 'function'
        ? await window.QG_enableRole(mode, {
            termsAccepted: true,
            tosVersion: versions.tos,
            agreementVersion: poster ? versions.posterPayment : versions.ica
          })
        : { success: false, error: 'role_access_unavailable' };
      if (!result.success) {
        var errorNode = overlay.querySelector('[data-role-error]');
        if (errorNode) {
          errorNode.hidden = false;
          errorNode.textContent = result.error === 'teen_poster_unavailable'
            ? 'Poster mode becomes available when you turn 18.'
            : (result.error === 'tasker_consent_required' || result.error === 'poster_consent_required'
              ? 'Please agree to the required terms to continue.'
              : (result.error === 'consent_schema_missing'
                ? 'Role consent is not set up on the server yet. Please try again shortly.'
                : 'Could not enable this mode — ' + String(result.error || 'unknown_error') +
                  (result.http_status ? ' (HTTP ' + result.http_status + ')' : '') + '.'));
        }
        confirmBtn.disabled = !agree.checked;
        confirmBtn.textContent = result.error === 'teen_poster_unavailable'
          ? 'Available when you turn 18'
          : 'Enable ' + roleLabel + ' mode';
        return;
      }
      close();
      document.documentElement.setAttribute('data-mode', mode);
      if (typeof applyRoleTheme === 'function') applyRoleTheme();
      showRoleToast(mode);
      setTimeout(function () { window.location.href = 'dashboard.html'; }, 180);
    };
  }

  function buildDashboardHero(data) {
    data = data || {};
    var isPoster = data.isPoster !== false;
    var cityRaw = data.city || 'Calgary';
    var city = typeof escapeHtml === 'function'
      ? escapeHtml(cityRaw)
      : String(cityRaw).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    var html = '';

    if (isPoster) {
      var pending = data.pendingApplicants || 0;
      var inProg = data.inProgressPosted || 0;
      var mobilePoster = !!data.mobilePoster;
      if (mobilePoster) {
        /* Mobile poster: always show the prominent post card (toggle covers mode switch). */
        html = '<a class="dash-hero dash-hero-primary dash-hero-mobile-post" href="posttask.html">' +
          '<span class="dash-hero-emoji" aria-hidden="true">✨</span>' +
          '<span class="dash-hero-body">' +
            '<strong>Post a task in under a minute</strong>' +
            '<span>Get help near ' + city + ' — errands, home, tutoring & more</span>' +
          '</span>' +
          '<span class="dash-hero-cta">Post a task →</span></a>';
        return html;
      }
      if (pending > 0) {
        html = '<a class="dash-hero dash-hero-pulse" href="mytasks.html?tab=posted&applicants=1">' +
          '<span class="dash-hero-emoji">👥</span>' +
          '<span class="dash-hero-body">' +
            '<strong>' + pending + ' applicant' + (pending !== 1 ? 's' : '') + ' waiting</strong>' +
            '<span>Review and accept a tasker for your open tasks</span>' +
          '</span>' +
          '<span class="dash-hero-cta">Review →</span></a>';
      } else if (inProg > 0) {
        html = '<a class="dash-hero" href="mytasks.html?tab=inprogress">' +
          '<span class="dash-hero-emoji">⏳</span>' +
          '<span class="dash-hero-body">' +
            '<strong>' + inProg + ' task' + (inProg !== 1 ? 's' : '') + ' in progress</strong>' +
            '<span>Message your tasker or mark complete when done</span>' +
          '</span>' +
          '<span class="dash-hero-cta">Open →</span></a>';
      } else {
        html = '<a class="dash-hero dash-hero-primary" href="posttask.html">' +
          '<span class="dash-hero-emoji">✨</span>' +
          '<span class="dash-hero-body">' +
            '<strong>Post a task in under a minute</strong>' +
            '<span>Get help near ' + city + ' — errands, home, tutoring & more</span>' +
          '</span>' +
          '<span class="dash-hero-cta">Post →</span></a>';
      }
    } else {
      var nearby = data.openNearby || 0;
      var workerInProg = data.workerInProgress || 0;
      if (workerInProg > 0) {
        html = '<a class="dash-hero" href="mytasks.html?tab=inprogress">' +
          '<span class="dash-hero-emoji">💼</span>' +
          '<span class="dash-hero-body">' +
            '<strong>' + workerInProg + ' active task' + (workerInProg !== 1 ? 's' : '') + '</strong>' +
            '<span>Check messages and mark complete when you\'re done</span>' +
          '</span>' +
          '<span class="dash-hero-cta">My gigs →</span></a>';
      } else if (nearby > 0) {
        html = '<a class="dash-hero dash-hero-primary" href="browsetask.html">' +
          '<span class="dash-hero-emoji">🔍</span>' +
          '<span class="dash-hero-body">' +
            '<strong>' + nearby + ' task' + (nearby !== 1 ? 's' : '') + ' near ' + city + '</strong>' +
            '<span>Apply with your offer — posters review applicants here</span>' +
          '</span>' +
          '<span class="dash-hero-cta">Browse →</span></a>';
      } else {
        html = '<a class="dash-hero" href="profile.html">' +
          '<span class="dash-hero-emoji">✨</span>' +
          '<span class="dash-hero-body">' +
            '<strong>Stand out to posters</strong>' +
            '<span>Add a photo, bio, and skills on your profile to get hired</span>' +
          '</span>' +
          '<span class="dash-hero-cta">Profile →</span></a>';
      }
    }

    var access = typeof window.QG_getRoleAccess === 'function' ? window.QG_getRoleAccess() : null;
    if (access && access.is_teen && !isPoster) return html;
    var targetMode = isPoster ? 'tasker' : 'poster';
    var hasTarget = !access || (targetMode === 'tasker' ? access.is_tasker : access.is_poster);
    var switchLabel = hasTarget
      ? (isPoster ? 'Switch to Tasker mode →' : 'Switch to Poster mode →')
      : (isPoster ? 'Start finding work →' : 'Become a Poster →');
    var switchAction = hasTarget
      ? 'typeof switchToRoleMode===\'function\'&&switchToRoleMode(\'' + targetMode + '\')'
      : 'typeof QG_offerRoleOptIn===\'function\'&&QG_offerRoleOptIn(\'' + targetMode + '\')';
    return html +
      '<p class="dash-hero-switch">' +
      '<button type="button" class="dash-hero-switch-btn" onclick="' + switchAction + '">' +
      switchLabel + '</button></p>';
  }

  window.getQuickGigsMode = getCurrentMode;
  window.setQuickGigsMode = setQuickGigsMode;
  window.renderRoleFlip = renderRoleFlip;
  window.buildDashboardHero = buildDashboardHero;
  window.QG_offerRoleOptIn = offerRoleOptIn;
  document.addEventListener('qg-role-access-changed', function () {
    if (document.getElementById('roleFlipMount')) renderRoleFlip('roleFlipMount');
  });
})();
