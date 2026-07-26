// QuickGigs — Recover paid Stripe checkouts → held payments + unlock chat
// Deploy: supabase functions deploy sync-payment --no-verify-jwt
// Use when UI says "no completed payment" after a real Stripe pay.

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

function isUuidLike(val: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(val || '').trim(),
  );
}

function isNumericId(val: string): boolean {
  return /^\d+$/.test(String(val || '').trim());
}

function paymentRank(status: unknown): number {
  const st = String(status || '').toLowerCase();
  if (st === 'paid' || st === 'completed') return 4;
  if (st === 'held') return 3;
  if (st === 'pending') return 1;
  return 0;
}

type Sb = ReturnType<typeof createClient>;

async function unlockConversation(
  supabase: Sb,
  taskId: string,
  posterId: string,
  workerId: string,
  legacyTaskId: string,
) {
  const keys: (string | number)[] = [];
  if (taskId) keys.push(taskId);
  if (legacyTaskId && isNumericId(legacyTaskId)) keys.push(parseInt(legacyTaskId, 10));

  for (const key of keys) {
    const { data: convs } = await supabase
      .from('conversations')
      .select('conv_id')
      .eq('task_id', key)
      .eq('poster_id', posterId)
      .eq('worker_id', workerId)
      .limit(1);
    if (convs?.[0]?.conv_id) {
      await supabase
        .from('conversations')
        .update({ is_unlocked: true, status: 'in_progress' })
        .eq('conv_id', convs[0].conv_id);
      return String(convs[0].conv_id);
    }
  }

  const { data: byPair } = await supabase
    .from('conversations')
    .select('conv_id')
    .eq('poster_id', posterId)
    .eq('worker_id', workerId)
    .in('status', ['in_progress', 'application'])
    .order('created_at', { ascending: false })
    .limit(1);

  if (byPair?.[0]?.conv_id) {
    await supabase
      .from('conversations')
      .update({ is_unlocked: true, status: 'in_progress' })
      .eq('conv_id', byPair[0].conv_id);
    return String(byPair[0].conv_id);
  }
  return null;
}

async function upsertHeldPayment(
  supabase: Sb,
  opts: {
    taskId: string;
    posterId: string;
    workerId: string;
    amount: number;
    stripeId: string;
    sessionId: string;
  },
) {
  const heldPatch = {
    status: 'held',
    stripe_id: opts.stripeId,
    completed_at: new Date().toISOString(),
  };

  // Update by checkout session id (pending rows store cs_…)
  const { data: bySession } = await supabase
    .from('payments')
    .update(heldPatch)
    .eq('stripe_id', opts.sessionId)
    .select('payment_id,task_id,status');
  if (bySession && bySession.length) return bySession[0];

  // Update by payment intent id
  const { data: byPi } = await supabase
    .from('payments')
    .update(heldPatch)
    .eq('stripe_id', opts.stripeId)
    .select('payment_id,task_id,status');
  if (byPi && byPi.length) return byPi[0];

  // Update pending by poster+worker
  const { data: byPair } = await supabase
    .from('payments')
    .update(heldPatch)
    .eq('poster_id', opts.posterId)
    .eq('worker_id', opts.workerId)
    .eq('status', 'pending')
    .select('payment_id,task_id,status');
  if (byPair && byPair.length) return byPair[0];

  // Update pending by UUID task
  if (isUuidLike(opts.taskId)) {
    const { data: byTask } = await supabase
      .from('payments')
      .update(heldPatch)
      .eq('task_id', opts.taskId)
      .eq('poster_id', opts.posterId)
      .eq('status', 'pending')
      .select('payment_id,task_id,status');
    if (byTask && byTask.length) return byTask[0];
  }

  // Already held?
  const { data: existing } = await supabase
    .from('payments')
    .select('payment_id,task_id,status')
    .eq('poster_id', opts.posterId)
    .eq('worker_id', opts.workerId)
    .in('status', ['held', 'paid', 'completed'])
    .order('created_at', { ascending: false })
    .limit(1);
  if (existing && existing.length) return existing[0];

  if (!isUuidLike(opts.taskId)) {
    return null;
  }

  const { data: inserted, error } = await supabase
    .from('payments')
    .insert({
      task_id: opts.taskId,
      poster_id: opts.posterId,
      worker_id: opts.workerId,
      amount: opts.amount,
      platform_fee: 0,
      worker_payout: 0,
      stripe_id: opts.stripeId,
      status: 'held',
      completed_at: new Date().toISOString(),
    })
    .select('payment_id,task_id,status')
    .limit(1);

  if (error) {
    console.error('sync-payment insert failed:', error);
    return null;
  }
  return inserted?.[0] || null;
}

