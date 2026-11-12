// SwiftGigs — confirm an account's email with a 6-digit code.
// Deploy: supabase functions deploy email-code --no-verify-jwt
// Secrets: RESEND_API_KEY, FROM_EMAIL (SUPABASE_URL / SERVICE_ROLE_KEY are automatic)
//
// Actions (POST, Firebase ID token in Authorization):
//   send_email_code     emails a code to the signed-in account's address
//   confirm_email_code  { code } marks users.email_verified and recomputes
//                       tasker_verified
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authErrorStatus, requireFirebaseUser } from '../_shared/firebase-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// ── Email confirmation by 6-digit code ──────────────────────────────────────
// Firebase's own confirmation emails were not reaching inboxes (its SMTP relay
// to Resend never delivered), so the code is generated and emailed here,
// through the same Resend account every other SwiftGigs email uses.
//
// Stateless: the code is an HMAC of (uid, email, 30-minute window) keyed with
// the service-role key, so nothing is stored. A code is accepted for the
// window it was issued in and the next one (30 to 60 minutes). Guessing is
// held off by the per-user attempt limit in confirm_email_code.
const EMAIL_CODE_WINDOW_MS = 30 * 60 * 1000;

async function emailCode(uid: string, email: string, windowIndex: number): Promise<string> {
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!secret) throw new Error('email_code_secret_missing');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const msg = `email-code:${uid}:${email.toLowerCase()}:${windowIndex}`;
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
  const n = ((sig[0] << 24) | (sig[1] << 16) | (sig[2] << 8) | sig[3]) >>> 0;
  return String(n % 1000000).padStart(6, '0');
}

/** Atomic per-user counter in Postgres. Returns false when over the limit. */
async function underLimit(
  supabase: ReturnType<typeof createClient>,
  uid: string,
  action: string,
  limit: number,
  windowSeconds: number,
  failOpen: boolean,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('qg_rate_limit_hit', {
    p_uid: uid,
    p_action: action,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error(`rate_limit_unavailable action=${action}:`, error.message);
    return failOpen;
  }
  return (data as Record<string, unknown> | null)?.allowed === true;
}

async function sendCodeEmail(to: string, code: string) {
  const resendKey = Deno.env.get('RESEND_API_KEY') || '';
  if (!resendKey) throw new Error('resend_not_configured');
  const from = Deno.env.get('FROM_EMAIL') || 'SwiftGigs <notify@quickgigs.ca>';
  const text = [
    `Your SwiftGigs confirmation code is ${code}`,
    '',
    'Enter it in the app to confirm your email. It expires in 30 minutes.',
    '',
    "If you didn't ask for this, you can ignore this email.",
  ].join('\n');
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:440px;margin:0 auto;padding:24px;color:#1b1726">' +
    '<p style="font-size:16px;margin:0 0 12px">Your SwiftGigs confirmation code</p>' +
    `<p style="font-size:34px;font-weight:700;letter-spacing:6px;margin:0 0 16px">${code}</p>` +
    '<p style="font-size:14px;color:#555;margin:0 0 8px">Enter it in the app to confirm your email. It expires in 30 minutes.</p>' +
    '<p style="font-size:12px;color:#888;margin:0">If you didn\'t ask for this, you can ignore this email.</p>' +
    '</div>';
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ from, to: [to], subject: `${code} is your SwiftGigs code`, text, html }),
  });
  if (!response.ok) throw new Error(`code_email_failed:${response.status}:${await response.text()}`);
}

type UserRow = Record<string, unknown> | null;

async function loadUser(supabase: ReturnType<typeof createClient>, uid: string): Promise<UserRow> {
  const { data, error } = await supabase
    .from('users')
    .select('firebase_uid,email,status,account_status,email_verified,email_verified_at,tasker_verified,tasker_verification_status')
    .eq('firebase_uid', uid)
    .maybeSingle();
  if (error) throw error;
  return data as UserRow;
}

