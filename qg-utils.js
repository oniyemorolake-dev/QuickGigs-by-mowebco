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
      '.qg-password-wrap{position:relative;width:100%;}' +
      '.qg-password-wrap input{padding-right:7.5rem!important;}' +
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
  var role = roleOverride || localStorage.getItem('qg-role') || localStorage.getItem('qg-session-mode') || 'poster';
  var mode = role === 'worker' ? 'worker' : 'poster';
  if (typeof setSessionMode === 'function') setSessionMode(mode);
  else localStorage.setItem('qg-session-mode', mode);
  return 'dashboard.html?mode=' + mode;
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
  /\b(?:call me|text me|whatsapp|wa\.me|telegram|tgm|tele\.gram|snapchat|snap me|instagram|insta\.gram|facebook|fb\.com|discord|signal app|viber)\b/i,
  /\b(?:venmo|cash\s?app|e[\-\s]?transfer|interac|paypal|zelle|etransfer)\b/i,
  /\b(?:my\s+number|reach\s+me\s+at|contact\s+me\s+at|dm\s+me|message\s+me\s+on)\b/i,
  /\b(?:four|five|six|seven|eight|nine)\s+(?:zero|one|two|three|four|five|six|seven|eight|nine)\b/i,
  /@[a-zA-Z0-9._]{3,}/,
  /\b[a-z]{2,6}\.[a-z]{2,6}\b/i
];

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

function isPureDigitChunk(text) {
  var val = stripForDigitCheck(text);
  return /^\d{2,6}$/.test(val);
}

function containsOffPlatformContact(text, recentTexts) {
  if (!text) return false;
  if (window.QG_CONFIG && window.QG_CONFIG.blockOffPlatformContact === false) return false;
  var val = stripForDigitCheck(String(text).trim());
  if (!val) return false;

  if (FRAUD_PATTERNS.some(function(p) { return p.test(val); })) return true;

  // Split-phone trick: only pure digit chunks (e.g. "587", "990", "8645") in a row
  if (isPureDigitChunk(val)) {
    if (val.length >= 7) return true;
    if (recentTexts && recentTexts.length) {
      var digitParts = recentTexts
        .map(stripForDigitCheck)
        .filter(isPureDigitChunk)
        .slice(-4)
        .concat([val]);
      if (digitParts.length >= 2 && digitParts.join('').length >= 10) return true;
    }
  }

  return false;
}

function getOffPlatformWarning() {
  return 'You can\'t share phone numbers, emails, or off-platform payment details on QuickGigs. Keep everything here until payment is complete.';
}

window.containsOffPlatformContact = containsOffPlatformContact;
window.containsFraud = containsOffPlatformContact;
window.getOffPlatformWarning = getOffPlatformWarning;

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
  var label = name || 'User';
  if (!uid) return escapeHtml(label);
  var cls = opts.className || 'profile-link';
  var style = opts.style || 'color:inherit;text-decoration:underline;text-underline-offset:2px';
  return '<a href="' + getProfileUrl(uid) + '" class="' + cls + '" style="' + style + '">' + escapeHtml(label) + '</a>';
}

window.avatarGradientForName = avatarGradientForName;
window.hasProfilePhotoUrl = hasProfilePhotoUrl;
window.renderUserAvatarHtml = renderUserAvatarHtml;
window.getCurrentPageReturnUrl = getCurrentPageReturnUrl;
window.sanitizeReturnUrl = sanitizeReturnUrl;
window.getProfileUrl = getProfileUrl;
window.profileNameLink = profileNameLink;
