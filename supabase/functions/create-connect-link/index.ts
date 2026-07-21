// QuickGigs — Stripe Connect Express onboarding for taskers
// Deploy: supabase functions deploy create-connect-link --no-verify-jwt
// Secrets: STRIPE_SECRET_KEY, SITE_URL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

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
    const workerId = String(body.worker_id || '').trim();
    const email = String(body.email || '').trim();
    if (!workerId) {
      return new Response(JSON.stringify({ ok: false, error: 'missing_worker_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: userRow } = await supabase
      .from('users')
      .select('stripe_connect_id, email')
      .eq('firebase_uid', workerId)
      .maybeSingle();

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
    let accountId = userRow?.stripe_connect_id || '';

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'CA',
        email: email || userRow?.email || undefined,
        capabilities: {
          transfers: { requested: true },
        },
        metadata: { project: 'quickgigs', firebase_uid: workerId },
      });
      accountId = account.id;
      await supabase
        .from('users')
        .update({ stripe_connect_id: accountId })
        .eq('firebase_uid', workerId);
    }

    const siteUrl = (Deno.env.get('SITE_URL') || 'https://quickgigs.ca').replace(/\/$/, '');
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${siteUrl}/profile.html?stripe=refresh`,
      return_url: `${siteUrl}/profile.html?stripe=done`,
      type: 'account_onboarding',
    });

    return new Response(JSON.stringify({ ok: true, url: link.url, account_id: accountId }), {
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
