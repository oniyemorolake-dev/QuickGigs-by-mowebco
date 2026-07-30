// QuickGigs — Stripe Connect Express onboarding for taskers
// Deploy: supabase functions deploy create-connect-link --no-verify-jwt
// Secrets: STRIPE_SECRET_KEY, SITE_URL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { authErrorStatus, requireFirebaseUser } from '../_shared/firebase-auth.ts';
import { verifyGuardianToken } from '../_shared/guardian-token.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      return new Response(JSON.stringify({ ok: false, error: 'stripe_not_configured' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const guardianToken = String(body.guardian_token || '').trim();
    let workerId = '';
    let guardianMode = false;
    if (guardianToken) {
      const claims = await verifyGuardianToken(guardianToken, 'guardian_payout');
      workerId = claims.uid;
      guardianMode = true;
    } else {
      try {
        const identity = await requireFirebaseUser(req);
        workerId = identity.uid;
      } catch (authErr) {
        return new Response(JSON.stringify({ ok: false, error: authErr instanceof Error ? authErr.message : 'unauthorized' }), {
          status: authErrorStatus(authErr),
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: userRow } = await supabase
      .from('users')
      .select('date_of_birth,account_status,guardian_consent_status,guardian_email,guardian_stripe_connect_id,stripe_connect_id,email')
      .eq('firebase_uid', workerId)
      .maybeSingle();
    if (!userRow) throw new Error('user_not_found');
    if (guardianMode && (
      userRow.account_status !== 'active' ||
      userRow.guardian_consent_status !== 'approved'
    )) {
      throw new Error('guardian_consent_required');
    }
    const email = guardianMode
      ? String(userRow.guardian_email || '')
      : String(body.email || userRow.email || '');

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
    let accountId = guardianMode
      ? (userRow.guardian_stripe_connect_id || '')
      : (userRow.stripe_connect_id || '');

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'CA',
        email: email || userRow?.email || undefined,
        capabilities: {
          transfers: { requested: true },
        },
        metadata: {
          project: 'quickgigs',
          firebase_uid: workerId,
          payout_owner: guardianMode ? 'guardian' : 'worker',
        },
      });
      accountId = account.id;
      await supabase
        .from('users')
        .update(guardianMode
          ? { guardian_stripe_connect_id: accountId }
          : { stripe_connect_id: accountId })
        .eq('firebase_uid', workerId);
    }

    const siteUrl = (Deno.env.get('SITE_URL') || 'https://quickgigs.ca').replace(/\/$/, '');
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: guardianMode
        ? `${siteUrl}/parent-consent.html?payout=refresh`
        : `${siteUrl}/profile.html?stripe=refresh`,
      return_url: guardianMode
        ? `${siteUrl}/parent-consent.html?payout=done`
        : `${siteUrl}/profile.html?stripe=done`,
      type: 'account_onboarding',
    });

    return new Response(JSON.stringify({ ok: true, url: link.url, account_id: accountId, payout_owner: guardianMode ? 'guardian' : 'worker' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('create-connect-link error:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
