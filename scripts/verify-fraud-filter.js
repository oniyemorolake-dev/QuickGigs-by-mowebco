/**
 * Verify sliding-window contact/fraud filter (qg-utils.js).
 * Run: node scripts/verify-fraud-filter.js
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var src = fs.readFileSync(path.join(__dirname, '..', 'qg-utils.js'), 'utf8');
var start = src.indexOf('// ── Off-platform contact blocking');
var end = src.indexOf('var AVATAR_GRADIENTS');
if (start < 0 || end < 0) {
  console.error('Could not locate fraud filter block in qg-utils.js');
  process.exit(1);
}

var sandbox = {
  window: { QG_CONFIG: {} },
  console: console,
  Date: Date,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout
};
vm.createContext(sandbox);
vm.runInContext(src.slice(start, end), sandbox);

var analyze = sandbox.window.analyzeOffPlatformContact;
var record = sandbox.window.recordFraudBufferMessage;
var clear = sandbox.window.clearBuffer;

var CONV = 'test-conv';
var USER = 'test-user';
var results = [];

function assert(name, cond, detail) {
  results.push({ name: name, pass: !!cond, detail: detail || '' });
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? ' (' + detail + ')' : ''));
}

clear(CONV, USER);

// Test 1: split phone 587 / 990 / 8645
var t1a = analyze('587', [], { convId: CONV, senderId: USER });
record(CONV, USER, '587');
var t1b = analyze('990', [], { convId: CONV, senderId: USER });
record(CONV, USER, '990');
var t1c = analyze('8645', [], { convId: CONV, senderId: USER });
var t1ok = !t1a.blocked && t1a.softWarn && !t1b.blocked && t1b.softWarn && t1c.blocked;
assert(
  'Test 1: split phone trips on third message',
  t1ok,
  '1=' + JSON.stringify({ blocked: t1a.blocked, soft: t1a.softWarn }) +
    ' 2=' + JSON.stringify({ blocked: t1b.blocked, soft: t1b.softWarn }) +
    ' 3=' + JSON.stringify({ blocked: t1c.blocked, reason: t1c.reason })
);
if (t1c.blocked === false) console.log('  LEAKED: 8645 was allowed');

clear(CONV, USER);

// Test 2: social handle
var t2 = analyze('insta tgm.rlk', [], { convId: CONV, senderId: USER });
assert('Test 2: insta tgm.rlk blocked', t2.blocked === true, 'reason=' + t2.reason);
if (!t2.blocked) console.log('  LEAKED: insta tgm.rlk');

clear(CONV, USER);

// Test 3: spoken email
var t3 = analyze('my email is jane at gmail dot com', [], { convId: CONV, senderId: USER });
assert('Test 3: spoken email blocked', t3.blocked === true, 'reason=' + t3.reason);
if (!t3.blocked) console.log('  LEAKED: jane at gmail dot com');

clear(CONV, USER);

// Test 4: normal message
var t4 = analyze('$50 for 2 hours of moving', [], { convId: CONV, senderId: USER });
assert(
  'Test 4: normal moving quote not blocked',
  t4.blocked === false && !t4.softWarn,
  'blocked=' + t4.blocked + ' softWarn=' + !!t4.softWarn + ' reason=' + (t4.reason || '')
);

clear(CONV, USER);

// Test 5: apply-style prose must not trip digit/"at" false positives
var applyMsgs = [
  'I have done yard work for 5 years and can start March 15 2026 at your place.',
  'Happy to help! Available weekdays after 5pm. Done 20+ similar jobs since 2019.',
  'Experienced cleaner available this weekend for your listing.'
];
applyMsgs.forEach(function (msg, i) {
  var r = analyze(msg, [], { convId: CONV, senderId: USER });
  assert(
    'Test 5.' + (i + 1) + ': apply prose not blocked',
    r.blocked === false,
    'reason=' + (r.reason || '') + ' msg=' + msg.slice(0, 40)
  );
});

clear(CONV, USER);

// Test 6: real phone still blocked
var t6 = analyze('Call me at 403-555-1212 please', [], { convId: CONV, senderId: USER });
assert('Test 6: real phone blocked', t6.blocked === true, 'reason=' + t6.reason);

var failed = results.filter(function (r) { return !r.pass; });
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
process.exit(failed.length ? 1 : 0);
