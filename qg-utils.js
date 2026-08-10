// QuickGigs — shared input/display helpers (XSS protection)
// Default: treat all user-generated text as plain text. Prefer textContent;
// when building HTML strings, always escapeHtml / escAttr / safeUrl.

function sanitizeInput(text, maxLen) {
  if (text == null) return '';
  var s = String(text);
  s = s.replace(/<[^>]*>/g, '');
  s = s.replace(/[<>'"`]/g, '');
  s = s.trim();
  if (maxLen && s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

/** Escape for HTML text nodes / safe insertion into HTML templates. */
function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape for double-quoted HTML attributes. */
function escAttr(text) {
  return escapeHtml(text).replace(/\r?\n/g, ' ');
}

/**
 * Allow only safe http(s) URLs (or same-origin relative paths) for href/src.
 * Blocks javascript:, data:, vbscript:, etc. (including whitespace / encoding tricks).
 */
function safeUrl(url, opts) {
  opts = opts || {};
  if (url == null) return '';
  var u = String(url).trim();
  if (!u) return '';
  // Collapse whitespace / control chars / zero-width
  u = u.replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, '');
  // Decode a couple of common obfuscations before scheme checks
  try {
    var once = decodeURIComponent(u.replace(/\+/g, ' '));
    if (once && once !== u) u = once.replace(/[\u0000-\u001F\u007F]/g, '');
  } catch (e) { /* keep raw */ }
  var lower = u.replace(/\s+/g, '').toLowerCase();
  if (
    lower.indexOf('javascript:') === 0 ||
    lower.indexOf('data:') === 0 ||
    lower.indexOf('vbscript:') === 0 ||
    lower.indexOf('file:') === 0 ||
    lower.indexOf('blob:') === 0
  ) {
    return '';
  }
  if (/^https?:\/\//i.test(u)) {
    try {
      var parsed = new URL(u);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
      return parsed.href;
    } catch (e) {
      return '';
    }
  }
  // Relative app paths only (no protocol-relative //evil.com)
  if (opts.allowRelative !== false && u.charAt(0) === '/' && u.charAt(1) !== '/') {
    return u;
  }
  if (opts.allowRelative !== false && /^[\w.-]+\.html([\?#][\w\W]*)?$/i.test(u)) {
    return u;
  }
  return '';
}

/** Set element text safely (plain text only). */
function setText(el, text) {
  if (!el) return;
  el.textContent = text == null ? '' : String(text);
}

/** Set href only after safeUrl — never javascript:/data:. */
function setSafeHref(el, url, opts) {
  if (!el) return '';
  var safe = safeUrl(url, opts);
  if (safe) el.setAttribute('href', safe);
  else el.removeAttribute('href');
  return safe;
}

/**
 * Safe local esc() for pages — always full HTML escape even if qg-utils loaded late.
 * Prefer this over incomplete .replace(/</g, ...) fallbacks.
 */
function qgEsc(text) {
  if (typeof escapeHtml === 'function' && escapeHtml !== qgEsc) return escapeHtml(text);
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

window.sanitizeInput = sanitizeInput;
window.escapeHtml = escapeHtml;
window.escAttr = escAttr;
window.safeUrl = safeUrl;
window.setText = setText;
window.setSafeHref = setSafeHref;
window.qgEsc = qgEsc;

/** Capitalize each word — e.g. "john smith" → "John Smith" */
function formatPersonName(name) {
  if (!name) return '';
  return String(name).trim().split(/\s+/).filter(Boolean).map(function(part) {
    if (part.length <= 2 && part.indexOf("'") === -1) {
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    }
    return part.split(/(['-])/).map(function(chunk) {
      if (chunk === "'" || chunk === '-') return chunk;
      if (!chunk) return chunk;
      return chunk.charAt(0).toUpperCase() + chunk.slice(1).toLowerCase();
    }).join('');
  }).join(' ');
}

window.formatPersonName = formatPersonName;

/** Display-only location capitalization — e.g. "calgary, ab" → "Calgary, AB" (does not mutate stored data). */
function formatLocationDisplay(loc) {
  if (!loc) return '';
  return String(loc).trim().split(',').map(function (part) {
    part = part.trim();
    if (!part) return part;
    if (/^[a-zA-Z]{2}$/.test(part)) return part.toUpperCase();
    return part.replace(/\b([a-zA-Z])([a-zA-Z]*)/g, function (_m, first, rest) {
      return first.toUpperCase() + rest.toLowerCase();
    });
  }).filter(Boolean).join(', ');
}

window.formatLocationDisplay = formatLocationDisplay;

/** Trim and uppercase only the first character (rest unchanged). */
function formatTitle(str) {
  if (!str) return str;
  var t = String(str).trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

window.formatTitle = formatTitle;

/**
 * Parse Supabase/Postgres timestamps as real instants.
 * Naive "YYYY-MM-DD HH:MM:SS" / "YYYY-MM-DDTHH:MM:SS" (no Z/offset) is treated as UTC —
 * otherwise JS uses local time and Western Canada clocks see a "future" stamp → "0m ago".
 */
function parseQgTimestamp(input) {
  if (input == null || input === '') return NaN;
  if (input instanceof Date) {
    var dt = input.getTime();
    return isNaN(dt) ? NaN : dt;
  }
  if (typeof input === 'number') {
    if (!isFinite(input)) return NaN;
    // Unix seconds vs milliseconds
    return input < 1e12 ? Math.round(input * 1000) : Math.round(input);
  }
  var s = String(input).trim();
  if (!s) return NaN;
  // "2026-07-27 14:00:00" or "2026-07-27T14:00:00" (no zone) → UTC
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) {
    s = s.replace(' ', 'T');
    if (s.charAt(s.length - 1) !== 'Z') s += 'Z';
  } else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(s)) {
    s = s.replace(' ', 'T');
  }
  var t = Date.parse(s);
  return isNaN(t) ? NaN : t;
}

window.parseQgTimestamp = parseQgTimestamp;

/**
 * Unified relative time: <1m "Just now", <1h "Xm ago", <24h "Xh ago", <7d "Xd ago", else "Mon D".
 * Always based on an absolute timestamp (typically tasks.created_at), never "now" or updated_at.
 */
function timeAgo(date) {
  if (date == null || date === '') return '';
  var thenMs = typeof parseQgTimestamp === 'function' ? parseQgTimestamp(date) : new Date(date).getTime();
  if (isNaN(thenMs)) return '';
  var s = (Date.now() - thenMs) / 1000;
  // Small clock skew / UTC-vs-local misparse residual — not a real future post
  if (s < 0 && s > -120) s = 0;
  // Larger "future" usually means bad zone parse; try forcing UTC once
  if (s < -120 && typeof date === 'string' && date.indexOf('Z') < 0 && date.indexOf('+') < 0) {
    var retry = Date.parse(String(date).trim().replace(' ', 'T') + 'Z');
    if (!isNaN(retry)) {
      s = (Date.now() - retry) / 1000;
    }
  }
  if (s < 0) s = 0;
  if (s < 60) return 'Just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return new Date(thenMs).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

window.timeAgo = timeAgo;

/** Return trimmed desc only when meaningful (> 8 chars); else null. */
function cleanSnippet(desc) {
  if (!desc) return null;
  var t = String(desc).trim();
  return t.length > 8 ? t : null;
}

window.cleanSnippet = cleanSnippet;

function formatRelativeTime(iso) {
  return timeAgo(iso) || 'Recently';
}

window.formatRelativeTime = formatRelativeTime;

/** Post-time label for cards — "Posted 30m ago" (time), never "away" (distance). */
function formatPostedTime(iso) {
  var rel = timeAgo(iso);
  if (!rel) return 'Posted recently';
  if (rel === 'Just now') return 'Posted just now';
  if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(rel)) return 'Posted ' + rel;
  return 'Posted ' + rel;
}

window.formatPostedTime = formatPostedTime;

function attachNameFormatter(inputId) {
  var input = document.getElementById(inputId);
  if (!input || input.dataset.nameFormatReady) return;
  input.dataset.nameFormatReady = '1';
  input.setAttribute('autocomplete', 'name');
  input.addEventListener('blur', function() {
    if (input.value.trim()) input.value = formatPersonName(input.value);
  });
}

window.attachNameFormatter = attachNameFormatter;

function attachPasswordToggle(inputId) {
  var input = document.getElementById(inputId);
  if (!input || input.dataset.toggleReady) return;
  input.dataset.toggleReady = '1';

  if (!document.getElementById('qg-password-toggle-styles')) {
    var style = document.createElement('style');
    style.id = 'qg-password-toggle-styles';
    style.textContent =
      '.qg-password-wrap{position:relative;width:100%;max-width:100%;box-sizing:border-box;}' +
      '.qg-password-wrap input{width:100%;max-width:100%;box-sizing:border-box;padding-right:2.75rem!important;}' +
      '.qg-password-toggle{position:absolute;right:8px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.06);border:1px solid rgba(200,168,233,0.25);border-radius:8px;cursor:pointer;color:#c8a8e9;padding:6px 8px;line-height:1;display:inline-flex;align-items:center;justify-content:center;}' +
      '.qg-password-toggle:hover,.qg-password-toggle:focus-visible{color:#fff;border-color:rgba(200,168,233,0.55);outline:none;box-shadow:0 0 0 3px rgba(107,63,160,0.28);}' +
      '.qg-password-toggle svg{width:18px;height:18px;display:block;pointer-events:none;}' +
      'body.light .qg-password-toggle{background:#f5f2ff;border-color:#e0d8ff;color:#6b3fa0;}' +
      'body.light .qg-password-toggle:hover,body.light .qg-password-toggle:focus-visible{color:#4a1d8a;}';
    document.head.appendChild(style);
  }

  var wrap = document.createElement('div');
  wrap.className = 'qg-password-wrap';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  var EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a21.8 21.8 0 0 1 5.06-5.94"/><path d="M9.9 4.24A10.94 10.94 0 0 1 12 5c7 0 11 7 11 7a21.9 21.9 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'qg-password-toggle';
  btn.setAttribute('aria-label', 'Show password');
  btn.setAttribute('aria-pressed', 'false');
  btn.innerHTML = EYE;
  btn.onclick = function () {
    var show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.innerHTML = show ? EYE_OFF : EYE;
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    btn.setAttribute('aria-pressed', show ? 'true' : 'false');
  };
  wrap.appendChild(btn);
}

/** Friendly Firebase Auth errors — never surface raw SDK strings. */
function qgFirebaseAuthErrorMessage(error) {
  var code = (error && error.code) || '';
  var map = {
    'auth/email-already-in-use': 'An account with this email already exists — log in instead.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
    'auth/user-not-found': 'No account found with this email — sign up instead.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/weak-password': 'Password is too weak. Use at least 8 characters with letters and a number.',
    'auth/network-request-failed': 'Network error. Check your connection and try again.',
    'auth/user-disabled': 'This account has been disabled. Contact support@quickgigs.ca.',
    'auth/missing-email': 'Enter your email address first.',
    'auth/invalid-login-credentials': 'Incorrect email or password.',
    'auth/operation-not-allowed': 'Email sign-in is temporarily unavailable. Try again later.',
    'auth/requires-recent-login': 'Please log in again to continue.'
  };
  if (map[code]) return map[code];
  return 'Something went wrong. Please try again.';
}

function qgIsValidEmail(email) {
  email = String(email || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Returns { score:0-3, label:'weak'|'medium'|'strong'|'', ok:boolean } — min 8 chars. */
function qgPasswordStrength(password) {
  var p = String(password || '');
  if (!p) return { score: 0, label: '', ok: false };
  var score = 0;
  if (p.length >= 8) score++;
  if (p.length >= 10) score++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score++;
  if (/\d/.test(p)) score++;
  if (/[^A-Za-z0-9]/.test(p)) score++;
  var level = 0;
  var label = 'weak';
  if (p.length < 8) {
    level = 1;
    label = 'weak';
  } else if (score <= 2) {
    level = 1;
    label = 'weak';
  } else if (score <= 3) {
    level = 2;
    label = 'medium';
  } else {
    level = 3;
    label = 'strong';
  }
  // Minimum: 8+ chars AND at least medium (mixed case, number, or longer password).
  return { score: level, label: label, ok: p.length >= 8 && level >= 2 };
}

function qgSetFieldError(errorEl, message, show) {
  if (!errorEl) return;
  if (message) errorEl.textContent = message;
  errorEl.style.display = show ? 'block' : 'none';
  errorEl.setAttribute('role', 'alert');
}

function qgSetAuthBusy(btn, busy, idleLabel) {
  if (!btn) return;
  if (busy) {
    if (!btn.dataset.idleLabel) btn.dataset.idleLabel = btn.textContent || idleLabel || '';
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.setAttribute('aria-busy', 'true');
    var label = idleLabel || btn.dataset.busyLabel || 'Please wait…';
    btn.innerHTML = '<span class="signup-btn-spinner" aria-hidden="true"></span><span>' + label + '</span>';
  } else {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    btn.removeAttribute('aria-busy');
    btn.textContent = btn.dataset.idleLabel || idleLabel || btn.textContent;
  }
}

window.qgFirebaseAuthErrorMessage = qgFirebaseAuthErrorMessage;
window.qgIsValidEmail = qgIsValidEmail;
window.qgPasswordStrength = qgPasswordStrength;
window.qgSetFieldError = qgSetFieldError;
window.qgSetAuthBusy = qgSetAuthBusy;

function getDashboardUrl(roleOverride) {
  // Do not overwrite stored mode when building a link — only setMode if an override is explicit
  if (roleOverride != null && roleOverride !== '') {
    if (typeof setMode === 'function') setMode(roleOverride);
    else if (typeof setSessionMode === 'function') setSessionMode(roleOverride);
  }
  return 'dashboard.html';
}

window.attachPasswordToggle = attachPasswordToggle;
window.getDashboardUrl = getDashboardUrl;

// ── Off-platform contact blocking (chat + applications) ──
// CLIENT UX ONLY. A determined user can bypass anything client-side.
// Authoritative check must run server-side (Supabase Edge Function on message insert)
// once that backend exists. Do not treat this buffer as security enforcement.

var FRAUD_WINDOW_MAX = 6;
var FRAUD_WINDOW_MS = 5 * 60 * 1000;
/** @type {Object.<string, Array<{text:string, at:number}>>} */
var _fraudBuffers = {};

var FRAUD_PATTERNS = [
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/,
  /\b\(\d{3}\)\s?\d{3}[-.\s]?\d{4}\b/,
  /\b\d{10,15}\b/,
  /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/,
  /\+\d[\d\s\-]{8,}/,
  /\b(?:instagram|insta|\big\b|snapchat|snap|telegram|tgm|\btg\b|whatsapp|\bwa\b|tiktok|wa\.me|tele\.gram|insta\.gram|facebook|fb\.com|discord|signal(?:\s+app)?|viber)\b/i,
  /\b(?:call\s+me|text\s+me|snap\s+me|dm\s+me|message\s+me\s+on|add\s+me\s+on)\b/i,
  /\b(?:venmo|cash\s?app|e[\-\s]?transfer|interac|paypal|zelle|etransfer)\b/i,
  /\b(?:my\s+number|reach\s+me\s+at|contact\s+me\s+at|my\s+email)\b/i,
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine)(?:\s*[- ]\s*(?:zero|one|two|three|four|five|six|seven|eight|nine)){3,}\b/i,
  /@[a-zA-Z0-9._]{3,}/,
  /\b(?:https?:\/\/|www\.)\S+/i,
  // Dotted obfuscation (e.g. tgm.rlk) — not a real public TLD URL
  /\b(?!www\b)[a-z]{2,8}\.(?!com|org|net|edu|gov|ca|io|co|me|app|dev|uk|us|info|biz|html?|js|css)[a-z]{2,8}\b/i
];

var FRAUD_PHONE_RE = /\d{10,15}/;
var FRAUD_EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;

function fraudBufferKey(conversationId, senderId) {
  return String(conversationId || '') + '::' + String(senderId || '');
}

function pruneFraudBuffer(list) {
  var now = Date.now();
  return (list || []).filter(function (e) {
    return e && (now - e.at) <= FRAUD_WINDOW_MS;
  }).slice(-FRAUD_WINDOW_MAX);
}

/**
 * Clear the sliding-window buffer when contact is legitimately unlocked (escrow funded).
 * @param {string} conversationId
 * @param {string} senderId
 */
function clearBuffer(conversationId, senderId) {
  delete _fraudBuffers[fraudBufferKey(conversationId, senderId)];
}

/** Clear buffers for both parties in a conversation (call on escrow unlock). */
function clearConversationFraudBuffers(conversationId, posterId, workerId) {
  if (posterId) clearBuffer(conversationId, posterId);
  if (workerId) clearBuffer(conversationId, workerId);
}

function getFraudBufferTexts(conversationId, senderId) {
  var key = fraudBufferKey(conversationId, senderId);
  _fraudBuffers[key] = pruneFraudBuffer(_fraudBuffers[key]);
  return _fraudBuffers[key].map(function (e) { return e.text; });
}

/** Record a successfully sent message into the sliding window. */
function recordFraudBufferMessage(conversationId, senderId, text) {
  if (!conversationId || !senderId || !text) return;
  var key = fraudBufferKey(conversationId, senderId);
  var list = pruneFraudBuffer(_fraudBuffers[key]);
  list.push({ text: String(text), at: Date.now() });
  _fraudBuffers[key] = list.slice(-FRAUD_WINDOW_MAX);
}

/** Seed buffer from loaded chat history (own messages only). */
function seedFraudBuffer(conversationId, senderId, texts) {
  if (!conversationId || !senderId) return;
  clearBuffer(conversationId, senderId);
  (texts || []).slice(-FRAUD_WINDOW_MAX).forEach(function (t) {
    if (t) recordFraudBufferMessage(conversationId, senderId, t);
  });
}

function digitsOnly(str) {
  return String(str || '').replace(/\D/g, '');
}

/** Lowercase, strip money/images/urls noise, O→0 beside digits, spoken email → @/. */
function normalizeFraudText(text) {
  var s = String(text || '').toLowerCase();
  s = s.replace(/\[img\][^\s]*/g, ' ');
  s = s.replace(/https?:\/\/\S+/gi, ' ');
  s = s.replace(/\$\d+(?:\.\d{1,2})?/g, ' ');
  // O/o as zero only when adjacent to a digit (avoids wrecking "for"/"hours")
  s = s.replace(/(\d)[o]/g, '$10');
  s = s.replace(/[o](\d)/g, '0$1');
  // Spoken email only — do NOT rewrite every " at " (e.g. "at your place" → "@your" false positive).
  s = s.replace(
    /\b([a-z0-9._%+\-]+)\s+at\s+([a-z0-9.\-]+)\s+dot\s+([a-z]{2,})\b/g,
    '$1@$2.$3'
  );
  s = s.replace(
    /\b([a-z0-9._%+\-]+)\s+at\s+(gmail|yahoo|hotmail|outlook|icloud|protonmail|live|aol)\b/g,
    '$1@$2'
  );
  s = s.replace(/\s*\(\s*at\s*\)\s*/g, '@');
  return s.trim();
}

/** True when text is essentially a phone / digit blob (not prose that happens to mention years/dates). */
function isDigitHeavyContactSoup(text) {
  var raw = String(text || '').trim();
  if (!raw) return false;
  var digits = digitsOnly(raw);
  if (digits.length < 7 || digits.length > 15) return false;
  var stripped = raw.replace(/[\s\-().+]/g, '');
  if (/^\d{7,15}$/.test(stripped)) return true;
  var compactLen = raw.replace(/\s/g, '').length || 1;
  return (digits.length / compactLen) >= 0.7;
}

function stripSpacePunct(text) {
  return String(text || '').replace(/[^a-zA-Z0-9@.+-]/g, '');
}

function isPureDigitChunk(text) {
  var val = normalizeFraudText(text).replace(/[\s\-().]/g, '');
  return /^\d{2,6}$/.test(val);
}

function getOffPlatformWarning() {
  return 'Sharing contact details is against QuickGigs rules — keep chat and payment on QuickGigs';
}

function getDigitsOnlyWarning() {
  return 'Heads up: sending numbers in pieces can look like a phone number. Keep contact details off chat.';
}

function getOffPlatformStrongWarning() {
  return 'Sharing contact info violates our terms and can lead to a ban';
}

function hardBlock(reason) {
  return { blocked: true, softWarn: false, reason: reason, message: getOffPlatformWarning() };
}

/**
 * Analyze text against a sliding window of this sender's recent messages
 * (per conversation, last ~6 within 5 minutes), COMBINED — so split phones reassemble.
 *
 * @param {string} text
 * @param {string[]} [recentTexts] optional fallback texts (e.g. UI history)
 * @param {{convId?:string,senderId?:string}} [opts]
 * @returns {{ blocked: boolean, softWarn?: boolean, reason?: string, message?: string }}
 */
function analyzeOffPlatformContact(text, recentTexts, opts) {
  opts = opts || {};
  if (!text) return { blocked: false };
  if (typeof window !== 'undefined' && window.QG_CONFIG && window.QG_CONFIG.blockOffPlatformContact === false) {
    return { blocked: false };
  }

  var val = normalizeFraudText(String(text).trim());
  if (!val) return { blocked: false };

  var buffered = [];
  if (opts.convId && opts.senderId) {
    buffered = getFraudBufferTexts(opts.convId, opts.senderId);
  }
  var fallback = (recentTexts || []).slice(-FRAUD_WINDOW_MAX).map(function (t) {
    return normalizeFraudText(String(t || ''));
  }).filter(Boolean);

  // Prefer live buffer; fall back to UI recent texts when buffer empty
  var windowTexts = buffered.length ? buffered : fallback;
  var combinedRaw = windowTexts.concat([val]).join(' ');
  var compact = stripSpacePunct(combinedRaw);
  var allDigits = digitsOnly(combinedRaw);

  // Concatenated short digit-only messages → phone
  var digitTrail = windowTexts.concat([val]).filter(function (t) {
    return isPureDigitChunk(t);
  }).map(function (t) {
    return digitsOnly(t);
  }).join('');
  if (digitTrail.length >= 10 && FRAUD_PHONE_RE.test(digitTrail)) {
    return hardBlock('split_phone');
  }

  // Spaced / separator phones — only when the window is digit-heavy (not prose with years/dates)
  if (isDigitHeavyContactSoup(combinedRaw) && FRAUD_PHONE_RE.test(allDigits)) {
    return hardBlock('phone');
  }
  // Contiguous phone-like run in the current message (with optional separators)
  if (/(?:\d[\s\-().+]*){9,14}\d/.test(val)) {
    return hardBlock('phone');
  }

  if (FRAUD_EMAIL_RE.test(compact) || FRAUD_EMAIL_RE.test(val)) {
    return hardBlock('email');
  }

  // Current message hard patterns (handles, apps, links, spoken contact)
  if (FRAUD_PATTERNS.some(function (p) { return p.test(val); })) {
    return hardBlock('pattern');
  }

  // Patterns across the combined window (split "dm" + "me", etc.)
  if (FRAUD_PATTERNS.some(function (p) { return p.test(compact) || p.test(combinedRaw); })) {
    return hardBlock('split_pattern');
  }

  // Lone 7–15 digit blob in one message (not incidental digits in prose)
  if (isDigitHeavyContactSoup(val)) {
    return hardBlock('digits');
  }

  // Soft-warn: short digit-only fragment (possible split) — allow, caller should log
  if (isPureDigitChunk(val)) {
    return {
      blocked: false,
      softWarn: true,
      reason: 'digit_fragment',
      message: getDigitsOnlyWarning()
    };
  }

  return { blocked: false };
}

function containsOffPlatformContact(text, recentTexts, opts) {
  return analyzeOffPlatformContact(text, recentTexts, opts).blocked;
}

/** Log a fraud / contact-sharing attempt for the admin Security Log + Fraud Alerts. */
function logFraudContactEvent(detail) {
  detail = detail || {};
  try {
    if (typeof sbPost === 'function') {
      sbPost('admin_actions', {
        admin_email: 'system@quickgigs',
        action_type: detail.soft ? 'fraud_contact_soft_warn' : 'fraud_contact_attempt',
        target_type: detail.convId ? 'conversation' : 'user',
        target_id: String(detail.convId || detail.userId || ''),
        detail: {
          user_id: detail.userId || '',
          conv_id: detail.convId || '',
          reason: detail.reason || '',
          soft: !!detail.soft,
          violation: detail.violation || 1,
          preview: String(detail.preview || '').slice(0, 80),
          body: (detail.soft ? 'soft warn: ' : '') + (detail.reason || 'contact') + ' attempt' +
            (detail.violation ? ' (#' + detail.violation + ')' : '')
        }
      }).catch(function () {});
    }
  } catch (e) { /* non-blocking */ }

  // Also land in the admin Reports / moderation queue (hard matches only)
  if (!detail.soft && typeof createReport === 'function' && detail.userId && !detail.skipReport) {
    try {
      createReport({
        reporter_id: detail.userId,
        target_type: 'user',
        target_id: detail.userId,
        reason: 'off_platform',
        detail: JSON.stringify({
          auto: true,
          source: 'chat_contact_filter',
          reason: detail.reason || 'contact',
          conv_id: detail.convId || '',
          preview: String(detail.preview || '').slice(0, 120)
        })
      }).catch(function () {});
    } catch (e2) { /* non-blocking */ }
  }
}

window.analyzeOffPlatformContact = analyzeOffPlatformContact;
window.containsOffPlatformContact = containsOffPlatformContact;
window.containsFraud = containsOffPlatformContact;
window.getOffPlatformWarning = getOffPlatformWarning;
window.getDigitsOnlyWarning = getDigitsOnlyWarning;
window.getOffPlatformStrongWarning = getOffPlatformStrongWarning;
window.logFraudContactEvent = logFraudContactEvent;
window.isPureDigitChunk = isPureDigitChunk;
window.clearBuffer = clearBuffer;
window.clearFraudBuffer = clearBuffer;
window.clearConversationFraudBuffers = clearConversationFraudBuffers;
window.recordFraudBufferMessage = recordFraudBufferMessage;
window.seedFraudBuffer = seedFraudBuffer;
window.normalizeFraudText = normalizeFraudText;

var AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#6b3fa0,#c8a8e9)',
  'linear-gradient(135deg,#16a34a,#4ade80)',
  'linear-gradient(135deg,#d97706,#fbbf24)',
  'linear-gradient(135deg,#2563eb,#60a5fa)',
  'linear-gradient(135deg,#9b6fc4,#c8a8e9)'
];

function avatarGradientForName(name) {
  var n = 0;
  for (var i = 0; i < (name || '').length; i++) n += name.charCodeAt(i);
  return AVATAR_GRADIENTS[n % AVATAR_GRADIENTS.length];
}

function hasProfilePhotoUrl(url) {
  // Presence check only (storage HTTPS, or rare local blob during upload).
  // Rendering must still go through safeUrl / safeMediaUrl.
  return !!(url && String(url).trim());
}

/** Like safeUrl, but also allows blob: for same-tab upload previews only. */
function safeMediaUrl(url) {
  var https = safeUrl(url);
  if (https) return https;
  var u = String(url == null ? '' : url).trim();
  if (/^blob:/i.test(u) && typeof location !== 'undefined') return u;
  return '';
}

/** CSS background-image:url("…") — scheme-checked + quoted. */
function safeCssUrl(url) {
  var u = safeMediaUrl(url);
  if (!u) return '';
  return 'url("' + String(u).replace(/\\/g, '\\\\').replace(/"/g, '\\22') + '")';
}

window.safeMediaUrl = safeMediaUrl;
window.safeCssUrl = safeCssUrl;

function renderUserAvatarHtml(name, avatarUrl, opts) {
  opts = opts || {};
  var cls = opts.className || 'user-avatar';
  var initial = (name || 'U').charAt(0).toUpperCase();
  var label = escapeHtml(name || 'User');
  var photo = safeMediaUrl(avatarUrl);
  var size = Number(opts.size) || 40;
  if (photo) {
    // Remote avatars: lazy + async decode + intrinsic size hints.
    // Inline max dimensions so flex parents (messages list) can't expand to intrinsic photo size.
    var box = 'width:' + size + 'px;height:' + size + 'px;min-width:' + size + 'px;min-height:' + size + 'px;max-width:' + size + 'px;max-height:' + size + 'px;overflow:hidden;flex-shrink:0;box-sizing:border-box;';
    return '<div class="' + cls + ' has-photo" title="' + label + '" aria-label="' + label + '" style="' + box + '">' +
      '<img src="' + escAttr(photo) + '" alt="" loading="lazy" decoding="async" width="' + size + '" height="' + size + '" ' +
      'style="width:100%;height:100%;max-width:100%;max-height:100%;object-fit:cover;display:block;border-radius:inherit">' +
      '</div>';
  }
  var bg = opts.gradient || avatarGradientForName(name);
  // Gradients are from our allowlist only — never user CSS
  return '<div class="' + cls + '" style="background:' + bg + '" title="' + label + '" aria-label="' + label + '">' + escapeHtml(initial) + '</div>';
}

function getCurrentPageReturnUrl() {
  if (typeof window === 'undefined' || !window.location) return '';
  var page = window.location.pathname.split('/').pop() || '';
  if (!page || page === 'profile.html') return '';
  return page + (window.location.search || '');
}

function sanitizeReturnUrl(url) {
  if (!url || typeof url !== 'string') return '';
  var u = url.trim();
  if (/^javascript:/i.test(u) || u.indexOf('://') !== -1) return '';
  if (u.indexOf('..') !== -1) return '';
  if (!/^[\w.-]+\.html([\?#][\w\W]*)?$/i.test(u)) return '';
  return u;
}

function getProfileUrl(uid, returnTo) {
  if (!uid) return 'profile.html';
  var url = 'profile.html?user=' + encodeURIComponent(String(uid));
  var from = sanitizeReturnUrl(returnTo) || getCurrentPageReturnUrl();
  if (from) url += '&from=' + encodeURIComponent(from);
  return url;
}

function profileNameLink(name, uid, opts) {
  opts = opts || {};
  var label = opts.pronouns && opts.pronouns !== 'prefer not to say'
    ? formatNameWithPronouns(name, opts.pronouns)
    : (name || 'User');
  if (!uid) return escapeHtml(label);
  var cls = opts.className || 'profile-link';
  var style = opts.style || 'color:inherit;text-decoration:underline;text-underline-offset:2px';
  return '<a href="' + getProfileUrl(uid) + '" class="' + cls + '" style="' + style + '">' + escapeHtml(label) + '</a>';
}

function formatNameWithPronouns(name, pronouns) {
  var n = (name || '').trim();
  var p = (pronouns || '').trim();
  if (!p || p.toLowerCase() === 'prefer not to say') return n || 'User';
  return n ? n + ' · ' + p : p;
}

window.formatNameWithPronouns = formatNameWithPronouns;

window.safeMediaUrl = safeMediaUrl;
window.avatarGradientForName = avatarGradientForName;
window.hasProfilePhotoUrl = hasProfilePhotoUrl;
window.renderUserAvatarHtml = renderUserAvatarHtml;
window.getCurrentPageReturnUrl = getCurrentPageReturnUrl;
window.sanitizeReturnUrl = sanitizeReturnUrl;
window.getProfileUrl = getProfileUrl;
window.profileNameLink = profileNameLink;

/** In-app toast — bottom of screen, not browser alert(). */
function showToast(msg, color) {
  if (!msg) return;
  if (!document.getElementById('qg-toast-styles')) {
    var style = document.createElement('style');
    style.id = 'qg-toast-styles';
    style.textContent =
      '.qg-toast{position:fixed;bottom:calc(88px + env(safe-area-inset-bottom,0px));left:50%;transform:translateX(-50%) translateY(12px);' +
      'background:#4ade80;color:#0b0118;padding:12px 22px;border-radius:20px;font-family:DM Sans,sans-serif;' +
      'font-size:13px;font-weight:500;z-index:13000;max-width:min(92vw,420px);text-align:center;line-height:1.45;' +
      'box-shadow:0 8px 32px rgba(0,0,0,.35);opacity:0;visibility:hidden;pointer-events:none;' +
      'transition:opacity .2s ease,transform .2s ease,visibility .2s ease}' +
      '.qg-toast.visible{opacity:1;visibility:visible;transform:translateX(-50%) translateY(0)}' +
      'body.qg-apply-open .qg-toast{top:calc(12px + env(safe-area-inset-top,0px));bottom:auto;z-index:14000}';
    document.head.appendChild(style);
  }
  var el = document.getElementById('qgToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'qgToast';
    el.className = 'qg-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = String(msg);
  el.style.background = color || '#4ade80';
  el.style.color = color ? '#fff' : '#0b0118';
  el.classList.add('visible');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(function () {
    el.classList.remove('visible');
  }, 3200);
}

window.showToast = showToast;

/** Toast with alert() fallback for modules that load before qg-utils. */
function qgNotify(msg, color) {
  if (!msg) return;
  if (typeof showToast === 'function') showToast(msg, color);
  else if (typeof window.showToast === 'function') window.showToast(msg, color);
  else alert(msg);
}
window.qgNotify = qgNotify;

/**
 * sessionStorage cache with TTL (default 5 min).
 * Used for categories/filter options and the current user profile.
 */
async function getCached(key, fetcher, ttl) {
  ttl = ttl == null ? 300000 : ttl;
  var storageKey = 'qg-cache:' + String(key);
  try {
    var raw = sessionStorage.getItem(storageKey);
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.at && (Date.now() - parsed.at) < ttl) {
        return parsed.data;
      }
    }
  } catch (e) {}
  var data = typeof fetcher === 'function' ? await fetcher() : fetcher;
  // Do not cache null/empty user profile lookups — avoids sticky "missing" after signup/login.
  var skipCache = data == null && String(key).indexOf('user-profile') === 0;
  if (!skipCache) {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ at: Date.now(), data: data }));
    } catch (e2) {}
  }
  return data;
}

window.getCached = getCached;

/**
 * Auth identity — single source of truth for the signed-in Firebase user.
 *
 * ROOT CAUSE (account A → lands as B): qg-menu.js logout used to call
 * doLogout() only when a page defined it (dashboard/admin). On profile /
 * browse / mytasks / chat / etc. it fell through to location.href = login.html
 * WITHOUT Firebase signOut(), so Auth persistence kept B signed in and
 * sessionStorage/localStorage profile caches survived into the next session.
 */
var QG_AUTH_LS_KEEP = {
  'qg-theme': 1,
  'qg-cookie-consent': 1,
  'qg-pwa-dismiss': 1,
  'qg-pwa-ios-dismiss': 1,
  'qg-install-dismiss': 1,
  'qg-near-radius-km': 1,
  // Legacy welcome-tour flag (also preserved by prefix below)
  'qg-onboarded': 1,
  'qg-browse-hint-seen': 1
};

/** Keys that survive login clears — uid-scoped UX prefs. */
function qgAuthLsKeyShouldKeep(key) {
  if (!key) return false;
  if (QG_AUTH_LS_KEEP[key]) return true;
  if (key.indexOf('qg-welcome-tour:') === 0) return true;
  if (key.indexOf('qg-onboarding-done:') === 0) return true;
  return false;
}

var QG_AUTH_UID_KEY = 'qg-auth-uid';

function readStoredAuthUid() {
  try {
    return String(sessionStorage.getItem(QG_AUTH_UID_KEY) || localStorage.getItem(QG_AUTH_UID_KEY) || '');
  } catch (e) {
    return '';
  }
}

function writeStoredAuthUid(uid) {
  try {
    if (uid) {
      sessionStorage.setItem(QG_AUTH_UID_KEY, uid);
      localStorage.setItem(QG_AUTH_UID_KEY, uid);
    } else {
      sessionStorage.removeItem(QG_AUTH_UID_KEY);
      localStorage.removeItem(QG_AUTH_UID_KEY);
    }
  } catch (e2) {}
}

function clearQgUserScopedStorage() {
  try {
    sessionStorage.clear();
  } catch (e) {}

  try {
    var remove = [];
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (!key) continue;
      if (qgAuthLsKeyShouldKeep(key)) continue;
      // Never touch firebase:* — Auth persistence is owned by signOut().
      if (key.indexOf('firebase:') === 0) continue;
      if (key.indexOf('qg-') === 0) remove.push(key);
    }
    remove.forEach(function (k) {
      try { localStorage.removeItem(k); } catch (e2) {}
    });
  } catch (e3) {}

  try {
    window._qgCurrentDbUser = null;
    window._currentDbUser = null;
    window._qgIsSubscriber = false;
    window._currentUserAvatarUrl = '';
    window._userName = '';
  } catch (e4) {}
}

/**
 * Canonical current user — ALWAYS prefer firebase.auth().currentUser when
 * available. Never invent identity from profile/localStorage caches.
 */
function getCurrentUser() {
  try {
    if (window._auth && window._auth.currentUser) {
      var live = window._auth.currentUser;
      if (!window._currentUser || String(window._currentUser.uid) !== String(live.uid)) {
        window._qgAuthUser = live;
        window._qgAuthUid = String(live.uid);
        window._currentUser = live;
        window._qgAuthReady = true;
      }
      return live;
    }
  } catch (e) {}
  if (window._qgAuthReady) {
    return window._qgAuthUser || null;
  }
  return window._currentUser || null;
}

function getCurrentUserId() {
  var u = getCurrentUser();
  return u && u.uid ? String(u.uid) : '';
}

/**
 * Call from every onAuthStateChanged handler (and nowhere else for identity).
 * Clears user-scoped caches when the uid changes or the user signs out.
 */
function setCurrentUser(user) {
  var prevUid = window._qgAuthUid ? String(window._qgAuthUid) : '';
  if (!prevUid) prevUid = readStoredAuthUid();
  var nextUid = user && user.uid ? String(user.uid) : '';

  // If Auth already has a user, never trust a mismatched argument.
  try {
    if (window._auth && window._auth.currentUser && nextUid) {
      var liveUid = String(window._auth.currentUser.uid);
      if (liveUid !== nextUid) {
        user = window._auth.currentUser;
        nextUid = liveUid;
      }
    }
  } catch (e) {}

  window._qgAuthReady = true;

  if (!nextUid) {
    if (prevUid || window._currentUser || window._qgCurrentDbUser) {
      clearQgUserScopedStorage();
    }
    window._qgAuthUser = null;
    window._qgAuthUid = '';
    window._currentUser = null;
    writeStoredAuthUid('');
    return null;
  }

  if (prevUid && prevUid !== nextUid) {
    clearQgUserScopedStorage();
  }

  window._qgAuthUser = user;
  window._qgAuthUid = nextUid;
  window._currentUser = user;
  writeStoredAuthUid(nextUid);

  // After Firebase resolves a real user, probe whether Supabase accepts the ID token.
  // Prevents the "log in again" loop when REST 401 is a third-party config problem.
  try {
    if (
      window.QG_CONFIG &&
      window.QG_CONFIG.supabaseFirebaseAuth === true &&
      typeof window.qgProbeSupabaseFirebaseAuth === 'function' &&
      !window.__qgSupabaseJwtProbeDone
    ) {
      window.qgProbeSupabaseFirebaseAuth(user).then(function (ok) {
        console.info('[QG auth] session:verified', { supabaseAcceptsFirebaseJwt: ok });
      });
    }
  } catch (eProbe) {}

  return user;
}

/** Wipe caches before a new credential is applied (login / Google). */
function qgPrepareLogin() {
  clearQgUserScopedStorage();
  window._qgAuthUser = null;
  window._qgAuthUid = '';
  window._currentUser = null;
  window._qgAuthReady = false;
  writeStoredAuthUid('');
}

/**
 * signOut + clear every user-scoped cache, then go to login.
 * @param {import('firebase/auth').Auth} [auth]
 */
async function qgLogout(auth) {
  clearQgUserScopedStorage();
  window._qgAuthUser = null;
  window._qgAuthUid = '';
  window._currentUser = null;
  window._qgAuthReady = true;
  writeStoredAuthUid('');

  try {
    if (auth && typeof auth.signOut === 'function') {
      await auth.signOut();
    } else if (window._auth && typeof window._auth.signOut === 'function') {
      await window._auth.signOut();
    } else if (typeof firebase !== 'undefined' && firebase.auth) {
      await firebase.auth().signOut();
    }
  } catch (e) {
    console.warn('qgLogout signOut:', e);
  }

  window.location.href = 'login.html';
}

window.clearQgUserScopedStorage = clearQgUserScopedStorage;
window.getCurrentUser = getCurrentUser;
window.getCurrentUserId = getCurrentUserId;
window.setCurrentUser = setCurrentUser;
window.qgPrepareLogin = qgPrepareLogin;
window.qgLogout = qgLogout;
window.doLogout = function () {
  qgLogout(window._auth);
};

/**
 * Compress an image file via canvas → image/webp @ 0.8 quality, max width maxW (default 640).
 * Falls back to the original file if canvas/webp is unavailable.
 */
function compressImage(file, maxW) {
  maxW = maxW || 640;
  return new Promise(function (resolve) {
    if (!file || !file.type || file.type.indexOf('image/') !== 0) {
      resolve(file);
      return;
    }
    if (typeof URL === 'undefined' || !document.createElement) {
      resolve(file);
      return;
    }
    var img = new Image();
    var objectUrl = URL.createObjectURL(file);
    img.onload = function () {
      try {
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        if (!w || !h) {
          URL.revokeObjectURL(objectUrl);
          resolve(file);
          return;
        }
        var scale = w > maxW ? maxW / w : 1;
        var cw = Math.max(1, Math.round(w * scale));
        var ch = Math.max(1, Math.round(h * scale));
        var canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        var ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(objectUrl);
          resolve(file);
          return;
        }
        ctx.drawImage(img, 0, 0, cw, ch);
        URL.revokeObjectURL(objectUrl);
        if (!canvas.toBlob) {
          resolve(file);
          return;
        }
        canvas.toBlob(function (blob) {
          if (!blob) {
            resolve(file);
            return;
          }
          var base = String(file.name || 'photo').replace(/\.[^.]+$/, '');
          var out = new File([blob], base + '.webp', { type: 'image/webp', lastModified: Date.now() });
          resolve(out);
        }, 'image/webp', 0.8);
      } catch (err) {
        try { URL.revokeObjectURL(objectUrl); } catch (e) {}
        resolve(file);
      }
    };
    img.onerror = function () {
      try { URL.revokeObjectURL(objectUrl); } catch (e) {}
      resolve(file);
    };
    img.src = objectUrl;
  });
}

window.compressImage = compressImage;

/**
 * Platform fees — prefer feeBreakdown.js (load before this file).
 * Rates: one-off 25% | recurring 10% | one-off sub 20% | recurring sub 8%.
 * Never hardcode 0.25 elsewhere.
 */
if (typeof window.feeBreakdown !== 'function') {
  (function () {
    var FEE = { oneoff: 0.25, recurring: 0.10, oneoff_sub: 0.20, recurring_sub: 0.08 };
    function feeRate(opts) {
      opts = opts || {};
      if (opts.isRecurring) return opts.isSubscriber ? FEE.recurring_sub : FEE.recurring;
      return opts.isSubscriber ? FEE.oneoff_sub : FEE.oneoff;
    }
    function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
    window.QG_FEE = FEE;
    window.feeRate = feeRate;
    window.periodTotal = function (hourlyRate, hours) {
      return round2((Number(hourlyRate) || 0) * (Number(hours) || 0));
    };
    window.feeBreakdown = function (amount, opts) {
      var total = round2(amount);
      if (!isFinite(total) || total < 0) total = 0;
      var rate = feeRate(opts || {});
      var fee = round2(total * rate);
      var payout = round2(total - fee);
      var ratePct = Math.round(rate * 100);
      return { total: total, fee: fee, payout: payout, rate: rate, ratePct: ratePct, percent: ratePct };
    };
  })();
}

function formatCadAmount(n) {
  return '$' + (Number(n) || 0).toFixed(2) + ' CAD';
}

/**
 * Poster pays $TOTAL[/period] · Tasker receives $PAYOUT · QuickGigs fee $FEE (RATEPCT%)
 * Always routes through feeBreakdown / formatCommitmentBreakdown — never hardcode %.
 */
function formatFeeCommitmentLine(amount, opts) {
  opts = opts || {};
  if (opts.taskerFacing) return formatTaskerPayoutLine(amount, opts);
  if (typeof formatCommitmentBreakdown === 'function') {
    return formatCommitmentBreakdown(amount, Object.assign({}, opts, { taskerFacing: false }));
  }
  var b = feeBreakdown(amount, opts);
  var pct = b.ratePct != null ? b.ratePct : b.percent;
  var period = '';
  if (opts.isRecurring) {
    var pl = opts.periodLabel || 'per period';
    period = '/' + String(pl).replace(/^per\s+/i, '');
  }
  return 'Poster pays $' + b.total.toFixed(2) + period +
    ' · Tasker receives $' + b.payout.toFixed(2) + period +
    ' · QuickGigs fee $' + b.fee.toFixed(2) + ' (' + pct + '%)';
}

/** Tasker-facing: Poster pays $TOTAL · You receive $PAYOUT · QuickGigs fee $FEE (RATEPCT%). */
function formatTaskerPayoutLine(amount, opts) {
  opts = opts || {};
  var feeOpts = Object.assign({}, opts, {
    taskerFacing: true,
    isSubscriber: opts.isSubscriber != null
      ? !!opts.isSubscriber
      : (typeof currentUserIsSubscriber === 'function' ? currentUserIsSubscriber() : !!window._qgIsSubscriber)
  });
  if (typeof formatCommitmentBreakdown === 'function') {
    return formatCommitmentBreakdown(amount, feeOpts);
  }
  var b = feeBreakdown(amount, feeOpts);
  var pct = b.ratePct != null ? b.ratePct : b.percent;
  var period = '';
  if (feeOpts.isRecurring) {
    var pl = feeOpts.periodLabel || 'per period';
    period = '/' + String(pl).replace(/^per\s+/i, '');
  }
  return 'Poster pays $' + b.total.toFixed(2) + period +
    ' · You receive $' + b.payout.toFixed(2) + period +
    ' · QuickGigs fee $' + b.fee.toFixed(2) + ' (' + pct + '%)';
}

function formatFeeBreakdownHtml(amount, opts) {
  opts = opts || {};
  var feeOpts = {
    isRecurring: !!opts.isRecurring,
    isSubscriber: opts.isSubscriber != null
      ? !!opts.isSubscriber
      : (typeof currentUserIsSubscriber === 'function' ? currentUserIsSubscriber() : false),
    task: opts.task,
    periodLabel: opts.periodLabel
  };
  var line = opts.taskerOnly
    ? formatTaskerPayoutLine(amount, feeOpts)
    : formatFeeCommitmentLine(amount, feeOpts);
  var cls = 'qg-fee-breakdown' + (opts.className ? ' ' + opts.className : '');
  return '<div class="' + cls + '">' + line + (opts.cad === false ? '' : ' CAD') + '</div>';
}

window.formatCadAmount = formatCadAmount;
window.formatFeeCommitmentLine = formatFeeCommitmentLine;
window.formatTaskerPayoutLine = formatTaskerPayoutLine;
window.formatFeeBreakdownHtml = formatFeeBreakdownHtml;
