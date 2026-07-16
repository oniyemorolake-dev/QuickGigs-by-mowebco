/* QuickGigs — signup wizard: pronouns, gender, DOB picker, guardian (Option B) */
(function () {
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  function daysInMonth(month, year) {
    return new Date(year, month, 0).getDate();
  }

  function calcAge(y, m, d) {
    var today = new Date();
    var birth = new Date(y, m - 1, d);
    var age = today.getFullYear() - birth.getFullYear();
    var md = today.getMonth() - birth.getMonth();
    if (md < 0 || (md === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  }

  function genToken() {
    var arr = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(arr);
    else for (var i = 0; i < 16; i++) arr[i] = Math.floor(Math.random() * 256);
    return Array.from(arr).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function bindChips(container, key, state, onChange) {
    container.querySelectorAll('.qg-chip').forEach(function (chip) {
      chip.onclick = function () {
        container.querySelectorAll('.qg-chip').forEach(function (c) { c.classList.remove('selected'); });
        chip.classList.add('selected');
        state[key] = chip.getAttribute('data-value') || chip.textContent.trim();
        var customWrap = container.querySelector('.qg-custom-wrap') ||
          (container.parentElement && container.parentElement.querySelector('.qg-custom-wrap'));
        if (customWrap) customWrap.style.display = state[key] === 'custom' ? 'block' : 'none';
        if (onChange) onChange();
      };
    });
    var customInput = container.querySelector('.qg-custom-input') ||
      (container.parentElement && container.parentElement.querySelector('.qg-custom-input'));
    if (customInput) {
      customInput.oninput = function () {
        if (state[key] === 'custom') state[key + 'Custom'] = customInput.value.trim();
      };
    }
  }

  function buildDobPicker(mount, state, onChange) {
    var now = new Date();
    var startYear = now.getFullYear() - 100;
    var endYear = now.getFullYear() - 10;

    state.dobMonth = state.dobMonth || 1;
    state.dobDay = state.dobDay || 1;
    state.dobYear = state.dobYear || (now.getFullYear() - 20);

    function renderCol(type, items, selected) {
      var col = document.createElement('div');
      col.className = 'qg-dob-col';
      col.setAttribute('data-dob-col', type);
      items.forEach(function (item) {
        var el = document.createElement('div');
        el.className = 'qg-dob-item' + (item.value === selected ? ' selected' : '');
        el.textContent = item.label;
        el.setAttribute('data-value', item.value);
        el.onclick = function () { scrollToItem(col, el); snapCol(col, type); };
        col.appendChild(el);
      });
      col.onscroll = function () { debounceSnap(col, type); };
      return col;
    }

    function monthItems() {
      return MONTHS.map(function (m, i) { return { label: m, value: i + 1 }; });
    }
    function dayItems() {
      var max = daysInMonth(state.dobMonth, state.dobYear);
      if (state.dobDay > max) state.dobDay = max;
      var arr = [];
      for (var d = 1; d <= max; d++) arr.push({ label: String(d), value: d });
      return arr;
    }
    function yearItems() {
      var arr = [];
      for (var y = endYear; y >= startYear; y--) arr.push({ label: String(y), value: y });
      return arr;
    }

    var debounceTimer;
    function debounceSnap(col, type) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () { snapCol(col, type); }, 80);
    }

    function scrollToItem(col, el) {
      col.scrollTop = el.offsetTop - col.clientHeight / 2 + el.clientHeight / 2;
    }

    function snapCol(col, type) {
      var items = col.querySelectorAll('.qg-dob-item');
      if (!items.length) return;
      var mid = col.scrollTop + col.clientHeight / 2;
      var closest = items[0];
      var minDist = Infinity;
      items.forEach(function (item) {
        var dist = Math.abs(item.offsetTop + item.clientHeight / 2 - mid);
        if (dist < minDist) { minDist = dist; closest = item; }
      });
      scrollToItem(col, closest);
      items.forEach(function (i) { i.classList.remove('selected'); });
      closest.classList.add('selected');
      var val = parseInt(closest.getAttribute('data-value'), 10);
      if (type === 'month') state.dobMonth = val;
      if (type === 'day') state.dobDay = val;
      if (type === 'year') state.dobYear = val;
      if (type === 'month' || type === 'year') refreshDays();
      if (onChange) onChange();
    }

    function refreshDays() {
      var dayCol = mount.querySelector('[data-dob-col="day"]');
      if (!dayCol) return;
      var scroll = dayCol.scrollTop;
      var newCol = renderCol('day', dayItems(), state.dobDay);
      dayCol.replaceWith(newCol);
      newCol.scrollTop = scroll;
      setTimeout(function () { snapCol(newCol, 'day'); }, 50);
    }

    mount.innerHTML = '';
    var mCol = renderCol('month', monthItems(), state.dobMonth);
    var dCol = renderCol('day', dayItems(), state.dobDay);
    var yCol = renderCol('year', yearItems(), state.dobYear);
    mount.appendChild(mCol);
    mount.appendChild(dCol);
    mount.appendChild(yCol);

    setTimeout(function () {
      [mCol, dCol, yCol].forEach(function (col) {
        var type = col.getAttribute('data-dob-col');
        var sel = col.querySelector('.selected');
        if (sel) scrollToItem(col, sel);
      });
    }, 60);
  }

  function formatDobLong(state) {
    var m = state.dobMonth || 1;
    var d = state.dobDay || 1;
    return (MONTHS_FULL[m - 1] || MONTHS[m - 1]) + ' ' + d + ', ' + state.dobYear;
  }

  function formatAgeSpecific(age) {
    return age + ' year' + (age === 1 ? '' : 's') + ' old';
  }

  function getDobIso(state) {
    var m = String(state.dobMonth).padStart(2, '0');
    var d = String(state.dobDay).padStart(2, '0');
    return state.dobYear + '-' + m + '-' + d;
  }

  function getAgeFromState(state) {
    return calcAge(state.dobYear, state.dobMonth, state.dobDay);
  }

  function resolveChipValue(state, key) {
    if (state[key] === 'custom') return (state[key + 'Custom'] || '').trim();
    return state[key] || '';
  }

  window.QGSignupWizard = {
    MONTHS: MONTHS,
    calcAge: calcAge,
    genToken: genToken,
    bindChips: bindChips,
    buildDobPicker: buildDobPicker,
    formatDobLong: formatDobLong,
    formatAgeSpecific: formatAgeSpecific,
    getDobIso: getDobIso,
    getAgeFromState: getAgeFromState,
    resolveChipValue: resolveChipValue,

    create: function (opts) {
      var root = opts.root;
      var state = opts.state || {};
      var steps = [];
      var current = 0;

      state.pronouns = state.pronouns || '';
      state.gender = state.gender || '';
      state.guardianName = state.guardianName || '';
      state.guardianEmail = state.guardianEmail || '';
      state.guardianPhone = state.guardianPhone || '';

      function el(id) { return root.querySelector('#' + id); }

      function showStep(idx, dir) {
        steps.forEach(function (s, i) {
          s.classList.toggle('active', i === idx);
        });
        root.querySelectorAll('.qg-wizard-dot').forEach(function (dot, i) {
          dot.classList.toggle('active', i === idx);
          dot.classList.toggle('done', i < idx);
        });
        current = idx;
        if (opts.onStepChange) opts.onStepChange(idx);
      }

      function next() {
        if (!validateStep(current)) return;
        var nextIdx = current + 1;
        if (steps[nextIdx] && steps[nextIdx].getAttribute('data-skip') === '1') nextIdx++;
        if (nextIdx < steps.length) showStep(nextIdx);
        else if (opts.onComplete) opts.onComplete(state);
      }

      function back() {
        var prevIdx = current - 1;
        if (steps[prevIdx] && steps[prevIdx].getAttribute('data-skip') === '1') prevIdx--;
        if (prevIdx >= 0) showStep(prevIdx);
      }

      function validateStep(idx) {
        var stepEl = steps[idx];
        var type = stepEl.getAttribute('data-step');
        if (type === 'pronouns' && !resolveChipValue(state, 'pronouns')) {
          alert('Please choose or enter your pronouns.');
          return false;
        }
        if (type === 'gender') {
          /* optional — prefer not to say is fine */
        }
        if (type === 'dob') {
          var age = getAgeFromState(state);
          if (age < 16) {
            alert('QuickGigs is for ages 16 and up. If you\'re under 16, a parent can create an account for you when you\'re old enough.');
            return false;
          }
        }
        if (type === 'guardian') {
          if (!state.guardianName || state.guardianName.length < 2) {
            alert('Please enter your parent or guardian\'s full name.');
            return false;
          }
          if (!state.guardianEmail || state.guardianEmail.indexOf('@') < 1) {
            alert('Please enter a valid parent/guardian email.');
            return false;
          }
        }
        return true;
      }

      function updateAgeBadge() {
        var age = getAgeFromState(state);
        var summary = el('qgDobSummary');
        var dateVal = el('qgDobDateVal');
        var ageNum = el('qgAgeNumber');
        var status = el('qgAgeStatus');
        var legacyBadge = el('qgAgeBadge');

        if (dateVal) dateVal.textContent = formatDobLong(state);
        if (ageNum) ageNum.innerHTML = age + ' <span>years old</span>';

        if (summary) {
          summary.style.display = 'block';
          summary.className = 'qg-dob-summary' + (age < 16 ? ' blocked' : age < 18 ? ' minor' : ' ok');
        }
        if (status) {
          if (age < 16) {
            status.innerHTML = '<strong>Not eligible yet.</strong> QuickGigs requires you to be at least <strong>16 years old</strong>.';
          } else if (age < 18) {
            status.innerHTML = 'You\'re <strong>' + age + '</strong> — a parent or guardian must approve before you can post or apply.';
          } else {
            status.innerHTML = 'You\'re <strong>' + age + '</strong> — you meet the age requirement for QuickGigs.';
          }
        }
        if (legacyBadge) {
          legacyBadge.style.display = 'block';
          legacyBadge.className = 'qg-age-badge' + (age < 16 ? ' blocked' : age < 18 ? ' minor' : '');
          legacyBadge.textContent = formatAgeSpecific(age) + (age < 16 ? ' — must be 16+' : age < 18 ? ' — parent consent' : ' ✓');
        }
        var guardianStep = root.querySelector('[data-step="guardian"]');
        if (guardianStep) guardianStep.setAttribute('data-skip', age >= 16 && age < 18 ? '0' : '1');
      }

      root.querySelectorAll('[data-qg-next]').forEach(function (btn) { btn.onclick = next; });
      root.querySelectorAll('[data-qg-back]').forEach(function (btn) { btn.onclick = back; });

      steps = Array.prototype.slice.call(root.querySelectorAll('.qg-wizard-step'));
      var dobMount = root.querySelector('#qgDobPicker');
      if (dobMount) buildDobPicker(dobMount, state, updateAgeBadge);

      bindChips(root.querySelector('#qgPronounChips'), 'pronouns', state);
      bindChips(root.querySelector('#qgGenderChips'), 'gender', state);

      var gName = el('guardianName');
      var gEmail = el('guardianEmail');
      var gPhone = el('guardianPhone');
      if (gName) gName.oninput = function () { state.guardianName = gName.value.trim(); };
      if (gEmail) gEmail.oninput = function () { state.guardianEmail = gEmail.value.trim(); };
      if (gPhone) gPhone.oninput = function () { state.guardianPhone = gPhone.value.trim(); };

      updateAgeBadge();
      showStep(0);

      return {
        state: state,
        next: next,
        back: back,
        showStep: showStep,
        getIdentityPayload: function () {
          var age = getAgeFromState(state);
          var isMinor = age >= 16 && age < 18;
          var now = new Date().toISOString();
          var payload = {
            pronouns: resolveChipValue(state, 'pronouns'),
            gender: resolveChipValue(state, 'gender') || 'prefer not to say',
            date_of_birth: getDobIso(state),
            identity_collected_at: now
          };
          if (isMinor) {
            payload.guardian_name = state.guardianName;
            payload.guardian_email = state.guardianEmail;
            payload.guardian_phone = state.guardianPhone || '';
            payload.guardian_consent_status = 'pending';
            payload.guardian_consent_token = genToken();
            payload.account_status = 'pending_guardian';
          } else {
            payload.guardian_consent_status = 'not_required';
            payload.account_status = 'active';
          }
          return payload;
        }
      };
    }
  };
})();
