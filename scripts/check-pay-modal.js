/**
 * Prove Pay & fund escrow actually shows the Stripe overlay on top of a
 * chat sheet. The rebuilt screens used to load qg-stripe.js without
 * qg-stripe.css, so the overlay opened behind the sheet and looked dead.
 *
 *   node scripts/check-pay-modal.js
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/qg-tokens.css">
<link rel="stylesheet" href="/sg-app.css">
<script src="/qg-utils.js"></script>
<script src="/qg-config.js"></script>
<script src="/qg-stripe.js"></script>
</head>
<body class="sg-app">
<div class="sg-sheet open" id="sgChat" aria-hidden="false">
  <div class="sg-sheet-panel full" style="padding:20px;display:flex;flex-direction:column">
    <p>Chat is locked until you pay.</p>
    <div class="sg-sheet-foot" id="sgChatLockedActions">
      <button type="button" class="sg-btn purple" id="sgChatPay" style="width:100%">Pay &amp; fund escrow</button>
    </div>
  </div>
</div>
<script>
window._currentUser = { uid: 'poster-1' };
document.getElementById('sgChatPay').addEventListener('click', function () {
  window.QG_openPayModal('task-1', 'poster-1', { returnPage: 'messages', title: 'Pay & fund escrow' });
});
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/' || urlPath === '/pay-test.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
    return;
  }
  const file = path.normalize(path.join(ROOT, urlPath.replace(/^\/+/, '')));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

function fail(msg, extra) {
  console.error('FAIL', msg, extra || '');
  process.exitCode = 1;
}

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = 'http://127.0.0.1:' + port;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(base + '/pay-test.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.QG_openPayModal === 'function');

  const before = await page.evaluate(() => {
    const css = !!document.getElementById('qg-stripe-css') || !!document.querySelector('link[href*="qg-stripe.css"]');
    const critical = !!document.getElementById('qg-stripe-critical');
    return { css, critical, overlay: !!document.getElementById('qg-stripe-overlay') };
  });

  await page.click('#sgChatPay');
  await page.waitForSelector('#qg-stripe-overlay.open', { timeout: 4000 });

  const after = await page.evaluate(() => {
    const overlay = document.getElementById('qg-stripe-overlay');
    const sheet = document.getElementById('sgChat');
    const cs = overlay ? getComputedStyle(overlay) : {};
    const sheetCs = sheet ? getComputedStyle(sheet) : {};
    const r = overlay ? overlay.getBoundingClientRect() : {};
    return {
      open: overlay && overlay.classList.contains('open'),
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      zIndex: cs.zIndex,
      position: cs.position,
      sheetZ: sheetCs.zIndex,
      width: r.width,
      height: r.height,
      top: r.top,
      title: (document.getElementById('qgStripeTitle') || {}).textContent
    };
  });

  await page.screenshot({ path: path.join(ROOT, '.verify', 'pay-modal.png'), fullPage: true });

  console.log(JSON.stringify({ before, after }, null, 2));

  if (!before.critical && !before.css) fail('stripe CSS was not injected on load');
  if (!after.open) fail('overlay did not open');
  if (after.visibility !== 'visible') fail('overlay not visible', after.visibility);
  if (Number(after.opacity) < 0.5) fail('overlay opacity too low', after.opacity);
  if (after.position !== 'fixed') fail('overlay not fixed', after.position);
  if (Number(after.zIndex) <= Number(after.sheetZ || 0)) fail('overlay under chat sheet', after);
  if (!(after.width > 200 && after.height > 200)) fail('overlay has no size', after);
  if (!/Pay/.test(after.title || '')) fail('missing pay title', after.title);

  await browser.close();
  server.close();
  if (!process.exitCode) console.log('OK pay modal opens above the chat sheet');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
  try { server.close(); } catch (e) {}
});
