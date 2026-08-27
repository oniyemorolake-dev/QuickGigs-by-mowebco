(function () {
  'use strict';

  function ageFromDob(raw, now) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw || '').trim());
    if (!match) return null;
    now = now || new Date();
    var dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(now);
    function part(type) {
      var matchPart = dateParts.find(function(item){ return item.type === type; });
      return Number(matchPart && matchPart.value || 0);
    }
    var currentYear = part('year');
    var currentMonth = part('month');
    var currentDay = part('day');
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    var age = currentYear - year;
    if (currentMonth < month ||
        (currentMonth === month && currentDay < day)) age -= 1;
    return age >= 0 ? age : null;
  }

  function isTeenDob(dob) {
    var age = ageFromDob(dob);
    return age != null && age >= 16 && age < 18;
  }

  function setTier(user) {
    var age = ageFromDob(user && user.date_of_birth);
    var tier = age != null && age >= 16 && age < 18 ? 'teen' : 'adult';
    window._qgAgeTier = tier;
    window._qgAgeProfile = user || null;
    document.documentElement.setAttribute('data-qg-age-tier', tier);
    document.body && document.body.setAttribute('data-qg-age-tier', tier);
    window.dispatchEvent(new CustomEvent('qg-age-tier-ready', {
      detail: { tier: tier, age: age, user: user || null }
    }));
    return { tier: tier, age: age, user: user || null };
  }

  async function loadAgeTier(firebaseUid) {
    if (!firebaseUid || typeof getUserLoginGate !== 'function') return setTier(null);
    try {
      return setTier(await getUserLoginGate(firebaseUid));
    } catch (err) {
      return setTier(null);
    }
  }

  function taskAllowsTeen(task) {
    var pref = String(
      (task && (task.agePreference || task.age_preference || task.AGE_PREFERENCE)) ||
      'adults_only'
    ).toLowerCase();
    return pref !== 'adults_only';
  }

  window.QG_ageFromDob = ageFromDob;
  window.QG_isTeenDob = isTeenDob;
  window.QG_loadAgeTier = loadAgeTier;
  window.QG_setAgeTierFromUser = setTier;
  window.QG_taskAllowsTeen = taskAllowsTeen;
})();
