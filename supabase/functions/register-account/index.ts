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

async function sendGuardianEmail(email: string, teenName: string, consentUrl: string) {
  const resendKey = Deno.env.get('RESEND_API_KEY') || '';
  if (!resendKey) throw new Error('resend_not_configured');
  const from = Deno.env.get('FROM_EMAIL') || 'QuickGigs <notify@quickgigs.ca>';
  const body = [
    `${teenName} created a QuickGigs account and needs your approval.`,
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
      subject: `Approve ${teenName}'s QuickGigs account`,
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
      return json({ ok: false, error: 'underage', message: 'You must be at least 16 to join QuickGigs' }, 403);
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

    const write = existing?.user_id
      ? await supabase.from('users').update(row).eq('user_id', existing.user_id).select('*').single()
      : await supabase.from('users').insert({ ...row, user_id: identity.uid }).select('*').single();
    if (write.error) throw write.error;

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
