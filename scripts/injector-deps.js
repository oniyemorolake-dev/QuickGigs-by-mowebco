/**
 * Which injector-owned functions does a page actually need?
 *
 *   node scripts/injector-deps.js browsetask.html posttask.html
 *   node scripts/injector-deps.js            # all five remaining pages
 *
 * The rebuilt pages must not load the UI injectors, because those are what put
 * streak cards, goal cards, stat tiles, tips and banners back onto screens the
 * design does not have them on. Anything a page genuinely needs has to be
 * called from somewhere else or extracted, the way qg-streak.js was.
 *
 * This reports, per page, the names its inline script calls that are defined
 * ONLY inside an injector — those are the ones needing a decision — and
 * separately the names that are also available from a safe file, which can
 * simply be loaded instead.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/* Files a rebuilt page must not load. Measured, not guessed: each one adds
   chrome or a legacy stylesheet to an empty page purely by being loaded.
   Re-check with `node scripts/injector-probe.js` if this list is ever doubted.
   Everything else — including qg-verification.js, qg-payments-ui.js,
   qg-bigtech.js, qg-trust-profile.js and qg-role-switch.js — adds nothing on
   its own and is safe to load. */
const INJECTORS = new Set([
  'qg-brand-init.js', 'qg-nav.js', 'qg-menu.js', 'qg-bell.js', 'qg-help.js',
  'qg-ux.js', 'qg-wave2.js', 'qg-polish.js', 'qg-site.js', 'qg-cookies.js'
]);

const DEFAULT_PAGES = [
  'browsetask.html', 'posttask.html', 'messages.html', 'profile.html', 'mytasks.html'
];

const pages = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_PAGES;

// name -> Set of files that define it
const defs = new Map();
function addDef(name, file) {
  if (!defs.has(name)) defs.set(name, new Set());
  defs.get(name).add(file);
}

for (const file of fs.readdirSync(ROOT)) {
  if (!file.endsWith('.js')) continue;
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const patterns = [
    /\bwindow\.([A-Za-z_$][\w$]*)\s*=/g,
    /(?:^|\n)\s*function\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /(?:^|\n)\s*(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function/g,
    // qg-page-bits.js registers through def('name', fn) so it only defines
    // what is missing; those count as definitions too.
    /\bdef\(\s*['"]([A-Za-z_$][\w$]*)['"]/g
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src))) addDef(m[1], file);
  }
}

function inlineScript(html) {
  let out = '';
  const re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) out += '\n' + m[1];
  return out;
}

const summary = {};

for (const page of pages) {
  const full = path.join(ROOT, page);
  if (!fs.existsSync(full)) { console.log('\n' + page + ' — not found'); continue; }
  const html = fs.readFileSync(full, 'utf8');
  const code = inlineScript(html);

  // Names the page calls.
  const called = new Set();
  let m;
  const callRe = /\b([A-Za-z_$][\w$]*)\s*\(/g;
  while ((m = callRe.exec(code))) called.add(m[1]);
  const winRe = /\bwindow\.([A-Za-z_$][\w$]*)/g;
  while ((m = winRe.exec(code))) called.add(m[1]);

  // Names the page defines itself don't count.
  const own = new Set();
  const ownRe = /function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  while ((m = ownRe.exec(code))) own.add(m[1]);

  const blocked = [];
  const alsoSafe = [];

  for (const name of called) {
    if (own.has(name)) continue;
    const where = defs.get(name);
    if (!where) continue;
    const files = Array.from(where);
    const safe = files.filter((f) => !INJECTORS.has(f));
    const unsafe = files.filter((f) => INJECTORS.has(f));
    if (!unsafe.length) continue;
    if (safe.length) alsoSafe.push(name + '  (also in ' + safe.join(', ') + ')');
    else blocked.push(name + '  <- ' + unsafe.join(', '));
  }

  blocked.sort();
  alsoSafe.sort();
  summary[page] = blocked.length;

  console.log('\n=== ' + page + ' ===');
  console.log('  NEEDS A DECISION (only in an injector): ' + blocked.length);
  blocked.forEach((b) => console.log('    ' + b));
  if (alsoSafe.length) {
    console.log('  fine, available from a safe file too: ' + alsoSafe.length);
    alsoSafe.forEach((b) => console.log('    ' + b));
  }
}

console.log('\n--- totals ---');
Object.keys(summary).forEach((p) => console.log('  ' + p.padEnd(20) + summary[p]));
