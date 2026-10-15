const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const pages = [
  'index.html', 'login.html', 'signup.html', 'faq.html', 'how-it-works.html',
  'safety.html', 'guidelines.html', 'terms.html', 'privacy.html', 'feedback.html',
  'categories.html', '404.html', 'dispute-resolution.html', 'thank-you.html',
  'reset-password.html', 'poster-terms.html', 'contractor-agreement.html'
];

const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = path.normalize(path.join(root, urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '')));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('missing'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  for (const name of pages) {
    const errors = [];
    page.removeAllListeners('pageerror');
    page.on('pageerror', (e) => errors.push(String(e.message).split('\n')[0]));
    await page.goto(base + '/' + name, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(400);
    const info = await page.evaluate(() => {
      const doc = document.documentElement;
      const links = [...document.querySelectorAll('a[href]')].length;
      const buttons = document.querySelectorAll('button').length;
      const forms = document.querySelectorAll('form').length;
      return {
        overflow: doc.scrollWidth > doc.clientWidth + 2,
        scrollWidth: doc.scrollWidth,
        links,
        buttons,
        forms,
        title: document.title
      };
    });
    console.log(JSON.stringify({ page: name, errors: errors.slice(0, 3), ...info }));
  }
  await browser.close();
  server.close();
})().catch((err) => {
  console.error(err);
  try { server.close(); } catch (e) {}
  process.exit(1);
});
