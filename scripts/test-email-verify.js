/**
 * Email confirmation: send via window._auth (not window.auth), show Confirm email UI.
 *
 *   node scripts/test-email-verify.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.SG_BASE || 'http://localhost:8099';

(async () => {
  const signupSrc = fs.readFileSync(path.join(ROOT, 'signup.html'), 'utf8');
  const signupSends = /sendSignupEmailConfirmation\(userCredential\.user/.test(signupSrc)
    && /id="signupEmailConfirm"/.test(signupSrc)
    && /Confirm your email/.test(signupSrc);
  const dashSrc = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
  const dashLoads = /qg-verification\.js/.test(dashSrc)
    && /QG_paintEmailVerifyStrip/.test(dashSrc)
    && /id="sgVerifyLink">Confirm email/.test(dashSrc);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(BASE + '/qg-verification.js', { waitUntil: 'domcontentloaded' });
  await page.setContent(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
  <div class="sg-beta" id="sgVerifyStrip" hidden>
    <span class="sg-beta-text">Confirm your email — check your inbox for the link</span>
    <a href="#" id="sgVerifyLink">Confirm email</a>
  </div>
  <script src="${BASE}/qg-verification.js"></script>
</body></html>`, { waitUntil: 'load' });

  await page.waitForFunction(() => typeof window.QG_sendEmailVerification === 'function');

  const result = await page.evaluate(async () => {
    var sentCalls = [];
    var user = {
      uid: 'test-uid',
      email: 'verify@example.com',
      emailVerified: false,
      reload: async function () {},
      sendEmailVerification: async function (settings) { sentCalls.push(settings || {}); }
    };
    window.auth = undefined;
    window._auth = { currentUser: user };

    var sendRes = await window.QG_sendEmailVerification();
    window.QG_paintEmailVerifyStrip(user);
    var strip = document.getElementById('sgVerifyStrip');
    document.getElementById('sgVerifyLink').click();
    var overlay = document.getElementById('qgVerificationOverlay');
    var title = overlay && overlay.querySelector('#qgVerifyEmailTitle');
    var body = overlay ? overlay.textContent : '';
    return {
      sent: sendRes && sendRes.sent === true,
      sendOk: sendRes && sendRes.ok === true,
      callCount: sentCalls.length,
      continueUrl: sentCalls[0] && sentCalls[0].url,
      stripVisible: strip && strip.hidden === false,
      overlayTitle: title ? title.textContent : '',
      bodyHasConfirmEmail: /confirm your email/i.test(body),
      bodyHasInbox: /verify@example\.com/.test(body)
    };
  });

  console.log(JSON.stringify({ signupSends, dashLoads, result }, null, 2));
  const ok = signupSends && dashLoads
    && result.sent && result.sendOk && result.callCount >= 1
    && result.stripVisible
    && /confirm your email/i.test(result.overlayTitle)
    && result.bodyHasConfirmEmail && result.bodyHasInbox;
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
