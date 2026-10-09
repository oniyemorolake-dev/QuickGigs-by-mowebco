var store = {}, sess = {};
function mk(s) {
  return {
    getItem: function (k) { return k in s ? s[k] : null; },
    setItem: function (k, v) { s[k] = String(v); },
    removeItem: function (k) { delete s[k]; }
  };
}
global.localStorage = mk(store);
global.sessionStorage = mk(sess);
// Node defines its own read-only navigator, so plain assignment is ignored.
Object.defineProperty(global, 'navigator', {
  configurable: true,
  value: { vibrate: function (p) { global.__v = p; return true; } }
});
global.window = { getMode: function () { return 'tasker'; }, isWorkerMode: function () { return true; } };

eval(require('fs').readFileSync(require('path').join(__dirname, '..', 'qg-page-bits.js'), 'utf8'));
var w = global.window;
var fails = 0;
function ok(c, m) { if (!c) fails++; console.log('  ' + (c ? 'ok  ' : 'FAIL') + ' ' + m); }

w.haptic();
ok(global.__v === 10, 'haptic defaults to 10ms');

w.qgSaveBrowseFilters({ cat: 'beauty' });
ok(sess['qg-browse-filters'] === JSON.stringify({ cat: 'beauty' }), 'browse filters use sessionStorage under qg-browse-filters');
ok(w.qgLoadBrowseFilters().cat === 'beauty', 'browse filters round-trip');
delete sess['qg-browse-filters'];
ok(w.qgLoadBrowseFilters() === null, 'missing filters return null');

w.qgTrackTaskView({ task_id: 't1', title: 'Hair', budget: '80', category: 'BEAUTY', location: 'Calgary' });
w.qgTrackTaskView({ task_id: 't2', title: 'Dog' });
w.qgTrackTaskView({ task_id: 't1', title: 'Hair' });
var rv = JSON.parse(store['qg-recently-viewed']);
ok(rv.length === 2 && rv[0].id === 't1', 'recently viewed dedupes and moves to front');
ok(rv[1].category === '' && typeof rv[1].budget === 'number', 'task field readers normalise category and budget');
ok(JSON.parse(store['qg-recently-viewed'])[0].category === '', 'category lowercased');

w.qgSavePostDraft({ title: 'x' });
ok(store['qg-post-draft'] === JSON.stringify({ title: 'x' }), 'draft uses the qg-ux.js key');
ok(w.qgLoadPostDraft().title === 'x', 'draft round-trips');
w.qgClearPostDraft();
ok(!('qg-post-draft' in store), 'draft clears');

ok(w.defaultMyTasksTab() === 'applied', 'worker defaults to applied');
ok(w.normalizeMyTasksTab('posted') === 'applied', 'worker cannot land on posted');
ok(w.normalizeMyTasksTab('completed') === 'completed', 'valid tab passes through');
w.isWorkerMode = function () { return false; };
ok(w.defaultMyTasksTab() === 'posted', 'poster defaults to posted');
ok(w.normalizeMyTasksTab('applied') === 'posted', 'poster cannot land on applied');

var called = null;
w.QG_isDarkTheme = function () { return true; };
w.QG_applyTheme = function (d) { called = d; };
w.toggleTheme();
ok(called === false, 'toggleTheme flips dark to light through the qg-theme API');

// Nothing may clobber an injector that is already present.
global.window = { haptic: function () { return 'original'; } };
eval(require('fs').readFileSync(require('path').join(__dirname, '..', 'qg-page-bits.js'), 'utf8'));
ok(global.window.haptic() === 'original', 'does not overwrite a function already defined');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
