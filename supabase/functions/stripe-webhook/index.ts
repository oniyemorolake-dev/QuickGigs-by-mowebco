// QuickGigs — Stripe payments + Connect + role-verification webhook.
// Deploy: supabase functions deploy stripe-webhook --no-verify-jwt
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
// Stripe Dashboard → Webhooks → endpoint URL = .../functions/v1/stripe-webhook
// Events:
//   checkout.session.completed, checkout.session.expired,
//   payment_intent.succeeded, payment_intent.payment_failed,
//   account.updated,
//   identity.*, payment_method.detached
//
// Never store card/bank numbers — Stripe hosts all sensitive payment data.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { connectAccountReady } from '../_shared/connect-ready.ts';

async function markPaymentHeld(
  supabase: ReturnType<typeof createClient>,
  opts: {
    stripeRef: string;
    taskId: string;
    posterId: string;
    workerId: string;
    amountTotal?: number;
  },
) {
  const heldPatch = {
    status: 'held',
    stripe_id: opts.stripeRef,
    completed_at: new Date().toISOString(),
  };

  const { data: byStripe } = await supabase
    .from('payments')
    .update(heldPatch)
    .eq('stripe_id', opts.stripeRef)
    .select('payment_id');

  if (byStripe && byStripe.length) return { updated: true };

  // Also match pending checkout session ids that will be rewritten to pi_
  if (opts.taskId && opts.posterId) {
    const { data: byTask } = await supabase
      .from('payments')
      .update(heldPatch)
      .eq('task_id', opts.taskId)
      .eq('poster_id', opts.posterId)
      .eq('status', 'pending')
      .select('payment_id');
    if (byTask && byTask.length) return { updated: true };
  }

  if (!opts.taskId || !opts.posterId || !opts.workerId) return { updated: false };

  const { data: pendingPair } = await supabase
    .from('payments')
    .select('amount,platform_fee,worker_payout')
    .eq('poster_id', opts.posterId)
    .eq('worker_id', opts.workerId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1);

  const amountTotal = opts.amountTotal != null
    ? opts.amountTotal
    : Number(pendingPair?.[0]?.amount || 0);
  const platformFee = Number(pendingPair?.[0]?.platform_fee);
  const workerPayout = Number(pendingPair?.[0]?.worker_payout);

  await supabase.from('payments').insert({
    task_id: opts.taskId,
    poster_id: opts.posterId,
    worker_id: opts.workerId,
    amount: amountTotal,
    platform_fee: Number.isFinite(platformFee) ? platformFee : 0,
    worker_payout: Number.isFinite(workerPayout) ? workerPayout : 0,
    stripe_id: opts.stripeRef,
    status: 'held',
    completed_at: new Date().toISOString(),
  });
  return { updated: true, inserted: true };
}

async function unlockChat(
  supabase: ReturnType<typeof createClient>,
  taskId: string,
  posterId: string,
  workerId: string,
) {
  const taskIdKeys = (val: string): (string | number)[] => {
    const keys: (string | number)[] = [val];
    if (/^\d+$/.test(val)) keys.push(parseInt(val, 10));
    return keys;
  };

  let convId: string | null = null;
  for (const key of taskIdKeys(taskId)) {
    const { data: convs } = await supabase
      .from('conversations')
      .select('conv_id')
      .eq('task_id', key)
      .eq('poster_id', posterId)
      .eq('worker_id', workerId)
      .limit(1);
    if (convs && convs[0]?.conv_id) {
      convId = convs[0].conv_id;
      break;
    }
  }

  if (!convId) {
    const { data: byPair } = await supabase
      .from('conversations')
      .select('conv_id')
      .eq('poster_id', posterId)
      .eq('worker_id', workerId)
      .in('status', ['in_progress', 'application'])
      .order('created_at', { ascending: false })
      .limit(1);
    convId = byPair?.[0]?.conv_id || null;
  }

  if (convId) {
    await supabase
      .from('conversations')
      .update({ is_unlocked: true, status: 'in_progress' })
      .eq('conv_id', convId);
  }
}

