// QuickGigs — shared input/display helpers (XSS protection)
function sanitizeInput(text, maxLen) {
  if (text == null) return '';
  var s = String(text);
  s = s.replace(/<[^>]*>/g, '');
  s = s.replace(/[<>'"`]/g, '');
  s = s.trim();
  if (maxLen && s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

window.sanitizeInput = sanitizeInput;
window.escapeHtml = escapeHtml;

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

function formatRelativeTime(iso) {
  if (!iso) return 'Recently';
  var then = new Date(iso);
  if (isNaN(then.getTime())) return 'Recently';
  var diff = Date.now() - then.getTime();
  if (diff < 0) diff = 0;
  var mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + ' min' + (mins === 1 ? '' : 's') + ' ago';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + ' hr' + (hrs === 1 ? '' : 's') + ' ago';
  var days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return days + ' days ago';
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

window.formatRelativeTime = formatRelativeTime;

function formatPostedTime(iso) {
  return formatRelativeTime(iso);
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
      '.qg-password-wrap input{width:100%;max-width:100%;box-sizing:border-box;padding-right:7.5rem!important;}' +
      '.qg-password-toggle{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-family:DM Sans,sans-serif;font-size:0.75rem;font-weight:500;color:#c8a8e9;padding:4px 0;line-height:1;white-space:nowrap;}' +
      '.qg-password-toggle:hover{color:#fff;text-decoration:underline;}';
    document.head.appendChild(style);
  }

  var wrap = document.createElement('div');
  wrap.className = 'qg-password-wrap';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'qg-password-toggle';
  btn.setAttribute('aria-label', 'Show password');
  btn.textContent = 'See password';
  btn.onclick = function () {
    var show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? 'Hide password' : 'See password';
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  };
  wrap.appendChild(btn);
}

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
var FRAUD_PATTERNS = [
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/,
  /\b\(\d{3}\)\s?\d{3}[-.\s]?\d{4}\b/,
  /\b\d{10,11}\b/,
  /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/,
  /\+\d[\d\s\-]{8,}/,
  /\b(?:instagram|insta|ig|snapchat|snap|telegram|tgm|tg|whatsapp|wa|tiktok|wa\.me|tele\.gram|insta\.gram|facebook|fb\.com|discord|signal(?:\s+app)?|viber)\b/i,
  /\b(?:call\s+me|text\s+me|snap\s+me|dm\s+me|message\s+me\s+on)\b/i,
  /\b(?:venmo|cash\s?app|e[\-\s]?transfer|interac|paypal|zelle|etransfer)\b/i,
  /\b(?:my\s+number|reach\s+me\s+at|contact\s+me\s+at)\b/i,
  /\b(?:four|five|six|seven|eight|nine)\s+(?:zero|one|two|three|four|five|six|seven|eight|nine)\b/i,
  /@[a-zA-Z0-9._]{3,}/,
  // Dotted obfuscation (e.g. tgm.rlk) — not a real public TLD URL
  /\b(?!www\b)[a-z]{2,8}\.(?!com|org|net|edu|gov|ca|io|co|me|app|dev|uk|us|info|biz|html?|js|css)[a-z]{2,8}\b/i
];

var FRAUD_PHONE_RE = /\d{10,}/;
var FRAUD_EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;

function digitsOnly(str) {
  return String(str || '').replace(/\D/g, '');
}

/** Strip URLs / image bodies before digit-sequence checks (avoids false positives). */
function stripForDigitCheck(text) {
  return String(text || '')
    .replace(/\[img\][^\s]*/gi, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\$\d+(?:\.\d{1,2})?/g, '')
    .trim();
}

/** Strip spaces + punctuation for cross-message phone/email scans. */
function stripSpacePunct(text) {
  return String(text || '').replace(/[^a-zA-Z0-9@.+-]/g, '');
}

function isPureDigitChunk(text) {
  var val = stripForDigitCheck(text);
  return /^\d{2,6}$/.test(val);
}

function getOffPlatformWarning() {
  return 'You can\'t share phone numbers, emails, or off-platform payment details on QuickGigs. Keep everything here until payment is complete.';
}

function getDigitsOnlyWarning() {
  return 'Numbers only messages aren\'t allowed — describe the task instead';
}

function getOffPlatformStrongWarning() {
  return 'Sharing contact info violates our terms and can lead to a ban';
}

/**
 * Analyze text (+ optional previous sender messages) for off-platform contact.
 * @returns {{ blocked: boolean, reason?: string, message?: string }}
 */
function analyzeOffPlatformContact(text, recentTexts) {
  if (!text) return { blocked: false };
  if (window.QG_CONFIG && window.QG_CONFIG.blockOffPlatformContact === false) {
    return { blocked: false };
  }
  var val = stripForDigitCheck(String(text).trim());
  if (!val) return { blocked: false };

  var recent = (recentTexts || []).slice(-4).map(function (t) {
    return stripForDigitCheck(String(t || ''));
  }).filter(Boolean);
  var combined = recent.concat([val]).join('');
  var compact = stripSpacePunct(combined);
  var allDigits = digitsOnly(combined);

  // (a) Current + previous 4 messages (spaces/punct stripped) — phone / email across sends
  if (FRAUD_PHONE_RE.test(allDigits) || FRAUD_EMAIL_RE.test(compact)) {
    return {
      blocked: true,
      reason: 'split_contact',
      message: getOffPlatformWarning()
    };
  }

  // (b) Short all-digit messages — not sent, except while a pure digit-chunk trail is
  // still under 10 digits (so "587" → "990" → "8645" is blocked by (a) on the third).
  if (/^\d{2,6}$/.test(val)) {
    var lastRecent = recent.length ? recent[recent.length - 1] : '';
    var continuingTrail = !recent.length || isPureDigitChunk(lastRecent);
    if (continuingTrail) return { blocked: false };
    return {
      blocked: true,
      reason: 'digits_only',
      message: getDigitsOnlyWarning()
    };
  }

  if (/^\d{7,}$/.test(val)) {
    return {
      blocked: true,
      reason: 'digits',
      message: getOffPlatformWarning()
    };
  }

  if (FRAUD_PATTERNS.some(function (p) { return p.test(val); })) {
    return {
      blocked: true,
      reason: 'pattern',
      message: getOffPlatformWarning()
    };
  }

  if (FRAUD_PATTERNS.some(function (p) { return p.test(compact) || p.test(combined); })) {
    return {
      blocked: true,
      reason: 'split_pattern',
      message: getOffPlatformWarning()
    };
  }

  return { blocked: false };
}

function containsOffPlatformContact(text, recentTexts) {
  return analyzeOffPlatformContact(text, recentTexts).blocked;
}

/** Log a fraud / contact-sharing attempt for the admin Security Log + Fraud Alerts. */
function logFraudContactEvent(detail) {
  detail = detail || {};
  try {
    if (typeof sbPost === 'function') {
      sbPost('admin_actions', {
        admin_email: 'system@quickgigs',
        action_type: 'fraud_contact_attempt',
        target_type: detail.convId ? 'conversation' : 'user',
        target_id: String(detail.convId || detail.userId || ''),
        detail: {
          user_id: detail.userId || '',
          conv_id: detail.convId || '',
          reason: detail.reason || '',
          violation: detail.violation || 1,
          preview: String(detail.preview || '').slice(0, 80),
          body: (detail.reason || 'contact') + ' attempt' +
            (detail.violation ? ' (#' + detail.violation + ')' : '')
        }
      }).catch(function () {});
    }
  } catch (e) { /* non-blocking */ }
}

window.analyzeOffPlatformContact = analyzeOffPlatformContact;
window.containsOffPlatformContact = containsOffPlatformContact;
window.containsFraud = containsOffPlatformContact;
window.getOffPlatformWarning = getOffPlatformWarning;
window.getDigitsOnlyWarning = getDigitsOnlyWarning;
window.getOffPlatformStrongWarning = getOffPlatformStrongWarning;
window.logFraudContactEvent = logFraudContactEvent;
window.isPureDigitChunk = isPureDigitChunk;

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
  return !!(url && String(url).trim());
}

function renderUserAvatarHtml(name, avatarUrl, opts) {
  opts = opts || {};
  var cls = opts.className || 'user-avatar';
  var initial = (name || 'U').charAt(0).toUpperCase();
  var label = escapeHtml(name || 'User');
  if (hasProfilePhotoUrl(avatarUrl)) {
    var safeUrl = String(avatarUrl).replace(/'/g, '%27').replace(/"/g, '&quot;');
    return '<div class="' + cls + ' has-photo" style="background-image:url(\'' + safeUrl + '\')" title="' + label + '" aria-label="' + label + '"></div>';
  }
  var bg = opts.gradient || avatarGradientForName(name);
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
      '.qg-toast{position:fixed;bottom:88px;left:50%;transform:translateX(-50%) translateY(12px);' +
      'background:#4ade80;color:#0b0118;padding:12px 22px;border-radius:20px;font-family:DM Sans,sans-serif;' +
      'font-size:13px;font-weight:500;z-index:13000;max-width:min(92vw,420px);text-align:center;line-height:1.45;' +
      'box-shadow:0 8px 32px rgba(0,0,0,.35);opacity:0;visibility:hidden;pointer-events:none;' +
      'transition:opacity .2s ease,transform .2s ease,visibility .2s ease}' +
      '.qg-toast.visible{opacity:1;visibility:visible;transform:translateX(-50%) translateY(0)}';
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
