/* QuickGigs — poster / tasker role switch (Profile + quick actions) */
(function () {
  function getCurrentMode() {
    return typeof getSessionMode === 'function' ? getSessionMode() : 'poster';
  }

  function isPosterMode() {
    return getCurrentMode() !== 'worker';
  }

  function showRoleToast(mode) {
    var label = mode === 'worker' ? 'Tasker' : 'Poster';
    var msg = mode === 'worker'
      ? "You're in Tasker mode — browse gigs and apply."
      : "You're in Poster mode — post tasks and hire.";
    if (typeof showToast === 'function') showToast(msg);
    else alert(msg);
  }

  async function persistRoleToDb(mode) {
    var user = window._currentUser;
    if (!user || typeof upsertUserProfile !== 'function') return;
    try {
      await upsertUserProfile({
        name: user.displayName || (user.email ? user.email.split('@')[0] : ''),
        email: user.email || '',
        firebase_uid: user.uid,
        role: mode === 'worker' ? 'worker' : 'poster'
      });
    } catch (e) {
      console.warn('Role sync skipped:', e);
    }
  }

  async function setQuickGigsMode(mode, options) {
    options = options || {};
    mode = mode === 'worker' ? 'worker' : 'poster';
    var current = getCurrentMode();
    if (mode === current && !options.force) return { changed: false, mode: mode };

    if (typeof setSessionMode === 'function') setSessionMode(mode);
    else localStorage.setItem('qg-session-mode', mode);
    localStorage.setItem('qg-role', mode);

    await persistRoleToDb(mode);

    if (typeof applyRoleTheme === 'function') applyRoleTheme();
    if (typeof renderQuickGigsTabBar === 'function') {
      var active = document.querySelector('.tab-item.active');
      var activeId = active && active.getAttribute('aria-label')
        ? active.getAttribute('aria-label').toLowerCase()
        : 'home';
      if (activeId.indexOf('browse') >= 0) activeId = 'browse';
      else if (activeId.indexOf('post') >= 0) activeId = 'post';
      else if (activeId.indexOf('task') >= 0 || activeId.indexOf('job') >= 0) activeId = 'tasks';
      else if (activeId.indexOf('message') >= 0) activeId = 'messages';
      else activeId = 'home';
      renderQuickGigsTabBar(activeId === 'home' ? 'home' : activeId);
    }

    document.dispatchEvent(new CustomEvent('qg-mode-changed', { detail: { mode: mode } }));

    if (options.toast !== false) showRoleToast(mode);

    if (options.redirect === 'dashboard') {
      window.location.href = 'dashboard.html?mode=' + mode;
      return { changed: true, mode: mode };
    }
    if (options.redirect === 'reload') {
      window.location.reload();
      return { changed: true, mode: mode };
    }
    return { changed: true, mode: mode };
  }

  function renderRoleFlip(containerId, options) {
    options = options || {};
    var el = document.getElementById(containerId);
    if (!el) return;
    var mode = getCurrentMode();
    var isWorker = mode === 'worker';

    el.innerHTML =
      '<div class="qg-role-flip" role="group" aria-label="Switch between Poster and Tasker mode">' +
        '<p class="qg-role-flip-kicker">How you use QuickGigs</p>' +
        '<div class="qg-role-flip-track' + (isWorker ? ' is-worker' : '') + '">' +
          '<button type="button" class="qg-role-flip-opt' + (!isWorker ? ' active' : '') + '" data-mode="poster" aria-pressed="' + (!isWorker) + '">' +
            '<span class="qg-role-flip-icon">📋</span>' +
            '<span class="qg-role-flip-label">I need help</span>' +
            '<span class="qg-role-flip-desc">Post & hire</span>' +
          '</button>' +
          '<button type="button" class="qg-role-flip-opt' + (isWorker ? ' active' : '') + '" data-mode="worker" aria-pressed="' + isWorker + '">' +
            '<span class="qg-role-flip-icon">💼</span>' +
            '<span class="qg-role-flip-label">I\'m available</span>' +
            '<span class="qg-role-flip-desc">Browse & apply</span>' +
          '</button>' +
          '<span class="qg-role-flip-slider" aria-hidden="true"></span>' +
        '</div>' +
        '<p class="qg-role-flip-note">Same account — switch anytime. Taskers need a profile photo to apply.</p>' +
      '</div>';

    el.querySelectorAll('.qg-role-flip-opt').forEach(function (btn) {
      btn.onclick = function () {
        var next = btn.getAttribute('data-mode');
        setQuickGigsMode(next, { toast: true }).then(function () {
          renderRoleFlip(containerId, options);
        });
      };
    });
  }

  function buildDashboardHero(data) {
    data = data || {};
    var isPoster = data.isPoster !== false;
    var city = data.city || 'Calgary';
    var html = '';

    if (isPoster) {
      var pending = data.pendingApplicants || 0;
      var inProg = data.inProgressPosted || 0;
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
            '<strong>' + workerInProg + ' active job' + (workerInProg !== 1 ? 's' : '') + '</strong>' +
            '<span>Check messages and mark complete when you\'re done</span>' +
          '</span>' +
          '<span class="dash-hero-cta">My jobs →</span></a>';
      } else if (nearby > 0) {
        html = '<a class="dash-hero dash-hero-primary" href="browsetask.html">' +
          '<span class="dash-hero-emoji">🔍</span>' +
          '<span class="dash-hero-body">' +
            '<strong>' + nearby + ' gig' + (nearby !== 1 ? 's' : '') + ' near ' + city + '</strong>' +
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

    return html +
      '<p class="dash-hero-switch">Using QuickGigs as a ' + (isPoster ? 'Poster' : 'Tasker') +
      '? <a href="profile.html#roleSwitch">Switch mode in Profile</a></p>';
  }

  window.getQuickGigsMode = getCurrentMode;
  window.setQuickGigsMode = setQuickGigsMode;
  window.renderRoleFlip = renderRoleFlip;
  window.buildDashboardHero = buildDashboardHero;
})();
