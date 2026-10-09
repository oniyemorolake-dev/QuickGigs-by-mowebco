/**
 * Logs in for real, screenshots a page at 390px, and writes a side-by-side
 * against its design PNG so the two can be compared at a glance.
 *
 *   set SG_EMAIL=...  &&  set SG_PASS=...
 *   node scripts/page-vs-design.js dashboard.html 1-home.png done-home.png
 *
 * Credentials come from the environment only — never from a file in the repo.
 * Shoots light and dark, and poster and tasker, then stacks them beside the
 * design.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DESIGN = path.join(ROOT, 'Claude outputs', 'sg-design');
const BASE = process.env.SG_BASE || 'http://localhost:8099';

const [pageName, designPng, outName] = process.argv.slice(2);
if (!pageName || !designPng) {
  console.error('usage: node scripts/page-vs-design.js <page.html> <design.png> [out.png]');
  process.exit(2);
}
const EMAIL = process.env.SG_EMAIL;
const PASS = process.env.SG_PASS;
if (!EMAIL || !PASS) {
  console.error('Set SG_EMAIL and SG_PASS in the environment first.');
  process.exit(2);
}

async function login(context) {
  const page = await context.newPage();
  await page.goto(BASE + '/login.html');
  await page.waitForTimeout(1200);
  await page.fill('input[type="email"], #email, #loginEmail', EMAIL);
  await page.fill('input[type="password"], #password, #loginPassword', PASS);
  await Promise.all([
    page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 45000 }),
    page.click('button[type="submit"], #loginBtn, .login-btn')
  ]);
  await page.waitForTimeout(2500);
  await page.close();
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });

  console.log('logging in as ' + EMAIL + ' ...');
  await login(context);
  console.log('logged in.');

  const shots = [];
  for (const mode of ['poster', 'tasker']) {
    for (const theme of ['light', 'dark']) {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
      await page.addInitScript(
        ([m, t]) => {
          localStorage.setItem('qg-mode', m);
          localStorage.setItem('qg-theme', t);
        },
        [mode, theme]
      );
      await page.goto(BASE + '/' + pageName);
      await page.waitForTimeout(4000);
      const out = path.join(ROOT, '.verify', pageName.replace('.html', '') + '-' + mode + '-' + theme + '.png');
      await page.screenshot({ path: out, fullPage: true });
      shots.push({ file: out, label: mode + ' / ' + theme });
      console.log('  shot ' + mode + ' / ' + theme + (errors.length ? '   errors: ' + errors.join(' | ') : ''));
      await page.close();
    }
  }

  // Compose: design on the left, the four real shots to its right.
  const compose = await context.newPage();
  const toUrl = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
  const html =
    '<body style="margin:0;background:#2b2b31;font:12px system-ui;color:#fff;display:flex;gap:10px;padding:10px;align-items:flex-start">' +
    '<figure style="margin:0"><figcaption style="padding:4px">DESIGN</figcaption>' +
    '<img src="' + toUrl(path.join(DESIGN, designPng)) + '" style="width:390px;display:block"></figure>' +
    shots
      .map(
        (s) =>
          '<figure style="margin:0"><figcaption style="padding:4px">LIVE — ' +
          s.label +
          '</figcaption><img src="' +
          toUrl(s.file) +
          '" style="width:390px;display:block"></figure>'
      )
      .join('') +
    '</body>';
  await compose.setContent(html);
  await compose.waitForTimeout(600);
  const outPath = path.join(DESIGN, outName || 'done-' + pageName.replace('.html', '') + '.png');
  await compose.screenshot({ path: outPath, fullPage: true });
  console.log('\nside-by-side: ' + outPath);

  await browser.close();
})();
