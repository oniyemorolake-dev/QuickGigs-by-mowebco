/**
 * Screenshot the rebuilt Browse page beside its template, light and dark,
 * with fixture data so the list, the gig sheet and the filter panel all render.
 *
 *   node scripts/browse-shot.js
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
export function getAuth(){ return { currentUser: { uid:'fixture-uid', displayName:'Morolake A', email:'m@example.com' } }; }
export function onAuthStateChanged(a, cb){ setTimeout(function(){ cb(a.currentUser); }, 10); return function(){}; }
`;

function iso(dayOffset, hour, minute) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute || 0, 0, 0);
  return d.toISOString();
}

const TASKS = [
  { task_id: 'aaaaaaaa-0000-4000-8000-000000000001', title: 'Hair Braiding', category: 'beauty', budget: 80, status: 'open', location: '1420 17 Ave SW, Calgary', precise_address: '1420 17 Ave SW, Calgary', lat: 51.0375, lng: -114.0998, scheduled_at: iso(0, 16), est_hours: 2, posted_by: 'poster-1', poster_name: 'Aisha K.', description: 'Need two French braids done before a family event. I have my own hair extensions ready. Please bring your own braiding tools.', created_at: iso(0, 9) },
  { task_id: 'aaaaaaaa-0000-4000-8000-000000000002', title: 'Furniture Assembly', category: 'trades', budget: 55, status: 'open', location: 'Beltline, Calgary', lat: 51.0405, lng: -114.0760, scheduled_at: iso(1, 10), est_hours: 1.5, posted_by: 'poster-2', poster_name: 'Dan R.', description: 'IKEA wardrobe, flat packed.', created_at: iso(0, 8) },
  { task_id: 'aaaaaaaa-0000-4000-8000-000000000003', title: 'Grocery Pickup', category: 'errands', budget: 25, status: 'open', location: 'Mission, Calgary', lat: 51.0320, lng: -114.0680, scheduled_at: iso(0, 18, 30), est_hours: 0.75, posted_by: 'poster-3', poster_name: 'Sam T.', description: 'Weekly shop, list provided.', created_at: iso(0, 7) },
  { task_id: 'aaaaaaaa-0000-4000-8000-000000000004', title: 'Dog Walking', category: 'care', budget: 20, status: 'open', location: 'Kensington, Calgary', lat: 51.0530, lng: -114.0900, scheduled_at: iso(0, 17), est_hours: 0.5, posted_by: 'poster-4', poster_name: 'Priya N.', description: 'Two friendly beagles.', created_at: iso(0, 6) },
  { task_id: 'aaaaaaaa-0000-4000-8000-000000000005', title: 'Moving Help', category: 'moving', budget: 150, status: 'open', location: 'Inglewood, Calgary', lat: 51.0390, lng: -114.0330, scheduled_at: iso(3, 9), est_hours: 3, posted_by: 'poster-5', poster_name: 'Leo M.', description: 'Two-bed apartment, van booked.', created_at: iso(0, 5) }
];

// Appended to a real script response so it runs before the page's inline logic.
function fixtures(tasks) {
  window.QG_CAT_MAP = {
    errands: { label: 'Errands' }, home: { label: 'Home' }, tutoring: { label: 'Tutoring' },
    beauty: { label: 'Beauty' }, moving: { label: 'Moving' }, cooking: { label: 'Cooking' },
    tech: { label: 'Tech' }, care: { label: 'Care' }, gardening: { label: 'Gardening' },
    events: { label: 'Events' }, trades: { label: 'Trades' }, other: { label: 'Other' }
  };
  window.getCatInfo = function (c) { return window.QG_CAT_MAP[String(c || 'other').toLowerCase()] || { label: 'Other' }; };
  window.getTasks = function () { return Promise.resolve(tasks); };
  window.fetchAllTasksFresh = function () { return Promise.resolve(tasks); };
  window.readTasksCache = function () { return null; };
  window.getUsersNameMap = function () { return Promise.resolve({}); };
  window.getApplicationsByWorker = function () { return Promise.resolve([]); };
  window.loadSavedTaskIds = function () { return Promise.resolve(); };
  window.getUserByFirebaseUid = function () {
    return Promise.resolve({ poster_verified: true, created_at: '2025-02-01T00:00:00Z', stripe_payouts_enabled: true });
  };
  window.getReviewsForUser = function () { return Promise.resolve([{ rating: 5 }, { rating: 4 }]); };
  window.syncCurrentUserProfile = function () { return Promise.resolve(); };
  window.enforceBanOnLogin = function () { return Promise.resolve({ ok: true }); };
  window.QG_loadAgeTier = function () { return Promise.resolve({ tier: 'adult' }); };
  window.QG_loadVerification = function () { return Promise.resolve({ tasker_verified: true }); };
  window.ensureTaskerProfilePhoto = function () { return Promise.resolve({ ok: true }); };
  window.getUserCityLabel = function () { return 'Calgary, AB'; };
  window.getUserLocation = function () { return 'Calgary, AB'; };
  window.initUserLocation = function () { return Promise.resolve(); };
  window.getGeoFilterPos = function () { return null; };
  window.formatDistanceKm = function (km) { return (km < 10 ? km.toFixed(1) : Math.round(km)) + ' km'; };
  // Distances the design shows, so the meta row reads like the PNG.
  var DIST = { '...0001': 4, '...0002': 2.1, '...0003': 1.3, '...0004': 3.5, '...0005': 6 };
  window.sortTasksByProximity = function (list) {
    list.forEach(function (t, i) { t._distanceKm = [4, 2.1, 1.3, 3.5, 6][i % 5]; });
    return list;
  };
  void DIST;
}

async function shoot(browser, theme) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1100 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0].slice(0, 120)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 120)); });

  await page.route('**/firebase-app.js', (r) => r.fulfill({ contentType: 'application/javascript', body: FB_APP }));
  await page.route('**/firebase-auth.js', (r) => r.fulfill({ contentType: 'application/javascript', body: FB_AUTH }));
  await page.route('**/unpkg.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.L=undefined;' }));
  await page.route('**/qg-categories.js*', async (r) => {
    const res = await r.fetch();
    const src = '\n;(' + fixtures.toString() + ')(' + JSON.stringify(TASKS) + ');\n';
    r.fulfill({ response: res, body: (await res.text()) + src });
  });
  await page.addInitScript((t) => {
    try { localStorage.setItem('qg-theme', t); localStorage.setItem('qg-mode', 'tasker'); } catch (e) {}
  }, theme);

  await page.goto(BASE + '/browsetask.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const shots = {};
  shots.list = path.join(OUT, `browse-${theme}-list.png`);
  await page.screenshot({ path: shots.list, fullPage: true, animations: 'disabled' });

  await page.click('#sgGigList [data-gig]').catch(() => {});
  await page.waitForTimeout(700);
  shots.detail = path.join(OUT, `browse-${theme}-detail.png`);
  await page.screenshot({ path: shots.detail, animations: 'disabled' });

  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.click('#sgFilterBtn', { force: true }).catch(() => {});
  await page.waitForTimeout(700);
  shots.filters = path.join(OUT, `browse-${theme}-filters.png`);
  await page.screenshot({ path: shots.filters, animations: 'disabled' });

  const counted = await page.textContent('#sgGigCount').catch(() => '');
  const rows = await page.$$eval('#sgGigList .sg-gig', (n) => n.length).catch(() => -1);
  console.log(`${theme.padEnd(6)} rows=${rows}  count="${(counted || '').trim()}"` +
    (errors.length ? `\n       errors: ${[...new Set(errors)].slice(0, 4).join(' | ')}` : ''));
  await ctx.close();
  return shots;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // The design templates, for the like-for-like column.
  const tplShots = {};
  for (const [name, file] of [['browse', 'browse.html'], ['detail', 'gig-detail.html']]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 1100 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto('file://' + path.join(TPL, file).replace(/\\/g, '/'), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    tplShots[name] = path.join(OUT, `tpl-${name}.png`);
    await page.screenshot({ path: tplShots[name], fullPage: true, animations: 'disabled' });
    await ctx.close();
  }

  const light = await shoot(browser, 'light');
  const dark = await shoot(browser, 'dark');

  const ctx = await browser.newContext({ viewport: { width: 2100, height: 1250 }, deviceScaleFactor: 1 });
  const compose = await ctx.newPage();
  const url = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
  const fig = (cap, file, tone) =>
    `<figure style="margin:0"><figcaption style="padding:5px 2px;color:${tone};font-weight:600">${cap}</figcaption>` +
    `<img src="${url(file)}" style="width:300px;display:block;border:1px solid #444;border-radius:6px"></figure>`;
  await compose.setContent(
    '<body style="margin:0;background:#17171c;font:13px system-ui;color:#fff;display:flex;gap:14px;padding:16px;align-items:flex-start">' +
    fig('TEMPLATE browse', tplShots.browse, '#8f8') +
    fig('LIGHT list', light.list, '#9cf') +
    fig('DARK list', dark.list, '#9cf') +
    fig('TEMPLATE gig detail', tplShots.detail, '#8f8') +
    fig('LIGHT detail', light.detail, '#9cf') +
    fig('DARK filters', dark.filters, '#fc9') +
    '</body>');
  await compose.waitForTimeout(600);
  const out = path.join(OUT, 'browse-vs-design.png');
  await compose.screenshot({ path: out, fullPage: true });
  console.log('\n' + out);
  await browser.close();
  process.exit(0);
})();
