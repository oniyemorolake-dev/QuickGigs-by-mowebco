/* QuickGigs — trust stats: completion rate, response rate, warnings / auto-ban */
(function () {
  var WARNINGS_BEFORE_BAN = (window.QG_CONFIG && window.QG_CONFIG.autoBanAfterWarnings) || 3;

  function pct(n, d) {
    if (!d || d <= 0) return null;
    return Math.round((n / d) * 100);
  }

  function trustBadgeHtml(label, value, tone, iconName) {
    if (value == null || value === '') return '';
    var cls = tone ? ' is-' + tone : '';
    var mark = '';
    if (iconName && typeof qgIcon === 'function') {
      mark = qgIcon(iconName, { size: 12, className: 'qg-trust-ico' });
    }
    return '<span class="qg-trust-badge' + cls + '" title="' + label + '">' + mark + value + '</span>';
  }

  function renderTrustBadges(stats, opts) {
    if (!stats) return '';
    opts = opts || {};
    var parts = [];
    if (stats.completionRate != null && !(opts.hideZeroComplete && stats.completionRate <= 0)) {
      var tone = stats.completionRate >= 80 ? 'green' : (stats.completionRate >= 50 ? 'amber' : '');
      parts.push(trustBadgeHtml('Task completion rate', stats.completionRate + '% task rate', tone, 'checkCircle'));
    }
    // Response % is application status ratio — not latency. Keep as rate chip only when asked;
    // trust profile earned badges intentionally omit "Fast responder" until true response time exists.
    if (!opts.hideResponseRate && stats.responseRate != null && !(opts.hideZeroComplete && stats.responseRate <= 0)) {
      var rtone = stats.responseRate >= 70 ? 'green' : (stats.responseRate >= 40 ? 'amber' : '');
      parts.push(trustBadgeHtml('Response rate', stats.responseRate + '% response', rtone, 'zap'));
    }
    if (!opts.hideCompleted && stats.completedCount > 0) {
      parts.push(trustBadgeHtml('Jobs done', stats.completedCount + ' completed', '', 'briefcase'));
    }
    if (stats.avgRating != null && stats.reviewCount > 0) {
      var avg = (Math.round(Number(stats.avgRating) * 10) / 10).toFixed(1);
      parts.push(trustBadgeHtml('Rating', avg + ' (' + stats.reviewCount + ')', '', 'star'));
    }
    if (!parts.length) return '';
    return '<div class="qg-trust-row" role="list" aria-label="Trust indicators">' + parts.join('') + '</div>';
  }

  function dayKey(iso) {
    try {
      var d = new Date(iso);
      if (!isFinite(d.getTime())) return '';
      return d.toISOString().slice(0, 10);
    } catch (e) {
      return '';
    }
  }

  /** Consecutive calendar days with ≥1 completed job, counting back from the most recent. */
  function computeJobStreak(completedDates) {
    var keys = [];
    var seen = {};
    (completedDates || []).forEach(function (iso) {
      var k = dayKey(iso);
      if (!k || seen[k]) return;
      seen[k] = true;
      keys.push(k);
    });
    if (!keys.length) return null;
    keys.sort();
    keys.reverse();
    var streak = 1;
    for (var i = 0; i < keys.length - 1; i++) {
      var a = new Date(keys[i] + 'T12:00:00Z').getTime();
      var b = new Date(keys[i + 1] + 'T12:00:00Z').getTime();
      var diff = Math.round((a - b) / 86400000);
      if (diff === 1) streak += 1;
      else break;
    }
    return streak;
  }

  function categoryLabel(catId) {
    if (typeof getCatInfo === 'function') {
      var info = getCatInfo(catId);
      if (info && info.label) return String(info.label).replace(/^[^\w#A-Za-z]+/, '').trim() || info.label;
    }
    var raw = String(catId || '').trim();
    if (!raw) return '';
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  /**
   * From completed hire tasks: top category, rehire %, job-day streak.
   */
  async function fetchCompletedHireMeta(userId, workerApps) {
    var empty = {
      topCategory: '',
      topCategoryLabel: '',
      rehireRate: null,
      jobStreak: null,
      completedDates: []
    };
    var apps = Array.isArray(workerApps) ? workerApps : [];
    var taskIds = [];
    var seen = {};
    apps.forEach(function (a) {
      var st = String(a.status || '').toLowerCase();
      if (st !== 'accepted' && st !== 'completed' && st !== 'in_progress') return;
      var tid = String(a.task_id || '');
      if (!tid || seen[tid]) return;
      seen[tid] = true;
      taskIds.push(tid);
    });
    if (!taskIds.length || typeof sbGet !== 'function') return empty;

    var rows = [];
    var CHUNK = 80;
    for (var i = 0; i < taskIds.length; i += CHUNK) {
      var chunk = taskIds.slice(i, i + CHUNK);
      var inList = typeof postgrestInList === 'function'
        ? postgrestInList(chunk)
        : chunk.map(function (id) { return '"' + String(id).replace(/"/g, '') + '"'; }).join(',');
      var part = await sbGet(
        'tasks',
        'task_id=in.(' + inList + ')&status=eq.completed&select=task_id,category,posted_by,worker_completed_at,created_at,status',
        null,
        chunk.length
      );
      if (Array.isArray(part)) rows = rows.concat(part);
    }
    if (!rows.length) return empty;

    var catCounts = {};
    var posterCounts = {};
    var dates = [];
    rows.forEach(function (t) {
      var cat = String(t.category || '').toLowerCase().trim();
      if (cat) catCounts[cat] = (catCounts[cat] || 0) + 1;
      var poster = String(t.posted_by || '');
      if (poster) posterCounts[poster] = (posterCounts[poster] || 0) + 1;
      dates.push(t.worker_completed_at || t.created_at || '');
    });

    var topCategory = '';
    var topN = 0;
    Object.keys(catCounts).forEach(function (k) {
      if (catCounts[k] > topN) {
        topN = catCounts[k];
        topCategory = k;
      }
    });

    var uniquePosters = Object.keys(posterCounts);
    var rehireRate = null;
    if (rows.length >= 2 && uniquePosters.length >= 1) {
      var repeatJobs = 0;
      uniquePosters.forEach(function (p) {
        if (posterCounts[p] >= 2) repeatJobs += posterCounts[p] - 1;
      });
      // Share of completed hires that are repeat bookings with the same poster.
      if (repeatJobs > 0) {
        rehireRate = Math.round((repeatJobs / rows.length) * 100);
      }
    }

    return {
      topCategory: topCategory,
      topCategoryLabel: topCategory ? categoryLabel(topCategory) : '',
      rehireRate: rehireRate,
      jobStreak: computeJobStreak(dates),
      completedDates: dates
    };
  }

  function onTimeRateFromReviews(reviewRows) {
    var tagged = 0;
    var onTime = 0;
    (reviewRows || []).forEach(function (r) {
      var tags = r && (r.tags || r.TAGS);
      var list = [];
      if (Array.isArray(tags)) list = tags;
      else if (tags) list = String(tags).split(',').map(function (t) { return t.trim(); }).filter(Boolean);
      if (!list.length) return;
      tagged += 1;
      if (list.some(function (t) { return /on\s*time/i.test(t); })) onTime += 1;
    });
    if (tagged < 2) return null;
    return Math.round((onTime / tagged) * 100);
  }

  async function fetchUserTrustStats(userId) {
    if (!userId || typeof sbGet !== 'function') {
      return {
        completionRate: null,
        responseRate: null,
        completedCount: 0,
        reviewCount: 0,
        avgRating: null,
        topCategory: '',
        topCategoryLabel: '',
        rehireRate: null,
        jobStreak: null,
        onTimeRate: null,
        avgResponseMs: null
      };
    }

    var reputation = typeof getTaskerReputation === 'function'
      ? await getTaskerReputation(userId)
      : null;

    var apps = await sbGet('applications', 'worker_id=eq.' + encodeURIComponent(userId) + '&select=status,created_at,task_id');
    var posted = await sbGet('tasks', 'posted_by=eq.' + encodeURIComponent(userId) + '&select=status');
    var reviews = reputation && Array.isArray(reputation.reviews)
      ? reputation.reviews
      : await sbGet('reviews', 'reviewee_id=eq.' + encodeURIComponent(userId) + '&select=rating,tags');

    var workerApps = Array.isArray(apps) ? apps : [];
    var posterTasks = Array.isArray(posted) ? posted : [];
    var reviewRows = Array.isArray(reviews) ? reviews : [];

    var acceptedOrDone = workerApps.filter(function (a) {
      var s = (a.status || '').toLowerCase();
      return s === 'accepted' || s === 'completed' || s === 'in_progress';
    });
    var completedWorker = reputation && reputation.completedJobs != null
      ? Number(reputation.completedJobs) || 0
      : (typeof countCompletedJobsForWorker === 'function'
          ? await countCompletedJobsForWorker(userId)
          : workerApps.filter(function (a) {
              return (a.status || '').toLowerCase() === 'completed';
            }).length);

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
    var reviewCount = reviewRows.length;
    if (reputation && reputation.avgRating != null) {
      avgRating = reputation.avgRating;
      reviewCount = reputation.reviewCount || reviewCount;
    } else if (reviewRows.length) {
      var sum = reviewRows.reduce(function (acc, r) { return acc + (Number(r.rating) || 0); }, 0);
      avgRating = Math.round((sum / reviewRows.length) * 10) / 10;
    }

    var hireMeta = await fetchCompletedHireMeta(userId, workerApps);
    // Prefer hire-meta completed count when reputation count was 0 but tasks were readable.
    if (!completedWorker && hireMeta.completedDates && hireMeta.completedDates.length) {
      completedWorker = hireMeta.completedDates.length;
    }

    return {
      completionRate: completionRate,
      responseRate: responseRate,
      completedCount: completedWorker,
      reviewCount: reviewCount,
      avgRating: avgRating,
      topCategory: hireMeta.topCategory || '',
      topCategoryLabel: hireMeta.topCategoryLabel || '',
      rehireRate: hireMeta.rehireRate,
      jobStreak: hireMeta.jobStreak,
      onTimeRate: onTimeRateFromReviews(reviewRows),
      // Latency not stored — keep null so "Fast responder" is never shown.
      avgResponseMs: null
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
    return !!(userRow && (
      userRow.tasker_verified === true ||
      userRow.tasker_verified === 'true' ||
      userRow.TASKER_VERIFIED === true
    ));
  }

  function renderVerifiedBadge(isVerified) {
    if (!isVerified) return '';
    var mark = typeof qgIcon === 'function' ? qgIcon('checkCircle', { size: 12, className: 'qg-trust-ico' }) : '';
    return '<span class="qg-verified-badge" title="QuickGigs identity verified">' + mark + 'Identity verified</span>';
  }

  window.isWorkerVerified = isWorkerVerified;
  window.renderVerifiedBadge = renderVerifiedBadge;
})();
