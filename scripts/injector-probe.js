/**
 * Does a script inject UI just by being loaded?
 *
 *   node scripts/injector-probe.js
 *
 * The rebuilt pages ban "injectors", but that word covers two different
 * things. A file that mounts chrome the moment it loads genuinely cannot be
 * used. A file that only acts when a page calls it is a feature module and is
 * safe to load, even if it contains plenty of innerHTML.
 *
 * This loads each candidate in a real page with an empty body and reports what
 * it added to the DOM on its own. Zero added nodes means safe to load.
 */
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.env.SG_BASE || 'http://localhost:8099';

const CANDIDATES = [
  'qg-verification.js', 'qg-payments-ui.js', 'qg-polish.js', 'qg-bigtech.js',
  'qg-trust-profile.js', 'qg-role-switch.js', 'qg-activity-ticker.js',
  'qg-cookies.js', 'qg-site.js', 'qg-saved.js', 'qg-role-access.js',
  'qg-stats.js', 'qg-confetti.js', 'qg-notifications.js', 'qg-age.js',
  'qg-ux.js', 'qg-wave2.js', 'qg-bell.js', 'qg-help.js', 'qg-menu.js',
  'qg-nav.js', 'qg-onboarding.js', 'qg-brand-init.js'
];

(async () => {
  const browser = await chromium.launch();
  const results = [];

  for (const file of CANDIDATES) {
    const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message.split('\n')[0].slice(0, 80)));

    /* The script has to be in the initial HTML, not added afterwards: most of
       these inject from a DOMContentLoaded listener, which never fires again
       once the page has loaded. The probe is served under a real page name so
       any filename-gated logic behaves as it would in production. */
    await page.route('**/browsetask.html', (r) =>
      r.fulfill({
        contentType: 'text/html',
        body: '<!DOCTYPE html><html><head><link rel="stylesheet" href="qg-tokens.css">' +
          '</head><body><script src="' + file + '"><\/script></body></html>'
      }));

    const before = { body: 0, head: 1 };

    await page.goto(BASE + '/browsetask.html', { waitUntil: 'domcontentloaded' });

    // Give DOMContentLoaded-style and idle-deferred work a chance to run.
    await page.waitForTimeout(1800);

    const after = await page.evaluate(() => {
      const added = [];
      // The probe's own <script> tag is not an injection.
      Array.from(document.body.children).forEach((el) => {
        if (el.tagName === 'SCRIPT') return;
        added.push((el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
          (el.className && typeof el.className === 'string' && el.className.trim()
            ? '.' + el.className.trim().split(/\s+/)[0] : '')).slice(0, 44));
      });
      return {
        bodyAdded: added.length,
        nodes: added,
        sheets: Array.from(document.head.querySelectorAll('link[rel=stylesheet]')).map((l) =>
          l.getAttribute('href').split('?')[0])
      };
    }, before);

    const visual = after.bodyAdded > 0 || after.sheets.length > 1;
    results.push({
      file,
      verdict: visual ? 'INJECTS' : 'safe to load',
      detail: [
        after.bodyAdded ? after.bodyAdded + ' body node(s): ' + after.nodes.join(', ') : '',
        after.sheets.length > 1 ? 'adds ' + (after.sheets.length - 1) + ' stylesheet(s)' : '',
        errors.length ? 'errors: ' + errors[0] : ''
      ].filter(Boolean).join(' | ')
    });

    await context.close();
  }

  const safe = results.filter((r) => r.verdict === 'safe to load');
  const bad = results.filter((r) => r.verdict !== 'safe to load');

  console.log('\n=== SAFE TO LOAD (added nothing on their own) ===');
  safe.forEach((r) => console.log('  ' + r.file.padEnd(24) + (r.detail || '')));
  console.log('\n=== INJECTS ON LOAD (must stay out) ===');
  bad.forEach((r) => console.log('  ' + r.file.padEnd(24) + r.verdict + '  ' + r.detail));

  await browser.close();
})();
