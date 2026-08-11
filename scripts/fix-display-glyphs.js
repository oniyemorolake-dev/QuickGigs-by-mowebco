/**
 * Surgical glyph/display cleanup. Run: node scripts/fix-display-glyphs.js
 */
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');

function apply(rel, pairs) {
  var fp = path.join(root, rel);
  if (!fs.existsSync(fp)) return { file: rel, hits: 0, missed: [] };
  var before = fs.readFileSync(fp, 'utf8');
  var after = before;
  var hits = 0;
  var missed = [];
  pairs.forEach(function (pair) {
    if (after.indexOf(pair[0]) >= 0) {
      after = after.split(pair[0]).join(pair[1]);
      hits++;
    } else {
      missed.push(pair[0].slice(0, 60));
    }
  });
  if (after !== before) fs.writeFileSync(fp, after, 'utf8');
  return { file: rel, hits: hits, missed: missed };
}

var ico12 = function (name) {
  return "'+(typeof qgIcon==='function'?qgIcon('" + name + "',{size:12}):'')+'";
};

var results = [];

results.push(apply('mytasks.html', [
  ["replace('? Share', 'Share your task')", "replace(/[↗?]\\s*Share/, 'Share your task')"],
  ['<span class="tc-badge badge-open">? Open</span>', '<span class="tc-badge badge-open">Open</span>'],
  ['>? Cancel posting</button>', '>Cancel posting</button>'],
  ['>? Same account as tasker ? cancel &amp; use 2 logins</span>', '>Same account as tasker — cancel &amp; use 2 logins</span>'],
  ['>? Sync payment</button>', '>' + ico12('refresh') + ' Sync payment</button>'],
  ['>? Mark complete</button>', '>' + ico12('check') + ' Mark complete</button>'],
  ['>? Cancel task</button>', '>Cancel task</button>'],
  ["btn.textContent = '? Mark complete';", "btn.innerHTML = (typeof qgIcon==='function'?qgIcon('check',{size:12}):'')+' Mark complete';"],
  ['<span class="tc-badge badge-open" style="opacity:0.75">? Expired</span>', '<span class="tc-badge badge-open" style="opacity:0.75">Expired</span>'],
  ['<span class="tc-badge badge-open" style="opacity:0.75">? Cancelled</span>', '<span class="tc-badge badge-open" style="opacity:0.75">Cancelled</span>'],
  ['<span class="tc-badge badge-done">? Done</span>', '<span class="tc-badge badge-done">' + ico12('check') + ' Done</span>'],
  ['>? Repost task</button>', '>Repost task</button>'],
  ['>? Post again</button>', '>Post again</button>'],
  ["message: '?' + title + '? will be posted again", "message: '\\u201c' + title + '\\u201d will be posted again"],
  ["message: '?' + title + '? will be removed from browse", "message: '\\u201c' + title + '\\u201d will be removed from browse"],
  ["message: '?' + title + '? will go back to Open", "message: '\\u201c' + title + '\\u201d will go back to Open"],
  ["message: '?' + title + '? will be marked cancelled", "message: '\\u201c' + title + '\\u201d will be marked cancelled"],
  ["return esc(name || 'User');", "return esc(name || 'a QuickGigs member');"],
  ["'Worker accepted ? Tap to view'", "'Worker accepted — Tap to view'"],
  ["(frozen?'Disputed ? frozen':'In progress')", "(frozen?'Disputed — frozen':'In progress')"],
  ["showToast('Mark complete not ready ? hard refresh'", "showToast('Mark complete not ready — hard refresh'"],
  ["showToast('Showing saved tasks ? reconnect", "showToast('Showing saved tasks — reconnect"],
  ["'Counter sent ? waiting for tasker'", "'Counter sent — waiting for tasker'"],
  ["pay to unlock chat ? then coordinate", "pay to unlock chat — then coordinate"],
]));

results.push(apply('dashboard.html', [
  ["strong.textContent = '? Waiting for parent approval';", "strong.textContent = 'Waiting for parent approval';"],
  ["resend.textContent = result.success ? 'Email sent ?' : 'Could not send ? try again';", "resend.textContent = result.success ? 'Email sent' : 'Could not send — try again';"],
  ["' ? ' + rep.reviewCount + ' review'", "' · ' + rep.reviewCount + ' review'"],
  ['No tasks nearby yet ? post one', 'No tasks nearby yet — post one'],
  ["'Someone nearby can help ? post it.'", "'Someone nearby can help — post it.'"],
  ["'Errands, repairs, tutoring ? all covered.'", "'Errands, repairs, tutoring — all covered.'"],
  ['public launch ? beta uses', 'public launch — beta uses'],
  ['share an idea ? we read every message', 'share an idea — we read every message'],
]));

results.push(apply('browsetask.html', [
  ["(avail ? ' ? Available: ' + avail : '')", "(avail ? ' · Available: ' + avail : '')"],
  [" + ' ? My offer: $' + priceNum", " + ' · My offer: $' + priceNum"],
  ["posterName:posterName||'QuickGigs user'", "posterName:posterName||'a QuickGigs member'"],
  ["t.posterName === 'QuickGigs user'", "(t.posterName === 'a QuickGigs member' || t.posterName === 'QuickGigs user')"],
  ["'Still loading ? wait a second and try again.'", "'Still loading — wait a second and try again.'"],
  ['apply ? posters need', 'apply — posters need'],
  ['Fixed budget ? your offer matches', 'Fixed budget — your offer matches'],
  ["' Application saved ? chat stays locked until payment.'", "' Application saved — chat stays locked until payment.'"],
  ["' Application saved ? chat opens after acceptance and payment.'", "' Application saved — chat opens after acceptance and payment.'"],
]));

results.push(apply('posttask.html', [
  ['<a class="back-btn" href="dashboard.html">? Dashboard</a>',
   '<a class="back-btn" href="dashboard.html"><span data-qg-ico="arrowRight" data-qg-ico-size="14" style="display:inline-flex;transform:scaleX(-1)"></span> Dashboard</a>'],
]));

results.push(apply('qg-payments-ui.js', [
  ["map[String(id)] = t.title || t.TITLE || ('Task #' + id);",
   "map[String(id)] = (typeof formatTaskDisplayTitle === 'function' ? formatTaskDisplayTitle(t, id) : (t.title || t.TITLE || 'Untitled task'));"],
  ["var title = taskMap[String(tid)] || ('Task #' + tid);",
   "var title = taskMap[String(tid)] || (typeof formatTaskDisplayTitle === 'function' ? formatTaskDisplayTitle(null, tid) : 'Untitled task');"],
]));

results.push(apply('profile.html', [
  ["var taskTitle = r.task_title || r.TASK_TITLE || ('Task #' + (r.task_id || ''));",
   "var taskTitle = r.task_title || r.TASK_TITLE || (typeof formatTaskDisplayTitle === 'function' ? formatTaskDisplayTitle({ title: r.task_title, category: r.task_category || r.category, created_at: r.created_at }, r.task_id) : 'Untitled task');"],
  ["reviewerName = 'QuickGigs user';", "reviewerName = 'a QuickGigs member';"],
]));

results.forEach(function (r) {
  console.log(r.file + ': ' + r.hits + ' applied' + (r.missed.length ? ('; missed ' + r.missed.length) : ''));
  r.missed.slice(0, 8).forEach(function (m) { console.log('  miss: ' + m); });
});
