/* QuickGigs — UX overhaul helpers (trust, a11y, forms, onboarding). Safe additive. */
(function () {
  'use strict';

  var PAGE = (window.location.pathname || '').split('/').pop() || '';

  function ensureHeadMeta() {
    var head = document.head;
    if (!head) return;
    if (!document.querySelector('link[rel="icon"]')) {
      var icon = document.createElement('link');
      icon.rel = 'icon';
      icon.href = '/QuickGigsLogo.png';
      head.appendChild(icon);
    }
    if (!document.querySelector('link[rel="apple-touch-icon"]')) {
      var apple = document.createElement('link');
      apple.rel = 'apple-touch-icon';
      apple.href = '/QuickGigsLogo.png';
      apple.setAttribute('sizes', '180x180');
      head.appendChild(apple);
    }
    if (!document.querySelector('meta[name="description"]')) {
      var desc = document.createElement('meta');
      desc.name = 'description';
      var map = {
        'dashboard.html': 'Your QuickGigs dashboard — post tasks, track jobs, and manage gigs across Canada.',
        'browsetask.html': 'Browse open QuickGigs tasks near you and apply in under a minute.',
        'posttask.html': 'Post a task on QuickGigs — free during beta. Find local help across Canada.',
        'mytasks.html': 'Manage your QuickGigs postings and applications in one place.',
        'messages.html': 'QuickGigs messages — chat with posters and taskers after you match.',
        'chat.html': 'QuickGigs chat — coordinate your gig safely in-app.',
        'review.html': 'Leave a QuickGigs review and help keep the marketplace trustworthy.',
        'profile.html': 'Your QuickGigs profile — skills, payouts, and account settings.',
        'modeselector.html': 'Choose Poster or Tasker mode on QuickGigs.',
        'feedback.html': 'Send QuickGigs beta feedback — we read every message.',
        'terms.html': 'QuickGigs Terms of Service.',
        'privacy.html': 'QuickGigs Privacy Policy — PIPEDA-aligned data practices.'
      };
      desc.content = map[PAGE] || 'QuickGigs — Canada\'s marketplace for everyday tasks and gigs.';
      head.appendChild(desc);
    }
    if (PAGE === 'dashboard.html' && !document.querySelector('link[rel="prefetch"][href*="browsetask"]')) {
      var pre = document.createElement('link');
      pre.rel = 'prefetch';
      pre.href = 'browsetask.html';
      head.appendChild(pre);
    }
    if (PAGE === 'login.html' && !document.querySelector('link[rel="prefetch"][href*="dashboard"]')) {
      var pre2 = document.createElement('link');
      pre2.rel = 'prefetch';
      pre2.href = 'dashboard.html';
      head.appendChild(pre2);
    }
  }

  function ensureSkipAndMain() {
    if (!document.querySelector('.skip-link')) {
      var a = document.createElement('a');
      a.href = '#main';
      a.className = 'skip-link';
      a.textContent = 'Skip to content';
      document.body.insertBefore(a, document.body.firstChild);
    }
    if (document.getElementById('main')) return;
    var host = document.querySelector('main, [role="main"], #mainContent, .content, .page-content, .page-wrap, .signup-card');
    if (host) {
      host.classList.add('qg-main');
      host.setAttribute('role', 'main');
      // Never rename an existing id (e.g. mainContent) — add a sibling target for skip-link
      if (!host.id) host.id = 'main';
      else if (host.id !== 'main' && !document.getElementById('main')) {
        var anchor = document.createElement('span');
        anchor.id = 'main';
        anchor.setAttribute('tabindex', '-1');
        anchor.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)';
        host.parentNode.insertBefore(anchor, host);
      }
      return;
    }
    var main = document.createElement('main');
    main.id = 'main';
    main.className = 'qg-main';
    var stopSelectors = 'nav, .nav, .tab-bar, #qgTabBar, footer, .qg-global-loading, .skip-link, script, link, style, .qg-onboard-overlay, .modal-overlay, .confirm-overlay, #qgGlobalLoading, .stars, .signup-bg-mesh';
    var nodes = Array.prototype.slice.call(document.body.children);
    var moved = false;
    nodes.forEach(function (n) {
      if (n.nodeType !== 1) return;
      if (n.matches && n.matches(stopSelectors)) return;
      if (!moved) {
        document.body.insertBefore(main, n);
        moved = true;
      }
      main.appendChild(n);
    });
    if (!moved) document.body.appendChild(main);
  }

  function ensureBetaPill() {
    var brand = document.querySelector('.nav-brand, .nav .nav-logo, .signup-logo, .nav-logo');
    if (!brand) return;
    if (document.querySelector('.nav-beta-pill')) return;
    var pill = document.createElement('span');
    pill.className = 'nav-beta-pill';
    pill.textContent = 'Beta';
    pill.setAttribute('title', 'QuickGigs is in beta — features may change');
    if (brand.classList && brand.classList.contains('nav-brand')) brand.appendChild(pill);
    else if (brand.parentNode) {
      var wrap = brand.closest('.nav-brand') || brand.parentNode;
      wrap.appendChild(pill);
    }
  }

  function ensureTrustFooter() {
    var el = document.getElementById('siteFooter');
    if (!el) {
      el = document.createElement('footer');
      el.id = 'siteFooter';
      el.className = 'qg-trust-footer site-footer';
      var tab = document.getElementById('qgTabBar') || document.querySelector('nav.tab-bar');
      if (tab && tab.parentNode) tab.parentNode.insertBefore(el, tab);
      else document.body.appendChild(el);
    }
    if (typeof window.renderQuickGigsFooter === 'function') {
      window.renderQuickGigsFooter('siteFooter');
    } else {
      el.classList.add('qg-trust-footer', 'site-footer');
      el.innerHTML =
        '<div class="qg-foot-brand">QuickGigs</div>' +
        '<div class="qg-foot-co">A MoTechCo company © 2026</div>' +
        '<div class="qg-foot-links">' +
        '<a href="terms.html">Terms</a> · ' +
        '<a href="privacy.html">Privacy</a> · ' +
        '<a href="feedback.html">Feedback</a>' +
        '</div>' +
        '<div class="qg-foot-email"><a href="mailto:mowebsiteco@gmail.com">mowebsiteco@gmail.com</a></div>';
    }
  }

  function ensurePipeda() {
    if (PAGE !== 'login.html' && PAGE !== 'signup.html') return;
    if (document.querySelector('.qg-pipeda-line')) return;
    var bodyText = document.body && document.body.innerText || '';
    if (bodyText.indexOf('Your data is protected under Canadian privacy law (PIPEDA)') >= 0) return;
    var form = document.getElementById('loginForm') || document.getElementById('signupForm') || document.querySelector('form');
    if (!form) return;
    var line = document.createElement('p');
    line.className = 'qg-pipeda-line';
    line.textContent = '🔒 Your data is protected under Canadian privacy law (PIPEDA)';
    form.parentNode.insertBefore(line, form.nextSibling);
  }

  function initSignupHints() {
    if (PAGE !== 'signup.html') return;
    var hints = {
      name: 'Use the name you want posters and taskers to see.',
      email: 'We\'ll send account updates here — never sold.',
      phone: 'Used for account recovery and safety verification.',
      password: 'At least 8 characters. You can change this later.',
      confirmPassword: 'Re-enter the same password to confirm.'
    };
    Object.keys(hints).forEach(function (id) {
      var input = document.getElementById(id);
      if (!input) return;
      var field = input.closest('.signup-field') || input.parentNode;
      var label = field.querySelector('label');
      if (label && !label.getAttribute('for')) label.setAttribute('for', id);
      if (field.querySelector('.field-hint, .qg-field-hint')) return;
      var p = document.createElement('p');
      p.className = 'field-hint qg-field-hint';
      p.style.cssText = 'margin:4px 0 0;font-size:12px;line-height:1.45;opacity:0.75';
      p.textContent = hints[id];
      if (label && label.nextSibling) field.insertBefore(p, label.nextSibling);
      else field.insertBefore(p, input);
    });
  }

  function fixExternalLinks() {
    document.querySelectorAll('a[target="_blank"]').forEach(function (a) {
      var rel = (a.getAttribute('rel') || '').toLowerCase();
      if (rel.indexOf('noopener') === -1 || rel.indexOf('noreferrer') === -1) {
        a.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }

  function initTooltips() {
    document.querySelectorAll('[data-qg-tip]').forEach(function (el) {
      if (el.dataset.qgTipReady === '1') return;
      el.dataset.qgTipReady = '1';
      var text = el.getAttribute('data-qg-tip') || '';
      var wrap = document.createElement('span');
      wrap.className = 'qg-tip-wrap';
      el.parentNode.insertBefore(wrap, el);
      wrap.appendChild(el);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qg-tip-btn';
      btn.setAttribute('aria-label', 'More info');
      btn.textContent = 'ⓘ';
      var pop = document.createElement('div');
      pop.className = 'qg-tip-pop';
      pop.setAttribute('role', 'tooltip');
      pop.textContent = text;
      wrap.appendChild(btn);
      wrap.appendChild(pop);
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        document.querySelectorAll('.qg-tip-wrap.open').forEach(function (w) {
          if (w !== wrap) w.classList.remove('open');
        });
        wrap.classList.toggle('open');
      });
    });
    document.addEventListener('click', function () {
      document.querySelectorAll('.qg-tip-wrap.open').forEach(function (w) { w.classList.remove('open'); });
    });
  }

  function initOnboarding() {
    if (PAGE !== 'dashboard.html') return;
    try {
      if (localStorage.getItem('qg-onboarded') === '1') return;
    } catch (e) { return; }
    if (document.getElementById('qgOnboardOverlay')) return;
    var steps = [
      { title: 'Post a task or browse tasks', sub: 'Posters describe what they need. Taskers find work nearby and apply.' },
      { title: 'Chat unlocks once you\'re matched', sub: 'After a poster accepts an application, you can message in-app to coordinate.' },
      { title: 'Payments are off during beta — explore freely', sub: 'No escrow charge while we finish beta. Explore posting, applying, and chat.' }
    ];
    var i = 0;
    var overlay = document.createElement('div');
    overlay.id = 'qgOnboardOverlay';
    overlay.className = 'qg-onboard-overlay open';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'qgOnboardTitle');
    function render() {
      var last = i >= steps.length - 1;
      overlay.innerHTML =
        '<div class="qg-onboard-card">' +
        '<div class="qg-onboard-step">Welcome · Step ' + (i + 1) + ' of ' + steps.length + '</div>' +
        '<div class="qg-onboard-title" id="qgOnboardTitle">' + steps[i].title + '</div>' +
        '<div class="qg-onboard-sub">' + steps[i].sub + '</div>' +
        '<button type="button" class="qg-onboard-btn" id="qgOnboardNext">' + (last ? 'Got it' : 'Next') + '</button>' +
        '</div>';
      var btn = document.getElementById('qgOnboardNext');
      if (btn) btn.focus();
      if (btn) btn.onclick = function () {
        if (last) {
          try { localStorage.setItem('qg-onboarded', '1'); } catch (e2) {}
          overlay.classList.remove('open');
          overlay.remove();
        } else {
          i += 1;
          render();
        }
      };
    }
    document.body.appendChild(overlay);
    render();
  }

  function initBrowseHint() {
    if (PAGE !== 'browsetask.html') return;
    try {
      if (localStorage.getItem('qg-browse-hint-seen') === '1') return;
    } catch (e) {}
    if (document.querySelector('.qg-hint-banner')) return;
    var host = document.querySelector('.cards-area') || document.getElementById('cardsArea');
    if (!host || !host.parentNode) return;
    var banner = document.createElement('div');
    banner.className = 'qg-hint-banner';
    banner.innerHTML = 'Tap any task to see details and apply — it takes under a minute. <button type="button" id="qgBrowseHintDismiss" style="margin-left:8px;border:none;background:transparent;color:inherit;text-decoration:underline;cursor:pointer;font:inherit">Got it</button>';
    host.parentNode.insertBefore(banner, host);
    var d = document.getElementById('qgBrowseHintDismiss');
    if (d) d.onclick = function () {
      try { localStorage.setItem('qg-browse-hint-seen', '1'); } catch (e2) {}
      banner.remove();
    };
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var ctx = this;
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }
  window.qgDebounce = window.qgDebounce || debounce;

  function initBrowseDebounce() {
    if (PAGE !== 'browsetask.html') return;
    var input = document.getElementById('searchInput') || document.querySelector('.search-input');
    if (!input || input.dataset.qgDebounced === '1') return;
    input.dataset.qgDebounced = '1';
    var handler = input.oninput;
    if (typeof handler === 'function') {
      input.oninput = null;
      input.addEventListener('input', debounce(function (e) { handler.call(input, e); }, 300));
    } else if (typeof window.filterTasks === 'function') {
      input.addEventListener('input', debounce(function () { window.filterTasks(); }, 300));
    } else if (typeof window.applyFilters === 'function') {
      input.addEventListener('input', debounce(function () { window.applyFilters(); }, 300));
    }
  }

  function validateEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
  }

  function showFieldError(input, msg) {
    if (!input) return;
    input.classList.add('qg-invalid');
    var id = input.id || input.name;
    var err = id ? document.getElementById(id + 'Error') : null;
    if (!err) {
      err = input.parentNode && input.parentNode.querySelector('.qg-field-error');
    }
    if (!err && input.parentNode) {
      err = document.createElement('div');
      err.className = 'qg-field-error';
      if (id) err.id = id + 'Error';
      input.parentNode.appendChild(err);
    }
    if (err) {
      err.textContent = msg || 'Please check this field';
      err.classList.add('show');
    }
  }

  function clearFieldError(input) {
    if (!input) return;
    input.classList.remove('qg-invalid');
    var id = input.id || input.name;
    var err = (id && document.getElementById(id + 'Error')) ||
      (input.parentNode && input.parentNode.querySelector('.qg-field-error'));
    if (err) {
      err.textContent = '';
      err.classList.remove('show');
    }
  }

  function initBlurValidation() {
    document.querySelectorAll('input[required], textarea[required], input[type="email"], input#offerPrice, input#budget, #email, #password, #name').forEach(function (input) {
      if (input.dataset.qgBlurVal === '1') return;
      input.dataset.qgBlurVal = '1';
      if (input.id && !input.getAttribute('aria-describedby')) {
        // keep existing associations
      }
      input.addEventListener('blur', function () {
        var v = (input.value || '').trim();
        var type = (input.type || '').toLowerCase();
        var id = (input.id || '').toLowerCase();
        clearFieldError(input);
        if (input.required && !v) {
          showFieldError(input, 'This field is required');
          return;
        }
        if ((type === 'email' || id === 'email') && v && !validateEmail(v)) {
          showFieldError(input, 'Enter a valid email');
          return;
        }
        if ((id === 'offerprice' || id === 'budget' || input.getAttribute('inputmode') === 'decimal') && v) {
          var n = parseFloat(v);
          if (isNaN(n) || n < 20) showFieldError(input, 'Budget must be at least $20');
        }
        if ((type === 'password' || id === 'password') && v && v.length < 6) {
          showFieldError(input, 'Password must be at least 6 characters');
        }
      });
      input.addEventListener('input', function () { clearFieldError(input); });
    });

    // Associate labels missing for=
    document.querySelectorAll('label').forEach(function (label) {
      if (label.getAttribute('for')) return;
      var field = label.parentNode && label.parentNode.querySelector('input, textarea, select');
      if (field && field.id) label.setAttribute('for', field.id);
    });
  }

  function initModalA11y() {
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var open = document.querySelector('.modal-overlay.open, .confirm-overlay.open, .qg-onboard-overlay.open');
      if (!open) return;
      if (open.classList.contains('qg-onboard-overlay')) return;
      open.classList.remove('open');
      var trigger = window.__qgLastModalTrigger;
      if (trigger && typeof trigger.focus === 'function') trigger.focus();
    });

    document.addEventListener('click', function (e) {
      var t = e.target.closest('[onclick*="Modal"], [data-open-modal], .apply-btn, [data-pay-task]');
      if (t) window.__qgLastModalTrigger = t;
    }, true);

    document.querySelectorAll('.modal-overlay, .confirm-overlay').forEach(function (overlay) {
      if (overlay.dataset.qgA11y === '1') return;
      overlay.dataset.qgA11y = '1';
      var obs = new MutationObserver(function () {
        if (!overlay.classList.contains('open')) return;
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        var title = overlay.querySelector('.modal-title, .confirm-title, h2, h3');
        if (title) {
          if (!title.id) title.id = 'qgModalTitle';
          overlay.setAttribute('aria-labelledby', title.id);
        }
        var focusable = overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusable.length) focusable[0].focus();
      });
      obs.observe(overlay, { attributes: true, attributeFilter: ['class'] });
    });
  }

  function initToasts() {
    var toast = document.getElementById('toast');
    if (toast) {
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
    }
  }

  function animateCountEl(el) {
    if (!el || el.dataset.qgCounted === '1') return;
    var raw = (el.textContent || '').replace(/[^0-9.]/g, '');
    var target = parseFloat(raw);
    if (!target || isNaN(target)) return;
    el.dataset.qgCounted = '1';
    var prefix = (el.textContent || '').trim().charAt(0) === '$' ? '$' : '';
    var start = performance.now();
    var dur = 600;
    function frame(now) {
      var p = Math.min(1, (now - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      var val = Math.round(target * eased);
      el.textContent = prefix + val;
      if (p < 1) requestAnimationFrame(frame);
      else el.textContent = prefix + (Number.isInteger(target) ? target : target.toFixed(0));
    }
    el.textContent = prefix + '0';
    requestAnimationFrame(frame);
  }

  function initCountUp() {
    if (PAGE !== 'dashboard.html') return;
    document.querySelectorAll('.stat-val, .stat-value, [data-count-up]').forEach(animateCountEl);
    var host = document.getElementById('statsRow') || document.querySelector('.stats-grid, .stat-grid');
    if (!host || typeof MutationObserver === 'undefined') return;
    var obs = new MutationObserver(function () {
      document.querySelectorAll('.stat-val, .stat-value, [data-count-up]').forEach(animateCountEl);
    });
    obs.observe(host, { childList: true, subtree: true });
  }

  function formatCad(amount) {
    var n = Number(amount);
    if (isNaN(n)) return String(amount || '');
    return '$' + (Math.round(n * 100) / 100).toFixed(n % 1 ? 2 : 0) + ' CAD';
  }
  window.formatCadMoney = window.formatCadMoney || formatCad;

  function initPostDraft() {
    if (PAGE !== 'posttask.html') return;
    var KEY = 'qg-post-draft';
    var fields = ['title', 'description', 'budget', 'location', 'category', 'taskMode', 'task_mode'];
    var map = {};
    fields.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) map[id] = el;
    });
    // common posttask ids
    ['taskTitle', 'taskDesc', 'taskBudget', 'taskLocation', 'desc', 'price'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) map[id] = el;
    });
    var ids = Object.keys(map);
    if (!ids.length) return;

    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var data = JSON.parse(raw);
        ids.forEach(function (id) {
          if (data[id] != null && map[id] && !map[id].value) map[id].value = data[id];
        });
        if (typeof window.showToast === 'function') {
          window.showToast('Draft restored', '#9b6fc4');
        }
      }
    } catch (e) {}

    function save() {
      var out = {};
      ids.forEach(function (id) { out[id] = map[id].value; });
      try { localStorage.setItem(KEY, JSON.stringify(out)); } catch (e2) {}
    }
    ids.forEach(function (id) {
      map[id].addEventListener('input', debounce(save, 250));
    });

    window.qgClearPostDraft = function () {
      try { localStorage.removeItem(KEY); } catch (e3) {}
    };

    // Sticky post bar
    document.body.classList.add('qg-page-posttask');
    var postBtn = document.getElementById('submitBtn') ||
      document.getElementById('postBtn') ||
      document.querySelector('.submit-btn, .post-btn, button[onclick*="submit"], #submitPost');
    if (postBtn && !document.querySelector('.qg-sticky-post-bar')) {
      var bar = document.createElement('div');
      bar.className = 'qg-sticky-post-bar';
      var clone = postBtn.cloneNode(true);
      clone.id = (postBtn.id || 'submitBtn') + 'Sticky';
      clone.removeAttribute('onclick');
      clone.addEventListener('click', function (e) {
        e.preventDefault();
        postBtn.click();
      });
      bar.appendChild(clone);
      document.body.appendChild(bar);
    }

    if (!document.querySelector('.qg-beta-free-note')) {
      var noteHost = postBtn && postBtn.parentNode;
      if (noteHost) {
        var note = document.createElement('p');
        note.className = 'qg-beta-free-note';
        note.textContent = 'Free to post during beta. No payment required.';
        noteHost.insertBefore(note, postBtn.nextSibling);
      }
    }

    function addFieldHint(section, text) {
      if (!section || section.querySelector('.field-hint, .qg-field-hint')) return;
      var lab = section.querySelector('.section-label');
      if (!lab) return;
      var hp = document.createElement('p');
      hp.className = 'field-hint qg-field-hint';
      hp.textContent = text;
      lab.parentNode.insertBefore(hp, lab.nextSibling);
    }
    addFieldHint(document.getElementById('taskBudget') && document.getElementById('taskBudget').closest('.field'), 'Minimum $20 CAD — pay only when task completes after beta');
    addFieldHint(document.getElementById('taskTitle') && document.getElementById('taskTitle').closest('.field'), 'Keep it clear and specific — taskers decide in seconds.');
    addFieldHint(document.getElementById('taskLocation') && document.getElementById('taskLocation').closest('.field'), 'City and area help nearby taskers find you.');
    addFieldHint(document.getElementById('taskDesc') && document.getElementById('taskDesc').closest('.field'), 'Include timing, access notes, and what “done” looks like.');

    // Label associations + input attributes
    [['taskTitle', 'Task title'], ['taskDesc', 'Description'], ['taskBudget', 'Your budget'], ['taskLocation', 'Location']].forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      if (!el) return;
      if (pair[0] === 'taskBudget') {
        el.setAttribute('inputmode', 'decimal');
        el.setAttribute('enterkeyhint', 'done');
      }
      var lab = el.closest('.field') && el.closest('.field').querySelector('.section-label');
      if (lab && lab.tagName === 'SPAN') {
        var real = document.createElement('label');
        real.className = lab.className;
        real.setAttribute('for', pair[0]);
        real.innerHTML = lab.innerHTML;
        lab.parentNode.replaceChild(real, lab);
      }
    });

    // Wire draft clear into success path
    var _origSuccess = null;
    var successScreen = document.getElementById('successScreen');
    if (successScreen) {
      var obs = new MutationObserver(function () {
        if (successScreen.style.display === 'block' || successScreen.classList.contains('show')) {
          if (typeof window.qgClearPostDraft === 'function') window.qgClearPostDraft();
        }
      });
      obs.observe(successScreen, { attributes: true, attributeFilter: ['style', 'class'] });
    }

    // Tips on modes/budget if labels exist
    document.querySelectorAll('.section-label, .mode-name, label').forEach(function (lab) {
      var t = (lab.textContent || '').toLowerCase();
      if (lab.dataset.qgTip || lab.closest('.qg-tip-wrap')) return;
      if (t.indexOf('budget') >= 0) lab.setAttribute('data-qg-tip', 'Minimum $20 CAD. During beta you can post free — payment/escrow comes at launch.');
      if (t.indexOf('quick') >= 0 || t.indexOf('standard') >= 0 || t.indexOf('recurring') >= 0 || t.indexOf('task mode') >= 0) {
        lab.setAttribute('data-qg-tip', 'Quick = same-day errands. Standard = one-off jobs. Recurring = ongoing help billed by the hour.');
      }
    });
  }

  function initIconAria() {
    document.querySelectorAll('button').forEach(function (btn) {
      if (btn.getAttribute('aria-label')) return;
      var text = (btn.textContent || '').trim();
      if (!text || text.length > 24) {
        if (btn.classList.contains('mode-btn')) btn.setAttribute('aria-label', 'Toggle theme');
        if (btn.id === 'modeBtn') btn.setAttribute('aria-label', 'Toggle light or dark mode');
      }
    });
    document.querySelectorAll('img:not([alt])').forEach(function (img) {
      img.setAttribute('alt', '');
    });
  }

  function initOnlineDots() {
    document.querySelectorAll('[data-updated-at]').forEach(function (el) {
      if (el.querySelector('.qg-online-dot')) return;
      var ts = el.getAttribute('data-updated-at');
      if (!ts) return;
      var age = Date.now() - new Date(ts).getTime();
      if (isNaN(age) || age > 1000 * 60 * 60 * 24 * 7) return;
      var dot = document.createElement('span');
      dot.className = 'qg-online-dot';
      dot.setAttribute('aria-label', 'Recently active');
      el.appendChild(dot);
    });
  }

  function enhanceTimeTitles() {
    document.querySelectorAll('[data-time], [data-created-at], .time-ago, .rel-time').forEach(function (el) {
      var raw = el.getAttribute('data-time') || el.getAttribute('data-created-at') || el.getAttribute('datetime');
      if (!raw || el.getAttribute('title')) return;
      try {
        el.setAttribute('title', new Date(raw).toLocaleString('en-CA'));
      } catch (e) {}
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    ensureHeadMeta();
    ensureSkipAndMain();
    ensureBetaPill();
    ensureTrustFooter();
    ensurePipeda();
    fixExternalLinks();
    initBlurValidation();
    initModalA11y();
    initToasts();
    initPostDraft();
    initSignupHints();
    initTooltips();
    initOnboarding();
    initBrowseHint();
    initBrowseDebounce();
    initCountUp();
    initIconAria();
    initOnlineDots();
    enhanceTimeTitles();

    // Modal drag-handle affordance on mobile sheets
    document.querySelectorAll('.modal, .confirm-box').forEach(function (m) {
      if (m.querySelector('.modal-handle, .qg-sheet-handle')) return;
      var h = document.createElement('div');
      h.className = 'modal-handle qg-sheet-handle';
      h.setAttribute('aria-hidden', 'true');
      m.insertBefore(h, m.firstChild);
    });

    // Re-try tab bar if an inline call raced ahead of deferred qg-nav.js
    setTimeout(function () {
      var bar = document.getElementById('qgTabBar');
      if (bar && !bar.children.length && typeof window.renderQuickGigsTabBar === 'function') {
        var pageMap = {
          'dashboard.html': 'home',
          'browsetask.html': 'browse',
          'posttask.html': 'post',
          'mytasks.html': 'tasks',
          'messages.html': 'messages',
          'profile.html': 'profile'
        };
        window.renderQuickGigsTabBar(pageMap[PAGE] || 'home');
      }
      if (typeof window.refreshMessagesUnreadBadge === 'function') window.refreshMessagesUnreadBadge();
    }, 0);
  });
})();
