/* SwiftGigs — signup wizard: pronouns, gender, DOB picker, guardian (Option B) */
(function () {
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  function daysInMonth(month, year) {
    return new Date(year, month, 0).getDate();
  }

  function calcAge(y, m, d) {
    var year = Number(y);
    var month = Number(m);
    var day = Number(d);
    if (!isFinite(year) || !isFinite(month) || !isFinite(day)) return -1;
    var today = new Date();
    var birth = new Date(year, month - 1, day);
    if (isNaN(birth.getTime())) return -1;
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
    if (!container) return;
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
    // Youngest selectable year is 16 years ago. Listing ages 10–15 made the
    // wheel bounce to “under 16” on phones even when the highlight showed 19.
    var endYear = now.getFullYear() - 16;
    var cols = {};

    state.dobMonth = state.dobMonth || 1;
    state.dobDay = state.dobDay || 1;
    state.dobYear = state.dobYear || (now.getFullYear() - 20);
    if (state.dobYear > endYear) state.dobYear = endYear;
    if (state.dobYear < startYear) state.dobYear = startYear;

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

    function indexForValue(items, val) {
      var n = Number(val);
      for (var i = 0; i < items.length; i++) {
        if (items[i].value === val || items[i].value === n) return i;
      }
      return 0;
    }

    function renderCol(type, items) {
      var col = document.createElement('div');
      col.className = 'qg-dob-col';
      col.setAttribute('data-dob-col', type);
      items.forEach(function (item, idx) {
        var el = document.createElement('div');
        el.className = 'qg-dob-item';
        el.textContent = item.label;
        el.setAttribute('data-value', String(item.value));
        el.addEventListener('click', function () {
          applyValue(type, item.value);
          highlightCols();
          if (onChange) onChange();
          scrollColTo(type, idx, true);
          clearTimeout(col._snapT);
          col._snapT = setTimeout(function () { finishSnap(type, true); }, 180);
        });
        col.appendChild(el);
      });
      col.addEventListener('scroll', function () {
        highlightCols();
        clearTimeout(col._snapT);
        col._snapT = setTimeout(function () { finishSnap(type); }, 150);
      }, { passive: true });
      return col;
    }

    function pickerIsLaidOut() {
      var col = cols.year || cols.month;
      return !!(col && col.clientHeight > 8);
    }

    function applyValue(type, value) {
      var n = Number(value);
      if (!isFinite(n)) return;
      if (type === 'month') state.dobMonth = n;
      else if (type === 'day') state.dobDay = n;
      else if (type === 'year') state.dobYear = n;
    }

    function colIndex(type) {
      var col = cols[type];
      if (!col) return 0;
      var items = col.querySelectorAll('.qg-dob-item');
      if (!items.length) return 0;
      if (!pickerIsLaidOut()) {
        var want = type === 'month' ? state.dobMonth : type === 'day' ? state.dobDay : state.dobYear;
        return indexForValue(
          type === 'month' ? monthItems() : type === 'day' ? dayItems() : yearItems(),
          want
        );
      }
      var mid = col.getBoundingClientRect().top + col.clientHeight / 2;
      var best = 0;
      var bestDist = Infinity;
      for (var i = 0; i < items.length; i++) {
        var r = items[i].getBoundingClientRect();
        var dist = Math.abs((r.top + r.height / 2) - mid);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }
      return best;
    }

    function scrollColTo(type, index, smooth) {
      var col = cols[type];
      if (!col) return;
      var items = col.querySelectorAll('.qg-dob-item');
      var el = items[index];
      if (!el) return;
      var top = el.offsetTop - (col.clientHeight / 2) + (el.offsetHeight / 2);
      if (smooth && col.scrollTo) col.scrollTo({ top: top, behavior: 'smooth' });
      else col.scrollTop = top;
    }

    function highlightCols() {
      ['month', 'day', 'year'].forEach(function (type) {
        var col = cols[type];
        if (!col) return;
        var want = type === 'month' ? state.dobMonth : type === 'day' ? state.dobDay : state.dobYear;
        col.querySelectorAll('.qg-dob-item').forEach(function (el) {
          el.classList.toggle('selected', Number(el.getAttribute('data-value')) === Number(want));
        });
      });
    }

    function readStateFromCols() {
      if (!pickerIsLaidOut()) return;
      var mItems = monthItems();
      var yItems = yearItems();
      var mi = Math.min(colIndex('month'), mItems.length - 1);
      var yi = Math.min(colIndex('year'), yItems.length - 1);
      state.dobMonth = mItems[mi].value;
      state.dobYear = yItems[yi].value;
      var dItems = dayItems();
      var di = Math.min(colIndex('day'), dItems.length - 1);
      state.dobDay = dItems[di].value;
    }

    function rebuildDayCol() {
      var items = dayItems();
      var idx = indexForValue(items, state.dobDay);
      var newCol = renderCol('day', items);
      if (cols.day) cols.day.replaceWith(newCol);
      cols.day = newCol;
      scrollColTo('day', idx, false);
    }

    function finishSnap(type, keepState) {
      if (!pickerIsLaidOut()) {
        highlightCols();
        if (onChange) onChange();
        return;
      }
      if (!keepState) {
        scrollColTo(type, colIndex(type), false);
        var prevM = state.dobMonth;
        var prevY = state.dobYear;
        readStateFromCols();
        if (type === 'month' || type === 'year' || prevM !== state.dobMonth || prevY !== state.dobYear) {
          rebuildDayCol();
          readStateFromCols();
        }
      } else if (type === 'month' || type === 'year') {
        rebuildDayCol();
      }
      highlightCols();
      if (onChange) onChange();
    }

    function mountCols() {
      mount.innerHTML = '';
      cols.month = renderCol('month', monthItems());
      cols.day = renderCol('day', dayItems());
      cols.year = renderCol('year', yearItems());
      mount.appendChild(cols.month);
      mount.appendChild(cols.day);
      mount.appendChild(cols.year);
    }

    function syncToState() {
      scrollColTo('month', indexForValue(monthItems(), state.dobMonth), false);
      scrollColTo('year', indexForValue(yearItems(), state.dobYear), false);
      rebuildDayCol();
      readStateFromCols();
      highlightCols();
      if (onChange) onChange();
    }

    mountCols();
    requestAnimationFrame(function () {
      requestAnimationFrame(syncToState);
    });

    return {
      sync: function () {
        if (pickerIsLaidOut()) readStateFromCols();
        highlightCols();
        if (onChange) onChange();
      },
      refresh: syncToState
    };
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
      var dobApi = null;

      state.pronouns = state.pronouns || '';
      state.gender = state.gender || '';
      state.guardianName = state.guardianName || '';
      state.guardianEmail = state.guardianEmail || '';
      state.guardianPhone = state.guardianPhone || '';

      function el(id) { return root.querySelector('#' + id); }

      function showStep(idx) {
        steps.forEach(function (s, i) {
          s.classList.toggle('active', i === idx);
        });
        root.querySelectorAll('.qg-wizard-dot').forEach(function (dot, i) {
          dot.classList.toggle('active', i === idx);
          dot.classList.toggle('done', i < idx);
        });
        current = idx;
        if (steps[idx] && steps[idx].getAttribute('data-step') === 'dob') {
          if (dobApi && dobApi.refresh) setTimeout(function () { dobApi.refresh(); }, 50);
        }
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
        if (!stepEl) return true;
        var type = stepEl.getAttribute('data-step');

        if (type === 'account' || type === 'security') {
          return true;
        }
        // Pronouns are optional — allow skip / empty / free-text via chips.
        if (type === 'pronouns') {
          return true;
        }
        if (type === 'gender' && !resolveChipValue(state, 'gender')) {
          qgNotify('Please choose a gender option or select "Prefer not to say".', '#f59e0b');
          return false;
        }
        if (type === 'dob') {
          if (dobApi && dobApi.sync) dobApi.sync();
          var age = getAgeFromState(state);
          if (age < 16) {
            qgNotify('That birthday makes you ' + age + '. Scroll the year until it says 16 or older — 19 years old is around ' + (new Date().getFullYear() - 19) + '.', '#f59e0b');
            return false;
          }
          state.dateOfBirthIso = getDobIso(state);
        }
        if (type === 'guardian') {
          if (gName) state.guardianName = gName.value.trim();
          if (gEmail) state.guardianEmail = gEmail.value.trim();
          if (gPhone) state.guardianPhone = gPhone.value.trim();
          if (!state.guardianName || state.guardianName.length < 2) {
            qgNotify('Please enter your parent or guardian\'s full name.', '#f59e0b');
            return false;
          }
          if (!state.guardianEmail || state.guardianEmail.indexOf('@') < 1) {
            qgNotify('Please enter a valid parent/guardian email.', '#f59e0b');
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

        if (dateVal) dateVal.textContent = formatDobLong(state);
        if (ageNum) ageNum.innerHTML = age + ' <span>years old</span>';
        if (age >= 16) state.dateOfBirthIso = getDobIso(state);

        if (summary) {
          summary.style.display = 'block';
          summary.className = 'qg-dob-summary' + (age < 16 ? ' blocked' : age < 18 ? ' minor' : ' ok');
        }
        if (status) {
          if (age < 16) {
            status.innerHTML = '<strong>Not eligible yet.</strong> SwiftGigs requires you to be at least <strong>16 years old</strong>.';
          } else if (age < 18) {
            status.innerHTML = 'You\'re <strong>' + age + '</strong> — a parent or guardian must approve before you can post or apply.';
          } else {
            status.innerHTML = 'You\'re <strong>' + age + '</strong> — you meet the age requirement for SwiftGigs.';
          }
        }
        var guardianStep = root.querySelector('[data-step="guardian"]');
        if (guardianStep) guardianStep.setAttribute('data-skip', age >= 16 && age < 18 ? '0' : '1');
        document.dispatchEvent(new CustomEvent('qg-signup-age-changed', {
          detail: { age: age, isTeen: age >= 16 && age < 18 }
        }));
      }

      root.querySelectorAll('[data-qg-next]').forEach(function (btn) {
        var step = btn.closest('.qg-wizard-step');
        if (step && (step.getAttribute('data-step') === 'account' || step.getAttribute('data-step') === 'security')) return;
        btn.onclick = next;
      });
      root.querySelectorAll('[data-qg-back]').forEach(function (btn) { btn.onclick = back; });

      steps = Array.prototype.slice.call(root.querySelectorAll('.qg-wizard-step'));
      var dobMount = root.querySelector('#qgDobPicker');
      if (dobMount) dobApi = buildDobPicker(dobMount, state, updateAgeBadge);

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
          if (dobApi && dobApi.sync) dobApi.sync();
          if (gName) state.guardianName = gName.value.trim();
          if (gEmail) state.guardianEmail = gEmail.value.trim();
          if (gPhone) state.guardianPhone = gPhone.value.trim();
          var dobIso = state.dateOfBirthIso || getDobIso(state);
          var parts = String(dobIso).split('-');
          var age = calcAge(parts[0], parts[1], parts[2]);
          var isMinor = age >= 16 && age < 18;
          var now = new Date().toISOString();
          var payload = {
            pronouns: resolveChipValue(state, 'pronouns'),
            gender: resolveChipValue(state, 'gender') || 'prefer not to say',
            date_of_birth: dobIso,
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
