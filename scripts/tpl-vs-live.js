/**
 * Template vs live page, light theme, 390px. Live pages get a Firebase stub
 * so the auth guard does not bounce them. No fixture data — empty sections
 * hide, which is what a signed-in user with no gigs would see.
 *
 *   node scripts/tpl-vs-live.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.SG_BASE || 'http://localhost:8099';
const TPL = BASE + '/Claude%20outputs/sg-design/templates';

const PAIRS = [
  { label: 'Home', tpl: 'home.html?theme=light', live: 'dashboard.html' },
  { label: 'Browse', tpl: 'browse.html?theme=light', live: 'browsetask.html' },
  { label: 'Post task', tpl: 'post-task.html?step=1&theme=light', live: 'posttask.html' },
  { label: 'Messages', tpl: 'messages.html?theme=light', live: 'messages.html' },
  { label: 'Profile', tpl: 'profile.html?theme=light', live: 'profile.html' },
  { label: 'Active gig', tpl: 'active-gig.html?theme=light', live: 'mytasks.html' }
];

const FIREBASE_APP = 'export function initializeApp(){ return {}; }';
const FIREBASE_AUTH = `
export function getAuth(){ return { currentUser: { uid: 'x', displayName: 'Jordan', email: 'j@x.com', emailVerified: true } }; }
export function onAuthStateChanged(auth, cb){ setTimeout(function(){ cb(auth.currentUser); }, 20); return function(){}; }
export function signOut(){ return Promise.resolve(); }
`;

(async () => {
  const browser = await chromium.launch();
  const shots = [];

  for (const pair of PAIRS) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on('pageerror', () => {});

    await page.goto(TPL + '/' + pair.tpl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const tplPath = path.join(ROOT, '.verify', 'tpl-' + pair.label.replace(/\s+/g, '-') + '.png');
    await page.screenshot({ path: tplPath, fullPage: false });

    await page.route('**/firebase-app.js', (r) =>
      r.fulfill({ contentType: 'application/javascript', body: FIREBASE_APP }));
    await page.route('**/firebase-auth.js', (r) =>
      r.fulfill({ contentType: 'application/javascript', body: FIREBASE_AUTH }));
    await page.addInitScript(() => {
      try {
        localStorage.setItem('qg-theme', 'light');
        localStorage.setItem('qg-mode', 'tasker');
      } catch (e) {}
    });
    await page.goto(BASE + '/' + pair.live, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const livePath = path.join(ROOT, '.verify', 'live-' + pair.label.replace(/\s+/g, '-') + '.png');
    await page.screenshot({ path: livePath, fullPage: false });

    const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    console.log(pair.label + '  live font: ' + font + '  url: ' + page.url());

    shots.push({ label: pair.label, tpl: tplPath, live: livePath });
    await ctx.close();
  }

  const compose = await (await browser.newContext({ viewport: { width: 2500, height: 1800 } })).newPage();
  const url = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
  const cells = shots.map((s) =>
    '<div><div style="display:flex;gap:8px">' +
    '<figure style="margin:0"><figcaption>TEMPLATE — ' + s.label + '</figcaption>' +
    '<img src="' + url(s.tpl) + '" style="width:390px;display:block"></figure>' +
    '<figure style="margin:0"><figcaption>LIVE — ' + s.label + '</figcaption>' +
    '<img src="' + url(s.live) + '" style="width:390px;display:block"></figure>' +
    '</div></div>'
  ).join('');
  await compose.setContent(
    '<body style="margin:0;background:#2b2b31;color:#fff;font:12px system-ui;padding:12px">' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">' + cells + '</div></body>'
  );
  await compose.waitForTimeout(500);
  const out = path.join(ROOT, '.verify', 'tpl-vs-live.png');
  await compose.screenshot({ path: out, fullPage: true });
  console.log('\n' + out);
  await browser.close();
})();
