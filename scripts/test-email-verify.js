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
    && /id="sgVerifyLink">How to confirm/.test(dashSrc);

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
    var again = await window.QG_sendEmailVerification();
    window.QG_paintEmailVerifyStrip(user);
    var strip = document.getElementById('sgVerifyStrip');
    var stripWasVisible = strip && strip.hidden === false;
    document.getElementById('sgVerifyLink').click();
    var overlay = document.getElementById('qgVerificationOverlay');
    var title = overlay && overlay.querySelector('#qgVerifyEmailTitle');
    var body = overlay ? overlay.textContent : '';
    var sendBtn = overlay && overlay.querySelector('#qgVerifyEmailBtn');
    // Code flow: Send code -> enter code -> confirmed (server stubbed).
    var calls = [];
    window.QG_CONFIG = { roleVerificationUrl: 'https://example.invalid/role-verification' };
    window.callVerifiedFunction = async function (_url, body) {
      calls.push(body.action);
      if (body.action === 'send_email_code') return { ok: true, sent: true };
      if (body.action === 'confirm_email_code') {
        return body.code === '123456'
          ? { ok: true, confirmed: true, email_verified: true, tasker_verified: true }
          : { ok: false, error: 'wrong_code', message: 'That code is not right' };
      }
      return { ok: true, email_verified: false };
    };
    user.getIdToken = async function () { return 't'; };
    sendBtn.click();
    await new Promise(function (r) { setTimeout(r, 150); });
    var afterSend = sendBtn.textContent;
    var input = overlay.querySelector('#qgVerifyCodeInput');
    input.value = '000000';
    overlay.querySelector('#qgVerifyCodeBtn').click();
    await new Promise(function (r) { setTimeout(r, 150); });
    var wrongMsg = document.getElementById('qgVerifyEmailStatus').textContent;
    input.value = '123456';
    overlay.querySelector('#qgVerifyCodeBtn').click();
    await new Promise(function (r) { setTimeout(r, 150); });
    var okMsg = document.getElementById('qgVerifyEmailStatus').textContent;
    return {
      sent: sendRes && sendRes.sent === true,
      sendOk: sendRes && sendRes.ok === true,
      secondBlocked: again && again.sent === false,
      callCount: sentCalls.length,
      continueUrl: sentCalls[0] && sentCalls[0].url,
      handleInApp: sentCalls[0] && sentCalls[0].handleCodeInApp === true,
      stripVisible: stripWasVisible,
      overlayTitle: title ? title.textContent : '',
      bodyHasConfirmEmail: /confirm your email/i.test(body),
      bodyHasInbox: /verify@example\.com/.test(body),
      sendLocked: /code sent/i.test(afterSend) && sendBtn.disabled,
      codeCalls: calls.join(','),
      wrongRejected: /not right/i.test(wrongMsg),
      codeConfirmed: /email confirmed/i.test(okMsg) && strip.hidden === true
    };
  });

  console.log(JSON.stringify({ signupSends, dashLoads, result }, null, 2));
  const ok = signupSends && dashLoads
    && result.sent && result.sendOk && result.callCount === 1
    && result.secondBlocked && result.sendLocked
    && result.wrongRejected && result.codeConfirmed
    && result.continueUrl === 'https://quickgigs.ca/dashboard.html'
    && result.handleInApp
    && result.stripVisible
    && /confirm your email/i.test(result.overlayTitle)
    && result.bodyHasConfirmEmail && result.bodyHasInbox;
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
