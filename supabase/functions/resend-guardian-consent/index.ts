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
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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
    const { data: teen } = await supabase
      .from('users')
      .select('name,guardian_email,account_status,guardian_consent_status,guardian_consent_sent_at,consent_token,guardian_consent_token,consent_token_expires_at')
      .eq('firebase_uid', identity.uid)
      .maybeSingle();
    if (
      !teen ||
      teen.account_status !== 'pending_guardian' ||
      teen.guardian_consent_status !== 'pending'
    ) {
      return json({ ok: false, error: 'consent_not_pending' }, 409);
    }
    if (
      teen.guardian_consent_sent_at &&
      Date.now() - Date.parse(teen.guardian_consent_sent_at) < 60000
    ) {
      return json({ ok: false, error: 'resend_too_soon' }, 429);
    }

    const token = await signGuardianToken(identity.uid, 'guardian_consent', '7d');
    const tokenHash = await hashToken(token);
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const { error: updateError } = await supabase
      .from('users')
      .update({
        consent_token: tokenHash,
        guardian_consent_token: tokenHash,
        consent_token_expires_at: expiresAt,
      })
      .eq('firebase_uid', identity.uid);
    if (updateError) throw updateError;

    const resendKey = Deno.env.get('RESEND_API_KEY') || '';
    if (!resendKey) throw new Error('resend_not_configured');
    const siteUrl = (Deno.env.get('SITE_URL') || 'https://quickgigs.ca').replace(/\/$/, '');
    const consentUrl = `${siteUrl}/parent-consent.html?token=${encodeURIComponent(token)}`;
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: Deno.env.get('FROM_EMAIL') || 'QuickGigs <notify@quickgigs.ca>',
        to: [teen.guardian_email],
        subject: `Approve ${teen.name || 'your teen'}'s QuickGigs account`,
        text: `${teen.name || 'Your teen'} needs your approval to use QuickGigs.\n\n${consentUrl}\n\nThis one-time link expires in 7 days.`,
      }),
    });
    if (!response.ok) {
      await supabase
        .from('users')
        .update({
          consent_token: teen.consent_token,
          guardian_consent_token: teen.guardian_consent_token,
          consent_token_expires_at: teen.consent_token_expires_at,
        })
        .eq('firebase_uid', identity.uid)
        .eq('consent_token', tokenHash);
      throw new Error(`guardian_email_failed:${await response.text()}`);
    }
    await supabase
      .from('users')
      .update({ guardian_consent_sent_at: new Date().toISOString() })
      .eq('firebase_uid', identity.uid);
    return json({ ok: true, success: true, email_sent: true });
  } catch (err) {
    console.error('resend-guardian-consent error:', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
