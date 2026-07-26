var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var pages = [
  'index.html', 'browsetask.html', 'dashboard.html', 'mytasks.html',
  'login.html', 'review.html', 'feedback.html', 'chat.html', 'profile.html'
];
pages.forEach(function (p) {
  var h = fs.readFileSync(path.join(root, p), 'utf8');
  var title = (h.match(/<title>([^<]*)<\/title>/) || [])[1] || '-';
  var robots = (h.match(/name="robots" content="([^"]+)"/) || [])[1] || '-';
  var canon = (h.match(/rel="canonical" href="([^"]+)"/) || [])[1] || '-';
  var tw = (h.match(/name="twitter:card" content="([^"]+)"/) || [])[1] || '-';
  var ga = /qg-analytics/.test(h);
  var help = /qg-help/.test(h);
  console.log([p, title, robots, canon, tw, 'ga=' + ga, 'help=' + help].join(' | '));
});
