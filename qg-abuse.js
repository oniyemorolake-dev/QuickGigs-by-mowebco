/**
 * QuickGigs — client-side abuse protection (UX layer only).
 * Real rate limits / validation must be enforced server-side later.
 * Never treat these checks as security.
 */
(function () {
  var DEFAULTS = {
    minBudget: 20,
    maxTitle: 100,
    maxDescription: 2000,
    maxApplyMessage: 1000,
    maxChatMessage: 2000,
    maxReview: 500,
    maxBio: 160,
    maxLocation: 100,
    // Cooldown between successful starts of an action (ms)
    postCooldownMs: 5000,
    applyCooldownMs: 3000,
    // Chat: min gap between sends + burst window
    chatMinGapMs: 900,
    chatBurstMax: 5,
    chatBurstWindowMs: 12000
  };

  function limits() {
    var cfg = (window.QG_CONFIG && window.QG_CONFIG.abuseLimits) || {};
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      out[k] = cfg[k] != null ? cfg[k] : DEFAULTS[k];
    });
    return out;
  }

  var _lastActionAt = {};
  var _inFlight = {};
  var _chatSendTimes = [];

  function now() { return Date.now(); }

  /** Returns { ok:true } or { ok:false, waitMs, message } */
  function checkCooldown(key, cooldownMs) {
    var last = _lastActionAt[key] || 0;
    var wait = cooldownMs - (now() - last);
    if (wait > 0) {
      return {
        ok: false,
        waitMs: wait,
        message: 'Please wait ' + Math.ceil(wait / 1000) + 's before trying again.'
      };
    }
    return { ok: true };
  }

  function markAction(key) {
    _lastActionAt[key] = now();
  }

  function beginFlight(key) {
    if (_inFlight[key]) return false;
    _inFlight[key] = true;
    return true;
  }

  function endFlight(key) {
    _inFlight[key] = false;
  }

  function isInFlight(key) {
    return !!_inFlight[key];
  }

  /** Chat burst + gap. UX only. */
  function checkChatRate() {
    var L = limits();
    var t = now();
    _chatSendTimes = _chatSendTimes.filter(function (ts) {
      return t - ts < L.chatBurstWindowMs;
    });
    if (_chatSendTimes.length >= L.chatBurstMax) {
      var oldest = _chatSendTimes[0];
      var wait = L.chatBurstWindowMs - (t - oldest);
      return {
        ok: false,
        waitMs: wait,
        message: 'You\'re sending messages too quickly. Wait a few seconds.'
      };
    }
    var last = _chatSendTimes[_chatSendTimes.length - 1];
    if (last && t - last < L.chatMinGapMs) {
      return {
        ok: false,
        waitMs: L.chatMinGapMs - (t - last),
        message: 'Slow down — wait a moment before sending another message.'
      };
    }
    return { ok: true };
  }

  function markChatSent() {
    _chatSendTimes.push(now());
  }

  function parseBudget(raw) {
    if (raw == null || String(raw).trim() === '') return { ok: false, error: 'Enter a budget amount.' };
    var n = Number(raw);
    if (!isFinite(n) || isNaN(n)) return { ok: false, error: 'Budget must be a number.' };
    n = Math.round(n * 100) / 100;
    var min = limits().minBudget;
    if (n < min) return { ok: false, error: 'Minimum budget is $' + min + '.', value: n };
    return { ok: true, value: n };
  }

  function validateText(raw, opts) {
    opts = opts || {};
    var max = opts.max != null ? opts.max : 500;
    var min = opts.min != null ? opts.min : 1;
    var label = opts.label || 'This field';
    var s = String(raw == null ? '' : raw).trim();
    if (!s || !/\S/.test(s)) {
      return { ok: false, error: label + ' can\'t be blank.', value: '' };
    }
    if (s.length < min) {
      return { ok: false, error: label + ' is too short.', value: s };
    }
    if (s.length > max) {
      return { ok: false, error: label + ' must be ' + max + ' characters or fewer.', value: s.slice(0, max) };
    }
    return { ok: true, value: s };
  }

  function showInlineError(el, message) {
    if (!el) return;
    el.textContent = message || '';
    el.style.display = message ? 'block' : 'none';
  }

  function setInvalid(input, on) {
    if (!input) return;
    input.classList.toggle('invalid', !!on);
    input.setAttribute('aria-invalid', on ? 'true' : 'false');
  }

  /**
   * Bind maxlength + live counter. Counter gets .is-near / .is-over near the limit.
   * @param {HTMLElement|string} inputEl
   * @param {HTMLElement|string} countEl
   * @param {number} max
   */
  function bindCharCounter(inputEl, countEl, max) {
    var input = typeof inputEl === 'string' ? document.getElementById(inputEl) : inputEl;
    var count = typeof countEl === 'string' ? document.getElementById(countEl) : countEl;
    if (!input || !count || !max) return;
    input.setAttribute('maxlength', String(max));
    function paint() {
      var len = (input.value || '').length;
      count.textContent = len + ' / ' + max;
      count.classList.toggle('is-near', len >= Math.floor(max * 0.85));
      count.classList.toggle('is-over', len >= max);
      // Visible emphasis near the limit
      count.style.opacity = len >= Math.floor(max * 0.7) ? '1' : '';
    }
    if (!input._qgAbuseBound) {
      input._qgAbuseBound = true;
      input.addEventListener('input', paint);
    }
    paint();
  }

  function injectCounterStyles() {
    if (document.getElementById('qg-abuse-css')) return;
    var s = document.createElement('style');
    s.id = 'qg-abuse-css';
    s.textContent =
      '.qg-char-count{font-size:11px;color:var(--text-faint,rgba(255,255,255,0.45));text-align:right;margin-top:4px;transition:color .15s,opacity .15s}' +
      '.qg-char-count.is-near{color:#fbbf24}' +
      '.qg-char-count.is-over{color:#f87171;font-weight:500}' +
      '.field-input.invalid,.modal-input.invalid,.msg-input.invalid,.comment-input.invalid,.edit-bio-input.invalid,' +
      '.edit-name-input.invalid{border-color:#ff6b6b!important}' +
      '.qg-inline-error{font-size:12px;color:#ff6b6b;margin-top:6px;display:none;line-height:1.4}';
    (document.head || document.documentElement).appendChild(s);
  }

  /** Ensure a counter element exists after `input`. */
  function ensureCounter(input, id) {
    if (!input) return null;
    var existing = id ? document.getElementById(id) : null;
    if (existing) return existing;
    var el = document.createElement('div');
    el.className = 'qg-char-count char-count';
    if (id) el.id = id;
    input.insertAdjacentElement('afterend', el);
    return el;
  }

  function ensureErrorEl(afterEl, id) {
    var existing = id ? document.getElementById(id) : null;
    if (existing) return existing;
    if (!afterEl || !afterEl.parentNode) return null;
    var el = document.createElement('div');
    el.className = 'qg-inline-error field-error';
    if (id) el.id = id;
    afterEl.insertAdjacentElement('afterend', el);
    return el;
  }

  injectCounterStyles();

  window.QG_ABUSE = {
    limits: limits,
    checkCooldown: checkCooldown,
    markAction: markAction,
    beginFlight: beginFlight,
    endFlight: endFlight,
    isInFlight: isInFlight,
    checkChatRate: checkChatRate,
    markChatSent: markChatSent,
    parseBudget: parseBudget,
    validateText: validateText,
    showInlineError: showInlineError,
    setInvalid: setInvalid,
    bindCharCounter: bindCharCounter,
    ensureCounter: ensureCounter,
    ensureErrorEl: ensureErrorEl
  };
})();
