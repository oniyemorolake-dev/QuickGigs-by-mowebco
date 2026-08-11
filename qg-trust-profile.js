/**
 * QuickGigs — Tasker trust profile + earned badges (tokens only).
 * Real data only — never fabricate ratings, streaks, response time, or rehire %.
 *
 * Bound now:
 *   Rating, Jobs done, Job-day streak, Top category specialty,
 *   Always on time (review tags), Rehire % (repeat posters), Top rated, Reliable closer
 * Not yet derivable (never shown):
 *   Fast responder / response latency (avgResponseMs not stored)
 */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ico(name, size, className) {
    size = size || 14;
    if (typeof qgIcon === 'function') {
      var mark = qgIcon(name, { size: size, className: className || 'qg-trust-ico' });
      if (mark) return mark;
    }
    return '';
  }

  /** First name + last initial (privacy). */
  function privacyDisplayName(fullName) {
    var raw = String(fullName || '').trim();
    if (!raw || /^a quickgigs member$/i.test(raw) || /^someone$/i.test(raw)) return 'Someone';
    if (typeof isGenericDisplayName === 'function' && isGenericDisplayName(raw)) return 'Someone';
    var parts = raw.split(/\s+/).filter(Boolean);
    if (!parts.length) return 'Someone';
    var first = parts[0];
    if (parts.length === 1) return first;
    var last = parts[parts.length - 1];
    return first + ' ' + last.charAt(0).toUpperCase() + '.';
  }

  function stripSkillEmoji(label) {
    return String(label || '')
      .replace(/^[^\w#A-Za-z]+/, '')
      .trim();
  }

  function primarySpecialty(skills) {
    var list = Array.isArray(skills) ? skills : [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var label = typeof item === 'string' ? item : (item && (item.label || item.name)) || '';
      var clean = stripSkillEmoji(label);
      if (clean) return clean;
    }
    return '';
  }

  function resolveSpecialty(opts) {
    opts = opts || {};
    var stats = opts.stats || {};
    if (stats.topCategoryLabel) return String(stats.topCategoryLabel);
    if (opts.specialty) return stripSkillEmoji(opts.specialty);
    return primarySpecialty(opts.skills);
  }

  /**
   * Title line from real history.
   * "Top Tasker · [specialty]" only when verified + strong rating + enough jobs.
   * Never invent Top Tasker for empty histories.
   */
  function buildTaskerTitleLine(opts) {
    opts = opts || {};
    var stats = opts.stats || {};
    var verified = !!opts.verified;
    var jobs = Number(stats.completedCount) || 0;
    var rating = stats.avgRating != null ? Number(stats.avgRating) : null;
    var reviews = Number(stats.reviewCount) || 0;
    var specialty = resolveSpecialty(opts);
    var isNew = jobs <= 0 && reviews <= 0;

    if (isNew) return 'New Tasker';

    var isTop =
      verified &&
      rating != null &&
      rating >= 4.5 &&
      jobs >= 5 &&
      reviews >= 1;

    if (isTop) {
      return specialty ? 'Top Tasker · ' + specialty : 'Top Tasker';
    }
    if (specialty) return 'Tasker · ' + specialty;
    return 'Tasker';
  }

  function parseReviewTags(review) {
    var tags = review && (review.tags || review.TAGS);
    if (!tags) return [];
    if (Array.isArray(tags)) return tags.map(function (t) { return String(t); });
    return String(tags).split(',').map(function (t) { return t.trim(); }).filter(Boolean);
  }

  /**
   * Earned badges from real metrics only.
   * Dropped when data missing: Fast responder (no latency), fabricated rehire %.
   */
  function deriveEarnedBadges(stats, reviews) {
    stats = stats || {};
    reviews = Array.isArray(reviews) ? reviews : [];
    var badges = [];
    var jobs = Number(stats.completedCount) || 0;
    var rating = stats.avgRating != null ? Number(stats.avgRating) : null;
    var reviewCount = Number(stats.reviewCount) || reviews.length || 0;
    var completionRate = stats.completionRate;
    var onTimeRate = stats.onTimeRate;
    var rehireRate = stats.rehireRate;

    if (completionRate != null && completionRate >= 80 && jobs >= 3) {
      badges.push({
        id: 'reliable-closer',
        label: 'Reliable closer',
        tone: 'accent',
        icon: 'checkCircle',
        source: 'completion_rate'
      });
    }
    if (rating != null && rating >= 4.8 && reviewCount >= 3) {
      badges.push({
        id: 'top-rated',
        label: 'Top rated',
        tone: 'accent',
        icon: 'star',
        source: 'avg_rating'
      });
    }

    // Prefer precomputed on-time %; else derive from review tags.
    if (onTimeRate == null) {
      var tagged = 0;
      var onTime = 0;
      reviews.forEach(function (r) {
        var tags = parseReviewTags(r);
        if (!tags.length) return;
        tagged += 1;
        if (tags.some(function (t) { return /on\s*time/i.test(t); })) onTime += 1;
      });
      if (tagged >= 2) onTimeRate = Math.round((onTime / tagged) * 100);
    }
    if (onTimeRate != null && onTimeRate >= 50) {
      badges.push({
        id: 'on-time',
        label: 'Always on time',
        tone: 'accent',
        icon: 'clock',
        source: 'review_tags_on_time'
      });
    }

    if (rehireRate != null && rehireRate > 0) {
      badges.push({
        id: 'rehired',
        label: rehireRate + '% rehired',
        tone: 'accent',
        icon: 'repeat',
        source: 'repeat_posters'
      });
    }

    // Fast responder intentionally omitted — avgResponseMs is not stored.

    if (jobs >= 10) {
      badges.push({
        id: 'jobs-10',
        label: '10+ jobs done',
        tone: 'accent',
        icon: 'briefcase',
        source: 'completed_jobs'
      });
    } else if (jobs >= 5) {
      badges.push({
        id: 'jobs-5',
        label: '5+ jobs done',
        tone: 'accent',
        icon: 'briefcase',
        source: 'completed_jobs'
      });
    }

    return badges;
  }

  function renderEarnedBadgesHtml(badges) {
    if (!badges || !badges.length) {
      return (
        '<div class="qg-earned-badges is-empty" aria-label="Earned badges">' +
        '<span class="qg-earned-empty">No badges yet — complete jobs and earn reviews to unlock them</span>' +
        '</div>'
      );
    }
    return (
      '<div class="qg-earned-badges" role="list" aria-label="Earned badges">' +
      badges
        .map(function (b) {
          return (
            '<span class="qg-earned-pill tone-' +
            esc(b.tone || 'accent') +
            '" role="listitem">' +
            (b.icon ? ico(b.icon, 12) : '') +
            esc(b.label) +
            '</span>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  /**
   * 3-stat row: Rating / Jobs done / Streak (flame line icon in --attention).
   */
  function renderTrustStatRowHtml(stats) {
    stats = stats || {};
    var jobs = Number(stats.completedCount) || 0;
    var reviews = Number(stats.reviewCount) || 0;
    var isNew = jobs <= 0 && reviews <= 0;
    var hasRating = stats.avgRating != null && reviews > 0;
    var rating = hasRating
      ? (Math.round(Number(stats.avgRating) * 10) / 10).toFixed(1)
      : 'New';

    var streak = stats.jobStreak;
    var hasStreak = streak != null && isFinite(Number(streak)) && Number(streak) > 0;
    var streakVal = hasStreak ? String(Math.round(Number(streak))) : '—';

    var newNote = isNew
      ? '<p class="qg-trust-new-note">New · no reviews yet</p>'
      : (!hasRating && jobs > 0
        ? '<p class="qg-trust-new-note">New · no reviews yet</p>'
        : '');

    return (
      '<div class="qg-trust-stats-block">' +
      '<div class="qg-trust-stats' +
      (isNew ? ' is-new' : '') +
      '" role="group" aria-label="Tasker reputation">' +
      '<div class="qg-trust-stat">' +
      '<div class="qg-trust-stat-val">' +
      (hasRating ? ico('star', 14) : '') +
      esc(rating) +
      '</div>' +
      '<div class="qg-trust-stat-lbl">Rating</div>' +
      '</div>' +
      '<div class="qg-trust-stat">' +
      '<div class="qg-trust-stat-val">' +
      esc(String(jobs)) +
      '</div>' +
      '<div class="qg-trust-stat-lbl">Done</div>' +
      '</div>' +
      '<div class="qg-trust-stat qg-trust-stat-streak' +
      (hasStreak ? ' is-hot' : '') +
      '">' +
      '<div class="qg-trust-stat-val">' +
      '<span class="qg-trust-flame" aria-hidden="true">' +
      ico('flame', 16, 'qg-trust-flame-ico') +
      '</span>' +
      esc(streakVal) +
      '</div>' +
      '<div class="qg-trust-stat-lbl">Streak</div>' +
      '</div>' +
      '</div>' +
      newNote +
      '</div>'
    );
  }

  function payoutConnected(userRow) {
    if (!userRow) return false;
    var guardianOwns = String(userRow.payout_owner || '') === 'guardian';
    if (guardianOwns) {
      return userRow.guardian_stripe_payouts_enabled === true || userRow.guardian_stripe_payouts_enabled === 1;
    }
    return (
      userRow.stripe_payouts_enabled === true ||
      userRow.stripe_payouts_enabled === 1 ||
      userRow.stripe_payouts_enabled === 'true'
    );
  }

  function renderPayoutStatusHtml(userRow, opts) {
    opts = opts || {};
    if (!userRow && !opts.force) return '';
    var ok = payoutConnected(userRow);
    if (ok) {
      return (
        '<div class="qg-payout-status is-connected" role="status">' +
        '<span class="qg-payout-dot" aria-hidden="true"></span>' +
        'Payouts connected · Stripe' +
        '</div>'
      );
    }
    if (opts.ownProfile) {
      return (
        '<div class="qg-payout-status is-prompt" role="status">' +
        '<a class="qg-payout-link" href="#payouts">Connect payouts</a>' +
        '<span class="qg-payout-hint"> to get paid for completed gigs</span>' +
        '</div>'
      );
    }
    return (
      '<div class="qg-payout-status is-pending" role="status">' +
      'Payout setup incomplete' +
      '</div>'
    );
  }

  function renderVerifiedBadgeHtml(isVerified) {
    if (!isVerified) return '';
    if (typeof renderVerifiedBadge === 'function') return renderVerifiedBadge(true);
    return (
      '<span class="qg-verified-badge">' +
      ico('checkCircle', 12) +
      'Verified</span>'
    );
  }

  function avatarInitials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function renderAvatarHtml(name, avatarUrl, className) {
    var cls = className || 'qg-trust-avatar';
    if (typeof renderUserAvatarHtml === 'function') {
      return renderUserAvatarHtml(name, avatarUrl, { className: cls });
    }
    var url = String(avatarUrl || '').trim();
    if (url) {
      return (
        '<div class="' +
        esc(cls) +
        ' has-photo" style="background-image:url(\'' +
        esc(url.replace(/'/g, '%27')) +
        '\')" role="img" aria-label="' +
        esc(name || 'Avatar') +
        '"></div>'
      );
    }
    return (
      '<div class="' +
      esc(cls) +
      '" aria-hidden="true">' +
      esc(avatarInitials(name)) +
      '</div>'
    );
  }

  /**
   * Full trust card — used for poster-facing applicant rows (and optional embeds).
   */
  function renderTrustCardHtml(opts) {
    opts = opts || {};
    var stats = opts.stats || {};
    var verified = !!opts.verified;
    var name = opts.name || 'Someone';
    var title = buildTaskerTitleLine({
      stats: stats,
      verified: verified,
      skills: opts.skills,
      specialty: opts.specialty
    });
    var badges = deriveEarnedBadges(stats, opts.reviews);
    if (opts.maxBadges != null) badges = badges.slice(0, opts.maxBadges);
    var payout = '';
    if (opts.userRow) {
      payout = renderPayoutStatusHtml(opts.userRow, { ownProfile: !!opts.ownProfile });
    }

    return (
      '<div class="qg-trust-card' +
      (opts.compact ? ' is-compact' : '') +
      '">' +
      '<div class="qg-trust-card-head">' +
      renderAvatarHtml(name, opts.avatarUrl, 'qg-trust-avatar') +
      '<div class="qg-trust-card-id">' +
      '<div class="qg-trust-card-name">' +
      esc(name) +
      (verified ? ' ' + renderVerifiedBadgeHtml(true) : '') +
      '</div>' +
      '<div class="qg-trust-card-title">' +
      esc(title) +
      '</div>' +
      '</div>' +
      '</div>' +
      renderTrustStatRowHtml(stats) +
      renderEarnedBadgesHtml(badges) +
      payout +
      '</div>'
    );
  }

  /**
   * Compact trust for poster-facing applicant rows.
   * Parent row already shows avatar + name — embed title, 3-stats, badges.
   */
  function renderApplicantTrustHtml(opts) {
    opts = opts || {};
    var stats = opts.stats || {};
    var verified = !!opts.verified;
    var title = buildTaskerTitleLine({
      stats: stats,
      verified: verified,
      skills: opts.skills,
      specialty: opts.specialty
    });
    var badges = deriveEarnedBadges(stats, opts.reviews).slice(0, opts.maxBadges != null ? opts.maxBadges : 4);
    var payout = '';
    if (opts.userRow) {
      payout = renderPayoutStatusHtml(opts.userRow, { ownProfile: false });
    }

    return (
      '<div class="qg-trust-card is-compact is-embed">' +
      '<div class="qg-trust-card-title qg-trust-embed-title">' +
      esc(title) +
      (verified ? ' ' + renderVerifiedBadgeHtml(true) : '') +
      '</div>' +
      renderTrustStatRowHtml(stats) +
      renderEarnedBadgesHtml(badges) +
      payout +
      '</div>'
    );
  }

  /**
   * Apply reputation-forward chrome on profile.html (own + public view).
   */
  async function mountProfileTrust(targetId, profileData, dbUser, isOwnProfile) {
    var wrap = document.getElementById('trustProfileMount');
    if (!wrap) return null;

    var stats =
      typeof fetchUserTrustStats === 'function'
        ? await fetchUserTrustStats(targetId)
        : {
            completedCount: 0,
            reviewCount: 0,
            avgRating: null,
            completionRate: null,
            responseRate: null,
            jobStreak: null,
            rehireRate: null,
            onTimeRate: null,
            topCategoryLabel: ''
          };

    var reviews = [];
    if (global._profileReputation && Array.isArray(global._profileReputation.reviews)) {
      reviews = global._profileReputation.reviews;
    } else if (typeof getTaskerReputation === 'function') {
      var rep = await getTaskerReputation(targetId);
      reviews = (rep && rep.reviews) || [];
      if (rep && rep.completedJobs != null) stats.completedCount = Number(rep.completedJobs) || stats.completedCount;
      if (rep && rep.avgRating != null) {
        stats.avgRating = rep.avgRating;
        stats.reviewCount = rep.reviewCount || stats.reviewCount;
      }
    }

    if (stats.onTimeRate == null && reviews.length) {
      var tagged = 0;
      var onTime = 0;
      reviews.forEach(function (r) {
        var tags = parseReviewTags(r);
        if (!tags.length) return;
        tagged += 1;
        if (tags.some(function (t) { return /on\s*time/i.test(t); })) onTime += 1;
      });
      if (tagged >= 2) stats.onTimeRate = Math.round((onTime / tagged) * 100);
    }

    var verified = !!(
      dbUser &&
      (dbUser.tasker_verified === true || dbUser.tasker_verified === 'true')
    );
    var title = buildTaskerTitleLine({
      stats: stats,
      verified: verified,
      skills: (profileData && profileData.skills) || []
    });
    var badges = deriveEarnedBadges(stats, reviews);

    var titleEl = document.getElementById('profileTitleLine');
    if (titleEl) {
      titleEl.textContent = title;
      titleEl.hidden = false;
    }

    var verifiedWrap = document.getElementById('verifiedBadgeWrap');
    if (verifiedWrap && verified && !verifiedWrap.querySelector('.qg-verified-badge, .role-verified-pill')) {
      verifiedWrap.innerHTML = renderVerifiedBadgeHtml(true);
    }

    var statsEl = document.getElementById('trustStatRow');
    if (statsEl) statsEl.innerHTML = renderTrustStatRowHtml(stats);

    var badgesEl = document.getElementById('earnedBadges');
    if (badgesEl) badgesEl.innerHTML = renderEarnedBadgesHtml(badges);

    var payoutEl = document.getElementById('payoutStatusLine');
    if (payoutEl) {
      payoutEl.innerHTML = renderPayoutStatusHtml(dbUser, { ownProfile: !!isOwnProfile });
      payoutEl.hidden = !payoutEl.innerHTML;
    }

    var legacy = document.getElementById('trustBadges');
    if (legacy) {
      legacy.innerHTML = '';
      legacy.hidden = true;
    }

    var ratingRow = document.getElementById('ratingRow');
    if (ratingRow) ratingRow.hidden = true;

    return { stats: stats, badges: badges, title: title };
  }

  global.QGTrustProfile = {
    privacyDisplayName: privacyDisplayName,
    buildTaskerTitleLine: buildTaskerTitleLine,
    deriveEarnedBadges: deriveEarnedBadges,
    renderEarnedBadgesHtml: renderEarnedBadgesHtml,
    renderTrustStatRowHtml: renderTrustStatRowHtml,
    renderPayoutStatusHtml: renderPayoutStatusHtml,
    renderTrustCardHtml: renderTrustCardHtml,
    renderApplicantTrustHtml: renderApplicantTrustHtml,
    mountProfileTrust: mountProfileTrust,
    payoutConnected: payoutConnected
  };
  global.privacyDisplayName = privacyDisplayName;
})(window);
