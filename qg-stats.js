/* QuickGigs — trust stats: completion rate, response rate, warnings / auto-ban */
(function () {
  var WARNINGS_BEFORE_BAN = (window.QG_CONFIG && window.QG_CONFIG.autoBanAfterWarnings) || 3;

  function pct(n, d) {
    if (!d || d <= 0) return null;
    return Math.round((n / d) * 100);
  }

  function trustBadgeHtml(label, value, tone) {
    if (value == null || value === '') return '';
    var cls = tone ? ' is-' + tone : '';
    return '<span class="qg-trust-badge' + cls + '" title="' + label + '">' + value + '</span>';
  }

  function renderTrustBadges(stats, opts) {
    if (!stats) return '';
    opts = opts || {};
    var parts = [];
    if (stats.completionRate != null && !(opts.hideZeroComplete && stats.completionRate <= 0)) {
      var tone = stats.completionRate >= 80 ? 'green' : (stats.completionRate >= 50 ? 'amber' : '');
      parts.push(trustBadgeHtml('Task completion rate', stats.completionRate + '% task rate', tone));
    }
    if (stats.responseRate != null && !(opts.hideZeroComplete && stats.responseRate <= 0)) {
      var rtone = stats.responseRate >= 70 ? 'green' : (stats.responseRate >= 40 ? 'amber' : '');
      parts.push(trustBadgeHtml('Response rate', '⚡ ' + stats.responseRate + '% response', rtone));
    }
    // Profile page already shows Completed in the stats row — avoid duplicating.
    if (!opts.hideCompleted && stats.completedCount > 0) {
      parts.push(trustBadgeHtml('Jobs done', stats.completedCount + ' completed'));
    }
    if (stats.avgRating != null && stats.reviewCount > 0) {
      parts.push(trustBadgeHtml('Rating', '★ ' + stats.avgRating.toFixed(1) + ' (' + stats.reviewCount + ')'));
    }
    if (!parts.length) return '';
    return '<div class="qg-trust-row" role="list" aria-label="Trust indicators">' + parts.join('') + '</div>';
  }

  async function fetchUserTrustStats(userId) {
    if (!userId || typeof sbGet !== 'function') {
      return { completionRate: null, responseRate: null, completedCount: 0, reviewCount: 0, avgRating: null };
    }

    var apps = await sbGet('applications', 'worker_id=eq.' + encodeURIComponent(userId) + '&select=status,created_at');
    var posted = await sbGet('tasks', 'posted_by=eq.' + encodeURIComponent(userId) + '&select=status');
    var reviews = await sbGet('reviews', 'reviewee_id=eq.' + encodeURIComponent(userId) + '&select=rating');

    var workerApps = Array.isArray(apps) ? apps : [];
    var posterTasks = Array.isArray(posted) ? posted : [];
    var reviewRows = Array.isArray(reviews) ? reviews : [];

    var acceptedOrDone = workerApps.filter(function (a) {
      var s = (a.status || '').toLowerCase();
      return s === 'accepted' || s === 'completed';
    });
    var completedWorker = workerApps.filter(function (a) {
      return (a.status || '').toLowerCase() === 'completed';
    }).length;

    var completionRate = pct(completedWorker, acceptedOrDone.length);

    var posterCompleted = posterTasks.filter(function (t) {
      return (t.status || '').toLowerCase() === 'completed';
    }).length;
    var posterTotal = posterTasks.filter(function (t) {
      var s = (t.status || '').toLowerCase();
      return s !== 'cancelled';
    }).length;

    if (completionRate == null && posterTotal > 0) {
      completionRate = pct(posterCompleted, posterTotal);
    }

    var responded = workerApps.filter(function (a) {
      return (a.status || '').toLowerCase() !== 'pending';
    }).length;
    var responseRate = pct(responded, workerApps.length);

    var avgRating = null;
    if (reviewRows.length) {
      var sum = reviewRows.reduce(function (acc, r) { return acc + (Number(r.rating) || 0); }, 0);
      avgRating = sum / reviewRows.length;
    }

    return {
      completionRate: completionRate,
      responseRate: responseRate,
      completedCount: completedWorker + posterCompleted,
      reviewCount: reviewRows.length,
      avgRating: avgRating
    };
  }

  async function fetchUserWarnings(userId) {
    if (!userId || typeof sbGet !== 'function') return [];
    var rows = await sbGet('user_warnings', 'user_id=eq.' + encodeURIComponent(userId) + '&select=warning_id,user_id,reason,created_at', 'created_at.desc');
    return Array.isArray(rows) ? rows : [];
  }

  async function addUserWarning(userId, reason, source, reportId) {
    if (!userId || typeof sbPost !== 'function') return { success: false };
    var row = {
      user_id: userId,
      reason: reason || 'Community report',
      source: source || 'admin',
      report_id: reportId || null
    };
    var result = await sbPost('user_warnings', row);
    if (result.success) {
      await checkAutoBan(userId);
    }
    return result;
  }

  async function checkAutoBan(userId) {
    var warnings = await fetchUserWarnings(userId);
    if (warnings.length < WARNINGS_BEFORE_BAN) return { banned: false, count: warnings.length };

    if (typeof sbPatch === 'function') {
      await sbPatch('users', 'user_id=eq.' + encodeURIComponent(userId), { status: 'banned' });
    } else if (typeof sbUpdate === 'function') {
      await sbUpdate('users', { status: 'banned' }, 'user_id=eq.' + encodeURIComponent(userId));
    }
    return { banned: true, count: warnings.length };
  }

  async function getUserStatus(userId) {
    if (!userId || typeof sbGet !== 'function') return 'active';
    // Prefer firebase_uid (Auth uid) — user_id is the internal UUID PK.
    var rows = await sbGet(
      'users',
      'firebase_uid=eq.' + encodeURIComponent(userId) + '&select=status',
      null,
      1
    );
    if (Array.isArray(rows) && rows[0] && rows[0].status) {
      return rows[0].status;
    }
    return 'active';
  }

  async function enforceBanOnLogin(user) {
    if (!user || !user.uid) return { ok: true };
    var status = await getUserStatus(user.uid);
    if (status !== 'banned') return { ok: true, status: status };

    qgNotify('Your account has been suspended. Contact support@quickgigs.ca if this is an error.', '#ef4444');
    if (typeof qgLogout === 'function') {
      await qgLogout(window._auth);
      return { ok: false, banned: true };
    }
    if (typeof clearQgUserScopedStorage === 'function') clearQgUserScopedStorage();
    try {
      if (window._auth && typeof window._auth.signOut === 'function') await window._auth.signOut();
      else if (typeof firebase !== 'undefined' && firebase.auth) await firebase.auth().signOut();
    } catch (e) {}
    window.location.href = 'login.html';
    return { ok: false, banned: true };
  }

  window.WARNINGS_BEFORE_BAN = WARNINGS_BEFORE_BAN;
  window.renderTrustBadges = renderTrustBadges;
  window.fetchUserTrustStats = fetchUserTrustStats;
  window.fetchUserWarnings = fetchUserWarnings;
  window.addUserWarning = addUserWarning;
  window.checkAutoBan = checkAutoBan;
  window.getUserStatus = getUserStatus;
  window.enforceBanOnLogin = enforceBanOnLogin;

  async function isWorkerVerified(userId, userRow, stats) {
    if (userRow && (userRow.is_verified === true || userRow.is_verified === 'true')) return true;
    if (userRow && userRow.IS_VERIFIED === true) return true;
    if (!userId) return false;
    stats = stats || (typeof fetchUserTrustStats === 'function' ? await fetchUserTrustStats(userId) : null);
    var photoOk = typeof hasProfilePhotoUrl === 'function' && userRow && hasProfilePhotoUrl(userRow.avatar_url);
    if (!photoOk && typeof resolveUserAvatarUrl === 'function') {
      var av = await resolveUserAvatarUrl(userId);
      photoOk = typeof hasProfilePhotoUrl === 'function' && hasProfilePhotoUrl(av);
    }
    if (!stats || !photoOk) return false;
    return (stats.completedCount || 0) >= 3 &&
      (stats.avgRating == null || stats.avgRating >= 4) &&
      (stats.completionRate == null || stats.completionRate >= 70);
  }

  function renderVerifiedBadge(isVerified) {
    if (!isVerified) return '';
    return '<span class="qg-verified-badge" title="Verified tasker — photo on file, strong completion history, and positive reviews">✓ Verified</span>';
  }

  window.isWorkerVerified = isWorkerVerified;
  window.renderVerifiedBadge = renderVerifiedBadge;
})();
