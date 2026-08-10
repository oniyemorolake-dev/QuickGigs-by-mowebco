// QuickGigs — Stripe Checkout for accepted task (poster pays)
// Deploy: supabase functions deploy create-checkout --no-verify-jwt
// Secrets: STRIPE_SECRET_KEY, SITE_URL (https://quickgigs.ca), SUPABASE_SERVICE_ROLE_KEY

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
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getField(row: Record<string, unknown>, key: string) {
  const lower = key.toLowerCase();
  for (const k of Object.keys(row || {})) {
    if (k.toLowerCase() === lower) return row[k];
  }
  return undefined;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e.message === 'string' && e.message) return e.message;
    if (typeof e.error === 'string' && e.error) return e.error;
    if (typeof e.details === 'string' && e.details) return e.details;
    if (typeof e.hint === 'string' && e.hint) return e.hint;
    if (typeof e.code === 'string' && e.code) return e.code;
    try {
      const raw = JSON.stringify(err);
      if (raw && raw !== '{}') return raw.length > 240 ? raw.slice(0, 240) + '…' : raw;
    } catch {
      /* fall through */
    }
  }
  return 'checkout_failed';
}

function resolveAmount(task: Record<string, unknown>, app: Record<string, unknown>) {
  // Accepted offer price wins when present (negotiation).
  const price = getField(app, 'price');
  if (price != null && price !== '' && Number(price) > 0) return Number(price);

  const rateType = String(getField(task, 'rate_type') || 'fixed').toLowerCase();
  if (rateType === 'hourly') {
    const hr = Number(getField(task, 'hourly_rate') || 0);
    const hours = Number(getField(task, 'est_hours') || 0);
    if (hr > 0 && hours > 0) return periodTotal(hr, hours);
  }
  const budget = getField(task, 'budget');
  return Number(budget || 0);
}

function isNumericId(val: string): boolean {
  return /^\d+$/.test(String(val || '').trim());
}

function isUuidLike(val: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(val || '').trim(),
  );
}

function relationTaskKeys(task: Record<string, unknown> | null, inputTaskId: string): (string | number)[] {
  const keys: (string | number)[] = [];
  const seen = new Set<string>();
  const add = (v: unknown) => {
    if (v == null || v === '') return;
    const s = String(v);
    if (seen.has(s)) return;
    seen.add(s);
    keys.push(v as string | number);
    const n = parseInt(s, 10);
    if (!isNaN(n) && String(n) === s) {
      const ns = 'n:' + n;
      if (!seen.has(ns)) {
        seen.add(ns);
        keys.push(n);
      }
    }
  };
  add(inputTaskId);
  if (task) {
    add(getField(task, 'id'));
    add(getField(task, 'task_id'));
  }
  return keys;
}

function findAcceptedApp(rows: unknown[] | null | undefined) {
  return (rows || []).find((row) =>
    String(getField(row as Record<string, unknown>, 'status') || '').toLowerCase() === 'accepted'
  ) as Record<string, unknown> | undefined;
}

function canonicalTaskId(task: Record<string, unknown>): string {
  return String(getField(task, 'task_id') || getField(task, 'id') || '');
}

async function findAcceptedAppForTaskUuid(
  supabase: any,
  taskUuid: string,
) {
  if (!taskUuid) return null;
  const { data, error } = await supabase.from('applications').select('*').eq('task_id', taskUuid);
  if (error) return null;
  return findAcceptedApp(data) || null;
}

async function matchInProgressTaskByWorker(
  supabase: any,
  tasks: Record<string, unknown>[],
  workerId: string,
) {
  for (const t of tasks) {
    const uuid = canonicalTaskId(t);
    if (!uuid) continue;
    const accepted = await findAcceptedAppForTaskUuid(supabase, uuid);
    if (accepted && String(getField(accepted, 'worker_id') || '') === workerId) return t;
  }
  return null;
}

async function fetchInProgressPosterTasks(
  supabase: any,
  posterId: string,
) {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('posted_by', posterId)
    .eq('status', 'in_progress');
  if (error) return { tasks: [] as Record<string, unknown>[], error };
  return { tasks: (data || []) as Record<string, unknown>[], error: null };
}

