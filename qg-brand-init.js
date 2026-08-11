/* QuickGigs — set mode + nav role label before paint (no URL/page forced flips) */
(function () {
  function normalizeRoleMode(m) {
    if (m === 'worker' || m === 'tasker') return 'tasker';
    if (m === 'poster') return 'poster';
    return null;
  }

  function migrateRoleIntoQgMode() {
    try {
      var raw = localStorage.getItem('qg-mode');
      // Theme leftover — qg-theme.js migrates this; treat as unset for role
      if (raw === 'light' || raw === 'dark') raw = null;
      var normalized = normalizeRoleMode(raw);
      if (normalized) return normalized;
      var old = localStorage.getItem('qg-session-mode') || localStorage.getItem('qg-role');
      normalized = normalizeRoleMode(old) || 'poster';
      localStorage.setItem('qg-mode', normalized);
      return normalized;
    } catch (e) {
      return 'poster';
    }
  }

  function getMode() {
    try {
      var raw = localStorage.getItem('qg-mode');
      if (raw === 'light' || raw === 'dark') return migrateRoleIntoQgMode();
      var n = normalizeRoleMode(raw);
      if (n) return n;
      return migrateRoleIntoQgMode();
    } catch (e) {
      return 'poster';
    }
  }

  function setMode(m) {
    var mode = normalizeRoleMode(m) || 'poster';
    try {
      localStorage.setItem('qg-mode', mode);
      // Keep legacy keys in sync for older code paths (worker = tasker)
      localStorage.setItem('qg-session-mode', mode === 'tasker' ? 'worker' : 'poster');
      localStorage.setItem('qg-role', mode === 'tasker' ? 'worker' : 'poster');
    } catch (e) {}
    document.documentElement.setAttribute('data-qg-mode', cssMode(mode));
    document.documentElement.setAttribute('data-mode', mode);
    if (document.body) applyRoleLabels();
    return mode;
  }

  function roleLabel(mode) {
    return (mode || getMode()) === 'tasker' ? 'Tasker' : 'Poster';
  }

  // CSS still uses worker|poster on data-qg-mode
  function cssMode(mode) {
    return (mode || getMode()) === 'tasker' ? 'worker' : 'poster';
  }

  var mode = getMode();
  document.documentElement.setAttribute('data-qg-mode', cssMode(mode));
  document.documentElement.setAttribute('data-mode', mode);

  function applyRoleLabels() {
    var activeMode = getMode();
    document.querySelectorAll('.nav-role').forEach(function (el) {
      el.textContent = roleLabel(activeMode);
    });
    document.querySelectorAll('.qg-mode-banner').forEach(function (el) {
      el.textContent = activeMode === 'tasker' ? "You're in Tasker mode" : "You're in Poster mode";
      el.setAttribute('data-mode', activeMode);
    });
  }

  function applyModeChrome() {
    var activeMode = getMode();
    document.documentElement.setAttribute('data-qg-mode', cssMode(activeMode));
    document.documentElement.setAttribute('data-mode', activeMode);

    var nav = document.querySelector('nav.nav, .nav');
    if (nav) {
      var brand = nav.querySelector('.nav-brand');
      var logo = nav.querySelector(':scope > .nav-logo');
      if (!brand && logo) {
        brand = document.createElement('div');
        brand.className = 'nav-brand';
        logo.parentNode.insertBefore(brand, logo);
        brand.appendChild(logo);
      }
      if (brand && !brand.querySelector('.nav-role')) {
        var role = document.createElement('span');
        role.className = 'nav-role';
        brand.appendChild(role);
      }
    }

    /* Exactly one mode banner app-wide (re-runs used to duplicate when
       something else inserted itself between .nav and the banner). */
    var banners = Array.prototype.slice.call(document.querySelectorAll('.qg-mode-banner'));
    var banner = document.getElementById('qgModeBanner') || banners[0] || null;
    banners.forEach(function (el) {
      if (banner && el !== banner) el.parentNode && el.parentNode.removeChild(el);
    });
    if (!banner && nav) {
      banner = document.createElement('div');
      banner.className = 'qg-mode-banner';
      banner.id = 'qgModeBanner';
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');
      nav.insertAdjacentElement('afterend', banner);
    } else if (banner && nav && banner.previousElementSibling !== nav) {
      nav.insertAdjacentElement('afterend', banner);
    }
    if (banner) {
      banner.id = 'qgModeBanner';
      banner.className = 'qg-mode-banner';
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');
      banner.textContent = activeMode === 'tasker' ? "You're in Tasker mode" : "You're in Poster mode";
      banner.setAttribute('data-mode', activeMode);
    }
    applyRoleLabels();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyModeChrome);
  } else {
    applyModeChrome();
  }

  window.getMode = getMode;
  window.setMode = setMode;
  window.QG_getBrandMode = function () { return cssMode(getMode()); };
  window.QG_applyRoleLabels = applyRoleLabels;
  window.QG_applyModeChrome = applyModeChrome;
  window.QG_listSkeletonHtml = function (opts) {
    opts = opts || {};
    var n = opts.rows || 4;
    var label = opts.label || 'Loading…';
    var widths = ['w80', 'w60', 'w80', 'w40'];
    var rows = '';
    var i;
    for (i = 0; i < n; i++) {
      rows +=
        '<div class="qg-list-skel-row" aria-hidden="true">' +
          '<div class="qg-list-skel-avatar"></div>' +
          '<div class="qg-list-skel-lines">' +
            '<div class="qg-list-skel-line ' + widths[i % widths.length] + '"></div>' +
            '<div class="qg-list-skel-line ' + widths[(i + 1) % widths.length] + '"></div>' +
          '</div>' +
        '</div>';
    }
    return '<div class="qg-list-skel" role="status" aria-busy="true" aria-label="' + label + '">' +
      '<div class="qg-list-skel-label">' + label + '</div>' + rows + '</div>';
  };

  function escState(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function stateIconHtml(name) {
    if (typeof window.qgIcon === 'function') return window.qgIcon(name || 'inbox', { size: 24 });
    return '';
  }

  function stateActionHtml(action) {
    if (!action) return '';
    var label = escState(action.label || 'Continue');
    var cls = 'qg-state-btn' + (action.secondary ? ' is-secondary' : '');
    var ico = action.icon && typeof window.qgIcon === 'function'
      ? window.qgIcon(action.icon, { size: 14 }) + ' '
      : '';
    if (action.href) {
      return '<a class="' + cls + '" href="' + escState(action.href) + '">' + ico + label + '</a>';
    }
    var onclick = action.onclick ? ' onclick="' + String(action.onclick).replace(/"/g, '&quot;') + '"' : '';
    var id = action.id ? ' id="' + escState(action.id) + '"' : '';
    return '<button type="button" class="' + cls + '"' + id + onclick + '>' + ico + label + '</button>';
  }

  /** Shared empty state: icon + headline + guidance + optional actions. */
  window.QG_emptyStateHtml = function (opts) {
    opts = opts || {};
    var compact = opts.compact ? ' is-compact' : '';
    var actions = '';
    if (opts.action || opts.secondary) {
      actions = '<div class="qg-state-actions">' +
        stateActionHtml(opts.action) +
        stateActionHtml(opts.secondary && Object.assign({ secondary: true }, opts.secondary)) +
        '</div>';
    }
    return '<div class="qg-state empty-state' + compact + '" role="status">' +
      '<div class="qg-state-icon empty-icon" aria-hidden="true">' + stateIconHtml(opts.icon || 'inbox') + '</div>' +
      '<div class="qg-state-title empty-title">' + escState(opts.title || 'Nothing here yet') + '</div>' +
      (opts.sub ? '<div class="qg-state-sub empty-sub empty-txt">' + escState(opts.sub) + '</div>' : '') +
      actions +
    '</div>';
  };

  /** Shared error / offline state with Try again. */
  window.QG_errorStateHtml = function (opts) {
    opts = opts || {};
    var offline = !!opts.offline;
    var title = opts.title || (offline ? "Can't connect" : 'Something went wrong');
    var sub = opts.sub || (offline
      ? 'Check your connection and try again.'
      : 'Check your connection, then try again.');
    var retry = opts.retry || { label: 'Try again', icon: 'refresh', onclick: 'location.reload()' };
    if (typeof opts.onRetry === 'string' && opts.onRetry) {
      retry = { label: 'Try again', icon: 'refresh', onclick: opts.onRetry };
    }
    var actions = '<div class="qg-state-actions">' + stateActionHtml(retry);
    if (opts.secondary) {
      actions += stateActionHtml(Object.assign({ secondary: true }, opts.secondary));
    }
    actions += '</div>';
    var compact = opts.compact ? ' is-compact' : '';
    return '<div class="qg-state is-error empty-state' + compact + '" role="alert">' +
      '<div class="qg-state-icon empty-icon" aria-hidden="true">' + stateIconHtml(opts.icon || 'alert') + '</div>' +
      '<div class="qg-state-title empty-title">' + escState(title) + '</div>' +
      '<div class="qg-state-sub empty-sub empty-txt">' + escState(sub) + '</div>' +
      actions +
    '</div>';
  };

  window.QG_spinnerHtml = function (opts) {
    opts = opts || {};
    var label = escState(opts.label || 'Loading…');
    var size = opts.large ? ' is-lg' : '';
    if (opts.inline === false) {
      return '<div class="qg-inline-load" role="status" aria-busy="true" aria-label="' + label + '">' +
        '<span class="qg-spinner' + size + '" aria-hidden="true"></span>' +
        '<span>' + label + '</span></div>';
    }
    return '<span class="qg-inline-load" role="status" aria-busy="true" aria-label="' + label + '">' +
      '<span class="qg-spinner' + size + '" aria-hidden="true"></span>' +
      (opts.hideLabel ? '' : '<span>' + label + '</span>') +
    '</span>';
  };

  var existingRoleTheme = document.querySelector('link[href*="qg-role-theme.css"]');
  if (existingRoleTheme) {
    var roleThemeBase = existingRoleTheme.getAttribute('href').split('?')[0];
    existingRoleTheme.setAttribute('href', roleThemeBase + '?v=20260731dashGrid2');
  } else {
    var roleTheme = document.createElement('link');
    roleTheme.rel = 'stylesheet';
    roleTheme.href = 'qg-role-theme.css?v=20260731dashGrid2';
    document.head.appendChild(roleTheme);
  }

  if (!document.querySelector('link[href*="qg-chrome.css"]')) {
    var chrome = document.createElement('link');
    chrome.rel = 'stylesheet';
    chrome.href = 'qg-chrome.css?v=1';
    document.head.appendChild(chrome);
  }

  if (!document.getElementById('qg-tokens-css') && !document.querySelector('link[href*="qg-tokens.css"]')) {
    var tokens = document.createElement('link');
    tokens.id = 'qg-tokens-css';
    tokens.rel = 'stylesheet';
    tokens.href = 'qg-tokens.css?v=20260811light1';
    document.head.appendChild(tokens);
  }

  if (!document.getElementById('qg-light-nav-css')) {
    var link = document.createElement('link');
    link.id = 'qg-light-nav-css';
    link.rel = 'stylesheet';
    link.href = 'qg-light-nav.css?v=20260728msgtheme';
    document.head.appendChild(link);
  }

  if (!document.getElementById('qg-refine-css')) {
    var refine = document.createElement('link');
    refine.id = 'qg-refine-css';
    refine.rel = 'stylesheet';
    refine.href = 'qg-refine.css?v=20260803posterLayout1';
    document.head.appendChild(refine);
  }

  /* Shared empty / loading / error states */
  if (!document.getElementById('qg-states-css') && !document.querySelector('link[href*="qg-states.css"]')) {
    var statesCss = document.createElement('link');
    statesCss.id = 'qg-states-css';
    statesCss.rel = 'stylesheet';
    statesCss.href = 'qg-states.css?v=20260811states1';
    document.head.appendChild(statesCss);
  }

  /* Light-mode contrast / CTA fixes (after tokens + states) */
  if (!document.getElementById('qg-light-fix-css') && !document.querySelector('link[href*="qg-light-fix.css"]')) {
    var lightFix = document.createElement('link');
    lightFix.id = 'qg-light-fix-css';
    lightFix.rel = 'stylesheet';
    lightFix.href = 'qg-light-fix.css?v=20260811light1';
    document.head.appendChild(lightFix);
  }

  /* Shell chrome last so token-based nav/menu/tabs win over page + role-theme hex */
  if (!document.getElementById('qg-shell-css') && !document.querySelector('link[href*="qg-shell.css"]')) {
    var shell = document.createElement('link');
    shell.id = 'qg-shell-css';
    shell.rel = 'stylesheet';
    shell.href = 'qg-shell.css?v=20260811notif1';
    document.head.appendChild(shell);
  }

  /* Dashboard content tokens (after shell; scoped to page-dashboard) */
  if (!document.getElementById('qg-dashboard-css') && !document.querySelector('link[href*="qg-dashboard.css"]')) {
    var dashCss = document.createElement('link');
    dashCss.id = 'qg-dashboard-css';
    dashCss.rel = 'stylesheet';
    dashCss.href = 'qg-dashboard.css?v=20260811dash1';
    document.head.appendChild(dashCss);
  }

  /* Core flow screens (post / apply / evidence / review) */
  if (!document.getElementById('qg-flows-css') && !document.querySelector('link[href*="qg-flows.css"]')) {
    var flowsCss = document.createElement('link');
    flowsCss.id = 'qg-flows-css';
    flowsCss.rel = 'stylesheet';
    flowsCss.href = 'qg-flows.css?v=20260811flows1';
    document.head.appendChild(flowsCss);
  }

  /* Browse Map / Spotlight views */
  if (!document.getElementById('qg-browse-views-css') && !document.querySelector('link[href*="qg-browse-views.css"]')) {
    var browseViewsCss = document.createElement('link');
    browseViewsCss.id = 'qg-browse-views-css';
    browseViewsCss.rel = 'stylesheet';
    browseViewsCss.href = 'qg-browse-views.css?v=20260811browse4';
    document.head.appendChild(browseViewsCss);
  }

  /* Guardian portal + parent consent + teen waiting badges */
  if (!document.getElementById('qg-guardian-css') && !document.querySelector('link[href*="qg-guardian.css"]')) {
    var guardianCss = document.createElement('link');
    guardianCss.id = 'qg-guardian-css';
    guardianCss.rel = 'stylesheet';
    guardianCss.href = 'qg-guardian.css?v=20260811teensafety1';
    document.head.appendChild(guardianCss);
  }

  /* Tasker trust profile + activity ticker */
  if (!document.getElementById('qg-trust-profile-css') && !document.querySelector('link[href*="qg-trust-profile.css"]')) {
    var trustCss = document.createElement('link');
    trustCss.id = 'qg-trust-profile-css';
    trustCss.rel = 'stylesheet';
    trustCss.href = 'qg-trust-profile.css?v=20260811trust3';
    document.head.appendChild(trustCss);
  }

  /* Safety / 911 block + emergency contact settings */
  if (!document.getElementById('qg-safety-css') && !document.querySelector('link[href*="qg-safety.css"]')) {
    var safetyCss = document.createElement('link');
    safetyCss.id = 'qg-safety-css';
    safetyCss.rel = 'stylesheet';
    safetyCss.href = 'qg-safety.css?v=20260811teensafety1';
    document.head.appendChild(safetyCss);
  }
  if (!document.querySelector('script[src*="qg-safety.js"]')) {
    var safetyJs = document.createElement('script');
    safetyJs.src = 'qg-safety.js?v=20260811teensafety1';
    safetyJs.defer = true;
    document.head.appendChild(safetyJs);
  }

  // Sync load so qgIcon is available before deferred page scripts run
  if (!document.querySelector('script[src*="qg-icons.js"]') && typeof window.qgIcon !== 'function') {
    try {
      document.write('<script src="qg-icons.js?v=20260811safety1"><\/script>');
    } catch (eWrite) {
      var icons = document.createElement('script');
      icons.src = 'qg-icons.js?v=20260811safety1';
      document.head.appendChild(icons);
    }
  }

  function markPageClass() {
    var page = (location.pathname.split('/').pop() || '').toLowerCase();
    var map = {
      'dashboard.html': 'page-dashboard',
      'mytasks.html': 'page-mytasks',
      'messages.html': 'page-messages',
      'chat.html': 'page-chat',
      'browsetask.html': 'page-browse',
      'posttask.html': 'page-posttask',
      'review.html': 'page-review',
      'parent-consent.html': 'page-parent-consent',
      'guardian-portal.html': 'page-guardian-portal',
      'profile.html': 'page-profile'
    };
    if (map[page]) document.body.classList.add(map[page]);
    if (page === 'browsetask.html' && !document.body.getAttribute('data-browse-view')) {
      document.body.setAttribute('data-browse-view', 'list');
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', markPageClass);
  } else {
    markPageClass();
  }

  if (!document.getElementById('qg-analytics-loader') && !document.querySelector('script[src*="qg-analytics"]')) {
    var cfgScript = document.querySelector('script[src*="qg-config.js"]');
    function loadGa() {
      var ga = document.createElement('script');
      ga.id = 'qg-analytics-loader';
      ga.src = 'qg-analytics.js?v=1';
      ga.async = true;
      document.head.appendChild(ga);
    }
    if (cfgScript) loadGa();
    else {
      var cfg = document.createElement('script');
      cfg.src = 'qg-config.js';
      cfg.onload = loadGa;
      document.head.appendChild(cfg);
    }
  }
})();
