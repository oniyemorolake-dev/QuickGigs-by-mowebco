// QuickGigs — apply saved theme before paint (include in <head> or top of <body>)
(function () {
  try {
    var light = localStorage.getItem('qg-mode') === 'light';
    var body = document.body;
    if (!body) return;
    if (document.body.classList.contains('theme-posttask')) {
      body.className = light ? 'light' : 'dark';
    } else {
      body.className = light ? 'light' : '';
    }
  } catch (e) {}
})();

window.QG_applyTheme = function (isDark, modeBtnId, posttaskStyle) {
  var body = document.body;
  if (posttaskStyle) {
    body.className = isDark ? 'dark' : 'light';
  } else {
    body.className = isDark ? '' : 'light';
  }
  var btn = modeBtnId ? document.getElementById(modeBtnId) : null;
  if (btn) btn.textContent = isDark ? '☀️ Light' : '🌙 Dark';
};
