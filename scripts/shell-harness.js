/**
 * Builds the synthetic app page used by shell-smoke.js and shell-shots.js.
 *
 * The stylesheet list is lifted straight out of dashboard.html and the real
 * qg-brand-init.js is loaded, so the cascade matches a live app page. That
 * matters: the tab bar's colours come from qg-role-theme.css, qg-shell.css and
 * qg-mobile.css, and asserting them against a harness that skips those sheets
 * proves nothing.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function dashboardStylesheets() {
  const html = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
  return (html.match(/<link[^>]*rel="stylesheet"[^>]*>/g) || [])
    .filter((tag) => tag.indexOf('fonts.googleapis.com') === -1)
    .join('\n');
}

/** @param {{mode?: string}} opts */
function harness(opts) {
  const mode = (opts && opts.mode) || 'poster';
  return `<!doctype html>
<html><head><meta charset="utf-8">
${dashboardStylesheets()}
<style>
  body { margin:0; background:var(--bg); color:var(--text);
         font-family:'DM Sans',system-ui,sans-serif; min-height:100vh; }
  .nav { display:flex; align-items:center; justify-content:space-between; padding:12px 20px; }
  .nav-brand { display:flex; flex-direction:column; gap:1px; align-items:flex-start; }
  .nav-logo { font-size:23px; }
  .nav-city { font-size:12.5px; color:var(--text-muted); }
  .filler { padding:20px; }
</style>
</head>
<body class="page-dashboard">
  <nav class="nav">
    <div class="nav-brand">
      <span class="nav-logo sg-wordmark">SwiftGigs</span>
      <span class="nav-city">Toronto, ON</span>
    </div>
    <div class="nav-right"></div>
  </nav>
  <div class="qg-mode-banner" id="qgModeBanner">You're in Poster mode</div>
  <div class="filler"><span class="sg-label">Shared shell</span></div>
  <nav class="tab-bar" id="qgTabBar"></nav>
  <script>
    localStorage.setItem('qg-mode', ${JSON.stringify(mode)});
    window._currentUser = { uid: 'harness-user' };
    /* qg-nav.js appends qg-role-access.js, which defines its own
       QG_getRoleAccess and would clobber this stub. Lock it so the harness
       represents a user who holds both roles. */
    Object.defineProperty(window, 'QG_getRoleAccess', {
      configurable: false, writable: false,
      value: function () { return { is_tasker: true, is_poster: true, is_teen: false }; }
    });
  <\/script>
  <script src="qg-icons.js"><\/script>
  <script src="qg-theme.js"><\/script>
  <script src="qg-brand-init.js"><\/script>
  <script src="qg-nav.js"><\/script>
  <script src="qg-menu.js"><\/script>
  <!-- The menu only offers Search and Quick help when their owners are loaded. -->
  <script src="qg-help.js"><\/script>
  <script src="qg-bigtech.js"><\/script>
</body></html>`;
}

module.exports = { harness };
