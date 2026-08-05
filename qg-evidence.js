/* QuickGigs — task evidence stamps + proof photos */
(function () {
  var STAMPS = [
    { type: 'on_my_way', label: 'On my way' },
    { type: 'arrived', label: 'Arrived' },
    { type: 'started', label: 'Started' },
    { type: 'completed', label: 'Completed' }
  ];

  function cfg() {
    return window.QG_CONFIG || {};
  }

  function endpoint() {
    return cfg().taskEvidenceUrl ||
      'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/task-evidence';
  }

  async function callEvidence(action, body) {
    var user = typeof getCurrentUser === 'function' ? getCurrentUser() : window._currentUser;
    if (!user || typeof callVerifiedFunction !== 'function') {
      return { ok: false, error: 'auth_required' };
    }
    var result = await callVerifiedFunction(
      endpoint(),
      Object.assign({ action: action }, body || {}),
      user
    );
    if (result && result.ok == null && result.success != null) result.ok = result.success;
    return result;
  }

  function getPosition() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) {
        resolve({ unavailable: true });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude
          });
        },
        function (err) {
          if (err && err.code === 1) resolve({ denied: true });
          else resolve({ unavailable: true });
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
      );
    });
  }

  async function stampTask(taskId, stampType) {
    var payload = { task_id: String(taskId), stamp_type: stampType };
    if (stampType === 'arrived') {
      var geo = await getPosition();
      if (geo.denied) {
        payload.location_denied = true;
        payload.location_status = 'denied';
      } else if (geo.unavailable) {
        payload.location_unavailable = true;
        payload.location_status = 'unavailable';
      } else {
        payload.lat = geo.lat;
        payload.lng = geo.lng;
      }
    }
    return await callEvidence('stamp', payload);
  }

  async function addEvidencePhoto(taskId, url, kind) {
    return await callEvidence('add_photo', {
      task_id: String(taskId),
      url: url,
      kind: kind || 'progress'
    });
  }

  async function getEvidence(taskId) {
    return await callEvidence('get', { task_id: String(taskId) });
  }

  function stampLabel(type) {
    var found = STAMPS.find(function (s) { return s.type === type; });
    return found ? found.label : type;
  }

  function formatDistance(m) {
    if (m == null || !isFinite(Number(m))) return '';
    var n = Number(m);
    if (n < 1000) return Math.round(n) + ' m from task';
    return (n / 1000).toFixed(1) + ' km from task';
  }

  function evidencePanelHtml(taskId, opts) {
    opts = opts || {};
    var isWorker = !!opts.isWorker;
    var frozen = !!opts.frozen;
    if (!isWorker) {
      return '<div class="qg-evidence-panel" data-evidence-task="' + String(taskId) + '">' +
        '<div class="qg-evidence-head">Task progress</div>' +
        '<p class="qg-evidence-note">Tasker check-ins and photo proof appear here as they work.</p>' +
        '<div class="qg-evidence-stamps" data-evidence-stamps></div>' +
        '<div class="qg-evidence-photos" data-evidence-photos></div>' +
        '</div>';
    }
    return '<div class="qg-evidence-panel" data-evidence-task="' + String(taskId) + '">' +
      '<div class="qg-evidence-head">Check in · evidence</div>' +
      (frozen
        ? '<p class="qg-evidence-note qg-evidence-frozen">Dispute open — escrow frozen. New stamps are paused.</p>'
        : '<p class="qg-evidence-note">Stamp your progress. “Arrived” captures location (optional if denied).</p>') +
      '<div class="qg-evidence-stamp-btns">' +
        STAMPS.map(function (s) {
          return '<button type="button" class="qg-evidence-stamp-btn" data-stamp="' + s.type + '" ' +
            (frozen ? 'disabled' : '') + '>' + s.label + '</button>';
        }).join('') +
      '</div>' +
      '<div class="qg-evidence-stamps" data-evidence-stamps></div>' +
      '<div class="qg-evidence-photo-row">' +
        '<label class="qg-evidence-photo-btn">' +
          '<input type="file" accept="image/*" data-evidence-file hidden ' + (frozen ? 'disabled' : '') + '>' +
          'Add before/after photo' +
        '</label>' +
        '<select data-evidence-kind class="qg-evidence-kind">' +
          '<option value="before">Before</option>' +
          '<option value="after">After</option>' +
          '<option value="progress">Progress</option>' +
        '</select>' +
      '</div>' +
      '<div class="qg-evidence-photos" data-evidence-photos></div>' +
      '</div>';
  }

  function renderStampList(el, stamps) {
    if (!el) return;
    var list = stamps || [];
    if (!list.length) {
      el.innerHTML = '<div class="qg-evidence-empty">No check-ins yet</div>';
      return;
    }
    el.innerHTML = list.map(function (s) {
      var t = stampLabel(s.stamp_type);
      var when = s.stamped_at ? new Date(s.stamped_at).toLocaleString() : '';
      var loc = '';
      if (s.stamp_type === 'arrived') {
        if (s.location_status === 'ok') loc = formatDistance(s.distance_m) || 'Location recorded';
        else if (s.location_status === 'denied') loc = 'Location denied';
        else if (s.location_status === 'unavailable') loc = 'Location unavailable';
      }
      return '<div class="qg-evidence-stamp-row"><strong>' + t + '</strong>' +
        '<span>' + when + (loc ? ' · ' + loc : '') + '</span></div>';
    }).join('');
  }

  function renderPhotoList(el, photos) {
    if (!el) return;
    var list = photos || [];
    if (!list.length) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = '<div class="qg-evidence-photo-grid">' + list.map(function (p) {
      return '<a href="' + String(p.url) + '" target="_blank" rel="noopener" class="qg-evidence-thumb">' +
        '<img src="' + String(p.url) + '" alt="' + String(p.kind || 'proof') + '">' +
        '<span>' + String(p.kind || 'proof') + '</span></a>';
    }).join('') + '</div>';
  }

  async function refreshEvidencePanel(root, taskId) {
    var panel = root.querySelector('[data-evidence-task="' + String(taskId) + '"]') ||
      document.querySelector('[data-evidence-task="' + String(taskId) + '"]');
    if (!panel) return;
    var data = await getEvidence(taskId);
    if (!data || !data.ok) return;
    renderStampList(panel.querySelector('[data-evidence-stamps]'), data.stamps);
    renderPhotoList(panel.querySelector('[data-evidence-photos]'), data.evidence_photos);
    if (data.task && data.task.evidence_frozen) {
      panel.querySelectorAll('button,input').forEach(function (n) { n.disabled = true; });
    }
  }

  function bindEvidencePanel(root) {
    var scope = root || document;
    scope.querySelectorAll('.qg-evidence-panel').forEach(function (panel) {
      if (panel._qgEvidenceBound) return;
      panel._qgEvidenceBound = true;
      var taskId = panel.getAttribute('data-evidence-task');
      refreshEvidencePanel(panel, taskId);

      panel.querySelectorAll('[data-stamp]').forEach(function (btn) {
        btn.onclick = async function () {
          btn.disabled = true;
          var type = btn.getAttribute('data-stamp');
          var prev = btn.textContent;
          btn.textContent = '…';
          var result = await stampTask(taskId, type);
          if (!result || !result.ok) {
            var msg = (result && result.message) || (result && result.error) || 'Could not save check-in';
            if (typeof showToast === 'function') showToast(msg, '#ef4444');
            else if (typeof qgNotify === 'function') qgNotify(msg, '#ef4444');
            btn.disabled = false;
            btn.textContent = prev;
            return;
          }
          if (typeof showToast === 'function') showToast(stampLabel(type) + ' recorded');
          await refreshEvidencePanel(panel, taskId);
          btn.disabled = false;
          btn.textContent = prev;
        };
      });

      var fileInput = panel.querySelector('[data-evidence-file]');
      if (fileInput) {
        fileInput.onchange = async function () {
          var file = fileInput.files && fileInput.files[0];
          if (!file) return;
          var user = typeof getCurrentUser === 'function' ? getCurrentUser() : window._currentUser;
          if (!user || typeof uploadTaskPhoto !== 'function') return;
          var kind = (panel.querySelector('[data-evidence-kind]') || {}).value || 'progress';
          var up = await uploadTaskPhoto(file, user.uid);
          fileInput.value = '';
          if (!up || !up.success || !up.url) {
            var err = (up && up.error) || 'Upload failed';
            if (typeof qgNotify === 'function') qgNotify(err, '#ef4444');
            return;
          }
          var saved = await addEvidencePhoto(taskId, up.url, kind);
          if (!saved || !saved.ok) {
            if (typeof qgNotify === 'function') qgNotify((saved && saved.error) || 'Could not attach photo', '#ef4444');
            return;
          }
          if (typeof showToast === 'function') showToast('Photo added to evidence');
          await refreshEvidencePanel(panel, taskId);
        };
      }
    });
  }

  if (!document.getElementById('qg-evidence-css')) {
    var style = document.createElement('style');
    style.id = 'qg-evidence-css';
    style.textContent =
      '.qg-evidence-panel{margin:12px 0;padding:14px;border-radius:14px;border:1px solid var(--border);background:rgba(255,255,255,0.03)}' +
      '.qg-evidence-head{font:600 13px Poppins,sans-serif;margin-bottom:6px}' +
      '.qg-evidence-note{font-size:12px;color:var(--text-muted);margin:0 0 10px;line-height:1.45}' +
      '.qg-evidence-frozen{color:#fbbf24}' +
      '.qg-evidence-stamp-btns{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}' +
      '.qg-evidence-stamp-btn{border:1px solid var(--border);background:var(--input-bg);color:var(--text);border-radius:999px;padding:8px 12px;font:600 11px Poppins,sans-serif;cursor:pointer}' +
      '.qg-evidence-stamp-btn:disabled{opacity:.45;cursor:not-allowed}' +
      '.qg-evidence-stamp-row{display:flex;justify-content:space-between;gap:10px;font-size:12px;padding:6px 0;border-top:1px solid var(--border)}' +
      '.qg-evidence-stamp-row span{color:var(--text-muted);text-align:right}' +
      '.qg-evidence-empty{font-size:12px;color:var(--text-faint)}' +
      '.qg-evidence-photo-row{display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap}' +
      '.qg-evidence-photo-btn{display:inline-flex;align-items:center;padding:8px 12px;border-radius:10px;background:linear-gradient(135deg,#6b3fa0,#a78bfa);color:#fff;font:600 11px Poppins,sans-serif;cursor:pointer}' +
      '.qg-evidence-kind{border-radius:10px;border:1px solid var(--border);background:var(--input-bg);color:var(--text);padding:7px 10px;font-size:12px}' +
      '.qg-evidence-photo-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}' +
      '.qg-evidence-thumb{display:block;border-radius:10px;overflow:hidden;border:1px solid var(--border);text-decoration:none;color:var(--text-muted);font-size:10px;text-align:center}' +
      '.qg-evidence-thumb img{width:100%;height:72px;object-fit:cover;display:block}' +
      '.qg-evidence-thumb span{display:block;padding:4px}';
    (document.head || document.documentElement).appendChild(style);
  }

  window.QG_stampTask = stampTask;
  window.QG_addEvidencePhoto = addEvidencePhoto;
  window.QG_getTaskEvidence = getEvidence;
  window.QG_evidencePanelHtml = evidencePanelHtml;
  window.QG_bindEvidencePanel = bindEvidencePanel;
  window.QG_refreshEvidencePanel = refreshEvidencePanel;
})();
