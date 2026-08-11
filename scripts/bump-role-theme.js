var fs = require('fs');
fs.readdirSync('.').filter(function (f) { return f.endsWith('.html'); }).forEach(function (f) {
  var t = fs.readFileSync(f, 'utf8');
  var u = t.replace(/qg-role-theme\.css\?v=[^"]+/g, 'qg-role-theme.css?v=20260811tokens1');
  if (u !== t) {
    fs.writeFileSync(f, u);
    console.log('bumped', f);
  }
});