async function fetchTaskRow(
  supabase: any,
  taskId: string,
  posterId: string,
) {
  if (isUuidLike(taskId)) {
    const { data, error } = await supabase.from('tasks').select('*').eq('task_id', taskId).limit(1);
    if (data && data[0]) return { task: data[0] as Record<string, unknown>, error: null };
    if (error) return { task: null, error };
  }

  const legacyKeys = relationTaskKeys(null, taskId);
  const { tasks: inProgress, error: listErr } = await fetchInProgressPosterTasks(supabase, posterId);

  if (listErr) return { task: null, error: listErr };

  for (const key of legacyKeys) {
    const { data: convs } = await supabase
      .from('conversations')
      .select('*')
      .eq('task_id', key)
      .eq('poster_id', posterId)
      .limit(5);
    for (const conv of convs || []) {
      const workerId = String(getField(conv as Record<string, unknown>, 'worker_id') || '');
      const matched = await matchInProgressTaskByWorker(supabase, inProgress, workerId);
      if (matched) return { task: matched, error: null };
    }
  }

  for (const key of legacyKeys) {
    const { data: apps, error: appErr } = await supabase.from('applications').select('*').eq('task_id', key);
    if (appErr) continue;
    const accepted = findAcceptedApp(apps);
    if (!accepted) continue;
    const workerId = String(getField(accepted, 'worker_id') || '');
    const matched = await matchInProgressTaskByWorker(supabase, inProgress, workerId);
    if (matched) return { task: matched, error: null };
    const appTaskId = String(getField(accepted, 'task_id') || '');
    if (isUuidLike(appTaskId)) {
      const { data } = await supabase.from('tasks').select('*').eq('task_id', appTaskId).limit(1);
      if (data && data[0]) return { task: data[0] as Record<string, unknown>, error: null };
    }
  }

  const eligible: Record<string, unknown>[] = [];
  for (const t of inProgress) {
    const uuid = canonicalTaskId(t);
    if (uuid && await findAcceptedAppForTaskUuid(supabase, uuid)) eligible.push(t);
  }
  if (eligible.length === 1) return { task: eligible[0], error: null };

  for (const t of inProgress) {
    const uuid = canonicalTaskId(t);
    if (legacyKeys.some((k) => String(k) === uuid)) return { task: t, error: null };
  }

  if (!isNumericId(taskId) && !isUuidLike(taskId)) {
    const { data, error } = await supabase.from('tasks').select('*').eq('task_id', taskId).limit(1);
    if (data && data[0]) return { task: data[0] as Record<string, unknown>, error: null };
    if (error) return { task: null, error };
  }

  return { task: null, error: null };
}

async function fetchAcceptedApp(
  supabase: any,
  task: Record<string, unknown>,
  inputTaskId: string,
) {
  const taskUuid = canonicalTaskId(task);
  if (taskUuid) {
    const byUuid = await findAcceptedAppForTaskUuid(supabase, taskUuid);
    if (byUuid) return { app: byUuid, error: null };
  }

  const keys = relationTaskKeys(task, inputTaskId);
  let lastErr: unknown = null;
  for (const key of keys) {
    const { data, error } = await supabase.from('applications').select('*').eq('task_id', key);
    if (error) {
      lastErr = error;
      continue;
    }
    const accepted = findAcceptedApp(data);
    if (accepted) return { app: accepted as Record<string, unknown>, error: null };
  }
  return { app: null, error: lastErr };
}

