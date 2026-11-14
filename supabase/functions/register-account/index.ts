import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authErrorStatus, requireFirebaseUser } from '../_shared/firebase-auth.ts';
import { hashToken, signGuardianToken } from '../_shared/guardian-token.ts';

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

function ageOn(dateOfBirth: string): number {
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return -1;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/** Same inbox, different spelling: lower-case, drop "+tag", and for Gmail
 *  drop dots, so teen+mum@gmail.com and t.e.e.n@gmail.com count as teen@gmail.com. */
function inboxKey(email: string): string {
  const e = String(email || '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return e;
  let local = e.slice(0, at).split('+')[0];
  let domain = e.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return local + '@' + domain;
}
function phoneKey(phone: string): string {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

async function sendGuardianEmail(email: string, teenName: string, consentUrl: string) {
  const resendKey = Deno.env.get('RESEND_API_KEY') || '';
  if (!resendKey) throw new Error('resend_not_configured');
  const from = Deno.env.get('FROM_EMAIL') || 'SwiftGigs <notify@quickgigs.ca>';
  const body = [
    `${teenName} created a SwiftGigs account and needs your approval.`,
    '',
    'Review their details and accept or decline:',
    consentUrl,
    '',
    'This link expires in 7 days and can only be used once.',
  ].join('\n');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: `Approve ${teenName}'s SwiftGigs account`,
      text: body,
    }),
  });
  if (!response.ok) throw new Error(`guardian_email_failed:${await response.text()}`);
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
    const body = await req.json();
    const dateOfBirth = String(body.date_of_birth || '').trim();
    const age = ageOn(dateOfBirth);
    if (age < 0) return json({ ok: false, error: 'invalid_date_of_birth' }, 400);
    if (age < 16) {
      return json({ ok: false, error: 'underage', message: 'You must be at least 16 to join SwiftGigs' }, 403);
    }

    const isTeen = age < 18;
    const startingRole = String(body.starting_role || body.role || 'worker').toLowerCase() === 'poster'
      ? 'poster'
      : 'tasker';
    if (isTeen && startingRole === 'poster') {
      return json({
        ok: false,
        error: 'teen_poster_unavailable',
        message: 'Poster mode becomes available when you turn 18.',
      }, 403);
    }
    const guardianName = String(body.guardian_name || '').trim().slice(0, 120);
    const guardianEmail = String(body.guardian_email || '').trim().toLowerCase().slice(0, 254);
    const guardianPhone = String(body.guardian_phone || '').trim().slice(0, 30);
    if (isTeen && guardianName.length < 2) {
      return json({ ok: false, error: 'guardian_name_required' }, 400);
    }
    if (isTeen && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guardianEmail)) {
      return json({ ok: false, error: 'guardian_email_required' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    );
    // The guardian has to be a different, adult person. An email cannot prove
    // that on its own (Stripe's ID check on the guardian is the real proof),
    // but the obvious dodges are refused here.
    if (isTeen) {
      const teenEmail = String(identity.email || body.email || '').trim().toLowerCase();
      if (inboxKey(guardianEmail) === inboxKey(teenEmail)) {
        return json({
          ok: false,
          error: 'guardian_email_same_as_teen',
          message: 'Use your parent or guardian\'s own email address, not yours.',
        }, 400);
      }
      if (phoneKey(guardianPhone).length < 10) {
        return json({
          ok: false,
          error: 'guardian_phone_required',
          message: 'Add your parent or guardian\'s phone number.',
        }, 400);
      }
      if (phoneKey(guardianPhone) === phoneKey(String(body.phone || ''))) {
        return json({
          ok: false,
          error: 'guardian_phone_same_as_teen',
          message: 'Use your parent or guardian\'s own phone number, not yours.',
        }, 400);
      }
      // The guardian address must not belong to another under-18 account.
      const { data: sameInbox } = await supabase
        .from('users')
        .select('firebase_uid,date_of_birth,email')
        .ilike('email', guardianEmail)
        .limit(5);
      const minorOwnsIt = (sameInbox || []).some((u) =>
        u.firebase_uid !== identity.uid && u.date_of_birth && ageOn(String(u.date_of_birth)) < 18
      );
      if (minorOwnsIt) {
        return json({
          ok: false,
          error: 'guardian_email_is_minor',
          message: 'That email belongs to an under-18 account. A parent or guardian must be an adult.',
        }, 400);
      }
      if ((Deno.env.get('GUARDIAN_CONSENT_SECRET') || '').length < 32) {
        // Without the signing secret no approval link can be made, so say so
        // instead of creating an account nobody can approve.
        console.error('register-account: GUARDIAN_CONSENT_SECRET is not set');
        return json({
          ok: false,
          error: 'teen_signup_unavailable',
          message: 'Sign-up for ages 16 and 17 is not open yet. Please try again soon.',
        }, 503);
      }
    }

    const now = new Date().toISOString();
    let consentToken = '';
    let tokenHash: string | null = null;
    let tokenExpires: string | null = null;
    if (isTeen) {
      consentToken = await signGuardianToken(identity.uid, 'guardian_consent', '7d');
      tokenHash = await hashToken(consentToken);
      tokenExpires = new Date(Date.now() + 7 * 86400000).toISOString();
    }

    const row = {
      firebase_uid: identity.uid,
      name: String(body.name || '').trim().slice(0, 120),
      email: identity.email || String(body.email || '').trim().toLowerCase(),
      phone: String(body.phone || '').trim().slice(0, 30),
      role: startingRole === 'tasker' ? 'worker' : 'poster',
      is_tasker: startingRole === 'tasker',
      is_poster: startingRole === 'poster',
      last_active_mode: startingRole,
      roles_updated_at: now,
      status: 'active',
      account_status: isTeen ? 'pending_guardian' : 'active',
      date_of_birth: dateOfBirth,
      identity_collected_at: now,
      pronouns: String(body.pronouns || '').trim().slice(0, 80),
      gender: String(body.gender || 'prefer not to say').trim().slice(0, 80),
      guardian_name: isTeen ? guardianName : null,
      guardian_email: isTeen ? guardianEmail : null,
      guardian_phone: isTeen ? guardianPhone || null : null,
      guardian_consent_status: isTeen ? 'pending' : 'not_required',
      guardian_consent_at: null,
      guardian_consent_token: tokenHash,
      consent_token: tokenHash,
      consent_token_expires_at: tokenExpires,
      consent_accepted_at: null,
      graduated_at: null,
      payout_owner: isTeen ? 'guardian' : 'self',
      tasker_verified: false,
      tasker_verification_status: 'unverified',
      tasker_background_check_status: 'not_started',
      poster_verified: false,
      poster_verification_status: 'unverified',
      email_verified: identity.emailVerified,
    };

    const { data: existing } = await supabase
      .from('users')
      .select('user_id,date_of_birth,identity_collected_at,account_status')
      .eq('firebase_uid', identity.uid)
      .maybeSingle();
    if (existing?.account_status === 'blocked') {
      return json({ ok: false, error: 'account_blocked' }, 403);
    }
    if (existing?.date_of_birth || existing?.identity_collected_at) {
      return json({ ok: false, error: 'account_already_registered' }, 409);
    }

    // Invite-only while soft close is on: the closed sign on the sign-up page
    // is not enough, so the server refuses anyone who has not been invited.
    const tokenEmail = String(identity.email || '').trim().toLowerCase();
    const { data: gate } = await supabase
      .from('platform_banner')
      .select('active,soft_close')
      .eq('id', 1)
      .maybeSingle();
    if (gate?.active && gate?.soft_close && !existing?.user_id) {
      let allowed = false;
      if (tokenEmail) {
        const { data: invite } = await supabase
          .from('waitlist')
          .select('invited_at')
          .eq('email', tokenEmail)
          .maybeSingle();
        allowed = !!invite?.invited_at;
      }
      if (!allowed) {
        const { data: adminRow } = await supabase
          .from('admins')
          .select('user_id')
          .eq('user_id', identity.uid)
          .maybeSingle();
        allowed = !!adminRow;
      }
      if (!allowed) {
        return json({
          ok: false,
          error: 'signups_closed',
          message: 'SwiftGigs is invite-only right now. Join the waitlist and we will email you when your spot opens.',
        }, 403);
      }
    }

    const write = existing?.user_id
      ? await supabase.from('users').update(row).eq('user_id', existing.user_id).select('*').single()
      // user_id is a UUID with its own default; the Firebase UID lives in
      // firebase_uid. Passing the Firebase UID here failed every new signup
      // with 22P02 (invalid input syntax for type uuid).
      : await supabase.from('users').insert({ ...row, firebase_uid: identity.uid }).select('*').single();
    if (write.error) throw write.error;

    if (tokenEmail) {
      // Best effort: tick the waitlist entry so Admin shows who joined.
      try {
        await supabase
          .from('waitlist')
          .update({ signed_up: true, signed_up_at: now })
          .eq('email', tokenEmail);
      } catch (_wlErr) { /* not critical */ }
    }

    let consentUrl = '';
    let emailQueued = false;
    if (isTeen) {
      const siteUrl = (Deno.env.get('SITE_URL') || 'https://quickgigs.ca').replace(/\/$/, '');
      consentUrl = `${siteUrl}/parent-consent.html?token=${encodeURIComponent(consentToken)}`;
      try {
        await sendGuardianEmail(guardianEmail, row.name || 'Your teen', consentUrl);
        emailQueued = true;
        await supabase
          .from('users')
          .update({ guardian_consent_sent_at: new Date().toISOString() })
          .eq('firebase_uid', identity.uid);
      } catch (emailErr) {
        console.error('Guardian consent email failed:', emailErr);
      }
    }

    return json({
      ok: true,
      success: true,
      account_status: row.account_status,
      guardian_consent_status: row.guardian_consent_status,
      email_sent: emailQueued,
      user: write.data,
    });
  } catch (err) {
    console.error('register-account error:', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
