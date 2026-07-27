/* QuickGigs — floating help panel (logged-in app pages) */
(function () {
  var PAGE = (window.location.pathname.split('/').pop() || '').toLowerCase();
  var APP_PAGES = {
    'dashboard.html': 1,
    'browsetask.html': 1,
    'posttask.html': 1,
    'mytasks.html': 1,
    'messages.html': 1,
    'chat.html': 1,
    'review.html': 1,
    'profile.html': 1,
    'modeselector.html': 1
  };
  if (!APP_PAGES[PAGE]) return;

  var FAQ = [
    {
      q: 'How do I post a task?',
      a: 'Switch to Poster mode, tap Post a task, add a title, budget, and timing, then publish. Taskers nearby can apply right away.'
    },
    {
      q: 'How do applications work?',
      a: 'Taskers apply with a price and short note. You review applicants on My Tasks, accept one tasker, then coordinate in chat.'
    },
    {
      q: 'When do payments start?',
      a: 'Payments are in beta setup. When live, posters pay through QuickGigs before work begins so funds stay protected until the task is done.'
    },
    {
      q: 'How do I report a problem?',
      a: 'Use Report on a task or profile, or email us. For product feedback, use the Feedback page — we read every note.'
    }
  ];

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function closePanel() {
    var root = document.getElementById('qgHelpRoot');
    if (!root) return;
    root.classList.remove('is-open');
    var btn = document.getElementById('qgHelpFab');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    var panel = document.getElementById('qgHelpPanel');
    if (panel) panel.setAttribute('hidden', '');
  }

  function openPanel() {
    var root = document.getElementById('qgHelpRoot');
    if (!root) return;
    root.classList.add('is-open');
    var btn = document.getElementById('qgHelpFab');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    var panel = document.getElementById('qgHelpPanel');
    if (panel) {
      panel.removeAttribute('hidden');
      var first = panel.querySelector('.qg-help-q');
      if (first) first.focus();
    }
  }

  function togglePanel() {
    var root = document.getElementById('qgHelpRoot');
    if (root && root.classList.contains('is-open')) closePanel();
    else openPanel();
  }

  function bindComposerFocusHide(root) {
    if (PAGE !== 'chat.html') return;
    document.documentElement.setAttribute('data-qg-page', 'chat');
    document.body.classList.add('page-chat');
    var input = document.getElementById('msgInput');
    if (!input) return;
    var sync = function () {
      root.classList.toggle('is-composer-focused', document.activeElement === input);
    };
    input.addEventListener('focus', sync);
    input.addEventListener('blur', function () {
      setTimeout(sync, 0);
    });
    sync();
  }

  function mount() {
    if (document.getElementById('qgHelpRoot')) return;
    if (PAGE === 'messages.html') {
      document.documentElement.setAttribute('data-qg-page', 'messages');
      document.body.classList.add('page-messages');
    }
    var root = document.createElement('div');
    root.id = 'qgHelpRoot';
    root.className = 'qg-help-root';
    root.innerHTML =
      '<button type="button" class="qg-help-fab" id="qgHelpFab" aria-expanded="false" aria-controls="qgHelpPanel" aria-label="Help and support">?</button>' +
      '<div class="qg-help-panel" id="qgHelpPanel" role="dialog" aria-modal="true" aria-labelledby="qgHelpTitle" hidden>' +
        '<div class="qg-help-head">' +
          '<div class="qg-help-title" id="qgHelpTitle">Help</div>' +
          '<button type="button" class="qg-help-close" id="qgHelpClose" aria-label="Close help">×</button>' +
        '</div>' +
        '<div class="qg-help-body">' +
          FAQ.map(function (item, i) {
            return '<div class="qg-help-item">' +
              '<button type="button" class="qg-help-q" id="qgHelpQ' + i + '" aria-expanded="false" aria-controls="qgHelpA' + i + '">' +
                esc(item.q) +
              '</button>' +
              '<div class="qg-help-a" id="qgHelpA' + i + '" role="region" hidden>' + esc(item.a) + '</div>' +
            '</div>';
          }).join('') +
          '<div class="qg-help-actions">' +
            '<a class="qg-help-link" href="mailto:mowebsiteco@gmail.com">Email us</a>' +
            '<a class="qg-help-link" href="feedback.html">Send feedback</a>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);

    document.getElementById('qgHelpFab').addEventListener('click', togglePanel);
    document.getElementById('qgHelpClose').addEventListener('click', closePanel);

    root.querySelectorAll('.qg-help-q').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var expanded = btn.getAttribute('aria-expanded') === 'true';
        var panel = document.getElementById(btn.getAttribute('aria-controls'));
        root.querySelectorAll('.qg-help-q').forEach(function (other) {
          other.setAttribute('aria-expanded', 'false');
          var otherA = document.getElementById(other.getAttribute('aria-controls'));
          if (otherA) otherA.setAttribute('hidden', '');
        });
        if (!expanded) {
          btn.setAttribute('aria-expanded', 'true');
          if (panel) panel.removeAttribute('hidden');
        }
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closePanel();
    });

    bindComposerFocusHide(root);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
