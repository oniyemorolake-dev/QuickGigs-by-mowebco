// QuickGigs — Create PaymentIntent escrow (funds stay on platform; no transfer_data)
// Deploy: supabase functions deploy create-escrow-intent --no-verify-jwt
// Secrets: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Prefer create-checkout (embedded Checkout) for the poster pay UI. This endpoint
// exposes a raw PaymentIntent with transfer_group = task_<taskId> for the same
// escrow model. Release still goes through release-payout on mark-complete.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { feeBreakdown, periodTotal } from '../_shared/fee.ts';
import { taskTransferGroup } from '../_shared/connect-ready.ts';
import { authErrorStatus, requireFirebaseUser } from '../_shared/firebase-auth.ts';

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

function getField(row: Record<string, unknown>, key: string) {
  const lower = key.toLowerCase();
  for (const k of Object.keys(row || {})) {
    if (k.toLowerCase() === lower) return row[k];
  }
  return undefined;
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && typeof (err as { message?: string }).message === 'string') {
    return (err as { message: string }).message;
  }
  return String(err);
}

function isUuidLike(val: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(val || '').trim(),
  );
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
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) return json({ ok: false, error: 'stripe_not_configured' }, 503);
    if (stripeKey.startsWith('sk_live_')) {
      return json({
        ok: false,
        error: 'live_keys_blocked',
        message: 'Escrow is running in Stripe TEST mode only.',
      }, 503);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: 'invalid_json' }, 400);
    }

    const taskId = String(body.task_id || '').trim();
    const posterId = identity.uid;
    if (!taskId) return json({ ok: false, error: 'missing_task' }, 400);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: posterUser, error: posterErr } = await supabase
      .from('users')
      .select('account_status,status,is_poster,poster_verified,poster_payment_method_id,poster_stripe_customer_id')
      .eq('firebase_uid', posterId)
      .maybeSingle();
    if (posterErr) return json({ ok: false, error: 'poster_lookup_failed', details: posterErr.message }, 500);
    if (!posterUser || posterUser.account_status !== 'active') {
      return json({ ok: false, error: 'account_not_active' }, 403);
    }
    if (posterUser.is_poster !== true) return json({ ok: false, error: 'poster_role_required' }, 403);
    if (posterUser.poster_verified !== true || !String(posterUser.poster_payment_method_id || '').trim()) {
      return json({ ok: false, error: 'poster_payment_verification_required' }, 403);
    }

    const { data: task, error: taskErr } = await supabase
      .from('tasks')
      .select('*')
      .eq('task_id', taskId)
      .maybeSingle();
    if (taskErr) return json({ ok: false, error: 'task_lookup_failed', details: taskErr.message }, 500);
    if (!task) return json({ ok: false, error: 'task_not_found' }, 404);
    if (String(task.posted_by || '') !== posterId) return json({ ok: false, error: 'not_task_poster' }, 403);
    if (String(task.status || '').toLowerCase() !== 'in_progress') {
      return json({ ok: false, error: 'task_not_in_progress' }, 400);
    }

    const paymentTaskId = String(task.task_id || taskId);
    if (!isUuidLike(paymentTaskId)) {
      return json({ ok: false, error: 'task_uuid_missing' }, 400);
    }

    const { data: apps, error: appErr } = await supabase
      .from('applications')
      .select('*')
      .eq('task_id', paymentTaskId);
    if (appErr) return json({ ok: false, error: 'application_lookup_failed', details: appErr.message }, 500);
    const app = (apps || []).find((row) =>
      String(getField(row as Record<string, unknown>, 'status') || '').toLowerCase() === 'accepted'
    ) as Record<string, unknown> | undefined;
    if (!app) return json({ ok: false, error: 'no_accepted_worker' }, 400);
    const workerId = String(getField(app, 'worker_id') || '');
    if (!workerId || workerId === posterId) return json({ ok: false, error: 'worker_missing' }, 400);

    const { data: already } = await supabase
      .from('payments')
      .select('payment_id,status')
      .eq('task_id', paymentTaskId)
      .in('status', ['held', 'completed', 'paid'])
      .limit(1);
    if (already && already.length) return json({ ok: false, error: 'already_paid' }, 409);

    let amount = Number(getField(app, 'price') || 0);
    if (!(amount > 0)) {
      const rateType = String(getField(task as Record<string, unknown>, 'rate_type') || 'fixed').toLowerCase();
      if (rateType === 'hourly') {
        amount = periodTotal(
          Number(getField(task as Record<string, unknown>, 'hourly_rate') || 0),
          Number(getField(task as Record<string, unknown>, 'est_hours') || 0),
        );
      } else {
        amount = Number(getField(task as Record<string, unknown>, 'budget') || 0);
      }
    }
    if (!(amount > 0)) return json({ ok: false, error: 'invalid_amount' }, 400);
    if (amount < 20) {
      return json({
        ok: false,
        error: 'amount_below_minimum',
        message: 'Tasks must be at least $20 CAD.',
        min_amount: 20,
      }, 400);
    }

    const { data: workerUser } = await supabase
      .from('users')
      .select('stripe_connect_id,stripe_payouts_enabled,is_subscriber,date_of_birth,guardian_stripe_payouts_enabled,guardian_consent_status,payout_owner')
      .eq('firebase_uid', workerId)
      .maybeSingle();

    const taskMode = String(getField(task as Record<string, unknown>, 'task_mode') || '').toLowerCase();
    const isRecurring = !!(getField(task as Record<string, unknown>, 'is_recurring')) || taskMode === 'recurring';
    const isSubscriber = !!(workerUser && workerUser.is_subscriber);
    let breakdown = feeBreakdown(amount, { isRecurring, isSubscriber });
    if (Deno.env.get('FEE_FORCE_ENV') === '1') {
      const envPct = Number(Deno.env.get('PLATFORM_FEE_PERCENT') || '15');
      const fee = Math.round(amount * (envPct / 100) * 100) / 100;
      breakdown = {
        total: amount,
        fee,
        payout: Math.round((amount - fee) * 100) / 100,
        rate: envPct / 100,
        ratePct: envPct,
        percent: envPct,
      };
    }

    const amountCents = Math.round(breakdown.total * 100);
    const transferGroup = taskTransferGroup(paymentTaskId);
    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });

    let paymentIntent: Stripe.PaymentIntent;
    try {
      // No transfer_data / on_behalf_of — funds held on the platform (escrow).
      paymentIntent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: 'cad',
        customer: String(posterUser.poster_stripe_customer_id || '') || undefined,
        automatic_payment_methods: { enabled: true },
        transfer_group: transferGroup,
        metadata: {
          project: 'quickgigs',
          purpose: 'task_escrow',
          task_id: paymentTaskId,
          poster_id: posterId,
          worker_id: workerId,
          transfer_group: transferGroup,
          platform_fee: String(breakdown.fee),
          worker_payout: String(breakdown.payout),
        },
      });
    } catch (stripeErr) {
      console.error('paymentIntents.create failed:', stripeErr);
      return json({
        ok: false,
        error: 'stripe_payment_intent_failed',
        details: errMsg(stripeErr),
      }, 502);
    }

    const paymentRow = {
      task_id: paymentTaskId,
      poster_id: posterId,
      worker_id: workerId,
      amount: breakdown.total,
      platform_fee: breakdown.fee,
      worker_payout: breakdown.payout,
      stripe_id: paymentIntent.id,
      status: 'pending',
    };

    const { data: pendingRows } = await supabase
      .from('payments')
      .select('payment_id')
      .eq('task_id', paymentTaskId)
      .eq('poster_id', posterId)
      .eq('status', 'pending')
      .limit(5);

    if (pendingRows && pendingRows.length) {
      const { error: updErr } = await supabase
        .from('payments')
        .update(paymentRow)
        .eq('payment_id', pendingRows[0].payment_id);
      if (updErr) {
        return json({ ok: false, error: 'payment_row_update_failed', details: updErr.message }, 500);
      }
    } else {
      const { error: insErr } = await supabase.from('payments').insert(paymentRow);
      if (insErr) {
        return json({ ok: false, error: 'payment_row_insert_failed', details: insErr.message }, 500);
      }
    }

    return json({
      ok: true,
      payment_intent_id: paymentIntent.id,
      client_secret: paymentIntent.client_secret,
      transfer_group: transferGroup,
      amount: breakdown.total,
      platform_fee: breakdown.fee,
      worker_payout: breakdown.payout,
      currency: 'cad',
      // Card/bank data never touches QuickGigs — confirm via Stripe.js client_secret.
    });
  } catch (err) {
    console.error('create-escrow-intent error:', err);
    return json({ ok: false, error: errMsg(err) }, 500);
  }
});
