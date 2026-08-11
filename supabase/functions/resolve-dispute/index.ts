// QuickGigs — admin resolve dispute (release / refund / split) via Stripe
// Deploy: supabase functions deploy resolve-dispute --no-verify-jwt

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

function getField(row: Record<string, unknown> | null | undefined, key: string) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  for (const k of Object.keys(row)) {
    if (k.toLowerCase() === lower) return row[k];
  }
  return undefined;
}

function isMinor(dateOfBirth: unknown): boolean {
  const raw = String(dateOfBirth || '');
  const dob = new Date(`${raw}T00:00:00Z`);
  if (!raw || Number.isNaN(dob.getTime())) return false;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  if (
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate())
  ) age -= 1;
  return age < 18;
}

async function requireAdmin(
  supabase: ReturnType<typeof createClient>,
  identity: { uid: string; email: string },
) {
  const { data: row } = await supabase.from('admins').select('user_id').eq('user_id', identity.uid).maybeSingle();
  if (row) return true;
  const allowEmail = (Deno.env.get('ADMIN_NOTIFY_EMAIL') || 'mowebsiteco@gmail.com').toLowerCase();
  if (identity.email && identity.email.toLowerCase() === allowEmail) return true;
  return false;
}

async function resolvePaymentIntentId(stripe: Stripe, stripeRef: string): Promise<string> {
  if (stripeRef.startsWith('pi_')) return stripeRef;
  if (stripeRef.startsWith('cs_')) {
    const session = await stripe.checkout.sessions.retrieve(stripeRef);
    const pi = session.payment_intent;
    return typeof pi === 'string' ? pi : (pi?.id || '');
  }
  return '';
}

