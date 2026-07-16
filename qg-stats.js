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

  function renderTrustBadges(stats) {
    if (!stats) return '';
    var parts = [];
    if (stats.completionRate != null) {
      var tone = stats.completionRate >= 80 ? 'green' : (stats.completionRate >= 50 ? 'amber' : '');
      parts.push(trustBadgeHtml('Completion rate', '✓ ' + stats.completionRate + '% complete', tone));
    }
    if (stats.responseRate != null) {
      var rtone = stats.responseRate >= 70 ? 'green' : (stats.responseRate >= 40 ? 'amber' : '');
      parts.push(trustBadgeHtml('Response rate', '⚡ ' + stats.responseRate + '% response', rtone));
    }
    if (stats.completedCount > 0) {
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

    var apps = await sbGet('applications', 'worker_id=eq.' + encodeURIComponent(userId) + '&select=status,created_at,updated_at');
    var posted = await sbGet('tasks', 'poster_id=eq.' + encodeURIComponent(userId) + '&select=status');
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
    var rows = await sbGet('user_warnings', 'user_id=eq.' + encodeURIComponent(userId) + '&order=created_at.desc');
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
    var rows = await sbGet('users', 'user_id=eq.' + encodeURIComponent(userId) + '&select=status');
    if (Array.isArray(rows) && rows[0] && rows[0].status) {
      return rows[0].status;
    }
    return 'active';
  }

  async function enforceBanOnLogin(user) {
    if (!user || !user.uid) return { ok: true };
    var status = await getUserStatus(user.uid);
    if (status !== 'banned') return { ok: true, status: status };

    if (typeof firebase !== 'undefined' && firebase.auth) {
      await firebase.auth().signOut();
    }
    alert('Your QuickGigs account has been suspended after repeated community warnings. Contact support@quickgigs.ca if you believe this is an error.');
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
})();
