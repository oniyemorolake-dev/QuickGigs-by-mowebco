/**
 * Screenshot the rebuilt Profile beside its template, plus the four sheets the
 * design folds behind its three Settings rows and the Edit profile link.
 *
 *   node scripts/profile-shot.js
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
export function signOut(){ return Promise.resolve(); }
`;

function daysAgo(d) { return new Date(Date.now() - d * 86400000).toISOString(); }

const USER = {
  user_id: 'uuid-me', firebase_uid: 'me', name: 'Jordan Blake', email: 'j@example.com',
  avatar_url: '', bio: 'Handy with flat-pack furniture and happy to run errands across the inner city.',
  skills: ['\u{1F6FB} Errands', '\u{1F3E0} Home', '\u{1F69A} Moving'],
  availability: 'available', service_area: 'Calgary, AB', languages: 'English, French',
  pronouns: 'they/them', role: 'worker', is_tasker: true, is_poster: true,
  tasker_verified: true, poster_verified: false,
  notify_new_gigs: true, notify_new_gigs_email: false, alert_radius_km: 50,
  alert_categories: ['errands', 'moving'], alert_location: 'Calgary, AB',
  stripe_connect_id: '', stripe_payouts_enabled: false,
  created_at: '2025-02-11T10:00:00Z'
};

const TASKS = [
  { task_id: 't1', title: 'Furniture Assembly', price: 60, status: 'open', posted_by: 'me', created_at: daysAgo(3) },
  { task_id: 't2', title: 'Apartment Deep Clean', price: 120, status: 'completed', posted_by: 'me', created_at: daysAgo(12) }
];

const APPS = [
  { app_id: 'a1', task_id: 't9', worker_id: 'me', status: 'completed', created_at: daysAgo(5), task_title: 'Grocery Pickup', counter_price: 25 },
  { app_id: 'a2', task_id: 't8', worker_id: 'me', status: 'accepted', created_at: daysAgo(9), task_title: 'Dog Walking', counter_price: 30 }
];

const REVIEWS = [
  { rating: 5, review_comment: 'Fast, friendly and left the place tidy.', reviewer_name: 'Aisha K.', task_title: 'Grocery Pickup', created_at: daysAgo(5) },
  { rating: 4, review_comment: 'Good communication throughout.', reviewer_name: 'Daniel M.', task_title: 'Dog Walking', created_at: daysAgo(20) }
];

function fixtures(user, tasks, apps, reviews) {
  window.getUserByFirebaseUid = function () { return Promise.resolve(user); };
  window.getTasksByUser = function () { return Promise.resolve(tasks); };
  window.getApplicationsByWorker = function () { return Promise.resolve(apps); };
  window.getReviewsForUser = function () { return Promise.resolve(reviews); };
  window.countCompletedJobsForWorker = function () { return Promise.resolve(1); };
  window.getPaymentsForUser = function () { return Promise.resolve([]); };
  window.resolveUserAvatarUrl = function () { return Promise.resolve(''); };
  window.upsertUserProfile = function () { return Promise.resolve({ success: true }); };
  window.enforceBanOnLogin = function () { return Promise.resolve({ ok: true }); };
  window.syncCurrentUserProfile = function () { return Promise.resolve(); };
  window.QG_paymentsLive = function () { return true; };
  window.QG_startConnectOnboarding = function () { return Promise.resolve({ ok: false }); };
}

async function shoot(browser, theme) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1100 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0].slice(0, 120)));

  await page.route('**/firebase-app.js', (r) => r.fulfill({ contentType: 'application/javascript', body: FB_APP }));
  await page.route('**/firebase-auth.js', (r) => r.fulfill({ contentType: 'application/javascript', body: FB_AUTH }));
  /* Appended to the real supabase-db.js, and to qg-stripe.js after it, so the
     deferred real file cannot overwrite the stub the way qg-location.js did. */
  await page.route('**/supabase-db.js*', async (r) => {
    const res = await r.fetch();
    const src = '\n;(' + fixtures.toString() + ')(' +
      [USER, TASKS, APPS, REVIEWS].map((o) => JSON.stringify(o)).join(',') + ');\n';
    r.fulfill({ response: res, body: (await res.text()) + src });
  });
  await page.route('**/qg-stripe.js*', async (r) => {
    const res = await r.fetch();
    const src = '\nwindow.QG_paymentsLive=function(){return true;};\n';
    r.fulfill({ response: res, body: (await res.text()) + src });
  });
  await page.route('**/qg-role-access.js*', async (r) => {
    const res = await r.fetch();
    const src = '\nwindow.QG_getRoleAccess=function(){return {is_tasker:true,is_poster:true,is_teen:false};};\n';
    r.fulfill({ response: res, body: (await res.text()) + src });
  });
  await page.addInitScript((t) => {
    try { localStorage.setItem('qg-theme', t); localStorage.setItem('qg-mode', 'tasker'); } catch (e) {}
  }, theme);

  await page.goto(BASE + '/profile.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);

  const shots = {};
  shots.main = path.join(OUT, `prof-${theme}-main.png`);
  await page.screenshot({ path: shots.main, fullPage: true, animations: 'disabled' });

  const sheet = async (key, trigger) => {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(250);
    await page.click(trigger, { force: true }).catch(() => {});
    await page.waitForTimeout(700);
    shots[key] = path.join(OUT, `prof-${theme}-${key}.png`);
    await page.screenshot({ path: shots[key], animations: 'disabled' });
  };
  await sheet('edit', '#sgEditProfile');
  await sheet('pay', '#sgSetPayments');
  await sheet('notif', '#sgSetNotifications');
  await sheet('acct', '#sgSetAccount');

  const name = await page.textContent('#sgName').catch(() => '');
  const meta = await page.textContent('#sgMeta').catch(() => '');
  const acts = await page.$$eval('#sgActivity .sg-act', (n) => n.length).catch(() => -1);
  const revs = await page.$$eval('#sgReviews .sg-act', (n) => n.length).catch(() => -1);
  const stats = await page.$$eval('#sgStats .sg-act', (n) => n.length).catch(() => -1);
  console.log(`${theme.padEnd(6)} name="${(name || '').trim()}" meta="${(meta || '').trim()}" activity=${acts} reviews=${revs} stats=${stats}` +
    (errors.length ? `\n       errors: ${[...new Set(errors)].slice(0, 3).join(' | ')}` : ''));
  await ctx.close();
  return shots;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  const ctx0 = await browser.newContext({ viewport: { width: 390, height: 1100 }, deviceScaleFactor: 2 });
  const tplPage = await ctx0.newPage();
  await tplPage.goto('file://' + path.join(TPL, 'profile.html').replace(/\\/g, '/'), { waitUntil: 'domcontentloaded' });
  await tplPage.waitForTimeout(400);
  const tplShot = path.join(OUT, 'tpl-profile.png');
  await tplPage.screenshot({ path: tplShot, fullPage: true, animations: 'disabled' });
  await ctx0.close();

  const light = await shoot(browser, 'light');
  const dark = await shoot(browser, 'dark');

  const ctx = await browser.newContext({ viewport: { width: 2600, height: 1400 } });
  const compose = await ctx.newPage();
  const url = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
  const fig = (cap, file, tone) =>
    `<figure style="margin:0"><figcaption style="padding:5px 2px;color:${tone};font-weight:600">${cap}</figcaption>` +
    `<img src="${url(file)}" style="width:280px;display:block;border:1px solid #444;border-radius:6px"></figure>`;
  await compose.setContent(
    '<body style="margin:0;background:#17171c;font:13px system-ui;color:#fff;display:flex;gap:12px;padding:16px;align-items:flex-start">' +
    fig('TEMPLATE', tplShot, '#8f8') +
    fig('LIGHT', light.main, '#9cf') +
    fig('DARK', dark.main, '#9cf') +
    fig('Edit profile', light.edit, '#fc9') +
    fig('Payment methods', light.pay, '#fc9') +
    fig('Notifications', light.notif, '#fc9') +
    fig('Account settings', light.acct, '#fc9') +
    fig('Account settings (dark)', dark.acct, '#fc9') +
    '</body>');
  await compose.waitForTimeout(600);
  const out = path.join(OUT, 'profile-vs-design.png');
  await compose.screenshot({ path: out, fullPage: true });
  console.log('\n' + out);
  await browser.close();
  process.exit(0);
})();
