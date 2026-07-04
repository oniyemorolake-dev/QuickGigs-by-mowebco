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
