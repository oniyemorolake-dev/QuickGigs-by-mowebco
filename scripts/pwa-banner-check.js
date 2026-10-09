/**
 * Verifies the PWA install banner is styled on every page that can show it.
 *
 * The banner only appears after a beforeinstallprompt event, which headless
 * Chromium never fires, so the event is synthesised and showAndroidBanner is
 * reached through the real code path.
 *
 *   node scripts/pwa-banner-check.js [page ...]
 */
const { chromium } = require('playwright');
const path = require('path');

const BASE = 'http://localhost:8099';
const PAGES = process.argv.slice(2).length ? process.argv.slice(2) : ['login.html', 'index.html'];
const SHOTS = path.resolve(__dirname, '..', '.verify');

(async () => {
  const browser = await chromium.launch();
  let fails = 0;

  for (const pageName of PAGES) {
    for (const theme of ['dark', 'light']) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

      await page.addInitScript((t) => {
        localStorage.removeItem('qg-pwa-dismissed');
        localStorage.setItem('qg-theme', t);
      }, theme);

      await page.goto(BASE + '/' + pageName);
      await page.waitForTimeout(1500);

      // Drive the real path: fire the event qg-pwa.js listens for.
      await page.evaluate(() => {
        const e = new Event('beforeinstallprompt');
        e.prompt = () => {};
        e.userChoice = Promise.resolve({ outcome: 'dismissed' });
        window.dispatchEvent(e);
      });
      await page.waitForTimeout(900);

      const got = await page.evaluate(() => {
        const b = document.getElementById('qgPwaBanner');
        if (!b) return null;
        const cs = getComputedStyle(b);
        const btn = b.querySelector('.qg-pwa-install');
        return {
          display: cs.display,
          radius: cs.borderRadius,
          bg: cs.backgroundColor,
          border: cs.borderTopWidth,
          btnBg: btn ? getComputedStyle(btn).backgroundColor : null,
          btnRadius: btn ? getComputedStyle(btn).borderRadius : null
        };
      });

      const tag = pageName + ' / ' + theme;
      if (!got) {
        console.log('  SKIP  ' + tag + '   [banner did not render]');
      } else {
        // Unstyled would be display:block, radius 0px, transparent background.
        const styled =
          got.display === 'flex' &&
          got.radius !== '0px' &&
          got.bg !== 'rgba(0, 0, 0, 0)' &&
          got.btnRadius !== '0px';
        console.log((styled ? '  PASS  ' : '  FAIL  ') + tag + '   ' + JSON.stringify(got));
        if (!styled) fails++;
        await page.screenshot({
          path: path.join(SHOTS, 'pwa-' + pageName.replace('.html', '') + '-' + theme + '.png'),
          clip: { x: 0, y: 0, width: 390, height: 220 }
        });
      }

      if (errors.length) console.log('         page errors: ' + errors.join(' | '));
      await page.close();
    }
  }

  await browser.close();
  console.log(fails === 0 ? '\nBANNER STYLED EVERYWHERE' : '\n' + fails + ' UNSTYLED');
  process.exit(fails === 0 ? 0 : 1);
})();
