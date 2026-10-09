/**
 * Check Post task city typeahead + Use my location.
 *
 *   node scripts/test-city-typeahead.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.verify');
const BASE = process.env.SG_BASE || 'http://localhost:8099';

const FB_APP = 'export function initializeApp(){ return {}; }';
const FB_AUTH = `
export function getAuth(){ return { currentUser: { uid:'fixture-uid', displayName:'Morolake A', email:'m@example.com' } }; }
export function onAuthStateChanged(a, cb){ setTimeout(function(){ cb(a.currentUser); }, 10); return function(){}; }
`;

function fixtures() {
  window.getMode = function () { return 'poster'; };
  window.QG_loadVerification = function () {
    window.QG_verificationState = { poster_verified: true };
    return Promise.resolve(window.QG_verificationState);
  };
  window.QG_syncVerificationReturn = function () { return Promise.resolve(null); };
  window.syncCurrentUserProfile = function () { return Promise.resolve(); };
  window.enforceBanOnLogin = function () { return Promise.resolve({ ok: true }); };
  window.getUserLocation = function () { return ''; };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 900 },
    geolocation: { latitude: 51.0447, longitude: -114.0719 },
    permissions: ['geolocation']
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0].slice(0, 140)));

  await page.route('**/firebase-app.js', (r) => r.fulfill({ contentType: 'application/javascript', body: FB_APP }));
  await page.route('**/firebase-auth.js', (r) => r.fulfill({ contentType: 'application/javascript', body: FB_AUTH }));
  await page.route('**/qg-categories.js*', async (r) => {
    const res = await r.fetch();
    r.fulfill({ response: res, body: (await res.text()) + '\n;(' + fixtures.toString() + ')();\n' });
  });
  await page.route('**/nominatim.openstreetmap.org/search**', (r) => {
    r.fulfill({ contentType: 'application/json', body: '[]' });
  });
  await page.route('**/nominatim.openstreetmap.org/reverse**', (r) => {
    r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        address: { neighbourhood: 'Hillhurst', city: 'Calgary', state: 'Alberta' }
      })
    });
  });
  await page.addInitScript(() => {
    try { localStorage.setItem('qg-mode', 'poster'); } catch (e) {}
  });

  await page.goto(BASE + '/posttask.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1600);
  await page.click('#sgCatChips [data-cat="beauty"]').catch(() => {});
  await page.fill('#sgTitle', 'Hair Braiding');
  await page.click('#sgNext');
  await page.waitForSelector('#sgArea', { timeout: 4000 });

  await page.click('#sgArea');
  await page.fill('#sgArea', 'cal');
  await page.waitForFunction(() => {
    var list = document.getElementById('sgAreaSuggest');
    return list && !list.hidden && /Calgary, AB/.test(list.textContent || '');
  }, null, { timeout: 4000 });
  const suggest = await page.textContent('#sgAreaSuggest');
  await page.screenshot({ path: path.join(OUT, 'post-city-typeahead.png'), animations: 'disabled' });

  const ranked = await page.evaluate(() => window.suggestCanadianCities('cal', 8));
  await page.click('#sgAreaSuggest button:has-text("Calgary, AB")');
  const afterPick = await page.inputValue('#sgArea');

  const geoReqs = [];
  page.on('request', (req) => {
    if (/nominatim|geocode/i.test(req.url())) geoReqs.push(req.url());
  });
  await page.click('#sgUseLocChip');
  await page.waitForFunction(() => {
    var label = document.getElementById('sgUseLocLabel');
    return label && /Using your location|Allow location|Could not read/.test(label.textContent || '');
  }, null, { timeout: 8000 });
  const afterGps = await page.inputValue('#sgArea');
  const chip = await page.textContent('#sgUseLocLabel');
  console.log('ranked:', JSON.stringify(ranked));
  console.log('geo reqs:', geoReqs);
  await page.screenshot({ path: path.join(OUT, 'post-city-gps.png'), animations: 'disabled' });

  console.log('suggest:', JSON.stringify(suggest && suggest.replace(/\s+/g, ' ').trim()));
  console.log('after pick:', afterPick);
  console.log('after gps:', afterGps);
  console.log('chip:', (chip || '').trim());
  if (errors.length) console.log('errors:', errors.slice(0, 3).join(' | '));

  const ok = /Calgary, AB/.test(suggest || '') &&
    afterPick === 'Calgary, AB' &&
    /Hillhurst, Calgary, AB/.test(afterGps) &&
    /Using your location/.test(chip || '');
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