async function transferToWorker(
  stripe: Stripe,
  supabase: ReturnType<typeof createClient>,
  payment: Record<string, unknown>,
  workerId: string,
  amountCents: number,
  taskId: string,
  posterId: string,
) {
  if (amountCents <= 0) return { transfer_id: null as string | null };

  const { data: workerUser } = await supabase
    .from('users')
    .select('date_of_birth,guardian_consent_status,guardian_stripe_connect_id,guardian_stripe_payouts_enabled,stripe_connect_id,stripe_payouts_enabled')
    .eq('firebase_uid', workerId)
    .maybeSingle();

  const minor = isMinor(workerUser?.date_of_birth);
  if (minor && workerUser?.guardian_consent_status !== 'approved') {
    throw new Error('guardian_consent_required');
  }
  const connectId = minor
    ? String(workerUser?.guardian_stripe_connect_id || '')
    : String(workerUser?.stripe_connect_id || '');
  if (!connectId) throw new Error(minor ? 'guardian_payout_setup_required' : 'worker_payout_setup_required');

  const account = await stripe.accounts.retrieve(connectId);
  if (!account.payouts_enabled) {
    throw new Error(minor ? 'guardian_payout_setup_incomplete' : 'worker_payout_setup_incomplete');
  }

  const stripeRef = String(getField(payment, 'stripe_id') || '');
  let sourceTransaction: string | undefined;
  const piId = await resolvePaymentIntentId(stripe, stripeRef);
  if (piId.startsWith('pi_')) {
    const pi = await stripe.paymentIntents.retrieve(piId);
    const charge = pi.latest_charge;
    sourceTransaction = typeof charge === 'string' ? charge : charge?.id;
  }

  const transfer = await stripe.transfers.create({
    amount: amountCents,
    currency: 'cad',
    destination: connectId,
    ...(sourceTransaction ? { source_transaction: sourceTransaction } : {}),
    metadata: {
      project: 'quickgigs',
      task_id: taskId,
      worker_id: workerId,
      poster_id: posterId,
      payout_owner: minor ? 'guardian' : 'self',
      via: 'dispute_resolve',
    },
  });
  return { transfer_id: transfer.id, payout_owner: minor ? 'guardian' : 'self' };
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
      return json({ ok: false, error: 'live_keys_blocked' }, 503);
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const disputeId = String(body.dispute_id || '').trim();
    const resolution = String(body.resolution || '').toLowerCase();
    const reason = String(body.reason || body.resolution_reason || '').trim().slice(0, 2000);
    if (!disputeId) return json({ ok: false, error: 'missing_dispute_id' }, 400);
    if (!['release', 'refund', 'split'].includes(resolution)) {
      return json({ ok: false, error: 'invalid_resolution' }, 400);
    }
    if (reason.length < 3) return json({ ok: false, error: 'reason_required' }, 400);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    if (!(await requireAdmin(supabase, identity))) {
      return json({ ok: false, error: 'admin_required' }, 403);
    }

    const { data: dispute, error: dErr } = await supabase
      .from('disputes')
      .select('*')
      .eq('dispute_id', disputeId)
      .maybeSingle();
    if (dErr) throw dErr;
    if (!dispute) return json({ ok: false, error: 'dispute_not_found' }, 404);

    const st = String(dispute.status || '').toLowerCase();
    if (st === 'resolved' || st === 'rejected') {
      return json({ ok: true, already: true, resolution: dispute.resolution });
    }

    const taskId = String(dispute.task_id || '');
    const { data: pays } = await supabase
      .from('payments')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
      .limit(10);

    const payment = (pays || []).find((p) => {
      const ps = String(p.status || '').toLowerCase();
      return ps === 'disputed' || ps === 'held';
    }) as Record<string, unknown> | undefined;

    if (!payment) return json({ ok: false, error: 'no_held_payment' }, 400);

    const amount = Number(getField(payment, 'amount') || 0);
    const workerPayout = Number(getField(payment, 'worker_payout') || 0);
    let releaseAmount = Number(body.release_amount);
    let refundAmount = Number(body.refund_amount);

    if (resolution === 'release') {
      releaseAmount = workerPayout;
      refundAmount = 0;
    } else if (resolution === 'refund') {
      releaseAmount = 0;
      refundAmount = amount;
    } else {
      // split — amounts required in CAD
      if (!Number.isFinite(releaseAmount) || !Number.isFinite(refundAmount) || releaseAmount < 0 || refundAmount < 0) {
        return json({ ok: false, error: 'split_amounts_required' }, 400);
      }
      if (Math.round((releaseAmount + refundAmount) * 100) > Math.round(amount * 100) + 1) {
        return json({ ok: false, error: 'split_exceeds_amount' }, 400);
      }
    }

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
    const posterId = String(getField(payment, 'poster_id') || '');
    const workerId = String(getField(payment, 'worker_id') || '');
    const stripeRef = String(getField(payment, 'stripe_id') || '');
    const piId = await resolvePaymentIntentId(stripe, stripeRef);
    if (!piId.startsWith('pi_')) return json({ ok: false, error: 'invalid_payment_reference' }, 400);

    let transferId: string | null = null;
    let refundId: string | null = null;
    let payoutOwner: string | null = null;

    const releaseCents = Math.round(releaseAmount * 100);
    const refundCents = Math.round(refundAmount * 100);

    if (refundCents > 0) {
      const refund = await stripe.refunds.create({
        payment_intent: piId,
        amount: refundCents,
        metadata: {
          project: 'quickgigs',
          task_id: taskId,
          dispute_id: disputeId,
          via: 'dispute_resolve',
        },
      });
      refundId = refund.id;
    }

    if (releaseCents > 0) {
      const transferred = await transferToWorker(
        stripe,
        supabase,
        payment,
        workerId,
        releaseCents,
        taskId,
        posterId,
      );
      transferId = transferred.transfer_id;
      payoutOwner = transferred.payout_owner || null;
    }

    const now = new Date().toISOString();
    let payStatus = 'paid';
    if (releaseCents <= 0 && refundCents > 0) payStatus = 'refunded';
    else if (releaseCents > 0 && refundCents > 0) payStatus = 'paid';

    await supabase
      .from('payments')
      .update({
        status: payStatus,
        transfer_id: transferId || getField(payment, 'transfer_id') || null,
        completed_at: now,
      })
      .eq('payment_id', getField(payment, 'payment_id'));

    await supabase
      .from('disputes')
      .update({
        status: 'resolved',
        resolution,
        resolved_by: identity.uid,
        resolved_at: now,
        resolution_reason: reason,
        release_amount: releaseAmount,
        refund_amount: refundAmount,
      })
      .eq('dispute_id', disputeId);

    await supabase
      .from('tasks')
      .update({ evidence_frozen: false })
      .eq('task_id', taskId);

    try {
      await supabase.from('admin_actions').insert({
        admin_id: identity.uid,
        action: 'dispute_resolved_' + resolution,
        target_type: 'dispute',
        target_id: disputeId,
        detail: JSON.stringify({
          release_amount: releaseAmount,
          refund_amount: refundAmount,
          transfer_id: transferId,
          refund_id: refundId,
          reason,
        }),
      });
    } catch (_) { /* optional */ }

    return json({
      ok: true,
      dispute_id: disputeId,
      resolution,
      release_amount: releaseAmount,
      refund_amount: refundAmount,
      transfer_id: transferId,
      refund_id: refundId,
      payout_owner: payoutOwner,
      payment_status: payStatus,
    });
  } catch (err) {
    console.error('resolve-dispute error:', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
