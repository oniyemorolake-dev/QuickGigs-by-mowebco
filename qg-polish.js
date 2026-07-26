// QuickGigs — shared polish helpers (safe: only define if missing)
(function () {
  'use strict';

  if (typeof window.showSkeleton !== 'function') {
    window.showSkeleton = function (containerId, count) {
      var el = document.getElementById(containerId);
      if (!el) return;
      var html = '';
      var n = count || 3;
      for (var i = 0; i < n; i++) {
        html += '<div style="background:rgba(255,255,255,0.04);border-radius:16px;padding:16px;margin-bottom:10px;animation:pulse 1.5s infinite ease-in-out"><div style="height:14px;background:rgba(255,255,255,0.08);border-radius:8px;margin-bottom:10px;width:60%"></div><div style="height:10px;background:rgba(255,255,255,0.06);border-radius:8px;width:80%;margin-bottom:8px"></div><div style="height:10px;background:rgba(255,255,255,0.05);border-radius:8px;width:40%"></div></div>';
      }
      el.innerHTML = html;
    };
  }

  if (typeof window.haptic !== 'function') {
    window.haptic = function (pattern) {
      if (navigator.vibrate) navigator.vibrate(pattern || 10);
    };
  }

  if (typeof window.formatDate !== 'function') {
    window.formatDate = function (dateStr) {
      if (!dateStr) return '';
      return new Date(dateStr).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
    };
  }

  if (typeof window.formatCad !== 'function') {
    window.formatCad = function (amount) {
      var n = Math.round(Number(amount) || 0);
      return '$' + n + ' CAD';
    };
  }

  if (typeof window.timeAgo !== 'function') {
    window.timeAgo = function (dateStr) {
      if (!dateStr) return '';
      var diff = Date.now() - new Date(dateStr).getTime();
      var mins = Math.floor(diff / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return mins + 'm ago';
      var hrs = Math.floor(mins / 60);
      if (hrs < 24) return hrs + 'hr ago';
      var days = Math.floor(hrs / 24);
      if (days < 7) return days + 'd ago';
      return window.formatDate(dateStr);
    };
  }

  if (typeof window.showEmptyState !== 'function') {
    window.showEmptyState = function (containerId, icon, title, sub) {
      var el = document.getElementById(containerId);
      if (!el) return;
      el.innerHTML =
        '<div style="text-align:center;padding:60px 20px;animation:fadeIn 0.3s ease">' +
        '<div style="font-size:48px;margin-bottom:16px">' + (icon || '🔍') + '</div>' +
        '<div style="font-size:16px;font-weight:500;color:var(--text);margin-bottom:8px">' + (title || 'Nothing here yet') + '</div>' +
        '<div style="font-size:14px;color:var(--text-muted);line-height:1.6">' + (sub || 'Check back soon') + '</div>' +
        '</div>';
    };
  }

  function toastSafe(msg, color) {
    if (typeof window.showToast === 'function') window.showToast(msg, color);
  }

  window.addEventListener('online', function () { toastSafe('Back online', '#4ade80'); });
  window.addEventListener('offline', function () { toastSafe('You are offline — some features may not work', '#ef4444'); });

  window.addEventListener('beforeunload', function () {
    try {
      sessionStorage.setItem('qg-scroll-' + window.location.pathname, String(window.scrollY || 0));
    } catch (e) {}
  });

  window.addEventListener('load', function () {
    try {
      var pos = sessionStorage.getItem('qg-scroll-' + window.location.pathname);
      if (pos) window.scrollTo(0, parseInt(pos, 10) || 0);
    } catch (e) {}
  });

  document.addEventListener('DOMContentLoaded', function () {
    // Character counters for textareas (skip if already has one)
    document.querySelectorAll('textarea').forEach(function (ta) {
      if (ta.dataset.qgCounter === '1') return;
      if (ta.nextElementSibling && ta.nextElementSibling.classList) {
        var sib = ta.nextElementSibling;
        if (sib.classList.contains('qg-char-counter') || sib.classList.contains('char-count') || sib.id === 'charCount') return;
      }
      var max = ta.getAttribute('maxlength') || 500;
      var counter = document.createElement('div');
      counter.className = 'qg-char-counter';
      counter.style.cssText = 'font-size:11px;color:var(--text-faint);text-align:right;margin-top:4px';
      counter.textContent = (ta.value || '').length + ' / ' + max;
      ta.dataset.qgCounter = '1';
      if (ta.parentNode) ta.parentNode.insertBefore(counter, ta.nextSibling);
      ta.addEventListener('input', function () {
        counter.textContent = ta.value.length + ' / ' + max;
      });
    });

    // Lazy-load images missing the attribute
    document.querySelectorAll('img:not([loading])').forEach(function (img) {
      img.setAttribute('loading', 'lazy');
    });

    // Prevent double form submits
    document.querySelectorAll('form').forEach(function (form) {
      if (form.dataset.qgSubmitGuard === '1') return;
      form.dataset.qgSubmitGuard = '1';
      form.addEventListener('submit', function () {
        var btn = form.querySelector('button[type="submit"], .save-btn, .submit-btn, .empty-btn');
        if (!btn || btn.disabled) return;
        var original = btn.textContent;
        btn.disabled = true;
        btn.dataset.qgOriginalText = original;
        setTimeout(function () {
          if (btn.disabled && btn.dataset.qgOriginalText) {
            btn.disabled = false;
            btn.textContent = btn.dataset.qgOriginalText;
          }
        }, 8000);
      });
    });

    // Page-specific: back to top on browse + dashboard (IntersectionObserver, not scroll spam)
    var page = (window.location.pathname || '').split('/').pop() || '';
    if (page === 'browsetask.html' || page === 'dashboard.html') {
      if (!document.getElementById('backToTop')) {
        var topBtn = document.createElement('button');
        topBtn.id = 'backToTop';
        topBtn.setAttribute('aria-label', 'Back to top');
        topBtn.textContent = '↑';
        topBtn.style.cssText = 'display:none;position:fixed;bottom:90px;right:20px;width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#6b3fa0,#9b6fc4);border:none;color:#fff;font-size:18px;cursor:pointer;z-index:99;box-shadow:0 4px 15px rgba(107,63,160,0.4);transition:opacity 0.2s ease;align-items:center;justify-content:center';
        topBtn.onclick = function () { window.scrollTo({ top: 0, behavior: 'smooth' }); };
        document.body.appendChild(topBtn);
        var sentinel = document.getElementById('qgBackTopSentinel');
        if (!sentinel) {
          sentinel = document.createElement('div');
          sentinel.id = 'qgBackTopSentinel';
          sentinel.setAttribute('aria-hidden', 'true');
          sentinel.style.cssText = 'position:absolute;top:300px;left:0;width:1px;height:1px;pointer-events:none;opacity:0';
          document.body.appendChild(sentinel);
        }
        if (typeof IntersectionObserver === 'function') {
          var io = new IntersectionObserver(function (entries) {
            var entry = entries[0];
            topBtn.style.display = entry && !entry.isIntersecting ? 'flex' : 'none';
          });
          io.observe(sentinel);
        } else {
          topBtn.style.display = 'none';
        }
      }
    }

    // Stagger-fade cards on first render (capped at 8)
    window.qgStaggerCards = function (root) {
      var host = root || document;
      var cards = host.querySelectorAll('.task-card, .stat-card, .action-card, .mini-card, .step, .mode-card');
      var n = Math.min(cards.length, 8);
      for (var i = 0; i < n; i++) {
        if (cards[i].dataset.qgStagger === '1') continue;
        cards[i].dataset.qgStagger = '1';
        cards[i].classList.add('qg-stagger-in');
        cards[i].style.animationDelay = (i * 40) + 'ms';
      }
    };
    window.qgStaggerCards(document);

    if (page === 'browsetask.html') {
      var startY = 0;
      document.addEventListener('touchstart', function (e) {
        startY = e.touches[0].clientY;
      }, { passive: true });
      document.addEventListener('touchend', function (e) {
        if (e.changedTouches[0].clientY - startY > 80 && window.scrollY === 0) {
          if (typeof window.loadTasks === 'function') window.loadTasks();
          toastSafe('Refreshing tasks', '#9b6fc4');
        }
      }, { passive: true });
    }
  });
})();
