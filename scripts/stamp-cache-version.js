/**
 * Stamp a unique cache-bust id into sw.js + qg-pwa.js (and HTML qg-pwa script tags).
 * Run automatically from .githooks/pre-commit so deploys cannot forget to bump.
 *
 * Usage: node scripts/stamp-cache-version.js
 */
var fs = require('fs');
var path = require('path');
var { execSync } = require('child_process');

var root = path.resolve(__dirname, '..');

function gitShort() {
  try {
    return String(execSync('git rev-parse --short HEAD', { cwd: root })).trim() || 'nogit';
  } catch (_e) {
    return 'nogit';
  }
}

function buildId() {
  // Unique per stamp: short commit + unix seconds (avoids collisions if hook re-runs)
  return gitShort() + '-' + Math.floor(Date.now() / 1000);
}

function readUtf8NoBom(full) {
  var buf = fs.readFileSync(full);
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    buf = buf.subarray(3);
  }
  return buf.toString('utf8');
}

function writeUtf8NoBom(full, text) {
  // Explicit UTF-8 Buffer write — never rely on platform default encoding.
  fs.writeFileSync(full, Buffer.from(String(text), 'utf8'));
}

function rewrite(file, replacer) {
  var full = path.join(root, file);
  if (!fs.existsSync(full)) return false;
  var before = readUtf8NoBom(full);
  var after = replacer(before);
  if (after === before) return false;
  // Guard: refuse to write if this pass introduced new U+FFFD replacement chars
  var beforeBad = (before.match(/\uFFFD/g) || []).length;
  var afterBad = (after.match(/\uFFFD/g) || []).length;
  if (afterBad > beforeBad) {
    console.error('Refusing to write ' + file + ' — would increase replacement characters');
    return false;
  }
  writeUtf8NoBom(full, after);
  return true;
}

var id = buildId();
var changed = [];

if (rewrite('sw.js', function (src) {
  if (/var BUILD_ID = '[^']*';/.test(src)) {
    return src.replace(/var BUILD_ID = '[^']*';/, "var BUILD_ID = '" + id + "';");
  }
  // Legacy CACHE_NAME only — inject BUILD_ID block near top
  if (/var CACHE_NAME = '[^']*';/.test(src)) {
    return src.replace(
      /var CACHE_NAME = '[^']*';/,
      "var BUILD_ID = '" + id + "';\nvar CACHE_NAME = 'quickgigs-' + BUILD_ID;"
    );
  }
  return src;
})) changed.push('sw.js');

if (rewrite('qg-pwa.js', function (src) {
  if (/var SHEET_VER = '[^']*';/.test(src)) {
    return src.replace(/var SHEET_VER = '[^']*';/, "var SHEET_VER = '" + id + "';");
  }
  if (/var BUILD_ID = '[^']*';/.test(src)) {
    return src.replace(/var BUILD_ID = '[^']*';/, "var BUILD_ID = '" + id + "';");
  }
  return src;
})) changed.push('qg-pwa.js');

// Deliberately does NOT rewrite the .html files.
//
// It used to stamp `qg-pwa.js?v=` and a `<!-- qg-build: -->` marker into all 33
// root HTML files. Because CI commits the stamp result, that produced a commit
// touching every HTML file on every push, which collided constantly with
// in-flight HTML edits (see AGENTS.md). Anything edited near a stamped line got
// dragged into the conflict.
//
// Cache invalidation does not depend on those HTML values: BUILD_ID below feeds
// sw.js's CACHE_NAME, so a bump makes the service worker install a fresh cache
// and refetch every asset, qg-pwa.js included, regardless of its ?v= string.
// Clients without a service worker fall back to GitHub Pages' short max-age.
// The `?v=` and `<!-- qg-build: -->` values in HTML are now frozen legacy —
// read the live build from qg-build-id.json or the active CACHE_NAME instead.

// Machine-readable stamp for debugging / future tooling
writeUtf8NoBom(
  path.join(root, 'qg-build-id.json'),
  JSON.stringify({ buildId: id, stampedAt: new Date().toISOString() }, null, 2) + '\n'
);
changed.push('qg-build-id.json');

console.log('Stamped BUILD_ID=' + id);
console.log('Updated: ' + changed.join(', '));
