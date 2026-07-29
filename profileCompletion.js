/**
 * profileCompletion.js — single source of truth for the completion meter.
 * Weights sum to 100. Account basics (name+email) are guaranteed at signup,
 * so a real user never sees 0%. The remaining fields are the "encourage" items.
 *
 * Actual users-table columns (do not rename):
 *   name      → users.name
 *   email     → users.email
 *   photo     → users.avatar_url (legacy accept photo_url)
 *   bio       → users.bio
 *   skills    → users.skills TEXT (JSON array or comma-separated) — ANY 1+ skill
 *   pronouns  → users.pronouns
 *   verified  → users.email_verified (and users.verified if present);
 *               also Firebase emailVerified. NOT users.is_verified (worker badge).
 */
(function (global) {
  'use strict';

  /** Field key → real DB column(s) read for that check */
  var FIELD_COLUMNS = {
    name: 'users.name',
    email: 'users.email',
    photo: 'users.avatar_url',
    bio: 'users.bio',
    skills: 'users.skills',
    pronouns: 'users.pronouns',
    verified: 'users.email_verified (alias users.verified; NOT is_verified)'
  };

  var COMPLETION_FIELDS = [
    { key: 'name', weight: 15, column: FIELD_COLUMNS.name, has: function (u) {
      return !!(u.name && String(u.name).trim());
    } },
    { key: 'email', weight: 15, column: FIELD_COLUMNS.email, has: function (u) {
      return !!(u.email && String(u.email).trim());
    } },
    { key: 'photo', weight: 20, column: FIELD_COLUMNS.photo, has: function (u) {
      return !!(u.avatar_url || u.photo_url);
    } },
    { key: 'bio', weight: 20, column: FIELD_COLUMNS.bio, has: function (u) {
      var bio = u.bio ? String(u.bio).trim() : '';
      return !!bio && bio.length >= 20;
    } },
    { key: 'skills', weight: 15, column: FIELD_COLUMNS.skills, has: function (u) {
      // ANY 1+ skill counts — never require 3
      return normalizeSkills(u.skills).length >= 1;
    } },
    { key: 'pronouns', weight: 5, column: FIELD_COLUMNS.pronouns, has: function (u) {
      var p = u.pronouns ? String(u.pronouns).trim() : '';
      return !!p && p.toLowerCase() !== 'prefer not to say';
    } },
    { key: 'verified', weight: 10, column: FIELD_COLUMNS.verified, has: function (u) {
      // users.email_verified / users.verified — NEVER users.is_verified
      return isTruthyFlag(u.verified) || isTruthyFlag(u.email_verified) || isTruthyFlag(u.emailVerified);
    } }
  ];

  function isTruthyFlag(v) {
    return v === true || v === 1 || v === 'true' || v === 't';
  }

  var FIELD_LABELS = {
    photo: 'Add a profile photo',
    bio: 'Write a short bio (20+ characters)',
    skills: 'Add at least one skill',
    pronouns: 'Add your pronouns',
    verified: 'Verify your email',
    name: 'Add your name',
    email: 'Add your email'
  };

  function normalizeSkills(skills) {
    if (Array.isArray(skills)) {
      return skills.map(function (s) { return String(s == null ? '' : s).trim(); }).filter(Boolean);
    }
    var raw = skills == null ? '' : String(skills).trim();
    if (!raw) return [];
    if (raw.charAt(0) === '[') {
      try {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.map(function (s) { return String(s == null ? '' : s).trim(); }).filter(Boolean);
        }
      } catch (e) {}
    }
    return raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  /**
   * Normalize a DB / Firebase / edit-form user into the shape profileCompletion expects.
   */
  function toCompletionUser(src, extras) {
    src = src || {};
    extras = extras || {};
    var photo = extras.avatar_url || extras.photo_url || src.avatar_url || src.photo_url || '';
    if (photo && typeof global.hasProfilePhotoUrl === 'function' && !global.hasProfilePhotoUrl(photo)) {
      photo = '';
    }
    // Prefer users.email_verified / users.verified — ignore is_verified worker badge
    var verified = isTruthyFlag(extras.verified) || isTruthyFlag(extras.emailVerified) ||
      isTruthyFlag(extras.email_verified) ||
      isTruthyFlag(src.verified) || isTruthyFlag(src.email_verified) || isTruthyFlag(src.emailVerified);
    var skills = extras.skills != null ? extras.skills : src.skills;
    return {
      name: extras.name != null ? extras.name : (src.name || ''),
      email: extras.email != null ? extras.email : (src.email || ''),
      avatar_url: photo,
      photo_url: photo,
      bio: extras.bio != null ? extras.bio : (src.bio || ''),
      skills: skills,
      pronouns: extras.pronouns != null ? extras.pronouns : (src.pronouns || ''),
      verified: verified,
      email_verified: verified,
      emailVerified: verified
    };
  }

  function profileCompletion(user) {
    user = user || {};
    var pct = 0;
    var missing = [];
    var fieldLog = {};
    var columnLog = {};
    for (var i = 0; i < COMPLETION_FIELDS.length; i++) {
      var f = COMPLETION_FIELDS[i];
      var ok = false;
      try { ok = !!f.has(user); } catch (e) { ok = false; }
      fieldLog[f.key] = ok;
      columnLog[f.key] = f.column || FIELD_COLUMNS[f.key] || f.key;
      if (ok) pct += f.weight;
      else missing.push({ key: f.key, label: FIELD_LABELS[f.key], weight: f.weight });
    }
    missing.sort(function (a, b) { return b.weight - a.weight; });
    if (typeof console !== 'undefined' && console.log) {
      console.log('[profileCompletion] field true/false + column read:', {
        name: { ok: fieldLog.name, column: columnLog.name, value: user.name || null },
        email: { ok: fieldLog.email, column: columnLog.email, value: user.email || null },
        photo: { ok: fieldLog.photo, column: columnLog.photo, value: user.avatar_url || user.photo_url || null },
        bio: { ok: fieldLog.bio, column: columnLog.bio, len: user.bio ? String(user.bio).trim().length : 0 },
        skills: { ok: fieldLog.skills, column: columnLog.skills, count: normalizeSkills(user.skills).length, value: normalizeSkills(user.skills) },
        pronouns: { ok: fieldLog.pronouns, column: columnLog.pronouns, value: user.pronouns || null },
        verified: { ok: fieldLog.verified, column: columnLog.verified, value: !!(user.verified || user.email_verified || user.emailVerified) }
      });
      console.log('[profileCompletion] →', Math.round(pct) + '%',
        '| columns: name→users.name, email→users.email, photo→users.avatar_url, bio→users.bio, skills→users.skills (1+), pronouns→users.pronouns, verified→users.email_verified');
    }
    return {
      pct: Math.round(pct),
      complete: pct >= 100,
      missing: missing,
      nextSteps: missing.slice(0, 2),
      fields: fieldLog,
      columns: columnLog
    };
  }

  global.COMPLETION_FIELDS = COMPLETION_FIELDS;
  global.FIELD_LABELS = FIELD_LABELS;
  global.FIELD_COLUMNS = FIELD_COLUMNS;
  global.profileCompletion = profileCompletion;
  global.toCompletionUser = toCompletionUser;
  global.normalizeProfileSkills = normalizeSkills;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      profileCompletion: profileCompletion,
      COMPLETION_FIELDS: COMPLETION_FIELDS,
      FIELD_LABELS: FIELD_LABELS,
      FIELD_COLUMNS: FIELD_COLUMNS,
      toCompletionUser: toCompletionUser
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
