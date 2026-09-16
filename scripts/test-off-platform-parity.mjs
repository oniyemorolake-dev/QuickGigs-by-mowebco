/**
 * Parity test: the server port in supabase/functions/_shared/off-platform.ts
 * must agree with analyzeOffPlatformContact in qg-utils.js.
 *
 * The client copy is UX only; the server copy enforces. If they disagree, users
 * get told a message is fine and then have it rejected (or worse, the reverse).
 *
 * Run: node scripts/test-off-platform-parity.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── Load the client implementation in a browser-ish sandbox ──────────────────
function loadClient() {
  const src = fs.readFileSync(path.join(root, 'qg-utils.js'), 'utf8');
  const sandbox = {
    window: {},
    document: { addEventListener() {} },
    console,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Date,
    setTimeout,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  try {
    vm.runInContext(src, sandbox);
  } catch (err) {
    console.error('Could not evaluate qg-utils.js:', err.message);
    process.exit(2);
  }
  const fn = sandbox.analyzeOffPlatformContact
    || (sandbox.window && sandbox.window.analyzeOffPlatformContact);
  if (typeof fn !== 'function') {
    console.error('analyzeOffPlatformContact not found on the client sandbox.');
    process.exit(2);
  }
  return fn;
}

const clientAnalyze = loadClient();
// pathToFileURL: on Windows a bare absolute path is rejected by the ESM loader.
const { analyzeOffPlatformContact: serverAnalyze } = await import(
  pathToFileURL(path.join(root, 'supabase/functions/_shared/off-platform.ts')).href
);

// ── Cases: [description, message, recentWindow] ─────────────────────────────
const CASES = [
  ['plain benign message',            'Hi, can you do this tomorrow morning?', []],
  ['benign with price',               'I can do it for $40 if that works',     []],
  ['benign with a year',              'I have done this since 2019 no problem', []],
  ['benign address-ish',              'I can meet you at your place at 3pm',   []],
  ['bare 10-digit phone',             '4035551234',                            []],
  ['dashed phone',                    '403-555-1234',                          []],
  ['bracketed phone',                 '(403) 555-1234',                        []],
  ['spaced phone',                    '403 555 1234',                          []],
  ['plain email',                     'reach me at bob@gmail.com',             []],
  ['spoken email',                    'bob at gmail dot com',                  []],
  ['at-parens obfuscation',           'bob (at) gmail.com',                    []],
  ['instagram handle',                'add me on instagram @bobsmith',         []],
  ['whatsapp mention',                'lets move to whatsapp',                 []],
  ['snapchat mention',                'snap me',                               []],
  ['text me',                         'text me instead',                       []],
  ['etransfer',                       'can you just etransfer me',             []],
  ['spoken digits',                   'four zero three five five five',        []],
  ['url',                             'see https://example.com/x',             []],
  ['www url',                         'go to www.example.com',                 []],
  ['dotted obfuscation',              'find me at tgm.rlk',                    []],
  ['short digit fragment (soft)',     '403',                                   []],
  ['split phone across window',       '1234',   ['403', '555']],
  ['split pattern across window',     'me on',  ['dm']],
  ['benign window then benign',       'sounds good',  ['see you at 5', 'ok']],
  ['O-as-zero obfuscation',           '4o3555l234',                            []],
  ['empty string',                    '',                                      []],
  ['whitespace only',                 '   ',                                   []],
  ['long prose no contact',           'I will bring my own tools and a ladder, should take about two hours total.', []],
];

let pass = 0;
const mismatches = [];

for (const [desc, text, recent] of CASES) {
  // The client reads its sliding window from an in-memory buffer keyed by
  // conv/sender; with no opts it falls back to the recentTexts argument, which
  // is the same input the server gets from the database.
  const c = clientAnalyze(text, recent, {});
  const s = serverAnalyze(text, recent);

  const same = !!c.blocked === !!s.blocked
    && !!c.softWarn === !!s.softWarn
    && (c.reason || null) === (s.reason || null);

  if (same) {
    pass++;
  } else {
    mismatches.push({ desc, text, recent, client: c, server: s });
  }
}

console.log(`\nOff-platform filter parity: ${pass}/${CASES.length} cases agree\n`);

if (mismatches.length) {
  console.log('MISMATCHES:');
  for (const m of mismatches) {
    console.log(`\n  case: ${m.desc}`);
    console.log(`  text: ${JSON.stringify(m.text)}  window: ${JSON.stringify(m.recent)}`);
    console.log(`  client: blocked=${!!m.client.blocked} soft=${!!m.client.softWarn} reason=${m.client.reason || '-'}`);
    console.log(`  server: blocked=${!!m.server.blocked} soft=${!!m.server.softWarn} reason=${m.server.reason || '-'}`);
  }
  console.log('');
  process.exit(1);
}

// Summary of what is actually being blocked, so the test doubles as documentation.
const blocked = CASES.filter(([, t, r]) => serverAnalyze(t, r).blocked).length;
const soft = CASES.filter(([, t, r]) => serverAnalyze(t, r).softWarn).length;
console.log(`Server verdicts: ${blocked} blocked, ${soft} soft-warned, ${CASES.length - blocked - soft} allowed.`);
console.log('Client and server agree on every case.\n');
