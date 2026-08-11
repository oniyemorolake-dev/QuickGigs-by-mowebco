var fs = require('fs');
var path = require('path');
var dir = path.join(__dirname, '..', 'supabase', 'functions');
var count = 0;

function walk(d) {
  fs.readdirSync(d).forEach(function (n) {
    var p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) return walk(p);
    if (!/\.(ts|js)$/.test(n)) return;
    var t = fs.readFileSync(p, 'utf8');
    var u = t
      .split("Content-Type': 'application/json'")
      .join("Content-Type': 'application/json; charset=utf-8'")
      .split('Content-Type": "application/json"')
      .join('Content-Type": "application/json; charset=utf-8"');
    // Avoid double-adding charset
    u = u
      .split("application/json; charset=utf-8; charset=utf-8")
      .join('application/json; charset=utf-8');
    if (u !== t) {
      fs.writeFileSync(p, u);
      count++;
      console.log(path.relative(path.join(__dirname, '..'), p));
    }
  });
}

walk(dir);
console.log('Updated', count, 'files');
