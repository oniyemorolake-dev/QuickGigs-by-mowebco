// QuickGigs — role-based navigation (poster vs tasker). Canonical mode: localStorage qg-mode.
(function () {
  var NAV = {
    poster: [
      { id: 'home', href: 'dashboard.html', icon: 'home', label: 'Home' },
      { id: 'tasks', href: 'mytasks.html?tab=posted', icon: 'clipboard', label: 'My Tasks' },
      { id: 'applicants', href: 'mytasks.html?tab=posted&applicants=1', icon: 'users', label: 'Applicants' },
      { id: 'messages', href: 'messages.html', icon: 'message', label: 'Messages' }
    ],
    worker: [
      { id: 'home', href: 'dashboard.html', icon: 'home', label: 'Home' },
      { id: 'browse', href: 'browsetask.html', icon: 'search', label: 'Browse' },
      { id: 'jobs', href: 'mytasks.html?tab=applied', icon: 'briefcase', label: 'My Jobs' },
      { id: 'messages', href: 'messages.html', icon: 'message', label: 'Messages' }
    ]
  };
  var roleUnreadCounts = { tasker: 0, poster: 0 };

  function navIconHtml(name) {
    if (typeof window.qgIcon === 'function') return window.qgIcon(name, { size: 22 });
    return '';
  }

  function normalizeMode(mode) {
    if (mode === 'worker' || mode === 'tasker') return 'tasker';
    return 'poster';
  }

  /** Canonical role mode: 'poster' | 'tasker' — only default lives here */
  function getMode() {
    try {
      var raw = localStorage.getItem('qg-mode');
      if (raw === 'light' || raw === 'dark') {
        try {
          if (!localStorage.getItem('qg-theme')) localStorage.setItem('qg-theme', raw);
        } catch (e1) {}
        raw = null;
      }
      if (raw === 'tasker' || raw === 'worker') return 'tasker';
      if (raw === 'poster') return 'poster';
      var legacy = localStorage.getItem('qg-session-mode') || localStorage.getItem('qg-role');
      var migrated = normalizeMode(legacy);
      try { localStorage.setItem('qg-mode', migrated); } catch (e2) {}
      return migrated;
    } catch (e) {
      return 'poster';
    }
  }

  function setMode(m) {
    var mode = normalizeMode(m);
    try {
      localStorage.setItem('qg-mode', mode);
      localStorage.setItem('qg-session-mode', mode === 'tasker' ? 'worker' : 'poster');
      localStorage.setItem('qg-role', mode === 'tasker' ? 'worker' : 'poster');
    } catch (e) {}
    return mode;
  }

  // Legacy API — do not read URL (that was resetting mode on navigation)
  function getSessionMode() {
    return getMode() === 'tasker' ? 'worker' : 'poster';
  }

  function setSessionMode(mode) {
    setMode(mode);
    return getSessionMode();
  }

  function isWorkerMode() {
    return getMode() === 'tasker';
  }

  function isPosterMode() {
    return getMode() === 'poster';
  }

  function cssMode() {
    return isWorkerMode() ? 'worker' : 'poster';
  }

  function showModeFeedback(message, isError) {
    if (!message) return;
    if (typeof window.showToast === 'function') {
      window.showToast(message, isError ? '#ef4444' : undefined);
    } else if (typeof window.qgNotify === 'function') {
      window.qgNotify(message, isError ? '#ef4444' : undefined);
    } else {
      window.alert(message);
    }
  }

  function roleSwitchErrorMessage(error, mode, httpStatus) {
    var label = mode === 'poster' ? 'Poster' : 'Tasker';
    if (error === 'teen_poster_unavailable') return 'Poster mode becomes available when you turn 18.';
    if (error === 'firebase_auth_required' || error === 'missing_authorization') return 'Please sign in again to switch modes.';
    if (error === 'role_access_unavailable' || error === 'function_not_configured') {
      return 'Mode switching is temporarily unavailable. Please refresh and try again.';
    }
    return 'Could not switch to ' + label + ' mode — ' + String(error || 'unknown_error') +
      (httpStatus ? ' (HTTP ' + httpStatus + ')' : '') + '.';
  }

  async function switchToRoleMode(next) {
    next = normalizeMode(next);
    var state = typeof window.QG_loadRoleAccess === 'function'
      ? await window.QG_loadRoleAccess(true)
      : (typeof window.QG_getRoleAccess === 'function' ? window.QG_getRoleAccess() : null);
    console.info('[QuickGigs mode toggle] account roles', {
      is_tasker: !!(state && state.is_tasker),
      is_poster: !!(state && state.is_poster),
      requested_mode: next,
      active_mode: getMode()
    });
    var allowed = state
      ? (next === 'poster' ? state.is_poster === true : state.is_tasker === true)
      : null;
    if (allowed === false) {
      if (typeof window.QG_offerRoleOptIn === 'function') {
        window.QG_offerRoleOptIn(next);
      } else {
        showModeFeedback(
          (next === 'poster' ? 'Poster' : 'Tasker') + ' mode is not enabled yet. Open your profile to enable it.',
          false
        );
        setTimeout(function () { window.location.href = 'profile.html#roleFlipMount'; }, 900);
      }
      return { success: false, error: next + '_role_required' };
    }
    if (!state || typeof window.QG_setActiveRoleMode !== 'function') {
      var unavailable = 'role_access_unavailable';
      showModeFeedback(roleSwitchErrorMessage(unavailable, next), true);
      return { success: false, error: unavailable };
    }
    if (getMode() === next) {
      setMode(next);
      applyRoleTheme();
      showModeFeedback("You're already in " + (next === 'poster' ? 'Poster' : 'Tasker') + ' mode.', false);
      setTimeout(function () { window.location.href = 'dashboard.html'; }, 180);
      return { success: true, mode: next, unchanged: true };
    }
    document.documentElement.classList.add('qg-role-transitioning');
    var result = await window.QG_setActiveRoleMode(next);
    if (!result.success) {
      document.documentElement.classList.remove('qg-role-transitioning');
      if (result.error === next + '_role_required') {
        if (typeof window.QG_offerRoleOptIn === 'function') window.QG_offerRoleOptIn(next);
        else showModeFeedback((next === 'poster' ? 'Poster' : 'Tasker') + ' mode must be enabled first.', false);
        return result;
      }
      showModeFeedback(roleSwitchErrorMessage(result.error, next, result.http_status), true);
      return result;
    }
    setMode(next);
    applyRoleTheme();
    document.documentElement.setAttribute('data-mode', next);
    document.dispatchEvent(new CustomEvent('qg-mode-changed', { detail: { mode: next } }));
    showModeFeedback("Switched to " + (next === 'poster' ? 'Poster' : 'Tasker') + ' mode.', false);
    setTimeout(function () {
      document.documentElement.classList.remove('qg-role-transitioning');
      window.location.href = 'dashboard.html';
    }, 260);
    return result;
  }

  function switchRoleMode() {
    return switchToRoleMode(isWorkerMode() ? 'poster' : 'tasker');
  }

  function renderHeaderRoleToggle() {
    var state = typeof window.QG_getRoleAccess === 'function' ? window.QG_getRoleAccess() : null;
    document.querySelectorAll('.qg-header-role-toggle').forEach(function (el) { el.remove(); });
    var hasBoth = !!(state && state.is_tasker && state.is_poster && !state.is_teen);
    document.querySelectorAll('#roleSwitchBtn,[onclick*="switchRoleMode"]').forEach(function (el) {
      if (!el.classList.contains('qg-header-role-opt')) el.style.display = hasBoth ? 'none' : 'none';
    });
    if (!state || (!state.is_tasker && !state.is_poster)) return;
    document.querySelectorAll('.nav').forEach(function (nav) {
      var host = nav.querySelector('.nav-right') || nav;
      var current = getMode();
      var toggle = document.createElement('div');
      toggle.className = 'qg-header-role-toggle';
      toggle.setAttribute('data-tasker-enabled', String(state.is_tasker === true));
      toggle.setAttribute('data-poster-enabled', String(state.is_poster === true));
      toggle.setAttribute('role', 'group');
      toggle.setAttribute('aria-label', 'Current QuickGigs mode');
      var taskerAvailable = state.is_tasker === true;
      var posterVisible = state.is_teen !== true;
      var posterAvailable = state.is_poster === true;
      toggle.style.gridTemplateColumns = posterVisible ? '1fr 1fr' : '1fr';
      toggle.innerHTML =
        '<button type="button" class="qg-header-role-opt' + (current === 'tasker' ? ' active' : '') +
          (taskerAvailable ? '' : ' is-unavailable') + '" data-role-mode="tasker" aria-pressed="' +
          (current === 'tasker') + '" aria-disabled="' + (!taskerAvailable) + '">Tasker</button>' +
        (posterVisible
          ? '<button type="button" class="qg-header-role-opt' + (current === 'poster' ? ' active' : '') +
            (posterAvailable ? '' : ' is-unavailable') + '" data-role-mode="poster" aria-pressed="' +
            (current === 'poster') + '" aria-disabled="' + (!posterAvailable) + '">Poster</button>'
          : '');
      toggle.querySelectorAll('[data-role-mode]').forEach(function (btn) {
        btn.onclick = async function () {
          var target = btn.getAttribute('data-role-mode');
          var available = target === 'poster' ? posterAvailable : taskerAvailable;
          if (!available && typeof window.QG_offerRoleOptIn === 'function') {
            window.QG_offerRoleOptIn(target);
            return;
          }
          btn.disabled = true;
          btn.classList.add('is-switching');
          try {
            await switchToRoleMode(target);
          } catch (err) {
            console.error('[QuickGigs mode toggle] click failed', err);
            showModeFeedback('Mode switching failed. Please refresh and try again.', true);
          } finally {
            if (btn && btn.isConnected) {
              btn.disabled = false;
              btn.classList.remove('is-switching');
            }
          }
        };
      });
      host.insertBefore(toggle, host.firstChild);
    });
    paintRoleUnreadIndicators();
  }

  function paintRoleUnreadIndicators() {
    var current = getMode();
    document.querySelectorAll('.qg-header-role-opt[data-role-mode]').forEach(function (btn) {
      var mode = btn.getAttribute('data-role-mode');
      var count = Number(roleUnreadCounts[mode] || 0);
      var show = mode !== current && count > 0;
      btn.classList.toggle('has-mode-unread', show);
      var dot = btn.querySelector('.qg-role-unread-dot');
      if (!dot) {
        dot = document.createElement('span');
        dot.className = 'qg-role-unread-dot';
        dot.setAttribute('aria-hidden', 'true');
        btn.appendChild(dot);
      }
      dot.hidden = !show;
      btn.setAttribute('aria-label', show
        ? (mode === 'poster' ? 'Poster' : 'Tasker') + ', ' + count + ' unread messages'
        : (mode === 'poster' ? 'Poster' : 'Tasker'));
    });
  }

  function getThemeMode() {
    // Visual chrome follows stored role only — never invent mode from page path
    return cssMode();
  }

  function applyNavBrand() {
    document.querySelectorAll('.nav').forEach(function (nav) {
      var logo = nav.querySelector(':scope > .nav-logo');
      if (logo && !logo.closest('.nav-brand')) {
        var wrap = document.createElement('div');
        wrap.className = 'nav-brand';
        logo.parentNode.insertBefore(wrap, logo);
        wrap.appendChild(logo);
        var role = document.createElement('span');
        role.className = 'nav-role';
        wrap.appendChild(role);
      }
    });
    if (typeof window.QG_applyModeChrome === 'function') window.QG_applyModeChrome();
    else if (typeof window.QG_applyRoleLabels === 'function') window.QG_applyRoleLabels();
    else {
      var label = isWorkerMode() ? 'TASKER' : 'POSTER';
      document.querySelectorAll('.nav-role').forEach(function (el) { el.textContent = label; });
    }
    renderHeaderRoleToggle();
    document.querySelectorAll('[data-qg-mode-tag]').forEach(function (el) {
      el.textContent = isWorkerMode() ? 'Tasker mode' : 'Poster mode';
      el.classList.toggle('tag-worker', isWorkerMode());
      el.classList.toggle('tag-poster', !isWorkerMode());
    });
  }

  function applyRoleTheme() {
    var mode = cssMode();
    if (document.body && document.body.classList) {
      document.body.classList.toggle('qg-mode-worker', mode === 'worker');
      document.body.classList.toggle('qg-mode-poster', mode === 'poster');
    }
    if (document.documentElement) {
      document.documentElement.setAttribute('data-qg-mode', mode);
      document.documentElement.setAttribute('data-mode', mode === 'worker' ? 'tasker' : 'poster');
    }
    applyNavBrand();
  }

  function renderQuickGigsTabBar(activeId) {
    var bar = document.getElementById('qgTabBar');
    if (!bar) return;
    var mode = getSessionMode();
    var items = NAV[mode] || NAV.poster;
    bar.innerHTML = items.map(function (item) {
      var cls = item.id === activeId ? 'tab-item active' : 'tab-item';
      var unreadBadge = item.id === 'messages'
        ? '<span class="tab-unread-badge" id="qgMsgUnreadBadge" aria-hidden="true"></span>'
        : '';
      return '<a class="' + cls + '" href="' + item.href + '" aria-label="' + item.label + '">' +
        '<span class="tab-icon" aria-hidden="true">' + navIconHtml(item.icon) + '</span>' +
        unreadBadge +
        '<span class="tab-lbl">' + item.label + '</span></a>';
    }).join('');
    applyRoleTheme();
    refreshMessagesUnreadBadge();
    // Icons may load after nav — refresh once if needed
    if (typeof window.qgIcon !== 'function') {
      setTimeout(function () {
        if (typeof window.qgIcon === 'function') renderQuickGigsTabBar(activeId);
      }, 50);
    }
  }

  function refreshMessagesUnreadBadge() {
    var badge = document.getElementById('qgMsgUnreadBadge');
    var link = badge && badge.closest('.tab-item');
    var toggles = document.querySelectorAll('.qg-header-role-opt[data-role-mode]');
    if ((!badge || !link) && !toggles.length) return;
    var user = window._currentUser;
    if (!user || typeof getConversationsForUser !== 'function') return;
    getConversationsForUser(user.uid).then(function (rows) {
      var counts = { tasker: 0, poster: 0 };
      (rows || []).forEach(function (conv) {
        var iAmPoster = String(conv.poster_id) === String(user.uid);
        var iAmTasker = String(conv.worker_id) === String(user.uid);
        if (!iAmPoster && !iAmTasker) return;
        var side = iAmPoster ? 'poster' : 'tasker';
        // Active chat thread — treat as read
        try {
          var openConv = new URLSearchParams(window.location.search).get('conv');
          if (openConv && String(openConv) === String(conv.conv_id) &&
              /(?:chat|messages)\.html$/i.test(location.pathname.split('/').pop() || '')) {
            return;
          }
        } catch (eOpen) {}
        var lastRead = iAmPoster ? conv.poster_last_read_at : conv.worker_last_read_at;
        var sentByMe = conv.last_sender_id && String(conv.last_sender_id) === String(user.uid);
        if (!sentByMe && conv.last_message_at &&
            (!lastRead || new Date(conv.last_message_at) > new Date(lastRead))) {
          counts[side] += 1;
        }
      });
      roleUnreadCounts = counts;
      paintRoleUnreadIndicators();
      var n = counts[getMode()] || 0;
      if (!badge || !link) return;
      if (n > 0) {
        badge.textContent = n > 99 ? '99+' : String(n);
        link.classList.add('has-unread');
        link.setAttribute('aria-label', 'Messages, ' + n + ' unread');
      } else {
        badge.textContent = '';
        link.classList.remove('has-unread');
        link.setAttribute('aria-label', 'Messages');
      }
    }).catch(function () {});
  }

  // Refresh badge when returning to the tab / focusing the app
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refreshMessagesUnreadBadge();
  });
  window.addEventListener('focus', function () {
    refreshMessagesUnreadBadge();
  });

  function initRoleThemeEarly() {
    applyRoleTheme();
  }

  function applyMyTasksTabsForMode(options) {
    options = options || {};
    var isWorker = isWorkerMode();

    document.documentElement.setAttribute('data-qg-mode', isWorker ? 'worker' : 'poster');

    var postedEl = document.getElementById('tabPosted');
    var appliedEl = document.getElementById('tabApplied');
    if (postedEl) {
      postedEl.hidden = isWorker;
      postedEl.style.display = isWorker ? 'none' : '';
    }
    if (appliedEl) {
      appliedEl.hidden = !isWorker;
      appliedEl.style.display = isWorker ? '' : 'none';
    }

    var titleEl = document.querySelector('.nav-title');
    if (titleEl) titleEl.textContent = isWorker ? 'My gigs' : 'My posted tasks';
  }

  function defaultMyTasksTab() {
    return isWorkerMode() ? 'applied' : 'posted';
  }

  function normalizeMyTasksTab(tab) {
    var allowed = isWorkerMode()
      ? { applied: 1, inprogress: 1, completed: 1 }
      : { posted: 1, inprogress: 1, completed: 1 };
    return allowed[tab] ? tab : defaultMyTasksTab();
  }

  function roleGateHtml(opts) {
    opts = opts || {};
    var targetMode = opts.targetMode === 'poster' ? 'poster' : 'tasker';
    var label = targetMode === 'tasker' ? 'Tasker' : 'Poster';
    var allowed = typeof window.QG_canUseRole === 'function' ? window.QG_canUseRole(targetMode) : null;
    var actionLabel = allowed === false ? 'Enable ' + label + ' mode' : 'Switch to ' + label + ' mode';
    var action = allowed === false
      ? 'typeof QG_offerRoleOptIn===\'function\'&&QG_offerRoleOptIn(\'' + targetMode + '\')'
      : 'typeof switchToRoleMode===\'function\'&&switchToRoleMode(\'' + targetMode + '\')';
    var ico = typeof window.qgIcon === 'function'
      ? window.qgIcon(opts.iconName || 'refresh', { size: 24 })
      : '';
    return '<div class="empty-state" style="text-align:center;padding:48px 20px">' +
      '<div class="empty-icon">' + ico + '</div>' +
      '<div class="empty-title">' + (opts.title || ('Switch to ' + label + ' mode')) + '</div>' +
      '<div class="empty-sub">' + (opts.sub || '') + '</div>' +
      '<button type="button" class="empty-btn" onclick="' + action + '">' + actionLabel + '</button>' +
      '</div>';
  }

  window.getMode = getMode;
  window.setMode = setMode;
  window.getSessionMode = getSessionMode;
  window.setSessionMode = setSessionMode;
  window.isWorkerMode = isWorkerMode;
  window.isPosterMode = isPosterMode;
  window.switchRoleMode = switchRoleMode;
  window.switchToRoleMode = switchToRoleMode;
  window.renderQuickGigsTabBar = renderQuickGigsTabBar;
  window.refreshMessagesUnreadBadge = refreshMessagesUnreadBadge;
  window.applyMyTasksTabsForMode = applyMyTasksTabsForMode;
  window.defaultMyTasksTab = defaultMyTasksTab;
  window.normalizeMyTasksTab = normalizeMyTasksTab;
  window.roleGateHtml = roleGateHtml;
  window.applyRoleTheme = applyRoleTheme;
  window.applyNavBrand = applyNavBrand;
  window.getThemeMode = getThemeMode;
  initRoleThemeEarly();

  var mobileScript = document.createElement('script');
  mobileScript.src = 'qg-mobile.js?v=20260726n';
  mobileScript.defer = true;
  document.head.appendChild(mobileScript);

  var menuScript = document.createElement('script');
  menuScript.src = 'qg-menu.js?v=5';
  menuScript.defer = true;
  document.head.appendChild(menuScript);

  if (!document.querySelector('script[src*="qg-role-access.js"]')) {
    var roleAccessScript = document.createElement('script');
    roleAccessScript.src = 'qg-role-access.js?v=20260803role1';
    roleAccessScript.async = false;
    roleAccessScript.defer = true;
    document.head.appendChild(roleAccessScript);
  }
  if (!document.querySelector('script[src*="qg-role-switch.js"]')) {
    var roleSwitchScript = document.createElement('script');
    roleSwitchScript.src = 'qg-role-switch.js?v=20260803role1';
    roleSwitchScript.async = false;
    roleSwitchScript.defer = true;
    document.head.appendChild(roleSwitchScript);
  }

  document.addEventListener('qg-role-access-changed', function () {
    applyRoleTheme();
    var bar = document.getElementById('qgTabBar');
    if (bar) {
      var active = bar.querySelector('.tab-item.active');
      var label = active && active.getAttribute('aria-label')
        ? active.getAttribute('aria-label').toLowerCase()
        : '';
      var activeId = label.indexOf('browse') >= 0 ? 'browse'
        : label.indexOf('job') >= 0 ? 'jobs'
        : label.indexOf('applicant') >= 0 ? 'applicants'
        : label.indexOf('task') >= 0 ? 'tasks'
        : label.indexOf('message') >= 0 ? 'messages'
        : label.indexOf('post') >= 0 ? 'post'
        : 'home';
      renderQuickGigsTabBar(activeId);
    }
  });

  var bellScript = document.createElement('script');
  bellScript.src = 'qg-bell.js?v=20260811notif1';
  bellScript.defer = true;
  document.head.appendChild(bellScript);

  var gateScript = document.createElement('script');
  gateScript.src = 'qg-admin-gate.js?v=1';
  gateScript.defer = true;
  document.head.appendChild(gateScript);

  var announceScript = document.createElement('script');
  announceScript.src = 'qg-announcement.js?v=6';
  announceScript.defer = true;
  document.head.appendChild(announceScript);
})();
