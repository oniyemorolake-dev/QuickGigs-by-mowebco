/**
 * QuickGigs — Tasker trust profile + earned badges (tokens only).
 * Only surfaces stats/badges that can be computed from real data.
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
    var initial = last.charAt(0).toUpperCase();
    return first + ' ' + initial + '.';
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

  function buildTaskerTitleLine(opts) {
    opts = opts || {};
    var stats = opts.stats || {};
    var verified = !!opts.verified;
    var jobs = Number(stats.completedCount) || 0;
    var rating = stats.avgRating != null ? Number(stats.avgRating) : null;
    var reviews = Number(stats.reviewCount) || 0;
    var specialty = primarySpecialty(opts.skills);

    var rank = 'New Tasker';
    if (jobs <= 0 && reviews <= 0) rank = 'New Tasker';
    else if (verified && rating != null && rating >= 4.5 && jobs >= 5) rank = 'Top Tasker';
    else if (jobs >= 1 || reviews >= 1) rank = 'Tasker';

    if (specialty) return rank + ' · ' + specialty + ' specialist';
    return rank;
  }

  function parseReviewTags(review) {
    var tags = review && (review.tags || review.TAGS);
    if (!tags) return [];
    if (Array.isArray(tags)) return tags.map(function (t) { return String(t); });
    return String(tags).split(',').map(function (t) { return t.trim(); }).filter(Boolean);
  }

  /**
   * Earned badges from real metrics / review tags only.
   * Not shown (no data): streak, response time, true rehire %.
   */
  function deriveEarnedBadges(stats, reviews) {
    stats = stats || {};
    reviews = Array.isArray(reviews) ? reviews : [];
    var badges = [];
    var jobs = Number(stats.completedCount) || 0;
    var rating = stats.avgRating != null ? Number(stats.avgRating) : null;
    var reviewCount = Number(stats.reviewCount) || reviews.length || 0;
    var responseRate = stats.responseRate;
    var completionRate = stats.completionRate;

    if (responseRate != null && responseRate >= 70 && (jobs >= 1 || reviewCount >= 1)) {
      badges.push({
        id: 'fast-responder',
        label: 'Fast responder',
        tone: 'accent',
        source: 'response_rate'
      });
    }
    if (completionRate != null && completionRate >= 80 && jobs >= 3) {
      badges.push({
        id: 'reliable-closer',
        label: 'Reliable closer',
        tone: 'accent',
        source: 'completion_rate'
      });
    }
    if (rating != null && rating >= 4.8 && reviewCount >= 3) {
      badges.push({
        id: 'top-rated',
        label: 'Top rated',
        tone: 'accent',
        source: 'avg_rating'
      });
    }

    var tagged = 0;
    var onTime = 0;
    var hireAgain = 0;
    reviews.forEach(function (r) {
      var tags = parseReviewTags(r);
      if (!tags.length) return;
      tagged += 1;
      tags.forEach(function (t) {
        if (/on\s*time/i.test(t)) onTime += 1;
        if (/hire again|would hire/i.test(t)) hireAgain += 1;
      });
    });
    if (tagged >= 2 && onTime / tagged >= 0.5) {
      badges.push({
        id: 'on-time',
        label: 'Always on time',
        tone: 'attention',
        source: 'review_tags'
      });
    }
    if (tagged >= 2 && hireAgain / tagged >= 0.5) {
      badges.push({
        id: 'hire-again',
        label: 'Would hire again',
        tone: 'accent',
        source: 'review_tags'
      });
    }

    if (jobs >= 10) {
      badges.push({ id: 'jobs-10', label: '10+ jobs done', tone: 'accent', source: 'completed_jobs' });
    } else if (jobs >= 5) {
      badges.push({ id: 'jobs-5', label: '5+ jobs done', tone: 'accent', source: 'completed_jobs' });
    }

    return badges;
  }

  function renderEarnedBadgesHtml(badges) {
    if (!badges || !badges.length) {
      return '<div class="qg-earned-badges is-empty" aria-label="Earned badges"><span class="qg-earned-empty">Badges unlock as you complete jobs and earn reviews</span></div>';
    }
    return (
      '<div class="qg-earned-badges" role="list" aria-label="Earned badges">' +
      badges
        .map(function (b) {
          return (
            '<span class="qg-earned-pill tone-' +
            esc(b.tone || 'accent') +
            '" role="listitem">' +
            esc(b.label) +
            '</span>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function renderTrustStatRowHtml(stats) {
    stats = stats || {};
    var rating =
      stats.avgRating != null && (stats.reviewCount || 0) > 0
        ? (Math.round(Number(stats.avgRating) * 10) / 10).toFixed(1)
        : 'New';
    var jobs = String(Number(stats.completedCount) || 0);
    // Streak is not server-backed — use completion % when available, else reviews.
    var thirdLabel = 'Completion';
    var thirdValue = '—';
    var thirdTone = '';
    if (stats.completionRate != null && (stats.completedCount || 0) > 0) {
      thirdValue = String(stats.completionRate) + '%';
      thirdTone = stats.completionRate >= 80 ? ' is-hot' : '';
    } else if ((stats.reviewCount || 0) > 0) {
      thirdLabel = 'Reviews';
      thirdValue = String(stats.reviewCount);
    }

    return (
      '<div class="qg-trust-stats" role="group" aria-label="Tasker reputation">' +
      '<div class="qg-trust-stat"><div class="qg-trust-stat-val">' +
      esc(rating) +
      '</div><div class="qg-trust-stat-lbl">Rating</div></div>' +
      '<div class="qg-trust-stat"><div class="qg-trust-stat-val">' +
      esc(jobs) +
      '</div><div class="qg-trust-stat-lbl">Jobs done</div></div>' +
      '<div class="qg-trust-stat' +
      thirdTone +
      '"><div class="qg-trust-stat-val">' +
      esc(thirdValue) +
      '</div><div class="qg-trust-stat-lbl">' +
      esc(thirdLabel) +
      '</div></div>' +
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
    return '<span class="qg-verified-badge">Verified</span>';
  }

  /**
   * Compact trust strip for poster-facing applicant rows.
   */
  function renderApplicantTrustHtml(opts) {
    opts = opts || {};
    var stats = opts.stats || {};
    var verified = !!opts.verified;
    var name = privacyDisplayName(opts.name);
    var title = buildTaskerTitleLine({
      stats: stats,
      verified: verified,
      skills: opts.skills
    });
    var rating =
      stats.avgRating != null && (stats.reviewCount || 0) > 0
        ? (Math.round(Number(stats.avgRating) * 10) / 10).toFixed(1)
        : 'New';
    var jobs = Number(stats.completedCount) || 0;
    var badges = deriveEarnedBadges(stats, opts.reviews).slice(0, 3);
    var payout = '';
    if (opts.userRow) payout = renderPayoutStatusHtml(opts.userRow, { ownProfile: false });

    return (
      '<div class="qg-applicant-trust">' +
      '<div class="qg-applicant-trust-title">' +
      esc(title) +
      (verified ? ' ' + renderVerifiedBadgeHtml(true) : '') +
      '</div>' +
      '<div class="qg-applicant-trust-meta">' +
      '<span class="qg-applicant-rating">' +
      esc(rating) +
      '</span>' +
      '<span class="qg-applicant-jobs">' +
      esc(String(jobs)) +
      ' job' +
      (jobs === 1 ? '' : 's') +
      '</span>' +
      '</div>' +
      (badges.length
        ? '<div class="qg-applicant-badges">' +
          badges
            .map(function (b) {
              return '<span class="qg-earned-pill tone-' + esc(b.tone) + '">' + esc(b.label) + '</span>';
            })
            .join('') +
          '</div>'
        : '') +
      payout +
      '</div>'
    );
  }

  /**
   * Apply reputation-forward chrome on profile.html.
   */
  async function mountProfileTrust(targetId, profileData, dbUser, isOwnProfile) {
    var wrap = document.getElementById('trustProfileMount');
    if (!wrap) return null;

    var stats =
      typeof fetchUserTrustStats === 'function'
        ? await fetchUserTrustStats(targetId)
        : { completedCount: 0, reviewCount: 0, avgRating: null };

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
    if (verifiedWrap && verified && !verifiedWrap.innerHTML.trim()) {
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

    // Keep legacy trustBadges for completion/response chips, but hide duplicates when earned pills exist.
    var legacy = document.getElementById('trustBadges');
    if (legacy && typeof renderTrustBadges === 'function') {
      legacy.innerHTML = renderTrustBadges(stats, { hideCompleted: true });
    }

    return { stats: stats, badges: badges, title: title };
  }

  global.QGTrustProfile = {
    privacyDisplayName: privacyDisplayName,
    buildTaskerTitleLine: buildTaskerTitleLine,
    deriveEarnedBadges: deriveEarnedBadges,
    renderEarnedBadgesHtml: renderEarnedBadgesHtml,
    renderTrustStatRowHtml: renderTrustStatRowHtml,
    renderPayoutStatusHtml: renderPayoutStatusHtml,
    renderApplicantTrustHtml: renderApplicantTrustHtml,
    mountProfileTrust: mountProfileTrust,
    payoutConnected: payoutConnected
  };
  global.privacyDisplayName = privacyDisplayName;
})(window);
