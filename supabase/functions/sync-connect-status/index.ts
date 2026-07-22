// QuickGigs — Sync Stripe Connect account status to users row
// Deploy: supabase functions deploy sync-connect-status --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

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

  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) return json({ ok: false, error: 'stripe_not_configured' }, 503);

    const body = await req.json();
    const workerId = String(body.worker_id || '').trim();
    if (!workerId) return json({ ok: false, error: 'missing_worker_id' }, 400);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: userRow } = await supabase
      .from('users')
      .select('stripe_connect_id')
      .eq('firebase_uid', workerId)
      .maybeSingle();

    const connectId = userRow?.stripe_connect_id || '';
    if (!connectId) return json({ ok: true, connected: false, payouts_enabled: false });

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
    const account = await stripe.accounts.retrieve(connectId);
    const payoutsEnabled = !!(account.payouts_enabled && account.details_submitted);

    await supabase
      .from('users')
      .update({ stripe_payouts_enabled: payoutsEnabled })
      .eq('firebase_uid', workerId);

    return json({
      ok: true,
      connected: true,
      payouts_enabled: payoutsEnabled,
      details_submitted: !!account.details_submitted,
    });
  } catch (err) {
    console.error('sync-connect-status error:', err);
    return json({ ok: false, error: String(err) }, 500);
  }
});
