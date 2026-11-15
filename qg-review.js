/* SwiftGigs reviews — a pop-up after a finished gig, for both sides.
   Never forced: "Not now" closes it and it is not shown again for that gig.
   The poster's sheet also offers a tip (100% to the tasker). */
(function () {
  'use strict';

  var TAGS = {
    poster: ['On time', 'Friendly', 'Thorough', 'Great work', 'Professional', 'Good value', 'Communicative', 'Would hire again'],
    worker: ['Clear instructions', 'Fair pay', 'Responsive', 'Easy to work with', 'Respectful', 'Safe environment', 'Would work again']
  };
  var WORDS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'];
  var TIPS = [0, 200, 500, 1000];
  var overlay = null, promptedThisLoad = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function skipKey(taskId) { return 'qg-review-skip-' + taskId; }
  function skipped(taskId) { try { return localStorage.getItem(skipKey(taskId)) === '1'; } catch (e) { return false; } }
  function skip(taskId) { try { localStorage.setItem(skipKey(taskId), '1'); } catch (e) {} }
  function me() { return window._currentUser || null; }

  function css() {
    if (document.getElementById('qgReviewCss')) return;
    var s = document.createElement('style');
    s.id = 'qgReviewCss';
    s.textContent =
      '.qg-rv-ov{position:fixed;inset:0;z-index:11900;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center;}' +
      '.qg-rv{width:100%;max-width:480px;max-height:94vh;overflow:auto;background:var(--surface,#fff);color:var(--text,#111);border-radius:20px 20px 0 0;padding:18px 18px calc(18px + env(safe-area-inset-bottom));box-sizing:border-box;}' +
      '.qg-rv-top{display:flex;justify-content:flex-end;}' +
      '.qg-rv-later{border:0;background:none;color:var(--text-muted,#666);font:inherit;font-size:14px;font-weight:600;padding:4px;cursor:pointer;}' +
      '.qg-rv-who{text-align:center;margin:2px 0 14px;}' +
      '.qg-rv-av{width:60px;height:60px;border-radius:50%;margin:0 auto 10px;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;color:#fff;background:var(--primary,#6d28d9);}' +
      '.qg-rv-who h2{margin:0;font-size:19px;font-weight:700;}' +
      '.qg-rv-who p{margin:4px 0 0;font-size:13.5px;color:var(--text-muted,#666);}' +
      '.qg-rv-stars{display:flex;justify-content:center;gap:6px;}' +
      '.qg-rv-star{border:0;background:none;padding:4px;cursor:pointer;color:var(--border,#ccc);line-height:0;}' +
      '.qg-rv-star.on{color:#f5b301;}' +
      '.qg-rv-star svg{width:38px;height:38px;fill:currentColor;}' +
      '.qg-rv-word{text-align:center;min-height:20px;margin:4px 0 12px;font-size:14px;font-weight:600;color:var(--text-muted,#666);}' +
      '.qg-rv-label{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text-muted,#666);margin:14px 0 8px;}' +
      '.qg-rv-tags{display:flex;flex-wrap:wrap;gap:8px;}' +
      '.qg-rv-tag,.qg-rv-tip{height:38px;padding:0 14px;border-radius:19px;border:1px solid var(--border,#ddd);background:transparent;color:var(--text,#111);font:inherit;font-size:14px;font-weight:600;cursor:pointer;}' +
      '.qg-rv-tag.on{border-color:var(--primary,#6d28d9);background:var(--primary,#6d28d9);color:#fff;}' +
      '.qg-rv-tip.on{border-color:var(--teal,#0d9488);background:var(--teal,#0d9488);color:#fff;}' +
      '.qg-rv-note{font-size:12.5px;color:var(--text-muted,#666);margin:8px 0 0;}' +
      '.qg-rv textarea{width:100%;box-sizing:border-box;min-height:76px;margin-top:4px;padding:12px 14px;border-radius:12px;border:1px solid var(--border,#ddd);background:var(--bg,#fafafa);color:var(--text,#111);font:inherit;font-size:16px;resize:vertical;}' +
      '.qg-rv-go{width:100%;height:50px;margin-top:16px;border:0;border-radius:14px;background:var(--primary,#6d28d9);color:#fff;font:inherit;font-size:16px;font-weight:700;cursor:pointer;}' +
      '.qg-rv-go:disabled{opacity:.45;cursor:default;}' +
      '.qg-rv-err{min-height:18px;margin:8px 0 0;font-size:13px;color:var(--danger,#c0392b);text-align:center;}';
    document.head.appendChild(s);
  }
  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.600 9.400l6.500-.9z"/></svg>';

  function close() {
    if (overlay) { overlay.remove(); overlay = null; }
    document.body.style.overflow = '';
  }

  /**
   * opts: { taskId, revieweeId, revieweeName, title, role ('poster' reviews the
   * tasker, 'worker' reviews the poster), canTip, onDone }
   */
  function open(opts) {
    opts = opts || {};
    if (!opts.taskId || !opts.revieweeId || !me()) return;
    css();
    close();
    var role = opts.role === 'worker' ? 'worker' : 'poster';
    var name = opts.revieweeName || (role === 'poster' ? 'your tasker' : 'the poster');
    var canTip = role === 'poster' && opts.canTip !== false && typeof window.QG_openTip === 'function';
    var rating = 0, tags = [], tipCents = 0;

    overlay = document.createElement('div');
    overlay.className = 'qg-rv-ov';
    overlay.innerHTML = '<div class="qg-rv" role="dialog" aria-modal="true" aria-label="Rate your gig">' +
      '<div class="qg-rv-top"><button type="button" class="qg-rv-later" data-rv-later>Not now</button></div>' +
      '<div class="qg-rv-who"><div class="qg-rv-av" translate="no">' + esc(String(name).charAt(0).toUpperCase()) + '</div>' +
        '<h2>How was ' + '<span translate="no">' + esc(name) + '</span>?</h2>' +
        (opts.title ? '<p translate="no">' + esc(opts.title) + '</p>' : '') + '</div>' +
      '<div class="qg-rv-stars" role="radiogroup" aria-label="Rating">' + [1, 2, 3, 4, 5].map(function (n) {
        return '<button type="button" class="qg-rv-star" data-rv-star="' + n + '" role="radio" aria-checked="false" aria-label="' + n + ' star' + (n > 1 ? 's' : '') + '">' + STAR + '</button>';
      }).join('') + '</div>' +
      '<div class="qg-rv-word" id="qgRvWord">Tap a star to rate</div>' +
      '<div id="qgRvMore" hidden>' +
        '<div class="qg-rv-label">What stood out? (optional)</div>' +
        '<div class="qg-rv-tags">' + TAGS[role].map(function (t) {
          return '<button type="button" class="qg-rv-tag" data-rv-tag="' + esc(t) + '">' + esc(t) + '</button>';
        }).join('') + '</div>' +
        '<div class="qg-rv-label">Add a note (optional)</div>' +
        '<textarea id="qgRvText" maxlength="500" placeholder="Tell others about your experience"></textarea>' +
        (canTip
          ? '<div class="qg-rv-label">Add a tip?</div><div class="qg-rv-tags">' + TIPS.map(function (c) {
              return '<button type="button" class="qg-rv-tip' + (c === 0 ? ' on' : '') + '" data-rv-tip="' + c + '">' + (c ? '$' + (c / 100) : 'No tip') + '</button>';
            }).join('') + '<button type="button" class="qg-rv-tip" data-rv-tip="other">Other</button></div>' +
            '<p class="qg-rv-note">Tips are optional. 100% goes to <span translate="no">' + esc(name) + '</span>.</p>'
          : '') +
      '</div>' +
      '<button type="button" class="qg-rv-go" id="qgRvGo" disabled>Submit</button>' +
      '<p class="qg-rv-err" id="qgRvErr" role="alert"></p></div>';
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    var go = overlay.querySelector('#qgRvGo');
    var err = overlay.querySelector('#qgRvErr');
    function paintGo() {
      go.disabled = !rating;
      go.textContent = tipCents === 'other' ? 'Submit and choose tip'
        : tipCents ? 'Submit and tip $' + (tipCents / 100) : 'Submit';
    }
    overlay.addEventListener('click', async function (e) {
      if (e.target === overlay || e.target.closest('[data-rv-later]')) { skip(opts.taskId); close(); return; }
      var star = e.target.closest('[data-rv-star]');
      if (star) {
        rating = Number(star.getAttribute('data-rv-star'));
        overlay.querySelectorAll('[data-rv-star]').forEach(function (b) {
          var on = Number(b.getAttribute('data-rv-star')) <= rating;
          b.classList.toggle('on', on);
          b.setAttribute('aria-checked', Number(b.getAttribute('data-rv-star')) === rating ? 'true' : 'false');
        });
        overlay.querySelector('#qgRvWord').textContent = WORDS[rating];
        overlay.querySelector('#qgRvMore').hidden = false;
        paintGo();
        return;
      }
      var tag = e.target.closest('[data-rv-tag]');
      if (tag) {
        var t = tag.getAttribute('data-rv-tag');
        var i = tags.indexOf(t);
        if (i >= 0) tags.splice(i, 1); else tags.push(t);
        tag.classList.toggle('on', i < 0);
        return;
      }
      var tip = e.target.closest('[data-rv-tip]');
      if (tip) {
        var v = tip.getAttribute('data-rv-tip');
        tipCents = v === 'other' ? 'other' : Number(v);
        overlay.querySelectorAll('[data-rv-tip]').forEach(function (b) { b.classList.toggle('on', b === tip); });
        paintGo();
        return;
      }
      if (e.target.closest('#qgRvGo') && rating) {
        go.disabled = true;
        go.textContent = 'Sending…';
        err.textContent = '';
        var user = me();
        var text = overlay.querySelector('#qgRvText').value;
        if (typeof window.sanitizeInput === 'function') text = window.sanitizeInput(text, 500);
        var res;
        try {
          res = await submitReview({
            task_id: String(opts.taskId),
            reviewer_id: user.uid,
            reviewee_id: String(opts.revieweeId),
            rating: rating,
            review_comment: text,
            tags: tags,
            reviewer_name: user.displayName || '',
            task_title: opts.title || ''
          });
        } catch (ex) { res = { success: false, error: String((ex && ex.message) || ex) }; }
        if (!res || (!res.success && res.error !== 'already_reviewed')) {
          err.textContent = res && res.error === 'content_moderation' && res.message ? res.message
            : res && res.error === 'reviews_rls_blocked' ? 'Reviews open once the gig is marked complete.'
            : 'Could not save your review. Try again.';
          paintGo();
          return;
        }
        skip(opts.taskId);
        var wantTip = tipCents;
        close();
        if (typeof window.showToast === 'function') window.showToast('Thanks for your review.');
        if (typeof opts.onDone === 'function') { try { opts.onDone({ rating: rating }); } catch (e2) {} }
        if (wantTip && canTip) {
          window.QG_openTip(String(opts.taskId), {
            taskerName: opts.revieweeName || '',
            title: opts.title || '',
            amountCents: wantTip === 'other' ? 0 : wantTip,
            onDone: opts.onTip
          });
        }
      }
    });
  }

  /** Gig ids this person has already reviewed. */
  async function reviewedIds(uid) {
    var rows = await sbGet('reviews', withSelect('reviewer_id=eq.' + encodeURIComponent(uid), 'task_id'), 'created_at.desc', 200);
    var set = {};
    (rows || []).forEach(function (r) { set[String(r.task_id)] = true; });
    return set;
  }

  /**
   * Uber-style: on opening the app, offer the most recent finished gig that
   * has not been rated or dismissed. At most one prompt per page load.
   */
  async function promptPending(opts) {
    opts = opts || {};
    var user = me();
    if (!user || promptedThisLoad || overlay) return;
    if (typeof sbGet !== 'function' || typeof submitReview !== 'function') return;
    promptedThisLoad = true;
    try {
      var uid = user.uid, q = encodeURIComponent(uid);
      var results = await Promise.all([
        sbGet('tasks', withSelect('posted_by=eq.' + q + '&status=eq.completed', 'task_id,title,posted_by,poster_name,poster_confirmed_at,created_at'), 'poster_confirmed_at.desc.nullslast', 5),
        sbGet('applications', withSelect('worker_id=eq.' + q + '&status=eq.completed', 'task_id,worker_id,created_at'), 'created_at.desc', 5),
        reviewedIds(uid)
      ]);
      var posted = results[0] || [], worked = results[1] || [], done = results[2] || {};
      var cands = [];
      posted.forEach(function (t) { cands.push({ taskId: String(t.task_id), role: 'poster', title: t.title, at: t.poster_confirmed_at || t.created_at }); });
      var workedIds = worked.map(function (a) { return String(a.task_id); });
      if (workedIds.length) {
        var tasks = await sbGet('tasks', withSelect('task_id=in.(' + workedIds.join(',') + ')&status=eq.completed', 'task_id,title,posted_by,poster_name,poster_confirmed_at,created_at'), null, 10);
        (tasks || []).forEach(function (t) {
          if (String(t.posted_by) === uid) return;
          cands.push({ taskId: String(t.task_id), role: 'worker', title: t.title, revieweeId: String(t.posted_by), revieweeName: t.poster_name || '', at: t.poster_confirmed_at || t.created_at });
        });
      }
      var cutoff = Date.now() - 30 * 86400000;
      function when(c) { var t = typeof parseQgTimestamp === 'function' ? parseQgTimestamp(c.at) : Date.parse(c.at); return isFinite(t) ? t : 0; }
      cands = cands.filter(function (c) { return !done[c.taskId] && !skipped(c.taskId) && when(c) >= cutoff; })
        .sort(function (a, b) { return when(b) - when(a); });
      var pick = cands[0];
      if (!pick) return;
      if (pick.role === 'poster') {
        var apps = await sbGet('applications', withSelect('task_id=eq.' + encodeURIComponent(pick.taskId) + '&status=eq.completed', 'worker_id,worker_name'), null, 1);
        if (!apps || !apps.length) return;
        pick.revieweeId = String(apps[0].worker_id);
        pick.revieweeName = apps[0].worker_name || '';
      }
      if (!pick.revieweeId || overlay || document.querySelector('.qg-tip-ov.open, .sg-sheet:not([hidden])')) return;
      pick.onDone = opts.onDone;
      pick.onTip = opts.onTip;
      open(pick);
    } catch (e) {}
  }

  window.QG_openReview = open;
  window.QG_promptPendingReview = promptPending;
  window.QG_reviewedTaskIds = reviewedIds;
})();
