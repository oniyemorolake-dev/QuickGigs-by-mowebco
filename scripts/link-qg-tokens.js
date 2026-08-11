/**
 * Ensure every root HTML page links qg-tokens.css near end of <head>
 * (after role-theme when present) so token values win the cascade.
 * Run: node scripts/link-qg-tokens.js
 */
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var LINK = '<link rel="stylesheet" href="qg-tokens.css?v=20260811tokens1" id="qg-tokens-css">';
var skip = /^(node_modules|tmp-chrome|google)/;

var files = fs.readdirSync(root).filter(function (f) {
  return f.endsWith('.html') && !skip.test(f);
});

files.forEach(function (name) {
  var fp = path.join(root, name);
  var html = fs.readFileSync(fp, 'utf8');
  // Remove any earlier auto-inserted tokens link (keep one at end of head)
  var cleaned = html.replace(/\s*<link[^>]*qg-tokens\.css[^>]*>\s*/gi, '\n');
  var next;
  if (/qg-role-theme\.css/i.test(cleaned)) {
    next = cleaned.replace(
      /(<link[^>]*qg-role-theme\.css[^>]*>)/i,
      '$1\n' + LINK
    );
  } else if (/<\/head>/i.test(cleaned)) {
    next = cleaned.replace(/<\/head>/i, LINK + '\n</head>');
  } else {
    console.log(name + ': SKIP');
    return;
  }
  if (next !== html) {
    fs.writeFileSync(fp, next, 'utf8');
    console.log(name + ': ok');
  } else {
    console.log(name + ': unchanged');
  }
});
