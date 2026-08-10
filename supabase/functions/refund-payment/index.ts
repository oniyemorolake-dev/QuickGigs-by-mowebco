// QuickGigs — Refund escrow payment when task cancelled before completion
// Deploy: supabase functions deploy refund-payment --no-verify-jwt
// Auth: Firebase JWT required. actor_id from token only — never trust body.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { authErrorStatus, requireFirebaseUser } from '../_shared/firebase-auth.ts';

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
    let identity;
    try {
      identity = await requireFirebaseUser(req);
    } catch (authErr) {
      return json({
        ok: false,
        error: authErr instanceof Error ? authErr.message : 'unauthorized',
      }, authErrorStatus(authErr));
    }

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) return json({ ok: false, error: 'stripe_not_configured' }, 503);

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: 'invalid_json' }, 400);
    }

    const taskId = String(body.task_id || '').trim();
    const actorId = identity.uid; // server-derived — ignore body.actor_id
    if (!taskId) return json({ ok: false, error: 'missing_task' }, 400);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: tasks } = await supabase.from('tasks').select('*').eq('task_id', taskId).limit(1);
    const task = tasks && tasks[0];
    if (!task) return json({ ok: false, error: 'task_not_found' }, 404);

    const posterId = String(task.posted_by || '');
    if (actorId !== posterId) return json({ ok: false, error: 'not_authorized' }, 403);

    const { data: payments } = await supabase
      .from('payments')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
      .limit(5);

    const payment = (payments || []).find((p) => {
      const st = String(p.status || '').toLowerCase();
      return st === 'held' || st === 'paid' || st === 'refunded';
    });

    if (!payment) return json({ ok: true, skipped: true, reason: 'no_payment' });

    const payStatus = String(payment.status || '').toLowerCase();
    if (payStatus === 'refunded') return json({ ok: true, already: true });
    if (payStatus === 'paid') {
      return json({ ok: false, error: 'already_released_use_dispute' }, 409);
    }
    if (payStatus !== 'held') return json({ ok: true, skipped: true, reason: 'not_refundable' });

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
    const stripeRef = String(payment.stripe_id || '');
    let paymentIntentId = stripeRef;

    try {
      if (stripeRef.startsWith('cs_')) {
        const session = await stripe.checkout.sessions.retrieve(stripeRef);
        paymentIntentId = typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id || stripeRef;
      }
    } catch (stripeErr) {
      console.error('refund session resolve failed:', stripeErr);
      return json({ ok: false, error: 'stripe_lookup_failed' }, 502);
    }

    if (!paymentIntentId.startsWith('pi_')) {
      return json({ ok: false, error: 'invalid_payment_reference' }, 400);
    }

    let refund: Stripe.Refund;
    try {
      refund = await stripe.refunds.create(
        { payment_intent: paymentIntentId },
        { idempotencyKey: `qg-refund-${payment.payment_id}` },
      );
    } catch (refundErr) {
      console.error('stripe.refunds.create failed:', refundErr);
      return json({ ok: false, error: 'stripe_refund_failed' }, 502);
    }

    await supabase
      .from('payments')
      .update({ status: 'refunded', completed_at: new Date().toISOString() })
      .eq('payment_id', payment.payment_id);

    return json({ ok: true, refund_id: refund.id, status: 'refunded' });
  } catch (err) {
    console.error('refund-payment error:', err);
    return json({ ok: false, error: 'refund_failed' }, 500);
  }
});
