/**
 * Layout check for the rebuilt pages, without a login.
 *
 *   node scripts/layout-shot.js dashboard.html 1-home.png
 *
 * Firebase is replaced by a stub that reports a signed-in user, so the auth
 * guard is satisfied and the page stays on screen. The Supabase helpers are
 * then replaced with fixtures and the page's own render functions are called.
 *
 * This proves the markup, the CSS and the render functions. It does NOT prove
 * the real queries — only a real login does that, via page-vs-design.js.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DESIGN = path.join(ROOT, 'Claude outputs', 'sg-design');
const BASE = process.env.SG_BASE || 'http://localhost:8099';

const [pageName, designPng] = process.argv.slice(2);
if (!pageName) {
  console.error('usage: node scripts/layout-shot.js <page.html> [design.png]');
  process.exit(2);
}

const FIREBASE_APP_STUB = `export function initializeApp(){ return {}; }`;
const FIREBASE_AUTH_STUB = `
export function getAuth(){ return { currentUser: { uid: 'fixture-uid', displayName: 'Morolake', email: 'morolake@example.com', emailVerified: true } }; }
export function onAuthStateChanged(auth, cb){ setTimeout(function(){ cb(auth.currentUser); }, 10); return function(){}; }
export function signOut(){ return Promise.resolve(); }
`;

/**
 * Fixtures mirror the content of the design PNG so the two can be compared.
 *
 * They are appended to the end of the real supabase-db.js and qg-location.js
 * responses rather than installed separately. Those files declare these names
 * as top-level functions, so defining them on window first makes the whole
 * script fail to parse, and installing them afterwards is too late for the
 * login gate. Appending runs them immediately after the originals.
 */
function fixtures() {
  var now = new Date();
  function at(dayOffset, hour, min) {
    var d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, min || 0, 0, 0);
    return d.toISOString();
  }
  var dist = { t1: 2.1, t2: 1.3, t3: 3.4 };

  var stubs = {
    getUserCityLabel: function () { return 'Calgary, AB'; },
    getUserLocation: function () { return { city: 'Calgary, AB' }; },
    sortTasksByProximity: function (list) { return list; },
    taskDistanceKm: function (t) { return dist[t.task_id] || null; },
    formatDistanceKm: function (km) { return (Math.round(km * 10) / 10) + ' km'; },
    initUserLocation: function () { return Promise.resolve(); },

    getTaskById: function (id) {
      return Promise.resolve({
        task_id: id, title: 'Hair Braiding', category: 'beauty',
        status: 'accepted', budget: 80, scheduled_at: at(0, 16, 0), posted_by: 'someone'
      });
    },
    fetchDashboardBootstrap: function (uid) {
      return Promise.resolve({
        tasks: [], myTaskIds: [], needWorkerPosted: false,
        apps: [{ app_id: 'a1', task_id: 't9', worker_id: uid, status: 'accepted' }],
        payments: [
          { amount: 55, status: 'paid', paid_at: at(-1, 12) },
          { amount: 65, status: 'paid', paid_at: at(-3, 12) },
          { amount: 25, status: 'paid', paid_at: at(-5, 12) }
        ]
      });
    },
    fetchAllTasksFresh: function () {
      return Promise.resolve([
        { task_id: 't1', title: 'Furniture Assembly', category: 'trades', status: 'open', budget: 55, scheduled_at: at(1, 10, 0), posted_by: 'p1' },
        { task_id: 't2', title: 'Grocery Pickup', category: 'package', status: 'open', budget: 25, scheduled_at: at(0, 18, 30), posted_by: 'p2' },
        { task_id: 't3', title: 'Dog Walking', category: 'care', status: 'open', budget: 30, scheduled_at: at(1, 9, 0), posted_by: 'p3' }
      ]);
    },
    fetchUserNotifications: function () { return Promise.resolve([]); },
    readTasksCache: function () { return []; },
    getUserLoginGate: function () { return Promise.resolve({ role: 'worker' }); },
    syncCurrentUserProfile: function () { return Promise.resolve({ user: { role: 'worker' } }); },
    getUserByFirebaseUid: function () { return Promise.resolve({ role: 'worker' }); }
  };

  Object.keys(stubs).forEach(function (k) { window[k] = stubs[k]; });
}

const FIXTURE_SRC = '\n;(' + fixtures.toString() + ')();\n';

const IDS = {
  'dashboard.html': ['sgCity', 'sgGreeting', 'sgCurrentTask', 'sgWeek', 'sgNearbyList', 'sgPersonBtn', 'sgTabs']
};

(async () => {
  const browser = await chromium.launch();
  const shots = [];

  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)); });

    await page.route('**/firebase-app.js', (r) =>
      r.fulfill({ contentType: 'application/javascript', body: FIREBASE_APP_STUB }));
    await page.route('**/firebase-auth.js', (r) =>
      r.fulfill({ contentType: 'application/javascript', body: FIREBASE_AUTH_STUB }));

    // Append the fixtures to the last data script the page loads.
    await page.route('**/qg-location.js*', async (r) => {
      const res = await r.fetch();
      r.fulfill({ response: res, body: (await res.text()) + FIXTURE_SRC });
    });

    await page.addInitScript((t) => {
      try { localStorage.setItem('qg-theme', t); } catch (e) {}
    }, theme);

    await page.goto(BASE + '/' + pageName, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    const out = path.join(ROOT, '.verify', pageName.replace('.html', '') + '-' + theme + '.png');
    await page.screenshot({ path: out, fullPage: true });
    shots.push({ file: out, label: theme });

    const missing = await page.evaluate(
      (ids) => ids.filter((id) => !document.getElementById(id)), IDS[pageName] || []);
    const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    const visible = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.sg-body > *, .sg-beta, header'))
        .filter((el) => el.offsetParent !== null)
        .map((el) => (el.id || el.className || el.tagName).toString().slice(0, 40)));

    console.log('[' + theme + '] missing ids: ' + (missing.length ? missing.join(', ') : 'none'));
    console.log('[' + theme + '] font: ' + font);
    console.log('[' + theme + '] visible blocks: ' + visible.join(' | '));
    console.log('[' + theme + '] ' + (errors.length ? 'errors:\n   - ' + errors.slice(0, 6).join('\n   - ') : 'no page errors'));

    await context.close();
  }

  if (designPng && fs.existsSync(path.join(DESIGN, designPng))) {
    const ctx = await browser.newContext({ viewport: { width: 1250, height: 1000 } });
    const compose = await ctx.newPage();
    const url = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
    await compose.setContent(
      '<body style="margin:0;background:#2b2b31;font:12px system-ui;color:#fff;display:flex;gap:10px;padding:10px;align-items:flex-start">' +
      '<figure style="margin:0"><figcaption style="padding:4px">DESIGN</figcaption><img src="' +
      url(path.join(DESIGN, designPng)) + '" style="width:390px;display:block"></figure>' +
      shots.map((s) =>
        '<figure style="margin:0"><figcaption style="padding:4px">BUILT — ' + s.label +
        ' (fixture data)</figcaption><img src="' + url(s.file) + '" style="width:390px;display:block"></figure>'
      ).join('') + '</body>'
    );
    await compose.waitForTimeout(500);
    const out = path.join(ROOT, '.verify', 'layout-' + pageName.replace('.html', '') + '.png');
    await compose.screenshot({ path: out, fullPage: true });
    console.log('\nside-by-side: ' + out);
  }

  await browser.close();
})();
