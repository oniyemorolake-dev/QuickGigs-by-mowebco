// Server-side port of analyzeOffPlatformContact from qg-utils.js.
//
// The client copy stays where it is and remains the UX layer: it gives instant
// feedback and a friendly warning. This module is the ENFORCEMENT layer — the
// client version is advisory only, because a crafted request never runs it.
//
// Keep the two in sync. The regexes, the normalisation steps and the decision
// order below are transcribed verbatim from qg-utils.js (lines ~460-680) so the
// two implementations agree on what counts as a violation. If you change one,
// change the other, or users will be blocked by the server after the client
// told them the message was fine.
//
// The one intentional difference: the client's sliding window is an in-memory
// buffer (`_fraudBuffers`), which a fresh request cannot see. Here the caller
// passes recent message bodies read back from the database instead, which is
// both authoritative and survives a page reload.

export const FRAUD_WINDOW_MAX = 6;
export const FRAUD_WINDOW_MS = 5 * 60 * 1000;

const FRAUD_PATTERNS: RegExp[] = [
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/,
  /\b\(\d{3}\)\s?\d{3}[-.\s]?\d{4}\b/,
  /\b\d{10,15}\b/,
  /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/,
  /\+\d[\d\s\-]{8,}/,
  /\b(?:instagram|insta|\big\b|snapchat|snap|telegram|tgm|\btg\b|whatsapp|\bwa\b|tiktok|wa\.me|tele\.gram|insta\.gram|facebook|fb\.com|discord|signal(?:\s+app)?|viber)\b/i,
  /\b(?:call\s+me|text\s+me|snap\s+me|dm\s+me|message\s+me\s+on|add\s+me\s+on)\b/i,
  /\b(?:venmo|cash\s?app|e[\-\s]?transfer|interac|paypal|zelle|etransfer)\b/i,
  /\b(?:my\s+number|reach\s+me\s+at|contact\s+me\s+at|my\s+email)\b/i,
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine)(?:\s*[- ]\s*(?:zero|one|two|three|four|five|six|seven|eight|nine)){3,}\b/i,
  /@[a-zA-Z0-9._]{3,}/,
  /\b(?:https?:\/\/|www\.)\S+/i,
  // Dotted obfuscation (e.g. tgm.rlk) — not a real public TLD URL
  /\b(?!www\b)[a-z]{2,8}\.(?!com|org|net|edu|gov|ca|io|co|me|app|dev|uk|us|info|biz|html?|js|css)[a-z]{2,8}\b/i,
];

const FRAUD_PHONE_RE = /\d{10,15}/;
const FRAUD_EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;

export type FraudVerdict = {
  blocked: boolean;
  softWarn?: boolean;
  reason?: string;
  message?: string;
};

export function offPlatformWarning(): string {
  return 'Sharing contact details is against SwiftGigs rules — keep chat and payment on SwiftGigs';
}

export function digitsOnlyWarning(): string {
  return 'Heads up: sending numbers in pieces can look like a phone number. Keep contact details off chat.';
}

function digitsOnly(str: unknown): string {
  return String(str ?? '').replace(/\D/g, '');
}

/** Lowercase, strip money/images/urls noise, O→0 beside digits, spoken email → @/. */
export function normalizeFraudText(text: unknown): string {
  let s = String(text ?? '').toLowerCase();
  s = s.replace(/\[img\][^\s]*/g, ' ');
  s = s.replace(/https?:\/\/\S+/gi, ' ');
  s = s.replace(/\$\d+(?:\.\d{1,2})?/g, ' ');
  // O/o as zero only when adjacent to a digit (avoids wrecking "for"/"hours")
  s = s.replace(/(\d)[o]/g, '$10');
  s = s.replace(/[o](\d)/g, '0$1');
  // Spoken email only — do NOT rewrite every " at ".
  s = s.replace(
    /\b([a-z0-9._%+\-]+)\s+at\s+([a-z0-9.\-]+)\s+dot\s+([a-z]{2,})\b/g,
    '$1@$2.$3',
  );
  s = s.replace(
    /\b([a-z0-9._%+\-]+)\s+at\s+(gmail|yahoo|hotmail|outlook|icloud|protonmail|live|aol)\b/g,
    '$1@$2',
  );
  s = s.replace(/\s*\(\s*at\s*\)\s*/g, '@');
  return s.trim();
}

/** True when text is essentially a phone / digit blob, not prose mentioning years. */
function isDigitHeavyContactSoup(text: unknown): boolean {
  const raw = String(text ?? '').trim();
  if (!raw) return false;
  const digits = digitsOnly(raw);
  if (digits.length < 7 || digits.length > 15) return false;
  const stripped = raw.replace(/[\s\-().+]/g, '');
  if (/^\d{7,15}$/.test(stripped)) return true;
  const compactLen = raw.replace(/\s/g, '').length || 1;
  return (digits.length / compactLen) >= 0.7;
}

