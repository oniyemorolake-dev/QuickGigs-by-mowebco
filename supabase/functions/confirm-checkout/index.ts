// QuickGigs — Confirm Stripe checkout session (instant unlock; backup for webhook delay)
// Also: sync unlock by conv_id (tasker side after poster pays)
// Deploy: supabase functions deploy confirm-checkout --no-verify-jwt

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
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function isNumericId(val: string): boolean {
  return /^\d+$/.test(String(val || '').trim());
}

function taskIdKeys(taskId: string): (string | number)[] {
  const keys: (string | number)[] = [];
  const seen = new Set<string>();
  const add = (v: string | number) => {
    const s = String(v);
    if (seen.has(s)) return;
    seen.add(s);
    keys.push(v);
  };
  add(taskId);
  if (isNumericId(taskId)) add(parseInt(taskId, 10));
  return keys;
}

function paymentRank(status: string): number {
  const st = String(status || '').toLowerCase();
  if (st === 'paid' || st === 'completed') return 4;
  if (st === 'held') return 3;
  if (st === 'pending') return 1;
  return 0;
}

function isPaidStatus(status: string): boolean {
  const st = String(status || '').toLowerCase();
  return st === 'held' || st === 'paid' || st === 'completed';
}

async function findPaidPayment(
  supabase: ReturnType<typeof createClient>,
  stripe: Stripe,
  posterId: string,
  workerId: string,
) {
  const { data: rows } = await supabase
    .from('payments')
    .select('*')
    .eq('poster_id', posterId)
    .eq('worker_id', workerId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (!rows || !rows.length) return null;

  const best = rows.reduce((a, b) => (paymentRank(a.status) > paymentRank(b.status) ? a : b));
  if (isPaidStatus(best.status)) return best;

  for (const row of rows) {
    if (String(row.status || '').toLowerCase() !== 'pending' || !row.stripe_id) continue;
    const sid = String(row.stripe_id);
    if (!sid.startsWith('cs_')) continue;
    try {
      const session = await stripe.checkout.sessions.retrieve(sid);
      const paid = session.payment_status === 'paid' || session.status === 'complete';
      if (!paid) continue;
      const paymentIntentId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id || session.id;
      await supabase
        .from('payments')
        .update({
          status: 'held',
          stripe_id: paymentIntentId,
          completed_at: new Date().toISOString(),
        })
        .eq('payment_id', row.payment_id);
      return { ...row, status: 'held' };
    } catch (err) {
      console.warn('Could not verify pending Stripe session:', sid, err);
    }
  }

  return null;
}

async function unlockConversation(
  supabase: ReturnType<typeof createClient>,
  taskId: string,
  posterId: string,
  workerId: string,
) {
  for (const key of taskIdKeys(taskId)) {
    const { data: convs } = await supabase
      .from('conversations')
      .select('conv_id')
      .eq('task_id', key)
      .eq('poster_id', posterId)
      .eq('worker_id', workerId)
      .limit(1);
    if (convs && convs[0]?.conv_id) {
      await supabase
        .from('conversations')
        .update({ is_unlocked: true, status: 'in_progress' })
        .eq('conv_id', convs[0].conv_id);
      return convs[0].conv_id;
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

  if (byPair && byPair[0]?.conv_id) {
    await supabase
      .from('conversations')
      .update({ is_unlocked: true, status: 'in_progress' })
      .eq('conv_id', byPair[0].conv_id);
    return byPair[0].conv_id;
  }

  return null;
}

async function syncUnlockByConversation(
  supabase: ReturnType<typeof createClient>,
  stripe: Stripe,
  convId: string,
  actorId: string,
) {
  const { data: conv, error: convErr } = await supabase
    .from('conversations')
    .select('*')
    .eq('conv_id', convId)
    .maybeSingle();

  if (convErr || !conv) return json({ ok: false, error: 'conv_not_found' }, 404);
  if (actorId !== conv.poster_id && actorId !== conv.worker_id) {
    return json({ ok: false, error: 'not_participant' }, 403);
  }

  const payment = await findPaidPayment(supabase, stripe, conv.poster_id, conv.worker_id);
  if (!payment) return json({ ok: false, error: 'not_paid' }, 402);

  await supabase
    .from('conversations')
    .update({ is_unlocked: true, status: 'in_progress' })
    .eq('conv_id', convId);

  return json({
    ok: true,
    unlocked: true,
    conv_id: convId,
    payment_status: payment.status,
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

    const body = await req.json().catch(() => ({}));
    const sessionId = String(body.session_id || '').trim();
    const convId = String(body.conv_id || '').trim();
    const actorId = identity.uid; // server-derived

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });

    if (convId && !sessionId) {
      return await syncUnlockByConversation(supabase, stripe, convId, actorId);
    }

    if (!sessionId) return json({ ok: false, error: 'missing_session_or_conv' }, 400);

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.metadata?.project !== 'quickgigs') {
      return json({ ok: false, error: 'not_quickgigs_session' }, 400);
    }

    const paid =
      session.payment_status === 'paid' ||
      session.status === 'complete';

    if (!paid) {
      return json({
        ok: false,
        error: 'payment_not_complete',
        status: session.payment_status || session.status,
      }, 409);
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

    // Only poster or worker on this payment may confirm
    if (actorId !== posterId && actorId !== workerId) {
      return json({ ok: false, error: 'not_authorized' }, 403);
    }

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
      let updated = false;
      for (const key of taskIdKeys(taskId)) {
        const { data: byTask } = await supabase
          .from('payments')
          .update(heldPatch)
          .eq('task_id', key)
          .eq('poster_id', posterId)
          .eq('status', 'pending')
          .select('payment_id');
        if (byTask && byTask.length) {
          updated = true;
          break;
        }
      }

      if (!updated) {
        const { data: pendingPair } = await supabase
          .from('payments')
          .select('amount,platform_fee,worker_payout')
          .eq('poster_id', posterId)
          .eq('worker_id', workerId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(1);
        const amountTotal = session.amount_total != null
          ? session.amount_total / 100
          : Number(pendingPair?.[0]?.amount || 0);
        const platformFee = Number(pendingPair?.[0]?.platform_fee);
        const workerPayout = Number(pendingPair?.[0]?.worker_payout);
        await supabase.from('payments').insert({
          task_id: taskId,
          poster_id: posterId,
          worker_id: workerId,
          amount: amountTotal,
          platform_fee: Number.isFinite(platformFee) ? platformFee : 0,
          worker_payout: Number.isFinite(workerPayout) ? workerPayout : 0,
          stripe_id: paymentIntentId,
          status: 'held',
          completed_at: new Date().toISOString(),
        });
      }
    }

    const unlockedConvId = convId || await unlockConversation(supabase, taskId, posterId, workerId);

    return json({ ok: true, task_id: taskId, status: 'held', conv_id: unlockedConvId });
  } catch (err) {
    console.error('confirm-checkout error:', err);
    return json({ ok: false, error: 'confirm_failed' }, 500);
  }
});
