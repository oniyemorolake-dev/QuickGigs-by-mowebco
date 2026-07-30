import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authErrorStatus, requireFirebaseUser } from '../_shared/firebase-auth.ts';
import { ageFromDateOfBirth, qgCalendarParts } from '../_shared/age.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function birthdayInDays(dateOfBirth: unknown, days: number): boolean {
  const raw = String(dateOfBirth || '');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return false;
  const current = qgCalendarParts();
  const targetDate = new Date(Date.UTC(current.year, current.month - 1, current.day + days, 18));
  const target = qgCalendarParts(targetDate);
  return Number(match[2]) === target.month &&
    Number(match[3]) === target.day &&
    target.year - Number(match[1]) === 18;
}

async function sendLifecycleEmail(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string,
  email: string,
  type: string,
  subject: string,
  text: string,
) {
  if (!email) return false;
  const { data: queued, error } = await supabase
    .from('notification_queue')
    .insert({ user_id: userId, email, type, subject, body_text: text, payload: { lifecycle: type } })
    .select('notification_id')
    .maybeSingle();
  if (error) {
    if (String(error.code) === '23505') return false;
    throw error;
  }
  const key = Deno.env.get('RESEND_API_KEY') || '';
  if (!key) return false;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('FROM_EMAIL') || 'QuickGigs <notify@quickgigs.ca>',
      to: [email],
      subject,
      text,
    }),
  });
  await supabase
    .from('notification_queue')
    .update(response.ok
      ? { sent_at: new Date().toISOString(), error_message: null }
      : { error_message: await response.text() })
    .eq('notification_id', queued?.notification_id);
  return response.ok;
}

async function graduateUser(
  supabase: ReturnType<typeof createClient<any>>,
  user: Record<string, unknown>,
) {
  const uid = String(user.firebase_uid || '');
  const name = String(user.name || 'there');
  const alreadyGraduated = Boolean(user.graduated_at);
  const wasTeenAccount = Boolean(user.guardian_email) ||
    ['pending', 'approved'].includes(String(user.guardian_consent_status || '')) ||
    String(user.payout_owner || '') === 'guardian';
  if (!wasTeenAccount) return { graduated: false, needs_payout_setup: false };
  if (ageFromDateOfBirth(user.date_of_birth) == null ||
      Number(ageFromDateOfBirth(user.date_of_birth)) < 18) {
    return { graduated: false, needs_payout_setup: false };
  }
  if (!alreadyGraduated) {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('users')
      .update({
        graduated_at: now,
        account_status: 'active',
        payout_owner: 'guardian',
      })
      .eq('firebase_uid', uid)
      .is('graduated_at', null);
    if (error) throw error;

    await sendLifecycleEmail(
      supabase, uid, String(user.email || ''), 'account_graduated',
      'Your QuickGigs account now has full adult access',
      `Hi ${name},\n\nYou are now 18, so guardian approval no longer applies to new gigs. Teen filters and restrictions have been removed.\n\nBefore any completed-gig payout can be released, add your own payout details in QuickGigs. Existing guardian payout information will not be used for new transfers.`,
    );
    await sendLifecycleEmail(
      supabase, uid, String(user.guardian_email || ''), 'guardian_role_ended',
      `${name} has turned 18 — guardian role ended`,
      `${name} has turned 18. Guardian approval and payout authority for this QuickGigs account have ended. Guardian details remain stored only as account history.`,
    );
  }
  return {
    graduated: !alreadyGraduated,
    needs_payout_setup: !alreadyGraduated ||
      String(user.payout_owner || 'guardian') !== 'self' ||
      user.stripe_payouts_enabled !== true,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const cronMode = String(body.mode || '') === 'cron';
    let uid = '';
    if (cronMode) {
      const expected = Deno.env.get('GRADUATION_CRON_SECRET') || '';
      if (!expected || req.headers.get('x-cron-secret') !== expected) {
        return json({ ok: false, error: 'unauthorized_cron' }, 403);
      }
    } else {
      try {
        uid = (await requireFirebaseUser(req)).uid;
      } catch (err) {
        return json({ ok: false, error: err instanceof Error ? err.message : 'unauthorized' }, authErrorStatus(err));
      }
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    );
    if (!cronMode) {
      const { data: user, error } = await supabase
        .from('users')
        .select('firebase_uid,name,email,date_of_birth,guardian_email,guardian_consent_status,graduated_at,payout_owner,stripe_payouts_enabled')
        .eq('firebase_uid', uid)
        .maybeSingle();
      if (error) throw error;
      if (!user) return json({ ok: false, error: 'user_not_found' }, 404);
      const result = await graduateUser(supabase, user);
      return json({ ok: true, ...result });
    }

    const { data: users, error } = await supabase
      .from('users')
      .select('firebase_uid,name,email,date_of_birth,guardian_email,guardian_consent_status,graduated_at,payout_owner,stripe_payouts_enabled')
      .not('date_of_birth', 'is', null)
      .not('guardian_email', 'is', null);
    if (error) throw error;
    let graduated = 0;
    let warned = 0;
    for (const user of users || []) {
      if (birthdayInDays(user.date_of_birth, 7)) {
        const sent = await sendLifecycleEmail(
          supabase, String(user.firebase_uid), String(user.email || ''), 'turning_18_soon',
          'You’ll soon have full QuickGigs access',
          `Hi ${user.name || 'there'},\n\nYou turn 18 in seven days. Guardian approval will stop applying to new gigs, teen-only filters will be removed, and you’ll need to add your own payout details before completed-gig payouts can be released.`,
        );
        if (sent) warned += 1;
      }
      if (!user.graduated_at && Number(ageFromDateOfBirth(user.date_of_birth)) >= 18) {
        const result = await graduateUser(supabase, user);
        if (result.graduated) graduated += 1;
      }
    }
    return json({ ok: true, processed: (users || []).length, graduated, warned });
  } catch (err) {
    console.error('graduate-account error:', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
