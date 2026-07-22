// QuickGigs — Confirm Stripe checkout session (instant unlock; backup for webhook delay)
// Deploy: supabase functions deploy confirm-checkout --no-verify-jwt

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
    const sessionId = String(body.session_id || '').trim();
    if (!sessionId) return json({ ok: false, error: 'missing_session_id' }, 400);

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.metadata?.project !== 'quickgigs') {
      return json({ ok: false, error: 'not_quickgigs_session' }, 400);
    }

    const paid =
      session.payment_status === 'paid' ||
      session.status === 'complete';

    if (!paid) {
      return json({ ok: false, error: 'payment_not_complete', status: session.payment_status || session.status }, 409);
    }

    const taskId = String(session.metadata?.task_id || '');
    const posterId = String(session.metadata?.poster_id || '');
    const workerId = String(session.metadata?.worker_id || '');
    const paymentIntentId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id || session.id;

    if (!taskId || !posterId || !workerId) {
      return json({ ok: false, error: 'missing_metadata' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    await supabase
      .from('payments')
      .update({
        status: 'held',
        stripe_id: paymentIntentId,
        completed_at: new Date().toISOString(),
      })
      .eq('task_id', taskId)
      .eq('poster_id', posterId);

    const { data: convs } = await supabase
      .from('conversations')
      .select('conv_id')
      .eq('task_id', taskId)
      .eq('poster_id', posterId)
      .eq('worker_id', workerId)
      .limit(1);

    if (convs && convs[0]?.conv_id) {
      await supabase
        .from('conversations')
        .update({ is_unlocked: true, status: 'in_progress' })
        .eq('conv_id', convs[0].conv_id);
    }

    return json({ ok: true, task_id: taskId, status: 'held' });
  } catch (err) {
    console.error('confirm-checkout error:', err);
    return json({ ok: false, error: String(err) }, 500);
  }
});
