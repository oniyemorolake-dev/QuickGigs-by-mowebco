/**
 * Contact sheet of what every app screen actually looks like right now,
 * beside the template it is supposed to match.
 *
 *   node scripts/app-state-shot.js
 *
 * Firebase is stubbed so the auth guard passes and the page stays on screen.
 * This shows layout, not live data.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TPL = path.join(ROOT, 'Claude outputs', 'sg-design', 'templates');
const BASE = process.env.SG_BASE || 'http://localhost:8099';

const PAGES = [
  ['dashboard.html', 'home.html'],
  ['browsetask.html', 'browse.html'],
  ['posttask.html', 'post-task.html'],
  ['messages.html', 'messages.html'],
  ['profile.html', 'profile.html'],
  ['mytasks.html', 'active-gig.html']
];

const FB_APP = 'export function initializeApp(){ return {}; }';
const FB_AUTH = `
export function getAuth(){ return { currentUser: { uid:'fixture-uid', displayName:'Morolake', email:'m@example.com', emailVerified:true } }; }
export function onAuthStateChanged(a, cb){ setTimeout(function(){ cb(a.currentUser); }, 10); return function(){}; }
export function signOut(){ return Promise.resolve(); }
export function getIdToken(){ return Promise.resolve('x'); }
`;

// Keep the page from bouncing to signup/login when the gate gets no row back.
function guards() {
  window.getUserLoginGate = function () { return Promise.resolve({ role: 'worker' }); };
  window.syncCurrentUserProfile = function () { return Promise.resolve({ user: { role: 'worker' } }); };
  window.getUserByFirebaseUid = function () { return Promise.resolve({ role: 'worker' }); };
  var realReplace = window.location.replace.bind(window.location);
  try {
    window.location.replace = function (u) {
      if (/signup|login/.test(String(u))) return;
      realReplace(u);
    };
  } catch (e) {}
}
const GUARD_SRC = '\n;(' + guards.toString() + ')();\n';

(async () => {
  const browser = await chromium.launch();
  const shots = [];

  for (const [page_, tpl] of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 1000 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message.split('\n')[0].slice(0, 90)));

    await page.route('**/firebase-app.js', (r) => r.fulfill({ contentType: 'application/javascript', body: FB_APP }));
    await page.route('**/firebase-auth.js', (r) => r.fulfill({ contentType: 'application/javascript', body: FB_AUTH }));
    await page.route('**/supabase-db.js*', async (r) => {
      const res = await r.fetch();
      r.fulfill({ response: res, body: (await res.text()) + GUARD_SRC });
    });
    await page.addInitScript(() => {
      try { localStorage.setItem('qg-theme', 'dark'); localStorage.setItem('qg-mode', 'tasker'); } catch (e) {}
    });

    await page.goto(BASE + '/' + page_, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4200);

    const where = page.url().split('/').pop().split('?')[0];
    const out = path.join(ROOT, '.verify', 'now-' + page_.replace('.html', '') + '.png');
    let got = null;
    for (const opts of [{ fullPage: true }, {}, { fullPage: true, caret: 'initial' }]) {
      try {
        await page.screenshot(Object.assign({ path: out, animations: 'disabled', timeout: 12000 }, opts));
        got = opts.fullPage ? 'full' : 'viewport only';
        break;
      } catch (e) { /* keep trying a cheaper capture */ }
    }
    if (got) shots.push({ file: out, page: page_, tpl, landed: where });
    console.log(page_.padEnd(18) + 'landed on ' + where.padEnd(16) +
      (got || 'SCREENSHOT FAILED').padEnd(18) +
      (errors.length ? 'js: ' + errors[0] : ''));
    await ctx.close();
  }

  // Shoot each template too, so the comparison is like for like.
  for (const s of shots) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 1000 } });
    const page = await ctx.newPage();
    await page.goto('file://' + path.join(TPL, s.tpl).replace(/\\/g, '/'), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    const out = path.join(ROOT, '.verify', 'tpl-' + s.tpl.replace('.html', '') + '.png');
    await page.screenshot({ path: out, fullPage: true, animations: 'disabled', timeout: 15000 });
    s.tplShot = out;
    await ctx.close();
  }

  const ctx = await browser.newContext({ viewport: { width: 2520, height: 1200 } });
  const compose = await ctx.newPage();
  const url = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
  await compose.setContent(
    '<body style="margin:0;background:#1d1d22;font:12px system-ui;color:#fff;display:flex;gap:8px;padding:10px;align-items:flex-start">' +
    shots.map((s) =>
      '<div><div style="padding:4px;font-weight:700">' + s.page + '</div>' +
      '<div style="display:flex;gap:6px">' +
      '<figure style="margin:0"><figcaption style="padding:3px;color:#8f8">TEMPLATE</figcaption>' +
      '<img src="' + url(s.tplShot) + '" style="width:195px;display:block;border:1px solid #444"></figure>' +
      '<figure style="margin:0"><figcaption style="padding:3px;color:#f99">LIVE NOW</figcaption>' +
      '<img src="' + url(s.file) + '" style="width:195px;display:block;border:1px solid #444"></figure>' +
      '</div></div>'
    ).join('') + '</body>');
  await compose.waitForTimeout(700);
  const out = path.join(ROOT, '.verify', 'app-now-vs-templates.png');
  await compose.screenshot({ path: out, fullPage: true });
  console.log('\n' + out);
  await browser.close();
})();
