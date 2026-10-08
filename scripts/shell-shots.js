/**
 * Screenshots the shared shell (tab bar + person menu) at 390px in both themes,
 * using the same synthetic harness as shell-smoke.js.
 *   node scripts/shell-shots.js [outDir]
 */
const { chromium } = require('playwright');
const path = require('path');
const { harness } = require('./shell-harness');

const BASE = 'http://localhost:8099';
/* Scratch output, deliberately outside "Claude outputs" — that folder is
   Claude's deliverable, not a place for throwaway verification shots. */
const OUT = process.argv[2] || path.resolve(__dirname, '..', '.verify');

const HARNESS = harness({ mode: 'poster' });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 760 } });
  await page.route('**/dashboard.html', (r) =>
    r.fulfill({ status: 200, contentType: 'text/html', body: HARNESS })
  );
  for (const theme of ['dark', 'light']) {
    for (const withMenu of [false, true]) {
      // Reload per shot — toggling the overlay in place leaves it stuck open.
      await page.goto(BASE + '/dashboard.html');
      await page.waitForTimeout(500);
      await page.evaluate((t) => {
        document.body.classList.toggle('light', t === 'light');
        document.documentElement.classList.toggle('light', t === 'light');
        window.renderQuickGigsTabBar('home');
      }, theme);
      await page.waitForTimeout(250);
      if (withMenu) {
        await page.evaluate(() => window.QG_openMenu());
        await page.waitForTimeout(450);
      }
      await page.screenshot({
        path: path.join(OUT, 'shell-' + (withMenu ? 'menu-' : '') + theme + '.png')
      });
    }
  }

  await browser.close();
  console.log('wrote shots to ' + OUT);
})();
