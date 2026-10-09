/**
 * Signup birthday wheel: 19-year-olds must not be blocked as under 16.
 *
 *   node scripts/test-dob-picker.js
 */
const { chromium } = require('playwright');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.SG_BASE || 'http://localhost:8099';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(BASE + '/qg-onboarding.css', { waitUntil: 'domcontentloaded' });
  await page.setContent(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${BASE}/qg-onboarding.css">
<style>.qg-wizard-step{display:none}.qg-wizard-step.active{display:block}</style>
</head>
<body style="margin:0;padding:24px;background:#120628">
  <div id="standalonePicker" class="qg-dob-picker"></div>
  <div id="signupWizard">
    <div class="qg-wizard-step" data-step="account"></div>
    <div class="qg-wizard-step active" data-step="dob">
      <div id="qgDobSummary"><div id="qgDobDateVal"></div><div id="qgAgeNumber"></div><div id="qgAgeStatus"></div></div>
      <div id="qgDobPicker" class="qg-dob-picker"></div>
      <button type="button" data-qg-next>Continue</button>
    </div>
    <div class="qg-wizard-step" data-step="terms"><button type="button" data-qg-next>Finish</button></div>
  </div>
  <script src="${BASE}/qg-onboarding.js"></script>
</body></html>`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.QGSignupWizard && window.QGSignupWizard.buildDobPicker);

  const result = await page.evaluate(async () => {
    var mount = document.getElementById('standalonePicker');
    var state = {};
    var api = window.QGSignupWizard.buildDobPicker(mount, state, function () {});
    await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
    await new Promise(function (r) { setTimeout(r, 80); });
    var defaultAge = window.QGSignupWizard.getAgeFromState(state);
    var defaultYear = state.dobYear;

    var wantYear = new Date().getFullYear() - 19;
    var yearCol = mount.querySelector('[data-dob-col="year"]');
    var target = yearCol && yearCol.querySelector('[data-value="' + wantYear + '"]');
    if (target) target.click();
    await new Promise(function (r) { setTimeout(r, 280); });
    var afterClickAge = window.QGSignupWizard.getAgeFromState(state);
    var yearAfterClick = state.dobYear;

    mount.style.display = 'none';
    api.sync();
    var afterHiddenYear = state.dobYear;
    var afterHiddenAge = window.QGSignupWizard.getAgeFromState(state);

    var wizard = window.QGSignupWizard.create({ root: document.getElementById('signupWizard') });
    wizard.showStep(1);
    await new Promise(function (r) { setTimeout(r, 80); });
    var live = document.getElementById('qgDobPicker');
    var liveYear = live.querySelector('[data-dob-col="year"] [data-value="' + wantYear + '"]');
    if (liveYear) liveYear.click();
    await new Promise(function (r) { setTimeout(r, 280); });
    document.querySelector('[data-step="dob"] [data-qg-next]').click();
    await new Promise(function (r) { setTimeout(r, 80); });
    var payload = wizard.getIdentityPayload();
    var payloadYear = payload && payload.date_of_birth ? Number(String(payload.date_of_birth).slice(0, 4)) : 0;

    return {
      defaultYear: defaultYear,
      defaultAge: defaultAge,
      wantYear: wantYear,
      yearAfterClick: yearAfterClick,
      ageAfterClick: afterClickAge,
      afterHiddenYear: afterHiddenYear,
      afterHiddenAge: afterHiddenAge,
      payloadDob: payload && payload.date_of_birth,
      payloadYear: payloadYear
    };
  });

  console.log(JSON.stringify(result));
  const ok = result.defaultAge >= 16 &&
    result.yearAfterClick === result.wantYear &&
    result.ageAfterClick >= 18 &&
    result.ageAfterClick <= 19 &&
    result.afterHiddenYear === result.wantYear &&
    result.afterHiddenAge >= 18 &&
    result.payloadYear === result.wantYear;
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
