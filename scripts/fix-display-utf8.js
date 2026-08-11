/**
 * Surgical display cleanup: replace U+FFFD (corrupted —/·) and broken "?" title separators.
 * Does not touch layout/CSS. Run: node scripts/fix-display-utf8.js
 */
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');

var FILES = [
  'mytasks.html', 'dashboard.html', 'browsetask.html', 'posttask.html',
  'profile.html', 'messages.html', 'chat.html', 'modeselector.html',
  'login.html', 'signup.html', 'faq.html', 'index.html',
  'qg-payments-ui.js', 'qg-utils.js', 'supabase-db.js'
];

function fix(text) {
  var out = text;
  // Replacement char from mangled em-dash / middle-dot / en-dash
  out = out.split('\uFFFD').join('\u00B7'); // ·
  // Title / og separators that became "?"
  out = out.replace(/(\w)\s*\?\s*QuickGigs/g, '$1 \u00B7 QuickGigs');
  // Broken CTA arrows that became "?" at end of browse links (keep intentional ?)
  out = out.replace(/Browse categories \?/g, 'Browse categories');
  out = out.replace(/Browse open tasks \?/g, 'Browse open tasks');
  out = out.replace(/Browse tasks \?/g, 'Browse tasks');
  out = out.replace(/Post a task \?/g, 'Post a task');
  out = out.replace(/Post another task \?/g, 'Post another task');
  // Empty-state copy with stray "?" mid-sentence (ellipsis / em-dash was mangled)
  out = out.replace(/Loading your tasks\?/g, 'Loading your tasks\u2026');
  out = out.replace(/try clearing location, date, or search/g, 'try clearing location, date, or search');
  out = out.replace(/No tasks match your filters \?/g, 'No tasks match your filters \u2014');
  out = out.replace(/No saved tasks yet \?/g, 'No saved tasks yet \u2014');
  out = out.replace(/No open tasks yet \?/g, 'No open tasks yet \u2014');
  out = out.replace(/tap \? Save/g, 'tap Save');
  out = out.replace(/metaBits\.join\(' \? '\)/g, "metaBits.join(' \\u00B7 ')");
  out = out.replace(/metaBits\.join\(' · '\)/g, "metaBits.join('\\u00B7')"); // normalize later in file-specific
  return out;
}

var report = [];
FILES.forEach(function (rel) {
  var fp = path.join(root, rel);
  if (!fs.existsSync(fp)) return;
  var before = fs.readFileSync(fp, 'utf8');
  var after = fix(before);
  // Prefer readable · in join strings
  after = after.replace(/metaBits\.join\('\\u00B7'\)/g, "metaBits.join(' · ')");
  after = after.replace(/metaBits\.join\(' \\u00B7 '\)/g, "metaBits.join(' · ')");
  if (after !== before) {
    fs.writeFileSync(fp, after, 'utf8');
    var n = 0;
    for (var i = 0; i < before.length; i++) if (before.charCodeAt(i) === 0xfffd) n++;
    report.push(rel + ' (had ' + n + ' U+FFFD)');
  }
});
console.log(report.length ? report.join('\n') : 'No changes');