function publicStatus(user: Record<string, unknown>) {
  return {
    email_verified: user.email_verified === true,
    email_verified_at: user.email_verified_at || null,
    tasker_verified: user.tasker_verified === true,
    tasker_verification_status: String(user.tasker_verification_status || 'unverified'),
  };
}

/** Same rule role-verification applies; the RPC owns the logic. */
async function recomputeTasker(supabase: ReturnType<typeof createClient>, uid: string) {
  const { error } = await supabase.rpc('qg_recompute_tasker_verified', { p_uid: uid });
  if (error) console.error('qg_recompute_tasker_verified failed:', error.message);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  let identity;
  try {
    identity = await requireFirebaseUser(req);
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'unauthorized' }, authErrorStatus(err));
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    );
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '').toLowerCase();
    let user = await loadUser(supabase, identity.uid);
    if (!user) return json({ ok: false, error: 'user_not_found' }, 404);
    if (
      user.account_status === 'blocked' ||
      ['banned', 'blocked', 'suspended'].includes(String(user.status || '').toLowerCase())
    ) return json({ ok: false, error: 'account_blocked' }, 403);

    if (action === 'send_email_code') {
      if (user.email_verified === true) {
        await recomputeTasker(supabase, identity.uid);
        user = await loadUser(supabase, identity.uid);
        return json({ ok: true, already: true, ...publicStatus(user || {}) });
      }
      // The address on the signed-in Firebase account; the code proves they can read it.
      const email = String(identity.email || user.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ ok: false, error: 'no_email_on_account', message: 'This account has no email address.' }, 400);
      }
      if (!await underLimit(supabase, identity.uid, 'send_email_code', 5, 3600, true)) {
        return json({
          ok: false,
          error: 'too_many_requests',
          message: 'Too many codes requested. Use the last one we sent, or try again in an hour.',
        }, 429);
      }
      const code = await emailCode(identity.uid, email, Math.floor(Date.now() / EMAIL_CODE_WINDOW_MS));
      try {
        await sendCodeEmail(email, code);
      } catch (mailErr) {
        console.error('send_email_code failed:', mailErr);
        return json({
          ok: false,
          error: 'email_send_failed',
          message: 'We could not send the code just now. Please try again in a minute.',
        }, 502);
      }
      return json({ ok: true, sent: true, email });
    }

    if (action === 'confirm_email_code') {
      if (user.email_verified === true) {
        await recomputeTasker(supabase, identity.uid);
        user = await loadUser(supabase, identity.uid);
        return json({ ok: true, already: true, ...publicStatus(user || {}) });
      }
      // Fail closed: without the attempt counter a 6-digit code could be guessed.
      if (!await underLimit(supabase, identity.uid, 'confirm_email_code', 8, 3600, false)) {
        return json({
          ok: false,
          error: 'too_many_attempts',
          message: 'Too many tries. Wait an hour, then request a new code.',
        }, 429);
      }
      const given = String(body.code || '').replace(/\D/g, '');
      const email = String(identity.email || user.email || '').trim().toLowerCase();
      if (given.length !== 6 || !email) {
        return json({ ok: false, error: 'invalid_code', message: 'Enter the 6-digit code from the email.' }, 400);
      }
      const w = Math.floor(Date.now() / EMAIL_CODE_WINDOW_MS);
      const valid = [await emailCode(identity.uid, email, w), await emailCode(identity.uid, email, w - 1)];
      if (!valid.includes(given)) {
        return json({
          ok: false,
          error: 'wrong_code',
          message: 'That code is not right, or it has expired. Check the latest email or send a new code.',
        }, 400);
      }
      const now = new Date().toISOString();
      const { error } = await supabase.from('users').update({
        email_verified: true,
        email_verified_at: now,
      }).eq('firebase_uid', identity.uid);
      if (error) throw error;
      await recomputeTasker(supabase, identity.uid);
      user = await loadUser(supabase, identity.uid);
      return json({ ok: true, confirmed: true, ...publicStatus(user || {}) });
    }

    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (err) {
    console.error('email-code error:', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
