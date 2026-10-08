/**
 * Ensure selected root HTML pages link qg-swift.css, placed immediately after
 * the qg-brand.css link (dashboard.html's placement) or else just before </head>.
 *
 * Idempotent: a page that already links qg-swift.css is left untouched.
 *
 * Scope note: qg-swift.css is entirely self-contained -- every selector is
 * .sg-* scoped, and its :root defines only --sg-* spacing/radius tokens that
 * nothing outside that file consumes. Linking it to a page with no .sg-* markup
 * therefore has no visual effect and only costs a request. PAGES below is an
 * explicit allow-list rather than "every page" for that reason.
 *
 * Run:        node scripts/link-qg-swift.js
 * Dry run:    node scripts/link-qg-swift.js --dry
 */
var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var LINK = '<link rel="stylesheet" href="qg-swift.css">';
var dry = process.argv.indexOf('--dry') !== -1;

// Pages that should carry the SwiftGigs component primitives.
// Edit this list to widen or narrow the rollout.
var PAGES = [
  'browsetask.html',
  'categories.html',
  'dashboard.html',
  'mytasks.html',
  'posttask.html',
  'workers.html'
];

// Never touch: Google site-verification stub, not a real page.
var NEVER = /^google[0-9a-f]+\.html$/i;

var added = 0, already = 0, skipped = 0, missing = 0;

PAGES.forEach(function (name) {
  if (NEVER.test(name)) { console.log('  ' + name + ': skip (verification stub)'); skipped++; return; }

  var fp = path.join(root, name);
  if (!fs.existsSync(fp)) { console.log('  ' + name + ': MISSING FILE'); missing++; return; }

  var html = fs.readFileSync(fp, 'utf8');

  if (/qg-swift\.css/i.test(html)) { console.log('  ' + name + ': already linked'); already++; return; }

  var next;
  if (/<link[^>]*qg-brand\.css[^>]*>/i.test(html)) {
    next = html.replace(/(<link[^>]*qg-brand\.css[^>]*>)/i, '$1\n' + LINK);
  } else if (/<\/head>/i.test(html)) {
    next = html.replace(/<\/head>/i, LINK + '\n</head>');
  } else {
    console.log('  ' + name + ': SKIP (no qg-brand.css link and no </head>)');
    skipped++;
    return;
  }

  if (next === html) { console.log('  ' + name + ': unchanged'); already++; return; }

  if (dry) { console.log('  ' + name + ': would add'); }
  else { fs.writeFileSync(fp, next, 'utf8'); console.log('  ' + name + ': added'); }
  added++;
});

console.log('\n' + (dry ? '[dry run] ' : '') +
  'added ' + added + ', already linked ' + already + ', skipped ' + skipped + ', missing ' + missing);
