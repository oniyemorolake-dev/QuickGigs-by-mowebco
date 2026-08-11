import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { hashToken, signGuardianToken, verifyGuardianToken } from '../_shared/guardian-token.ts';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  try {
    const body = await req.json();
    const token = String(body.token || '').trim();
    const action = String(body.action || 'preview').toLowerCase();
    if (!token) return json({ ok: false, error: 'missing_token' }, 400);

    const claims = await verifyGuardianToken(token, 'guardian_consent');
    const tokenHash = await hashToken(token);
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    );
    const { data: teen, error } = await supabase
      .from('users')
      .select(
        'user_id,firebase_uid,name,date_of_birth,guardian_name,guardian_email,guardian_consent_status,account_status,consent_token,consent_token_expires_at',
      )
      .eq('firebase_uid', claims.uid)
      .maybeSingle();
    if (error) throw error;
    if (!teen || teen.consent_token !== tokenHash) {
      return json({ ok: false, error: 'invalid_or_used_token' }, 410);
    }
    if (teen.consent_token_expires_at && Date.parse(teen.consent_token_expires_at) < Date.now()) {
      return json({ ok: false, error: 'token_expired' }, 410);
    }
    if (teen.account_status !== 'pending_guardian' || teen.guardian_consent_status !== 'pending') {
      return json({ ok: false, error: 'consent_not_pending' }, 409);
    }

    const publicTeen = {
      name: teen.name,
      date_of_birth: teen.date_of_birth,
      guardian_name: teen.guardian_name,
      guardian_email: teen.guardian_email,
    };
    if (action === 'preview') return json({ ok: true, teen: publicTeen });

    if (action === 'decline') {
      const { data: declined, error: declineError } = await supabase
        .from('users')
        .update({
          account_status: 'blocked',
          guardian_consent_status: 'rejected',
          consent_token: null,
          guardian_consent_token: null,
          consent_token_expires_at: null,
        })
        .eq('firebase_uid', claims.uid)
        .eq('consent_token', tokenHash)
        .select('firebase_uid')
        .maybeSingle();
      if (declineError) throw declineError;
      if (!declined) return json({ ok: false, error: 'invalid_or_used_token' }, 410);
      return json({ ok: true, declined: true });
    }

    if (action !== 'approve') return json({ ok: false, error: 'invalid_action' }, 400);
    if (body.terms_accepted !== true) {
      return json({ ok: false, error: 'terms_required' }, 400);
    }

    const acceptedAt = new Date().toISOString();
    const { data: approvedRow, error: approveError } = await supabase
      .from('users')
      .update({
        account_status: 'active',
        guardian_consent_status: 'approved',
        guardian_consent_at: acceptedAt,
        consent_accepted_at: acceptedAt,
        consent_token: null,
        guardian_consent_token: null,
        consent_token_expires_at: null,
      })
      .eq('firebase_uid', claims.uid)
      .eq('consent_token', tokenHash)
      .select('firebase_uid')
      .maybeSingle();
    if (approveError) throw approveError;
    if (!approvedRow) return json({ ok: false, error: 'invalid_or_used_token' }, 410);

    const payoutToken = await signGuardianToken(claims.uid, 'guardian_payout', '24h');
    return json({
      ok: true,
      approved: true,
      teen: publicTeen,
      payout_token: payoutToken,
    });
  } catch (err) {
    console.error('guardian-consent error:', err);
    const message = err instanceof Error ? err.message : String(err);
    const status = /token|signature|jwt|expir/i.test(message) ? 410 : 500;
    return json({ ok: false, error: message }, status);
  }
});
