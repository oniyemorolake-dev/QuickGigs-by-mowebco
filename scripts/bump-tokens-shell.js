var fs = require('fs');
fs.readdirSync('.').filter(function (f) { return f.endsWith('.html'); }).forEach(function (f) {
  var t = fs.readFileSync(f, 'utf8');
  var u = t
    .replace(/qg-tokens\.css\?v=[^"]+/g, 'qg-tokens.css?v=20260811shell1');
  if (u !== t) {
    fs.writeFileSync(f, u);
    console.log('bumped tokens', f);
  }
});
