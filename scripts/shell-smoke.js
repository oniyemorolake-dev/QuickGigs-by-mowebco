/**
 * Shell smoke check for the SwiftGigs layout rebuild.
 *
 * Loads the real shared shell scripts into a synthetic app page so the tab bar
 * and person menu can be asserted without going through Firebase Auth. This
 * checks structure only — the per-page visual pass against the design PNGs is
 * done on the real, logged-in pages.
 *
 *   node scripts/shell-smoke.js [baseUrl]
 */
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:8099';

const { harness } = require('./shell-harness');
const HARNESS = harness({ mode: 'poster' });

function check(name, pass, detail) {
  console.log((pass ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   [' + detail + ']' : ''));
  return pass ? 0 : 1;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

  // Served from /dashboard.html so pageKey() resolves to 'dashboard'.
  await page.route('**/dashboard.html', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: HARNESS })
  );
  await page.goto(BASE + '/dashboard.html');
  await page.waitForTimeout(400);
  await page.evaluate(() => window.renderQuickGigsTabBar && window.renderQuickGigsTabBar('home'));
  await page.waitForTimeout(200);

  let fails = 0;
  console.log('\n--- bottom tab bar ---');
  const tabs = await page.$$eval('#qgTabBar .tab-item', (els) =>
    els.map((e) => ({
      label: e.querySelector('.tab-lbl').textContent,
      href: e.getAttribute('href'),
      active: e.classList.contains('active'),
      colour: getComputedStyle(e.querySelector('.tab-lbl')).color
    }))
  );
  fails += check('exactly 4 tabs', tabs.length === 4, tabs.length + ' found');
  fails += check(
    'Home / Gigs / Messages / Profile',
    tabs.map((t) => t.label).join(' / ') === 'Home / Gigs / Messages / Profile',
    tabs.map((t) => t.label).join(' / ')
  );
  fails += check(
    'hrefs correct',
    tabs.map((t) => t.href).join(',') === 'dashboard.html,browsetask.html,messages.html,profile.html',
    tabs.map((t) => t.href).join(',')
  );
  const active = tabs.filter((t) => t.active);
  fails += check('one active tab, Home', active.length === 1 && active[0].label === 'Home');

  // Purple in both modes. --primary resolves to a purple, so assert the active
  // label differs from the inactive ones and matches --primary exactly.
  const primary = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()
  );
  const activeColour = active.length ? active[0].colour : '';
  const asRgb = await page.evaluate((hex) => {
    const d = document.createElement('div');
    d.style.color = hex;
    document.body.appendChild(d);
    const c = getComputedStyle(d).color;
    d.remove();
    return c;
  }, primary);
  fails += check('active tab is --primary (purple)', activeColour === asRgb, activeColour + ' vs ' + asRgb);

  console.log('\n--- header chrome removed ---');
  for (const [name, sel] of [
    ['no bell button', '#qgBellBtn'],
    ['no header search button', '.qg-nav-search-btn'],
    ['no floating help bubble', '#qgHelpFab'],
    ['no Poster/Tasker pill in header', '.nav-right .qg-header-role-toggle'],
    ['no role pill beside wordmark', '.nav-role'],
    ["no \"You're in X mode\" strip", '.qg-mode-banner']
  ]) {
    fails += check(name, (await page.$$(sel)).length === 0);
  }

  console.log('\n--- person button ---');
  const btn = await page.$('#qgMenuBtn');
  fails += check('person button present', !!btn);
  if (btn) {
    const info = await btn.evaluate((e) => ({
      bars: e.querySelectorAll('span').length,
      svgs: e.querySelectorAll('svg').length,
      radius: getComputedStyle(e).borderRadius,
      label: e.getAttribute('aria-label')
    }));
    fails += check('is an icon, not a hamburger', info.bars === 0 && info.svgs === 1, JSON.stringify(info));
    fails += check('round', info.radius === '50%', info.radius);
    fails += check('labelled for screen readers', info.label === 'Account menu', info.label);
  }

  console.log('\n--- menu absorbed the removed features ---');
  if (btn) {
    await btn.click();
    await page.waitForTimeout(350);
    const rows = await page.$$eval('#qgMenuBody .qg-menu-link, #qgMenuBody .qg-menu-action', (els) =>
      els.map((e) => e.textContent.trim())
    );
    for (const want of ['Notifications', 'Search', 'Quick help', 'My tasks', 'Applicants', 'Profile']) {
      fails += check('menu has "' + want + '"', rows.some((r) => r.indexOf(want) === 0), rows.join(' | '));
    }
    const toggle = await page.$('#qgMenuBody [data-qg-role-toggle-host] .qg-header-role-toggle');
    fails += check('Poster/Tasker toggle mounted in menu', !!toggle);
    if (toggle) {
      const opts = await page.$$eval(
        '#qgMenuBody .qg-header-role-opt',
        (els) => els.map((e) => e.textContent.trim())
      );
      fails += check('toggle offers both roles', opts.length === 2, opts.join(','));
    }
  }

  // Rule 4: the active tab must read purple in all four theme/mode combos.
  console.log('\n--- active tab colour across theme x mode ---');
  await page.evaluate(() => window.QG_closeMenu && window.QG_closeMenu());
  for (const mode of ['poster', 'tasker']) {
    for (const theme of ['dark', 'light']) {
      const got = await page.evaluate(
        ([m, t]) => {
          document.documentElement.setAttribute('data-qg-mode', m === 'tasker' ? 'worker' : 'poster');
          document.documentElement.setAttribute('data-mode', m);
          document.body.classList.toggle('light', t === 'light');
          document.body.classList.toggle('qg-mode-worker', m === 'tasker');
          document.body.classList.toggle('qg-mode-poster', m === 'poster');
          localStorage.setItem('qg-mode', m);
          window.renderQuickGigsTabBar('home');
          const lbl = document.querySelector('#qgTabBar .tab-item.active .tab-lbl');
          /* Read --primary in the tab's own scope: the light palette is
             declared on body.light, so resolving it against documentElement
             returns the dark value and the comparison is meaningless. */
          const probe = document.createElement('div');
          probe.style.color = getComputedStyle(lbl).getPropertyValue('--primary').trim();
          lbl.appendChild(probe);
          const want = getComputedStyle(probe).color;
          probe.remove();
          return { got: getComputedStyle(lbl).color, want: want };
        },
        [mode, theme]
      );
      fails += check(
        mode + ' + ' + theme + ' active tab is --primary',
        got.got === got.want,
        got.got + ' vs ' + got.want
      );
    }
  }

  console.log('\n--- page errors ---');
  fails += check('no uncaught page errors', errors.length === 0, errors.join(' ; '));

  await browser.close();
  console.log('\n' + (fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'));
  process.exit(fails === 0 ? 0 : 1);
})();