function stripSpacePunct(text: unknown): string {
  return String(text ?? '').replace(/[^a-zA-Z0-9@.+-]/g, '');
}

function isPureDigitChunk(text: unknown): boolean {
  const val = normalizeFraudText(text).replace(/[\s\-().]/g, '');
  return /^\d{2,6}$/.test(val);
}

function hardBlock(reason: string): FraudVerdict {
  return { blocked: true, softWarn: false, reason, message: offPlatformWarning() };
}

/**
 * Analyse `text` against a sliding window of the sender's recent messages,
 * COMBINED — so a phone number split across several messages reassembles.
 *
 * @param text       the incoming message body
 * @param recentText the sender's recent bodies in this conversation, oldest
 *                   first, already limited to the 5-minute window by the caller
 */
export function analyzeOffPlatformContact(
  text: unknown,
  recentTexts: string[] = [],
): FraudVerdict {
  if (!text) return { blocked: false };

  const val = normalizeFraudText(String(text).trim());
  if (!val) return { blocked: false };

  const windowTexts = (recentTexts || [])
    .slice(-FRAUD_WINDOW_MAX)
    .map((t) => normalizeFraudText(String(t ?? '')))
    .filter(Boolean);

  const combinedRaw = windowTexts.concat([val]).join(' ');
  const compact = stripSpacePunct(combinedRaw);
  const allDigits = digitsOnly(combinedRaw);

  // Concatenated short digit-only messages → phone
  const digitTrail = windowTexts
    .concat([val])
    .filter((t) => isPureDigitChunk(t))
    .map((t) => digitsOnly(t))
    .join('');
  if (digitTrail.length >= 10 && FRAUD_PHONE_RE.test(digitTrail)) {
    return hardBlock('split_phone');
  }

  // Spaced / separator phones — only when the window is digit-heavy
  if (isDigitHeavyContactSoup(combinedRaw) && FRAUD_PHONE_RE.test(allDigits)) {
    return hardBlock('phone');
  }
  // Contiguous phone-like run in the current message
  if (/(?:\d[\s\-().+]*){9,14}\d/.test(val)) {
    return hardBlock('phone');
  }

  if (FRAUD_EMAIL_RE.test(compact) || FRAUD_EMAIL_RE.test(val)) {
    return hardBlock('email');
  }

  // Current message hard patterns (handles, apps, links, spoken contact)
  if (FRAUD_PATTERNS.some((p) => p.test(val))) {
    return hardBlock('pattern');
  }

  // Patterns across the combined window (split "dm" + "me", etc.)
  if (FRAUD_PATTERNS.some((p) => p.test(compact) || p.test(combinedRaw))) {
    return hardBlock('split_pattern');
  }

  // Lone 7–15 digit blob in one message
  if (isDigitHeavyContactSoup(val)) {
    return hardBlock('digits');
  }

  // Soft-warn: short digit-only fragment (possible split) — allowed, but logged
  if (isPureDigitChunk(val)) {
    return {
      blocked: false,
      softWarn: true,
      reason: 'digit_fragment',
      message: digitsOnlyWarning(),
    };
  }

  return { blocked: false };
}

// Written as escapes on purpose: QG_SYS_PREFIX is U+27E6 'QG' U+27E7 (⟦QG⟧) and
// gets mangled by any tool that touches this file in a non-UTF-8 codepage.
// Source: QG_SYS_PREFIX in qg-chat-realtime.js, CHAT_IMAGE_PREFIX in supabase-db.js.
const QG_SYS_PREFIX = '\u27E6QG\u27E7';
const CHAT_IMAGE_PREFIX = '[img]';

/**
 * Mirrors the isSystemChatBody / isChatImageBody exemptions in sendChatMessage.
 * System notices and image attachments skip the contact filter on the client, so
 * they must skip it here too or normal flows start failing.
 *
 * Note the sender cannot forge these: a client-supplied body beginning with the
 * system prefix is rejected separately below, and image bodies are validated
 * against the storage-path allowlist.
 */
export function isExemptBody(body: string): boolean {
  const b = String(body ?? '');
  return b.startsWith(QG_SYS_PREFIX) || b.startsWith(CHAT_IMAGE_PREFIX);
}

/** True when a client is trying to pass its message off as a system notice. */
export function isForgedSystemBody(body: string): boolean {
  return String(body ?? '').startsWith(QG_SYS_PREFIX);
}
