/** Renders the four qg-states.js outputs so they can be eyeballed. */
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.env.SG_BASE || 'http://localhost:8099';

(async () => {
  const browser = await chromium.launch();
  const shots = [];

  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 1100 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

    await page.route('**/states.html', (r) =>
      r.fulfill({
        contentType: 'text/html',
        body:
          '<!DOCTYPE html><html class="' + theme + '"><head><meta charset="UTF-8">' +
          '<link rel="stylesheet" href="qg-tokens.css"><link rel="stylesheet" href="sg-app.css">' +
          '</head><body class="sg-app"><div class="sg-screen"><main class="sg-body" id="o"></main></div>' +
          '<script src="qg-states.js"><\/script><script>' +
          'var o=document.getElementById("o");' +
          'o.innerHTML = QG_listSkeletonHtml({rows:3})' +
          ' + QG_spinnerHtml({label:"Loading gigs…"})' +
          ' + QG_spinnerHtml({label:"Loading gigs…", inline:false, large:true})' +
          ' + QG_emptyStateHtml({icon:"search", title:"No gigs nearby", sub:"Try widening your radius or check back later.", action:{label:"Clear filters", onclick:"void 0"}})' +
          ' + QG_errorStateHtml({})' +
          ' + QG_errorStateHtml({offline:true, secondary:{label:"Go home", href:"dashboard.html"}});' +
          '<\/script></body></html>'
      }));

    await page.goto(BASE + '/states.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);

    const out = path.join(__dirname, '..', '.verify', 'states-' + theme + '.png');
    await page.screenshot({ path: out, fullPage: true });
    shots.push({ file: out, label: theme });
    console.log('[' + theme + '] ' + (errors.length ? 'errors: ' + errors.join(' | ') : 'no page errors'));
    await ctx.close();
  }

  const ctx = await browser.newContext({ viewport: { width: 830, height: 1100 } });
  const compose = await ctx.newPage();
  const fs = require('fs');
  const url = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
  await compose.setContent(
    '<body style="margin:0;background:#2b2b31;display:flex;gap:10px;padding:10px;font:12px system-ui;color:#fff">' +
    shots.map((s) => '<figure style="margin:0"><figcaption style="padding:4px">' + s.label +
      '</figcaption><img src="' + url(s.file) + '" style="width:390px;display:block"></figure>').join('') +
    '</body>');
  await compose.waitForTimeout(400);
  const out = path.join(__dirname, '..', '.verify', 'states.png');
  await compose.screenshot({ path: out, fullPage: true });
  console.log('\n' + out);
  await browser.close();
})();
