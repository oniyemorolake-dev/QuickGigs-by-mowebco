/**
 * Screenshot the rebuilt Post task wizard beside its template, all three steps.
 *
 *   node scripts/posttask-shot.js
 *
 * Firebase and the Supabase reads are stubbed. This proves markup, CSS and the
 * step/validation logic. It does NOT prove postTask() against the live table.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TPL = path.join(ROOT, 'Claude outputs', 'sg-design', 'templates');
const OUT = path.join(ROOT, '.verify');
const BASE = process.env.SG_BASE || 'http://localhost:8099';

const FB_APP = 'export function initializeApp(){ return {}; }';
const FB_AUTH = `
export function getAuth(){ return { currentUser: { uid:'fixture-uid', displayName:'Morolake A', email:'m@example.com' } }; }
export function onAuthStateChanged(a, cb){ setTimeout(function(){ cb(a.currentUser); }, 10); return function(){}; }
`;

function fixtures() {
  window.QG_CAT_MAP = {
    beauty: { label: 'Hair Braiding' }, home: { label: 'Cleaning' }, moving: { label: 'Moving Help' },
    trades: { label: 'Assembly' }, care: { label: 'Pet Care' }, errands: { label: 'Errands' },
    tutoring: { label: 'Tutoring' }, tech: { label: 'Tech' }, other: { label: 'Other' }
  };
  window.getCatInfo = function (c) { return window.QG_CAT_MAP[String(c || 'other').toLowerCase()] || { label: 'Other' }; };
  window.syncCurrentUserProfile = function () { return Promise.resolve(); };
  window.enforceBanOnLogin = function () { return Promise.resolve({ ok: true }); };
  window.getMode = function () { return 'poster'; };
  window.QG_loadVerification = function () {
    window.QG_verificationState = { poster_verified: true };
    return Promise.resolve(window.QG_verificationState);
  };
  window.QG_syncVerificationReturn = function () { return Promise.resolve(null); };
  window.getUserLocation = function () { return 'Hillhurst, Calgary, AB'; };
  window.initUserLocation = function () { return Promise.resolve(); };
  try { localStorage.removeItem('qg-post-verification-state'); } catch (e) {}
}

async function shoot(browser, theme) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1100 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0].slice(0, 120)));

  await page.route('**/firebase-app.js', (r) => r.fulfill({ contentType: 'application/javascript', body: FB_APP }));
  await page.route('**/firebase-auth.js', (r) => r.fulfill({ contentType: 'application/javascript', body: FB_AUTH }));
  await page.route('**/qg-categories.js*', async (r) => {
    const res = await r.fetch();
    r.fulfill({ response: res, body: (await res.text()) + '\n;(' + fixtures.toString() + ')();\n' });
  });
  await page.addInitScript((t) => {
    try { localStorage.setItem('qg-theme', t); localStorage.setItem('qg-mode', 'poster'); } catch (e) {}
  }, theme);

  await page.goto(BASE + '/posttask.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1600);

  // Fill in what step 1 needs so Continue advances.
  await page.click('#sgCatChips [data-cat="beauty"]').catch(() => {});
  await page.fill('#sgTitle', 'Hair Braiding').catch(() => {});
  const shots = {};
  shots.s1 = path.join(OUT, `post-${theme}-1.png`);
  await page.screenshot({ path: shots.s1, fullPage: true, animations: 'disabled' });

  await page.click('#sgNext');
  await page.waitForTimeout(500);
  await page.fill('#sgBudget', '80').catch(() => {});
  // qg-location.js loads after the fixtures and replaces getUserLocation, so the
  // area never prefills under the harness. Type it the way a poster would.
  await page.fill('#sgArea', 'Hillhurst, Calgary, AB').catch(() => {});
  shots.s2 = path.join(OUT, `post-${theme}-2.png`);
  await page.screenshot({ path: shots.s2, fullPage: true, animations: 'disabled' });

  await page.click('#sgNext');
  await page.waitForTimeout(500);
  shots.s3 = path.join(OUT, `post-${theme}-3.png`);
  await page.screenshot({ path: shots.s3, fullPage: true, animations: 'disabled' });

  const onStep = await page.$eval('[data-step="3"]', (el) => !el.hidden).catch(() => false);
  const review = await page.$$eval('.sg-review-row b', (n) => n.map((x) => x.textContent)).catch(() => []);
  const cta = await page.textContent('#sgNext').catch(() => '');
  console.log(`${theme.padEnd(6)} reached step 3: ${onStep}  cta="${(cta || '').trim()}"  review=${JSON.stringify(review)}` +
    (errors.length ? `\n       errors: ${[...new Set(errors)].slice(0, 3).join(' | ')}` : ''));
  await ctx.close();
  return shots;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  const tpl = {};
  for (const n of [1, 2, 3]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 1100 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto('file://' + path.join(TPL, 'post-task.html').replace(/\\/g, '/') + '?step=' + n,
      { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    tpl[n] = path.join(OUT, `tpl-post-${n}.png`);
    await page.screenshot({ path: tpl[n], fullPage: true, animations: 'disabled' });
    await ctx.close();
  }

  const light = await shoot(browser, 'light');
  const dark = await shoot(browser, 'dark');

  const ctx = await browser.newContext({ viewport: { width: 2900, height: 1500 } });
  const compose = await ctx.newPage();
  const url = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
  const fig = (cap, file, tone) =>
    `<figure style="margin:0"><figcaption style="padding:5px 2px;color:${tone};font-weight:600">${cap}</figcaption>` +
    `<img src="${url(file)}" style="width:290px;display:block;border:1px solid #444;border-radius:6px"></figure>`;
  await compose.setContent(
    '<body style="margin:0;background:#17171c;font:13px system-ui;color:#fff;display:flex;gap:12px;padding:16px;align-items:flex-start">' +
    [1, 2, 3].map((n) =>
      '<div style="display:flex;gap:8px">' +
      fig(`TEMPLATE step ${n}`, tpl[n], '#8f8') +
      fig(`LIGHT step ${n}`, light['s' + n], '#9cf') +
      fig(`DARK step ${n}`, dark['s' + n], '#c9f') +
      '</div>').join('') +
    '</body>');
  await compose.waitForTimeout(600);
  const out = path.join(OUT, 'posttask-vs-design.png');
  await compose.screenshot({ path: out, fullPage: true });
  console.log('\n' + out);
  await browser.close();
  process.exit(0);
})();
