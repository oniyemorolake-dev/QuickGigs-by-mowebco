/**
 * Screenshot the rebuilt My gigs: the Active Gig view beside its template,
 * plus the three list tabs and the applicants sheet.
 *
 *   node scripts/mytasks-shot.js
 *
 * Firebase and the Supabase reads are stubbed. This proves markup, CSS and the
 * render functions. It does NOT prove the live queries.
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
export function getAuth(){ return { currentUser: { uid:'me', displayName:'Jordan Blake', email:'j@example.com' } }; }
export function onAuthStateChanged(a, cb){ setTimeout(function(){ cb(a.currentUser); }, 10); return function(){}; }
`;

const soon = (h) => new Date(Date.now() + h * 3600000).toISOString();
const past = (d) => new Date(Date.now() - d * 86400000).toISOString();

const TASKS = [
  { task_id: 'tp1', title: 'Furniture Assembly', category: 'home', budget: 60, status: 'open', posted_by: 'me', location: '1420 17 Ave SW, Calgary', created_at: past(2), scheduled_at: soon(30) },
  { task_id: 'tp2', title: 'Garden Tidy Up', category: 'gardening', budget: 90, status: 'open', posted_by: 'me', location: 'Bridgeland, Calgary', created_at: past(1) },
  { task_id: 'ti2', title: 'Office Move Help', category: 'moving', budget: 140, status: 'in_progress', posted_by: 'me', location: 'Beltline, Calgary', precise_address: '611 10 Ave SW, Calgary', lat: 51.0448, lng: -114.0719, created_at: past(2), scheduled_at: soon(26) },
  { task_id: 'ti1', title: 'Hair Braiding', category: 'beauty', budget: 75, status: 'in_progress', posted_by: 'u-aisha', location: 'Beltline, Calgary', precise_address: '1420 17 Ave SW, Calgary', lat: 51.0375, lng: -114.0905, created_at: past(3), scheduled_at: soon(4) },
  { task_id: 'tc1', title: 'Grocery Pickup', category: 'errands', budget: 25, status: 'completed', posted_by: 'u-priya', location: 'Kensington, Calgary', created_at: past(9) },
  { task_id: 'tc2', title: 'Apartment Deep Clean', category: 'home', budget: 120, status: 'completed', posted_by: 'me', location: 'Beltline, Calgary', created_at: past(14) }
];

const APPS = [
  { app_id: 'a1', task_id: 'tp1', worker_id: 'u-dan', status: 'pending', price: 60, message: 'I assemble flat-pack every week, can be there tomorrow morning.', created_at: past(1) },
  { app_id: 'a2', task_id: 'tp1', worker_id: 'u-sam', status: 'pending', counter_price: 75, counter_by: 'worker', counter_round: 1, price: 60, message: 'Happy to do it, though it is a two-person lift.', created_at: past(1) },
  { app_id: 'a3', task_id: 'ti1', worker_id: 'me', status: 'accepted', price: 75, created_at: past(3) },
  { app_id: 'a4', task_id: 'tc1', worker_id: 'me', status: 'completed', price: 25, created_at: past(9) },
  { app_id: 'a6', task_id: 'ti2', worker_id: 'u-dan', status: 'accepted', price: 140, created_at: past(2) },
  { app_id: 'a5', task_id: 'tx9', worker_id: 'me', status: 'pending', price: 40, counter_price: 35, counter_by: 'poster', counter_round: 1, task_title: 'Dog Walking', posted_by: 'u-priya', task_category: 'care', task_status: 'open', created_at: past(1) }
];

const NAMES = { 'u-aisha': 'Aisha K.', 'u-dan': 'Daniel M.', 'u-sam': 'Sam O.', 'u-priya': 'Priya S.', me: 'Jordan Blake' };

function fixtures(tasks, apps, names) {
  const copy = (o) => JSON.parse(JSON.stringify(o));
  window.fetchMyTasksBundle = function () { return Promise.resolve({ tasks: copy(tasks), applications: copy(apps) }); };
  window.fetchAllTasksFresh = function () { return Promise.resolve(copy(tasks)); };
  window.fetchAllApplicationsFresh = function () { return Promise.resolve(copy(apps)); };
  window.getAllApplications = function () { return Promise.resolve(copy(apps)); };
  window.readTasksCache = function () { return null; };
  window.readAppsCache = function () { return null; };
  window.writeTasksCache = function () {};
  window.writeAppsCache = function () {};
  window.getUsersNameMap = function () { return Promise.resolve(names); };
  window.getUsersAvatarMap = function () { return Promise.resolve({}); };
  window.getPaymentsForUser = function () { return Promise.resolve([]); };
  window.getUserByFirebaseUid = function (uid) {
    return Promise.resolve({ firebase_uid: uid, name: names[uid] || 'Member', tasker_verified: true, stripe_payouts_enabled: true });
  };
  window.enforceBanOnLogin = function () { return Promise.resolve({ ok: true }); };
  window.syncCurrentUserProfile = function () { return Promise.resolve(); };
  window.QG_getTaskEvidence = function () {
    return Promise.resolve({ ok: true, stamps: [{ stamp_type: 'on_my_way', stamped_at: new Date().toISOString() }] });
  };
  window.QG_paymentsLive = function () { return true; };
  window.QG_handlePaymentReturn = function () { return Promise.resolve(); };
  window.QG_syncPendingPayments = function () { return Promise.resolve(); };
}

async function shoot(browser, theme, mode) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1100 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0].slice(0, 120)));

  await page.route('**/firebase-app.js', (r) => r.fulfill({ contentType: 'application/javascript', body: FB_APP }));
  await page.route('**/firebase-auth.js', (r) => r.fulfill({ contentType: 'application/javascript', body: FB_AUTH }));
  /* Appended to the real supabase-db.js, then re-applied after the later
     deferred modules so they cannot overwrite the stubs. */
  const stub = '\n;(' + fixtures.toString() + ')(' +
    [TASKS, APPS, NAMES].map((o) => JSON.stringify(o)).join(',') + ');\n';
  for (const file of ['supabase-db.js', 'qg-stripe.js', 'qg-evidence.js']) {
    await page.route(`**/${file}*`, async (r) => {
      const res = await r.fetch();
      r.fulfill({ response: res, body: (await res.text()) + stub });
    });
  }
  await page.addInitScript(([t, m]) => {
    try { localStorage.setItem('qg-theme', t); localStorage.setItem('qg-mode', m); } catch (e) {}
  }, [theme, mode]);

  const shots = {};
  const grab = async (key, full) => {
    shots[key] = path.join(OUT, `mt-${theme}-${mode}-${key}.png`);
    try {
      await page.screenshot({ path: shots[key], fullPage: !!full, animations: 'disabled', timeout: 10000 });
    } catch (e) {
      shots[key] = null;
      console.log(`       ${key}: SCREENSHOT FAILED`);
    }
  };

  await page.goto(BASE + '/mytasks.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  await grab('list', true);

  const rows = await page.$$eval('#sgTabContent .sg-card', (n) => n.length).catch(() => -1);
  const tabs = await page.$$eval('#sgSeg button', (n) => n.map((b) => b.textContent)).catch(() => []);

  if (mode === 'poster') {
    await page.click('#sgTabContent [data-task]', { force: true }).catch(() => {});
    await page.waitForTimeout(700);
    await grab('applicants');
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
  }

  // In progress, then the Active Gig view it opens.
  await page.click('#sgSeg [data-tab="inprogress"]', { force: true }).catch(() => {});
  await page.waitForTimeout(600);
  await grab('inprogress', true);
  await page.click('#sgTabContent [data-task]', { force: true }).catch(() => {});
  await page.waitForTimeout(1400);
  await grab('active', true);

  const title = await page.textContent('#sgActiveTitle').catch(() => '');
  const primary = await page.textContent('#sgActivePrimary').catch(() => '');
  const steps = await page.$$eval('#sgActiveSteps .s.done', (n) => n.length).catch(() => -1);
  const next = await page.textContent('#sgActiveNext').catch(() => '');

  await page.click('#sgActiveBack', { force: true }).catch(() => {});
  await page.waitForTimeout(400);
  await page.click('#sgSeg [data-tab="completed"]', { force: true }).catch(() => {});
  await page.waitForTimeout(600);
  await grab('completed', true);

  console.log(`${theme}/${mode} rows=${rows} tabs=[${tabs.join('|')}] active="${(title || '').trim()}" primary="${(primary || '').trim()}" done-steps=${steps} next="${(next || '').trim()}"` +
    (errors.length ? `\n       errors: ${[...new Set(errors)].slice(0, 3).join(' | ')}` : ''));
  await ctx.close();
  return shots;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  const ctx0 = await browser.newContext({ viewport: { width: 390, height: 1100 }, deviceScaleFactor: 2 });
  const tplPage = await ctx0.newPage();
  await tplPage.goto('file://' + path.join(TPL, 'active-gig.html').replace(/\\/g, '/'), { waitUntil: 'domcontentloaded' });
  await tplPage.waitForTimeout(400);
  const tplShot = path.join(OUT, 'tpl-active-gig.png');
  await tplPage.screenshot({ path: tplShot, fullPage: true, animations: 'disabled' });
  await ctx0.close();

  const worker = await shoot(browser, 'light', 'tasker');
  const poster = await shoot(browser, 'light', 'poster');
  const dark = await shoot(browser, 'dark', 'tasker');

  const ctx = await browser.newContext({ viewport: { width: 2700, height: 1400 } });
  const compose = await ctx.newPage();
  const url = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
  const fig = (cap, file, tone) => (file
    ? `<figure style="margin:0"><figcaption style="padding:5px 2px;color:${tone};font-weight:600">${cap}</figcaption>` +
      `<img src="${url(file)}" style="width:280px;display:block;border:1px solid #444;border-radius:6px"></figure>`
    : `<figure style="margin:0"><figcaption style="padding:5px 2px;color:#f66;font-weight:600">${cap} — no shot</figcaption></figure>`);
  await compose.setContent(
    '<body style="margin:0;background:#17171c;font:13px system-ui;color:#fff;display:flex;gap:12px;padding:16px;align-items:flex-start">' +
    fig('TEMPLATE active gig', tplShot, '#8f8') +
    fig('ACTIVE GIG light', worker.active, '#9cf') +
    fig('ACTIVE GIG dark', dark.active, '#9cf') +
    fig('Applied (tasker)', worker.list, '#fc9') +
    fig('Posted (poster)', poster.list, '#fc9') +
    fig('Applicants sheet', poster.applicants, '#fc9') +
    fig('In progress', worker.inprogress, '#fc9') +
    fig('Done', worker.completed, '#fc9') +
    '</body>');
  await compose.waitForTimeout(600);
  const out = path.join(OUT, 'mytasks-vs-design.png');
  await compose.screenshot({ path: out, fullPage: true });
  console.log('\n' + out);
  await browser.close();
  process.exit(0);
})();
