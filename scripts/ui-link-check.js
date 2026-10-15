const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pages = fs.readdirSync(root).filter((f) => f.endsWith('.html') && f !== 'google13a14307604310d2.html');
const missing = [];
const hashOnly = [];

for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  const hrefs = [...html.matchAll(/href\s*=\s*['"]([^'"]*)['"]/gi)].map((m) => m[1]);
  for (const href of hrefs) {
    if (!href || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    if (href === '#' || href === '#0') {
      hashOnly.push(page + ' -> ' + href);
      continue;
    }
    if (href.startsWith('#')) {
      const id = href.slice(1);
      if (!html.includes('id="' + id + '"') && !html.includes("id='" + id + "'")) {
        missing.push(page + ' missing anchor ' + href);
      }
      continue;
    }
    const file = decodeURIComponent(href.split('?')[0].split('#')[0]);
    if (!file || file.startsWith('/')) continue;
    if (!fs.existsSync(path.join(root, file))) missing.push(page + ' -> ' + href);
  }
}

console.log('PAGES ' + pages.length);
console.log('MISSING');
console.log([...new Set(missing)].join('\n') || '(none)');
console.log('BARE_HASH ' + [...new Set(hashOnly)].length);
console.log([...new Set(hashOnly)].join('\n'));
