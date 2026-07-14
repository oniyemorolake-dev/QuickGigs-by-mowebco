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
  var wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;width:100%;';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  input.style.paddingRight = '2.75rem';
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Show password');
  btn.textContent = '👁';
  btn.style.cssText = 'position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:1rem;opacity:0.65;padding:4px;line-height:1;';
  btn.onclick = function () {
    var show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? '🙈' : '👁';
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  };
  wrap.appendChild(btn);
}

function getDashboardUrl(roleOverride) {
  var role = roleOverride || localStorage.getItem('qg-role') || localStorage.getItem('qg-session-mode') || 'poster';
  var mode = role === 'worker' ? 'worker' : 'poster';
  localStorage.setItem('qg-session-mode', mode);
  return 'dashboard.html?mode=' + mode;
}

window.attachPasswordToggle = attachPasswordToggle;
window.getDashboardUrl = getDashboardUrl;
