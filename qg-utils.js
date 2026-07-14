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