async function upsertPendingPayment(
  supabase: any,
  row: Record<string, unknown>,
) {
  const taskId = String(row.task_id || '');
  const posterId = String(row.poster_id || '');
  const workerId = String(row.worker_id || '');
  let existing: { payment_id?: string }[] | null = null;

  if (posterId && workerId) {
    const byPair = await supabase
      .from('payments')
      .select('payment_id')
      .eq('poster_id', posterId)
      .eq('worker_id', workerId)
      .eq('status', 'pending')
      .limit(1);
    if (byPair.data && byPair.data.length) existing = byPair.data;
  }

  if ((!existing || !existing.length) && isUuidLike(taskId)) {
    const byTask = await supabase
      .from('payments')
      .select('payment_id')
      .eq('task_id', taskId)
      .eq('status', 'pending')
      .limit(1);
    if (byTask.error) return { ok: false, error: errorMessage(byTask.error) };
    if (byTask.data && byTask.data.length) existing = byTask.data;
  }

  if (existing && existing[0]?.payment_id) {
    const { error: updErr } = await supabase
      .from('payments')
      .update(row)
      .eq('payment_id', existing[0].payment_id);
    if (updErr) return { ok: false, error: errorMessage(updErr) };
    return { ok: true };
  }

  if (!isUuidLike(taskId)) {
    return { ok: false, error: 'payments.task_id requires a UUID' };
  }

  const { error: insErr } = await supabase.from('payments').insert(row);
  if (insErr) return { ok: false, error: errorMessage(insErr) };
  return { ok: true };
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
    // Hard-block live keys until public launch — escrow is TEST mode only.
    if (stripeKey.startsWith('sk_live_')) {
      return json({
        ok: false,
        error: 'live_keys_blocked',
        message: 'Escrow is running in Stripe TEST mode only.',
      }, 503);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceKey) {
      return json({ ok: false, error: 'supabase_service_role_not_configured' }, 503);
    }

    const body = await req.json();
    const taskId = String(body.task_id || '').trim();
    const requestedPosterId = String(body.poster_id || '').trim();
    const posterId = identity.uid;
    if (!taskId || !posterId) return json({ ok: false, error: 'missing_task_or_poster' }, 400);
    if (requestedPosterId && requestedPosterId !== posterId) {
      return json({ ok: false, error: 'poster_identity_mismatch' }, 403);
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: posterUser, error: posterUserError } = await supabase
      .from('users')
      .select('account_status,status,is_poster,poster_verified,poster_verification_status,poster_stripe_customer_id,poster_payment_method_id')
      .eq('firebase_uid', posterId)
      .maybeSingle();
    if (posterUserError) throw posterUserError;
    if (
      !posterUser ||
      posterUser.account_status !== 'active' ||
      ['banned', 'blocked', 'suspended'].includes(String(posterUser.status || '').toLowerCase())
    ) return json({ ok: false, error: 'account_not_active' }, 403);
    if (posterUser.is_poster !== true) {
      return json({ ok: false, error: 'poster_role_required' }, 403);
    }
    if (
      posterUser.poster_verified !== true ||
      !String(posterUser.poster_payment_method_id || '').trim()
    ) {
      return json({
        ok: false,
        error: 'poster_payment_verification_required',
        verification_status: posterUser.poster_verification_status || 'unverified',
      }, 403);
    }

    const { task, error: taskErr } = await fetchTaskRow(supabase, taskId, posterId);
    if (!task) {
      return json({
        ok: false,
        error: 'task_not_found',
        details: taskErr ? errorMessage(taskErr) : undefined,
      }, 404);
    }

    const postedBy = String(getField(task, 'posted_by') || '');
    if (postedBy !== posterId) return json({ ok: false, error: 'not_task_poster' }, 403);

    const status = String(getField(task, 'status') || '').toLowerCase();
    if (status !== 'in_progress') return json({ ok: false, error: 'task_not_in_progress' }, 400);

    const { app, error: appErr } = await fetchAcceptedApp(supabase, task, taskId);
    if (appErr && !app) {
      return json({ ok: false, error: 'application_lookup_failed', details: errorMessage(appErr) }, 500);
    }
    if (!app) return json({ ok: false, error: 'no_accepted_worker' }, 400);

    const workerId = String(getField(app, 'worker_id') || '');
    if (!workerId) return json({ ok: false, error: 'worker_missing' }, 400);
    if (workerId === posterId) return json({ ok: false, error: 'cannot_pay_self' }, 400);

    // payments.task_id is UUID in production — never store legacy numeric conversation ids
    const paymentTaskId = canonicalTaskId(task) || String(
      (isUuidLike(String(getField(app, 'task_id') || ''))
        ? getField(app, 'task_id')
        : '') || (isUuidLike(taskId) ? taskId : ''),
    );
    if (!paymentTaskId || !isUuidLike(paymentTaskId)) {
      return json({
        ok: false,
        error: 'task_uuid_missing',
        details: 'Could not resolve UUID task_id for payment row',
      }, 400);
    }

    // Already paid? Match by poster+worker (reliable) then UUID task_id
    const { data: pairPaid } = await supabase
      .from('payments')
      .select('payment_id,status')
      .eq('poster_id', posterId)
      .eq('worker_id', workerId)
      .in('status', ['held', 'completed', 'paid'])
      .limit(1);
    if (pairPaid && pairPaid.length) {
      return json({ ok: false, error: 'already_paid' }, 409);
    }
    const { data: uuidPaid } = await supabase
      .from('payments')
      .select('payment_id')
      .eq('task_id', paymentTaskId)
      .in('status', ['held', 'completed', 'paid'])
      .limit(1);
    if (uuidPaid && uuidPaid.length) {
      return json({ ok: false, error: 'already_paid' }, 409);
    }

    const amount = resolveAmount(task, app);
    if (!amount || amount <= 0) return json({ ok: false, error: 'invalid_amount' }, 400);
    // Platform minimum $20 CAD (same as post-task / abuseLimits.minBudget)
    if (amount < 20) {
      return json({
        ok: false,
        error: 'amount_below_minimum',
        message: 'Tasks must be at least $20 CAD.',
        min_amount: 20,
      }, 400);
    }

    let workerUser: Record<string, unknown> | null = null;
    {
      const withSub = await supabase
        .from('users')
        .select('stripe_connect_id, stripe_payouts_enabled, is_subscriber')
        .eq('firebase_uid', workerId)
        .maybeSingle();
      if (withSub.error) {
        const fallback = await supabase
          .from('users')
          .select('stripe_connect_id, stripe_payouts_enabled')
          .eq('firebase_uid', workerId)
          .maybeSingle();
        workerUser = (fallback.data as Record<string, unknown>) || null;
      } else {
        workerUser = (withSub.data as Record<string, unknown>) || null;
      }
    }

    const workerConnectId = String(workerUser?.stripe_connect_id || '');
    const taskMode = String(getField(task, 'task_mode') || '').toLowerCase();
    const isRecurring = !!(getField(task, 'is_recurring')) || taskMode === 'recurring';
    const isSubscriber = !!(workerUser && workerUser.is_subscriber);
    // Fees computed server-side only — client must never recompute for storage.
    // Default one-off 15% platform fee (escrow); recurring / subscriber rates lower.
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
    const platformFeeCents = Math.round(breakdown.fee * 100);
    const workerPayoutCents = Math.round(breakdown.payout * 100);
    const title = String(getField(task, 'title') || 'QuickGigs task');

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer: String(posterUser.poster_stripe_customer_id || '') || undefined,
        ui_mode: 'embedded',
        redirect_on_completion: 'never',
        currency: 'cad',
        line_items: [
          {
            price_data: {
              currency: 'cad',
              product_data: {
                name: title.substring(0, 120),
                description: 'QuickGigs task payment (CAD)',
              },
              unit_amount: amountCents,
            },
            quantity: 1,
          },
        ],
        // Escrow: no transfer_data / on_behalf_of — funds stay on the platform balance.
        // transfer_group links this PaymentIntent to the later Connect Transfer on complete.
        payment_intent_data: {
          transfer_group: taskTransferGroup(paymentTaskId),
          metadata: {
            project: 'quickgigs',
            purpose: 'task_escrow',
            task_id: paymentTaskId,
            poster_id: posterId,
            worker_id: workerId,
            worker_connect_id: workerConnectId || '',
            transfer_group: taskTransferGroup(paymentTaskId),
            platform_fee: String(breakdown.fee),
            worker_payout: String(breakdown.payout),
            legacy_task_id: isNumericId(taskId) ? taskId : '',
          },
        },
        metadata: {
          project: 'quickgigs',
          task_id: paymentTaskId,
          poster_id: posterId,
          worker_id: workerId,
          legacy_task_id: isNumericId(taskId) ? taskId : '',
        },
      });
    } catch (stripeErr) {
      console.error('Stripe session create failed:', stripeErr);
      return json({ ok: false, error: 'stripe_session_failed', details: errorMessage(stripeErr) }, 502);
    }

    if (!session.client_secret) {
      return json({ ok: false, error: 'missing_client_secret' }, 502);
    }

    const paymentRow = {
      task_id: paymentTaskId,
      poster_id: posterId,
      worker_id: workerId,
      amount,
      platform_fee: platformFeeCents / 100,
      worker_payout: workerPayoutCents / 100,
      stripe_id: session.id,
      status: 'pending',
    };

    const saved = await upsertPendingPayment(supabase, paymentRow);
    if (!saved.ok) {
      return json({ ok: false, error: 'payment_row_failed', details: saved.error }, 500);
    }

    return json({
      ok: true,
      client_secret: session.client_secret,
      session_id: session.id,
      amount: breakdown.total,
      platform_fee: breakdown.fee,
      worker_payout: breakdown.payout,
      fee_rate_pct: breakdown.ratePct,
      is_recurring: isRecurring,
      is_subscriber: isSubscriber,
      worker_has_payouts: !!workerConnectId,
      livemode: !!session.livemode,
      test_mode: !session.livemode,
    });
  } catch (err) {
    console.error('create-checkout error:', err);
    return json({ ok: false, error: 'checkout_failed', details: errorMessage(err) }, 500);
  }
});
