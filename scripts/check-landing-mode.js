import { chromium } from 'playwright';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(() => {
  try { navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { r.unregister(); }); }); } catch (e) {}
});
const page = await context.newPage();
await page.route('**/login.html*', (route) => route.abort());
await page.route('**/signup.html*', (route) => route.abort());

await page.goto('http://localhost:8099/index.html', { waitUntil: 'domcontentloaded' });
const guest = await page.evaluate(() => ({
  poster: (document.getElementById('qgNavPoster') || {}).textContent,
  tasker: (document.getElementById('qgNavTasker') || {}).textContent,
  browse: !!(document.querySelector('.qg-topnav-links a:not(.qg-nav-login)')),
  menu: !!document.getElementById('qgMenuBtn'),
  in: document.body.classList.contains('qg-landing-in')
}));

await page.addInitScript(() => {
  localStorage.setItem('qg-auth-uid', 'test-uid');
  localStorage.setItem('qg-mode', 'tasker');
});
await page.goto('http://localhost:8099/index.html', { waitUntil: 'domcontentloaded' });
const painted = await page.evaluate(() => {
  const p = document.getElementById('qgNavPoster');
  const t = document.getElementById('qgNavTasker');
  if (p) { p.textContent = 'Continue as poster'; p.href = 'dashboard.html?mode=poster'; }
  if (t) { t.textContent = 'Continue as tasker'; t.href = 'dashboard.html?mode=tasker'; }
  const line = document.getElementById('qgHeroLogin');
  if (line && line.firstChild) line.firstChild.textContent = 'You are signed in. ';
  const fn = typeof paintLandingSignedInMode === 'function';
  if (fn) paintLandingSignedInMode();
  return {
    fn,
    after: p && p.textContent,
    href: p && p.getAttribute('href'),
    in: document.body.classList.contains('qg-landing-in')
  };
});
await page.waitForTimeout(80);
const signed = await page.evaluate(() => {
  const poster = document.getElementById('qgNavPoster');
  const tasker = document.getElementById('qgNavTasker');
  const browse = document.querySelector('.qg-topnav-links a:not(.qg-nav-login)');
  const cs = browse ? getComputedStyle(browse).display : 'none';
  return {
    poster: poster && poster.textContent,
    posterHref: poster && poster.getAttribute('href'),
    taskerHidden: !!(tasker && (tasker.hidden || getComputedStyle(tasker).display === 'none')),
    browseHidden: cs === 'none',
    in: document.body.classList.contains('qg-landing-in'),
    hero: (document.getElementById('qgHeroPoster') || {}).textContent,
    earnHidden: !!(document.getElementById('qgEarnTasker') || {}).hidden,
    post: (document.getElementById('qgPostTask') || {}).textContent,
    menu: !!document.getElementById('qgMenuBtn')
  };
});

await page.goto('http://localhost:8099/dashboard.html', { waitUntil: 'domcontentloaded' });
const mode = await page.evaluate(() => {
  if (typeof QG_applyRoleMode === 'function') QG_applyRoleMode();
  const tag = document.querySelector('.sg-mode-tag');
  const access = typeof QG_getRoleAccess === 'function' ? QG_getRoleAccess() : null;
  return {
    htmlMode: document.documentElement.getAttribute('data-qg-mode'),
    tagMode: tag && tag.getAttribute('data-mode'),
    access: access && { tasker: access.is_tasker, poster: access.is_poster, mode: access.last_active_mode },
    hasSignupBounce: /signup\.html\?oauth=continue/.test(document.documentElement.outerHTML)
  };
});

await page.goto('http://localhost:8099/index.html', { waitUntil: 'domcontentloaded' });
await page.addScriptTag({ url: 'http://localhost:8099/qg-mode.js' });
await page.addScriptTag({ url: 'http://localhost:8099/qg-role-access.js' });
const role = await page.evaluate(() => {
  localStorage.setItem('qg-auth-uid', 'test-uid');
  localStorage.setItem('qg-mode', 'tasker');
  if (typeof QG_applyRoleMode === 'function') QG_applyRoleMode();
  const access = typeof QG_getRoleAccess === 'function' ? QG_getRoleAccess() : null;
  return {
    htmlMode: document.documentElement.getAttribute('data-qg-mode'),
    access: access && { tasker: access.is_tasker, poster: access.is_poster, mode: access.last_active_mode, local: !!access._local }
  };
});

const ok = signed.poster === 'Home'
  && signed.taskerHidden
  && signed.browseHidden
  && signed.post === 'Home'
  && !mode.hasSignupBounce
  && role.htmlMode === 'worker'
  && role.access
  && role.access.mode === 'tasker';

console.log(JSON.stringify({ guest, painted, signed, mode, role, ok }, null, 2));
await browser.close();
process.exit(ok ? 0 : 1);