async function markSessionHeld(
  supabase: Sb,
  stripe: Stripe,
  session: Stripe.Checkout.Session,
) {
  if (session.metadata?.project !== 'quickgigs') return null;
  const paid = session.payment_status === 'paid' || session.status === 'complete';
  if (!paid) return null;

  const taskId = String(session.metadata?.task_id || '');
  const posterId = String(session.metadata?.poster_id || '');
  const workerId = String(session.metadata?.worker_id || '');
  const legacyTaskId = String(session.metadata?.legacy_task_id || '');
  if (!taskId || !posterId || !workerId) return null;

  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id || session.id;
  const amount = session.amount_total != null ? session.amount_total / 100 : 0;

  const row = await upsertHeldPayment(supabase, {
    taskId,
    posterId,
    workerId,
    amount,
    stripeId: paymentIntentId,
    sessionId: session.id,
  });
  if (!row) return null;

  const convId = await unlockConversation(supabase, taskId, posterId, workerId, legacyTaskId);
  return {
    payment_id: row.payment_id,
    task_id: String(row.task_id || taskId),
    status: String(row.status || 'held'),
    poster_id: posterId,
    worker_id: workerId,
    conv_id: convId,
    session_id: session.id,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) return json({ ok: false, error: 'stripe_not_configured' }, 503);

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!serviceKey) return json({ ok: false, success: false, error: 'service_role_missing' }, 503);

    const body = await req.json();
    const posterId = String(body.poster_id || body.actor_id || '').trim();
    const workerIdHint = String(body.worker_id || '').trim();
    const taskIdHint = String(body.task_id || '').trim();

    if (!posterId) return json({ ok: false, error: 'missing_poster' }, 400);

    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey);
    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });

    const recovered: Record<string, unknown>[] = [];

    // 1) Confirm pending rows that still have checkout session ids
    const { data: pendingRows } = await supabase
      .from('payments')
      .select('*')
      .eq('poster_id', posterId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(20);

    for (const row of pendingRows || []) {
      if (workerIdHint && String(row.worker_id || '') !== workerIdHint) continue;
      const sid = String(row.stripe_id || '');
      try {
        if (sid.startsWith('cs_')) {
          const session = await stripe.checkout.sessions.retrieve(sid);
          const marked = await markSessionHeld(supabase, stripe, session);
          if (marked) recovered.push(marked);
          continue;
        }
        // Pending row already has payment_intent id — promote if Stripe says succeeded
        if (sid.startsWith('pi_')) {
          const pi = await stripe.paymentIntents.retrieve(sid);
          if (pi.status === 'succeeded') {
            const taskId = String(row.task_id || '');
            const workerId = String(row.worker_id || workerIdHint || '');
            if (taskId && workerId) {
              const held = await upsertHeldPayment(supabase, {
                taskId,
                posterId,
                workerId,
                amount: Number(row.amount || 0),
                stripeId: sid,
                sessionId: sid,
              });
              if (held) {
                const convId = await unlockConversation(
                  supabase,
                  taskId,
                  posterId,
                  workerId,
                  isNumericId(taskIdHint) ? taskIdHint : '',
                );
                recovered.push({
                  payment_id: held.payment_id,
                  task_id: String(held.task_id || taskId),
                  status: String(held.status || 'held'),
                  poster_id: posterId,
                  worker_id: workerId,
                  conv_id: convId,
                });
              }
            }
          }
        }
      } catch (err) {
        console.warn('sync-payment pending confirm failed:', sid, err);
      }
    }

    // 2) Scan recent Stripe checkout sessions for this poster (recovers missing DB rows)
    try {
      const listed = await stripe.checkout.sessions.list({ limit: 100 });
      for (const session of listed.data || []) {
        const metaPoster = String(session.metadata?.poster_id || '');
        if (metaPoster && metaPoster !== posterId) continue;
        // Also accept sessions with no metadata poster if we already have a pending row for this cs_
        if (!metaPoster) continue;
        if (workerIdHint && String(session.metadata?.worker_id || '') !== workerIdHint) continue;
        const marked = await markSessionHeld(supabase, stripe, session);
        if (marked) recovered.push(marked);
      }
    } catch (listErr) {
      console.warn('sync-payment session list failed:', listErr);
    }

    // 3) Return best held payment for this poster (+ optional worker)
    const { data: heldRows } = await supabase
      .from('payments')
      .select('*')
      .eq('poster_id', posterId)
      .in('status', ['held', 'paid', 'completed'])
      .order('created_at', { ascending: false })
      .limit(20);

    let best = null as Record<string, unknown> | null;
    for (const row of heldRows || []) {
      if (workerIdHint && String(row.worker_id || '') !== workerIdHint) continue;
      if (!best || paymentRank(row.status) > paymentRank(best.status)) best = row as Record<string, unknown>;
    }
    if (!best && heldRows && heldRows.length) best = heldRows[0] as Record<string, unknown>;

    if (!best) {
      return json({
        ok: false,
        success: false,
        error: 'no_paid_session_found',
        details: 'No Stripe-paid QuickGigs checkout found for this poster. Do not pay again until you check Stripe Dashboard → Payments.',
        recovered: recovered.length,
      }, 404);
    }

    // Ensure chat unlocked for best row
    const convId = await unlockConversation(
      supabase,
      String(best.task_id || ''),
      posterId,
      String(best.worker_id || workerIdHint || ''),
      isNumericId(taskIdHint) ? taskIdHint : '',
    );

    return json({
      ok: true,
      success: true,
      payment: best,
      task_id: best.task_id,
      worker_id: best.worker_id,
      status: best.status,
      conv_id: convId,
      recovered: recovered.length,
    });
  } catch (err) {
    console.error('sync-payment error:', err);
    return json({
      ok: false,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});