Deno.serve(async (req) => {
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!stripeKey || !webhookSecret) {
    return new Response('Stripe not configured', { status: 503 });
  }
  if (stripeKey.startsWith('sk_live_')) {
    return new Response('Live Stripe keys blocked — TEST mode only', { status: 503 });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('Missing signature', { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature failed:', err);
    return new Response('Invalid signature', { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // --- Connect Express: sync charges_enabled && payouts_enabled onto tasker ---
  if (event.type === 'account.updated') {
    const account = event.data.object as Stripe.Account;
    const uid = String(account.metadata?.firebase_uid || '');
    const payoutOwner = String(account.metadata?.payout_owner || 'worker');
    const ready = connectAccountReady(account);

    if (uid && account.metadata?.project === 'quickgigs') {
      if (payoutOwner === 'guardian') {
        await supabase.from('users').update({
          guardian_stripe_connect_id: account.id,
          guardian_stripe_payouts_enabled: ready.ready,
        }).eq('firebase_uid', uid);
      } else {
        await supabase.from('users').update({
          stripe_connect_id: account.id,
          stripe_payouts_enabled: ready.ready,
        }).eq('firebase_uid', uid);
      }
    } else {
      // Fallback: match by stored connect id if metadata missing
      await supabase.from('users').update({
        stripe_payouts_enabled: ready.ready,
      }).eq('stripe_connect_id', account.id);
      await supabase.from('users').update({
        guardian_stripe_payouts_enabled: ready.ready,
      }).eq('guardian_stripe_connect_id', account.id);
    }

    return new Response(JSON.stringify({
      received: true,
      account: account.id,
      ready: ready.ready,
      charges_enabled: ready.charges_enabled,
      payouts_enabled: ready.payouts_enabled,
    }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  if (
    event.type === 'identity.verification_session.verified' ||
    event.type === 'identity.verification_session.requires_input' ||
    event.type === 'identity.verification_session.canceled'
  ) {
    const verification = event.data.object as Stripe.Identity.VerificationSession;
    const purpose = String(verification.metadata?.purpose || '');
    if (
      verification.metadata?.project !== 'quickgigs' ||
      !['tasker_identity', 'tasker_id_check'].includes(purpose) ||
      !verification.metadata?.firebase_uid
    ) {
      return new Response(JSON.stringify({ ignored: true }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
    const verified = event.type === 'identity.verification_session.verified';
    const idStatus = verified
      ? 'verified'
      : event.type === 'identity.verification_session.requires_input' ? 'rejected' : 'not_started';
    await supabase.from('users').update({
      tasker_id_check_status: idStatus,
      tasker_id_checked_at: verified ? new Date().toISOString() : null,
      tasker_identity_session_id: verification.id,
    }).eq('firebase_uid', verification.metadata.firebase_uid);
    try {
      await supabase.rpc('qg_recompute_tasker_verified', {
        p_uid: verification.metadata.firebase_uid,
      });
    } catch (_rpcErr) {
      /* soft launch RPC may not be deployed yet */
    }
    return new Response(JSON.stringify({ received: true, verification: 'tasker_id_check' }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  if (event.type === 'payment_method.detached') {
    const paymentMethod = event.data.object as Stripe.PaymentMethod;
    await supabase.from('users').update({
      poster_verified: false,
      poster_verified_at: null,
      poster_verification_status: 'failed',
      poster_payment_method_id: null,
    }).eq('poster_payment_method_id', paymentMethod.id);
    return new Response(JSON.stringify({ received: true, verification: 'poster_revoked' }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  if (
    event.type === 'checkout.session.expired' ||
    event.type === 'payment_intent.payment_failed'
  ) {
    const obj = event.data.object as Stripe.Checkout.Session | Stripe.PaymentIntent;
    const meta = (obj as { metadata?: Record<string, string> }).metadata || {};
    if (meta.project !== 'quickgigs') {
      return new Response(JSON.stringify({ ignored: true }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
    const stripeRef = String(obj.id || '');
    if (stripeRef) {
      await supabase
        .from('payments')
        .update({ status: 'failed' })
        .eq('stripe_id', stripeRef)
        .eq('status', 'pending');
    }
    if (meta.task_id && meta.poster_id) {
      await supabase
        .from('payments')
        .update({ status: 'failed' })
        .eq('task_id', meta.task_id)
        .eq('poster_id', meta.poster_id)
        .eq('status', 'pending');
    }
    return new Response(JSON.stringify({ received: true, status: 'failed' }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  // --- Escrow funded via raw PaymentIntent ---
  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent;
    const meta = pi.metadata || {};
    if (meta.project !== 'quickgigs' || meta.purpose === 'poster_payment_method') {
      return new Response(JSON.stringify({ ignored: true }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
    const taskId = String(meta.task_id || '');
    const posterId = String(meta.poster_id || '');
    const workerId = String(meta.worker_id || '');
    await markPaymentHeld(supabase, {
      stripeRef: pi.id,
      taskId,
      posterId,
      workerId,
      amountTotal: pi.amount_received != null ? pi.amount_received / 100 : (pi.amount / 100),
    });
    if (taskId && posterId && workerId) {
      await unlockChat(supabase, taskId, posterId, workerId);
    }
    return new Response(JSON.stringify({
      received: true,
      funded: true,
      payment_intent: pi.id,
      task_id: taskId,
    }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  if (event.type !== 'checkout.session.completed') {
    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  if (session.metadata?.project !== 'quickgigs') {
    return new Response(JSON.stringify({ ignored: true }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  if (
    session.metadata?.purpose === 'poster_payment_method' &&
    session.metadata?.firebase_uid
  ) {
    const expanded = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ['setup_intent'],
    });
    const setupIntent = expanded.setup_intent as Stripe.SetupIntent | null;
    const paymentMethod = setupIntent && typeof setupIntent.payment_method === 'string'
      ? setupIntent.payment_method
      : setupIntent?.payment_method?.id || '';
    if (expanded.status === 'complete' && setupIntent?.status === 'succeeded' && paymentMethod) {
      await supabase.from('users').update({
        poster_verified: true,
        poster_verified_at: new Date().toISOString(),
        poster_verification_status: 'verified',
        poster_payment_method_id: paymentMethod,
      }).eq('firebase_uid', session.metadata.firebase_uid);
    }
    return new Response(JSON.stringify({ received: true, verification: 'poster' }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  const taskId = String(session.metadata?.task_id || '');
  const posterId = String(session.metadata?.poster_id || '');
  const workerId = String(session.metadata?.worker_id || '');
  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id || session.id;

  if (!taskId || !posterId || !workerId) {
    return new Response('Missing metadata', { status: 400 });
  }

  // Prefer updating the pending checkout session row first (stripe_id = cs_…)
  const heldPatch = {
    status: 'held',
    stripe_id: paymentIntentId,
    completed_at: new Date().toISOString(),
  };
  const { data: bySession } = await supabase
    .from('payments')
    .update(heldPatch)
    .eq('stripe_id', session.id)
    .select('payment_id');

  if (!bySession || !bySession.length) {
    await markPaymentHeld(supabase, {
      stripeRef: paymentIntentId,
      taskId,
      posterId,
      workerId,
      amountTotal: session.amount_total != null ? session.amount_total / 100 : undefined,
    });
  }

  await unlockChat(supabase, taskId, posterId, workerId);

  return new Response(JSON.stringify({ ok: true, task_id: taskId, funded: true }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
});
