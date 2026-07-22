// QuickGigs — Release worker payout when task is marked complete (escrow → 75/25 split)
// Deploy: supabase functions deploy release-payout --no-verify-jwt
// Secrets: STRIPE_SECRET_KEY
// Requires: payment status "held" on platform account (create-checkout without destination charge)

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
    const taskId = String(body.task_id || '').trim();
    const actorId = String(body.actor_id || '').trim();
    if (!taskId || !actorId) return json({ ok: false, error: 'missing_task_or_actor' }, 400);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: tasks, error: taskErr } = await supabase
      .from('tasks')
      .select('*')
      .eq('task_id', taskId)
      .limit(1);
    if (taskErr) throw taskErr;
    const task = tasks && tasks[0];
    if (!task) return json({ ok: false, error: 'task_not_found' }, 404);

    const taskStatus = String(task.status || '').toLowerCase();
    if (taskStatus !== 'in_progress' && taskStatus !== 'completed') {
      return json({ ok: false, error: 'task_not_releasable' }, 400);
    }

    const posterId = String(task.posted_by || '');
    const { data: apps } = await supabase
      .from('applications')
      .select('*')
      .eq('task_id', taskId)
      .eq('status', 'accepted')
      .limit(1);
    const app = apps && apps[0];
    const workerId = app ? String(app.worker_id || '') : '';
    if (!workerId) return json({ ok: false, error: 'no_accepted_worker' }, 400);

    const isPoster = actorId === posterId;
    const isWorker = actorId === workerId;
    if (!isPoster && !isWorker) return json({ ok: false, error: 'not_authorized' }, 403);

    const { data: payments } = await supabase
      .from('payments')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
      .limit(5);

    const payment = (payments || []).find((p) => {
      const st = String(p.status || '').toLowerCase();
      return st === 'held' || st === 'paid';
    });

    if (!payment) return json({ ok: true, skipped: true, reason: 'no_payment' });

    const payStatus = String(payment.status || '').toLowerCase();
    if (payStatus === 'paid') {
      return json({
        ok: true,
        already: true,
        worker_payout: payment.worker_payout,
        platform_fee: payment.platform_fee,
      });
    }

    if (payStatus !== 'held') {
      return json({ ok: true, skipped: true, reason: 'payment_not_held' });
    }

    const { data: workerUser } = await supabase
      .from('users')
      .select('stripe_connect_id, stripe_payouts_enabled')
      .eq('firebase_uid', workerId)
      .maybeSingle();

    const connectId = workerUser?.stripe_connect_id || '';
    if (!connectId) {
      return json({ ok: false, error: 'worker_payout_setup_required' }, 400);
    }

    const workerPayout = Number(payment.worker_payout || 0);
    const workerPayoutCents = Math.round(workerPayout * 100);
    if (!workerPayoutCents || workerPayoutCents <= 0) {
      return json({ ok: false, error: 'invalid_payout_amount' }, 400);
    }

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
    const paymentIntentId = String(payment.stripe_id || '');

    let sourceTransaction: string | undefined;
    if (paymentIntentId.startsWith('pi_')) {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      const charge = pi.latest_charge;
      sourceTransaction = typeof charge === 'string' ? charge : charge?.id;
    }

    const transfer = await stripe.transfers.create({
      amount: workerPayoutCents,
      currency: 'cad',
      destination: connectId,
      ...(sourceTransaction ? { source_transaction: sourceTransaction } : {}),
      metadata: {
        project: 'quickgigs',
        task_id: taskId,
        worker_id: workerId,
        poster_id: posterId,
      },
    });

    const now = new Date().toISOString();
    await supabase
      .from('payments')
      .update({
        status: 'paid',
        transfer_id: transfer.id,
        completed_at: now,
      })
      .eq('payment_id', payment.payment_id);

    return json({
      ok: true,
      transfer_id: transfer.id,
      worker_payout: workerPayout,
      platform_fee: Number(payment.platform_fee || 0),
      amount: Number(payment.amount || 0),
    });
  } catch (err) {
    console.error('release-payout error:', err);
    return json({ ok: false, error: String(err) }, 500);
  }
});
