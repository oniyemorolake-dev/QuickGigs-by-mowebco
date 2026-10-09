/**
 * Screenshot the rebuilt Messages inbox beside its template, plus the chat
 * view the design has no screen for.
 *
 *   node scripts/messages-shot.js
 *
 * Firebase and the Supabase reads are stubbed. This proves markup, CSS and the
 * render functions. It does NOT prove the live queries.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TPL = path.join(ROOT, 'Claude outputs', 'sg-design', 'templates');
const OUT = path.join(ROOT, '.verify');
const BASE = process.env.SG_BASE || 'http://localhost:8099';

const FB_APP = 'export function initializeApp(){ return {}; }';
const FB_AUTH = `
export function getAuth(){ return { currentUser: { uid:'me', displayName:'Morolake A', email:'m@example.com' } }; }
export function onAuthStateChanged(a, cb){ setTimeout(function(){ cb(a.currentUser); }, 10); return function(){}; }
`;

function ago(mins) { return new Date(Date.now() - mins * 60000).toISOString(); }

const CONVS = [
  { conv_id: 'c1', task_id: 't1', poster_id: 'u-aisha', worker_id: 'me', poster_name: 'Aisha K.', worker_name: 'Morolake A', task_title: 'Hair Braiding', status: 'in_progress', is_unlocked: true, last_message: 'Sounds great, see you at 4!', last_message_at: ago(2), last_sender_id: 'u-aisha', created_at: ago(400) },
  { conv_id: 'c2', task_id: 't2', poster_id: 'me', worker_id: 'u-dan', poster_name: 'Morolake A', worker_name: 'Daniel M.', task_title: 'Furniture Assembly', status: 'in_progress', is_unlocked: true, last_message: 'Is the desk still available for pickup?', last_message_at: ago(60), last_sender_id: 'u-dan', created_at: ago(500) },
  { conv_id: 'c3', task_id: 't3', poster_id: 'u-sg', worker_id: 'me', poster_name: 'SwiftGigs Support', worker_name: 'Morolake A', task_title: 'Payout', status: 'in_progress', is_unlocked: true, last_message: 'Your payout has been sent.', last_message_at: ago(1500), last_sender_id: 'u-sg', worker_last_read_at: ago(1000), created_at: ago(3000) },
  { conv_id: 'c4', task_id: 't4', poster_id: 'u-priya', worker_id: 'me', poster_name: 'Priya S.', worker_name: 'Morolake A', task_title: 'Grocery Pickup', status: 'in_progress', is_unlocked: true, last_message: 'Thanks for the quick pickup!', last_message_at: ago(4300), last_sender_id: 'u-priya', worker_last_read_at: ago(4000), created_at: ago(6000) }
];

const MSGS = [
  { message_id: 'm1', sender_id: 'u-aisha', body: 'Hi! Are you free around 4pm today for the braids?', created_at: ago(50) },
  { message_id: 'm2', sender_id: 'me', body: 'Yes, 4pm works. Should I bring my own tools?', created_at: ago(44) },
  { message_id: 'm3', sender_id: 'u-aisha', body: 'Please do. I have the extensions ready.', created_at: ago(40) },
  { message_id: 'm4', sender_id: 'u-aisha', body: 'Sounds great, see you at 4!', created_at: ago(2) }
];

function fixtures(convs, msgs) {
  window.getConversationsForUser = function () { return Promise.resolve(convs); };
  window.getConversation = function (id) {
    return Promise.resolve(convs.filter(function (c) { return c.conv_id === id; })[0] || null);
  };
  window.getMessagesForConversation = function () { return Promise.resolve(msgs); };
  window.getUsersAvatarMap = function () { return Promise.resolve({}); };
  window.markConversationRead = function () { return Promise.resolve(); };
  window.syncCurrentUserProfile = function () { return Promise.resolve(); };
  window.enforceBanOnLogin = function () { return Promise.resolve({ ok: true }); };
  window.forceUnlockConversationForTask = function () { return Promise.resolve(); };
  window.enrichConversationNames = function (c) { return Promise.resolve(c); };
  window.parseConversationUnlocked = function () { return true; };
  window.isChatPaymentGated = function () { return false; };
  window.getChatUnlockRule = function () { return 'accept'; };
  window.isChatImageBody = function () { return false; };
}

async function shoot(browser, theme) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1100 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0].slice(0, 120)));

  await page.route('**/firebase-app.js', (r) => r.fulfill({ contentType: 'application/javascript', body: FB_APP }));
  await page.route('**/firebase-auth.js', (r) => r.fulfill({ contentType: 'application/javascript', body: FB_AUTH }));
  await page.route('**/supabase-db.js*', async (r) => {
    const res = await r.fetch();
    const src = '\n;(' + fixtures.toString() + ')(' + JSON.stringify(CONVS) + ',' + JSON.stringify(MSGS) + ');\n';
    r.fulfill({ response: res, body: (await res.text()) + src });
  });
  await page.addInitScript((t) => {
    try { localStorage.setItem('qg-theme', t); localStorage.setItem('qg-mode', 'tasker'); } catch (e) {}
  }, theme);

  await page.goto(BASE + '/messages.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const shots = {};
  shots.inbox = path.join(OUT, `msg-${theme}-inbox.png`);
  await page.screenshot({ path: shots.inbox, fullPage: true, animations: 'disabled' });

  await page.click('#sgThreadList [data-conv]').catch(() => {});
  await page.waitForTimeout(900);
  shots.chat = path.join(OUT, `msg-${theme}-chat.png`);
  await page.screenshot({ path: shots.chat, animations: 'disabled' });

  const rows = await page.$$eval('#sgThreadList .sg-thread', (n) => n.length).catch(() => -1);
  const dots = await page.$$eval('#sgThreadList .dot', (n) => n.length).catch(() => -1);
  const bubbles = await page.$$eval('#sgChatScroll .sg-bubble', (n) => n.length).catch(() => -1);
  const name = await page.textContent('#sgChatName').catch(() => '');
  console.log(`${theme.padEnd(6)} threads=${rows} unread=${dots} bubbles=${bubbles} peer="${(name || '').trim()}"` +
    (errors.length ? `\n       errors: ${[...new Set(errors)].slice(0, 3).join(' | ')}` : ''));
  await ctx.close();
  return shots;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  const ctx0 = await browser.newContext({ viewport: { width: 390, height: 1100 }, deviceScaleFactor: 2 });
  const tplPage = await ctx0.newPage();
  await tplPage.goto('file://' + path.join(TPL, 'messages.html').replace(/\\/g, '/'), { waitUntil: 'domcontentloaded' });
  await tplPage.waitForTimeout(400);
  const tplShot = path.join(OUT, 'tpl-messages.png');
  await tplPage.screenshot({ path: tplShot, fullPage: true, animations: 'disabled' });
  await ctx0.close();

  const light = await shoot(browser, 'light');
  const dark = await shoot(browser, 'dark');

  const ctx = await browser.newContext({ viewport: { width: 1800, height: 1250 } });
  const compose = await ctx.newPage();
  const url = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
  const fig = (cap, file, tone) =>
    `<figure style="margin:0"><figcaption style="padding:5px 2px;color:${tone};font-weight:600">${cap}</figcaption>` +
    `<img src="${url(file)}" style="width:300px;display:block;border:1px solid #444;border-radius:6px"></figure>`;
  await compose.setContent(
    '<body style="margin:0;background:#17171c;font:13px system-ui;color:#fff;display:flex;gap:14px;padding:16px;align-items:flex-start">' +
    fig('TEMPLATE inbox', tplShot, '#8f8') +
    fig('LIGHT inbox', light.inbox, '#9cf') +
    fig('DARK inbox', dark.inbox, '#9cf') +
    fig('LIGHT chat', light.chat, '#fc9') +
    fig('DARK chat', dark.chat, '#fc9') +
    '</body>');
  await compose.waitForTimeout(600);
  const out = path.join(OUT, 'messages-vs-design.png');
  await compose.screenshot({ path: out, fullPage: true });
  console.log('\n' + out);
  await browser.close();
  process.exit(0);
})();
