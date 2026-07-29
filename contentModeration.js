/**
 * contentModeration.js — text safety layer (client first-pass).
 * Runs alongside the contact-info / fraud filter.
 *
 * FIRST-PASS HEURISTIC ONLY — not a verdict.
 * Authoritative moderation runs server-side + via a moderation API later.
 * Serious hits are blocked client-side and logged to the admin moderation queue.
 *
 * Keep ALL keyword / pattern lists in THIS file so they stay easy to expand.
 * Do not rename DB fields (reports.reason / reports.detail / reports.target_type).
 */
(function (global) {
  'use strict';

  // ══════════════════════════════════════════════════════════════
  // EDITABLE LISTS — expand here only
  // Matched against NORMALIZED text (see normalizeForModeration).
  // ══════════════════════════════════════════════════════════════

  /**
   * Common profanity / slurs (whole-token style after normalize).
   * Add plain lowercase spellings; leetspeak/spacing is handled by normalize.
   */
  var PROFANITY_WORDS = [
    'fuck', 'fucker', 'fucking', 'motherfucker', 'fck', 'fuk',
    'shit', 'sht', 'bullshit', 'asshole',
    'bitch', 'btch', 'bastard', 'cunt', 'dickhead', 'cock', 'pussy', 'whore', 'slut',
    'faggot', 'fag', 'nigger', 'nigga', 'retard', 'retarded', 'twat', 'wanker',
    'douche', 'douchebag', 'jackass', 'dumbass', 'piss off'
  ];

  /** Physical / violent threats, stalking, intimidation */
  var THREAT_PATTERNS = [
    /\b(kill(ed|ing)? you|i( will|ll) (kill|hurt|find|hunt|stab|shoot)|hurt you|rape|assault|beat you|watch your back|i know where you (live|work)|stab( you)?|shoot you|murder you|strangle|break your (legs|neck|face)|come after you|you( will|ll) regret)\b/i
  ];

  /** Sexual / adult content (not appropriate for QuickGigs tasks) */
  var SEXUAL_PATTERNS = [
    /\b(sex(ual)?|nude|nudes|naked|escort|hook ?up|hookup|sugar ?(baby|daddy)|xxx|only ?fans|onlyfans|explicit|sexual favor|send (nudes|pics)|dick pic|porn|erotic|intimate (services|massage)|cam ?girl|cam ?boy)\b/i
  ];

  /** Solicitation of adult / sexual services under a gig listing */
  var SOLICIT_PATTERNS = [
    /\b((happy ending|full service).{0,24}massage|massage.{0,24}(happy ending|full service)|adult (services|entertainment|work)|companionship for|paid (companionship|dating)|outcall|incall|\bfs\b|\bgfe\b|sensual massage|erotic massage)\b/i
  ];

  // ══════════════════════════════════════════════════════════════

  var USER_MESSAGE =
    "This contains language that isn't allowed on QuickGigs — please edit and try again";

  /**
   * Normalize before matching so obvious evasions are still caught:
   * lowercase, @→a, 0→o, !→i, 3→e, 4→a, 5→s, $→s, 7→t.
   * Collapses "f u c k" / "f*u*c*k" / "sh!t" without gluing normal words.
   */
  function normalizeForModeration(text) {
    var s = String(text == null ? '' : text).toLowerCase();
    s = s
      .replace(/@/g, 'a')
      .replace(/\$/g, 's')
      .replace(/0/g, 'o')
      .replace(/3/g, 'e')
      .replace(/4/g, 'a')
      .replace(/5/g, 's')
      .replace(/7/g, 't')
      .replace(/!/g, 'i')
      .replace(/\|/g, 'i');
    // Strip punctuation glued inside a word: f*ck, f.u.c.k, a$$hole
    var prev;
    do {
      prev = s;
      s = s.replace(/([a-z])[._\-*/\\+]+([a-z])/g, '$1$2');
    } while (s !== prev);
    // Spaced-out single letters only: "f u c k" (2+ spaces between singles)
    s = s.replace(/(^|[^a-z])([a-z](?:\s+[a-z]){2,})(?=[^a-z]|$)/g, function (_, lead, body) {
      return lead + body.replace(/\s+/g, '');
    });
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function buildProfanityRegex() {
    var parts = PROFANITY_WORDS.map(function (w) {
      return escapeRegExp(String(w).toLowerCase().trim()).replace(/\s+/g, '\\s+');
    }).filter(Boolean);
    if (!parts.length) return null;
    return new RegExp('(?:^|[^a-z])(?:' + parts.join('|') + ')(?=[^a-z]|$)', 'i');
  }

  var PROFANITY_RE = buildProfanityRegex();

  function testAny(patterns, text) {
    for (var i = 0; i < patterns.length; i++) {
      if (patterns[i].test(text)) return true;
    }
    return false;
  }

  /**
   * @param {string} text
   * @returns {{ blocked: boolean, flags: Array<{type:string,severity:string}>, message?: string, normalized?: string }}
   */
  function moderateText(text) {
    var raw = String(text == null ? '' : text);
    if (!raw.trim()) return { blocked: false, flags: [] };

    var norm = normalizeForModeration(raw);
    var flags = [];

    // FIRST-PASS HEURISTIC — authoritative checks run server-side + moderation API later.
    if (PROFANITY_RE && PROFANITY_RE.test(norm)) {
      flags.push({ type: 'profanity', severity: 'medium' });
    }
    if (testAny(THREAT_PATTERNS, norm) || testAny(THREAT_PATTERNS, raw)) {
      flags.push({ type: 'threat', severity: 'high' });
    }
    if (testAny(SEXUAL_PATTERNS, norm) || testAny(SEXUAL_PATTERNS, raw)) {
      flags.push({ type: 'sexual', severity: 'high' });
    }
    if (testAny(SOLICIT_PATTERNS, norm) || testAny(SOLICIT_PATTERNS, raw)) {
      flags.push({ type: 'solicitation', severity: 'high' });
    }

    if (!flags.length) return { blocked: false, flags: [], normalized: norm };
    return {
      blocked: true,
      flags: flags,
      message: USER_MESSAGE,
      normalized: norm
    };
  }

  /**
   * Map free-form source → reports.target_type CHECK ('task'|'user').
   * Flag types live in reports.detail (not reports.reason — CHECK enum).
   */
  function mapReportTarget(detail) {
    var source = String((detail && (detail.source || detail.targetType)) || '').toLowerCase();
    if (source === 'task' || source === 'task_post') {
      return { target_type: 'task', target_id: String(detail.targetId || 'post_attempt') };
    }
    var uid = (detail && detail.userId) ||
      (global._currentUser && global._currentUser.uid) ||
      'anonymous';
    return { target_type: 'user', target_id: String(detail.targetId || uid) };
  }

  /**
   * Log a blocked attempt to the admin moderation queue.
   * Uses reports.reason = 'inappropriate' (schema CHECK) and puts flag types in detail.
   */
  function logModerationAttempt(detail) {
    detail = detail || {};
    var flags = Array.isArray(detail.flags) ? detail.flags : [];
    var flagTypes = flags.map(function (f) { return f && f.type; }).filter(Boolean);
    var preview = String(detail.preview || '').slice(0, 120);
    var userId = detail.userId ||
      (global._currentUser && global._currentUser.uid) ||
      'anonymous';
    var mapped = mapReportTarget(detail);
    var reason = 'inappropriate';
    var payloadDetail = {
      content_moderation: true,
      source: detail.source || detail.targetType || 'content',
      flags: flagTypes,
      flag_details: flags,
      field: detail.field || '',
      preview: preview,
      user_id: userId,
      body: 'content_moderation' +
        (flagTypes.length ? ':' + flagTypes.join(',') : '') +
        (detail.field ? ' · field=' + detail.field : '') +
        (preview ? ' · ' + preview : '')
    };

    try {
      if (typeof sbPost === 'function') {
        var reportRow = {
          reporter_id: userId,
          target_type: mapped.target_type,
          target_id: mapped.target_id,
          reason: reason,
          detail: JSON.stringify(payloadDetail),
          status: 'open',
          created_at: new Date().toISOString()
        };
        sbPost('reports', reportRow).catch(function () {
          var alt = Object.assign({}, reportRow);
          alt.details = alt.detail;
          delete alt.detail;
          return sbPost('reports', alt).catch(function () {});
        });

        sbPost('admin_actions', {
          admin_email: 'system@quickgigs',
          action_type: 'content_moderation_block',
          target_type: mapped.target_type,
          target_id: mapped.target_id,
          detail: payloadDetail
        }).catch(function () {});
      }
    } catch (e) { /* non-blocking */ }

    try {
      var key = 'qg-moderation-queue';
      var list = [];
      try { list = JSON.parse(localStorage.getItem(key) || '[]') || []; } catch (e2) { list = []; }
      list.unshift({
        at: new Date().toISOString(),
        reason: 'content_moderation' + (flagTypes.length ? ':' + flagTypes.join(',') : ''),
        flags: flagTypes,
        source: detail.source || mapped.target_type,
        field: detail.field || '',
        user_id: userId,
        target_id: mapped.target_id,
        preview: preview
      });
      localStorage.setItem(key, JSON.stringify(list.slice(0, 100)));
    } catch (e3) { /* non-blocking */ }
  }

  /** Convenience: moderate + log if blocked. */
  function moderateAndLog(text, meta) {
    var result = moderateText(text);
    if (result.blocked) {
      logModerationAttempt(Object.assign({
        flags: result.flags,
        preview: text,
        message: result.message
      }, meta || {}));
    }
    return result;
  }

  global.moderateText = moderateText;
  global.normalizeForModeration = normalizeForModeration;
  global.logModerationAttempt = logModerationAttempt;
  global.moderateAndLog = moderateAndLog;
  global.QG_CONTENT_MOD_MESSAGE = USER_MESSAGE;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      moderateText: moderateText,
      normalizeForModeration: normalizeForModeration,
      logModerationAttempt: logModerationAttempt,
      moderateAndLog: moderateAndLog,
      USER_MESSAGE: USER_MESSAGE,
      PROFANITY_WORDS: PROFANITY_WORDS
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
