// QuickGigs — Release worker payout when task is marked complete (escrow → 75/25 split)
// Deploy: supabase functions deploy release-payout --no-verify-jwt
// Secrets: STRIPE_SECRET_KEY

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
    if (typeof e.details === 'string' && e.details) return e.details;
  }
  return String(err);
}

function isNumericId(val: string): boolean {
  return /^\d+$/.test(String(val || '').trim());
}

function isUuidLike(val: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(val || '').trim(),
  );
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

function taskIdKeys(taskId: string, extra?: string): (string | number)[] {
  const keys: (string | number)[] = [];
  const seen = new Set<string>();
  const add = (v: unknown) => {
    if (v == null || v === '') return;
    const s = String(v);
    if (seen.has(s)) return;
    seen.add(s);
    keys.push(v as string | number);
    if (isNumericId(s)) {
      const n = parseInt(s, 10);
      const ns = 'n:' + n;
      if (!seen.has(ns)) {
        seen.add(ns);
        keys.push(n);
      }
    }
  };
  add(taskId);
  if (extra) add(extra);
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
  const { data } = await supabase.from('applications').select('*').eq('task_id', taskUuid);
  return findAcceptedApp(data) || null;
}

async function fetchTaskRow(
  supabase: any,
  taskId: string,
  actorId: string,
  hintPosterId?: string,
  hintWorkerId?: string,
) {
  if (isUuidLike(taskId)) {
    const { data, error } = await supabase.from('tasks').select('*').eq('task_id', taskId).limit(1);
    if (data && data[0]) return { task: data[0] as Record<string, unknown>, error: null };
    if (error) return { task: null, error };
  }

  const keys = taskIdKeys(taskId);

  for (const key of keys) {
    const { data: apps } = await supabase.from('applications').select('*').eq('task_id', key);
    const accepted = findAcceptedApp(apps);
    if (accepted) {
      const appTaskId = String(getField(accepted, 'task_id') || '');
      if (isUuidLike(appTaskId)) {
        const { data } = await supabase.from('tasks').select('*').eq('task_id', appTaskId).limit(1);
        if (data && data[0]) return { task: data[0] as Record<string, unknown>, error: null };
      }
    }
  }

  if (hintPosterId) {
    const { data: posterTasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('posted_by', hintPosterId)
      .in('status', ['in_progress', 'completed']);
    for (const t of posterTasks || []) {
      const uuid = canonicalTaskId(t as Record<string, unknown>);
      if (!uuid) continue;
      const accepted = await findAcceptedAppForTaskUuid(supabase, uuid);
      if (!accepted) continue;
      const convMatch = keys.some((k) => String(k) === uuid || String(k) === String(getField(t as Record<string, unknown>, 'task_id')));
      if (convMatch || (posterTasks || []).length === 1) {
        return { task: t as Record<string, unknown>, error: null };
      }
    }
  }

  if (hintWorkerId || actorId) {
    const workerId = hintWorkerId || actorId;
    const { data: workerApps } = await supabase
      .from('applications')
      .select('*')
      .eq('worker_id', workerId)
      .eq('status', 'accepted');
    for (const app of workerApps || []) {
      const appTaskId = String(getField(app as Record<string, unknown>, 'task_id') || '');
      if (keys.some((k) => String(k) === appTaskId) || (workerApps || []).length === 1) {
        if (isUuidLike(appTaskId)) {
          const { data } = await supabase.from('tasks').select('*').eq('task_id', appTaskId).limit(1);
          if (data && data[0]) return { task: data[0] as Record<string, unknown>, error: null };
        }
      }
    }
  }

  for (const key of keys) {
    const { data: convs } = await supabase.from('conversations').select('*').eq('task_id', key).limit(5);
    for (const conv of convs || []) {
      const posterId = String(getField(conv as Record<string, unknown>, 'poster_id') || '');
      const workerId = String(getField(conv as Record<string, unknown>, 'worker_id') || '');
      const { data: posterTasks } = await supabase
        .from('tasks')
        .select('*')
        .eq('posted_by', posterId)
        .in('status', ['in_progress', 'completed']);
      for (const t of posterTasks || []) {
        const uuid = canonicalTaskId(t as Record<string, unknown>);
        const accepted = uuid ? await findAcceptedAppForTaskUuid(supabase, uuid) : null;
        if (accepted && String(getField(accepted, 'worker_id') || '') === workerId) {
          return { task: t as Record<string, unknown>, error: null };
        }
      }
    }
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
    if (byUuid) return byUuid;
  }
  for (const key of taskIdKeys(inputTaskId, taskUuid)) {
    const { data } = await supabase.from('applications').select('*').eq('task_id', key);
    const accepted = findAcceptedApp(data);
    if (accepted) return accepted;
  }
  return null;
}

async function findHeldPayment(
  supabase: any,
  posterId: string,
  workerId: string,
  taskId: string,
  taskUuid: string,
) {
  const candidates: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const key of taskIdKeys(taskId, taskUuid)) {
    const { data } = await supabase
      .from('payments')
      .select('*')
      .eq('task_id', key)
      .order('created_at', { ascending: false })
      .limit(10);
    for (const row of data || []) {
      const id = String(getField(row as Record<string, unknown>, 'payment_id') || '');
      if (id && !seen.has(id)) {
        seen.add(id);
        candidates.push(row as Record<string, unknown>);
      }
    }
  }

  const { data: byPair } = await supabase
    .from('payments')
    .select('*')
    .eq('poster_id', posterId)
    .eq('worker_id', workerId)
    .order('created_at', { ascending: false })
    .limit(20);

  for (const row of byPair || []) {
    const id = String(getField(row as Record<string, unknown>, 'payment_id') || '');
    if (id && !seen.has(id)) {
      seen.add(id);
      candidates.push(row as Record<string, unknown>);
    }
  }

  const rank = (p: Record<string, unknown>) => {
    const st = String(getField(p, 'status') || '').toLowerCase();
    if (st === 'paid' || st === 'completed') return 4;
    if (st === 'held') return 3;
    return 0;
  };

  candidates.sort((a, b) => rank(b) - rank(a));
  return candidates.find((p) => {
    const st = String(getField(p, 'status') || '').toLowerCase();
    return st === 'held' || st === 'paid';
  }) || null;
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
    if (stripeKey.startsWith('sk_live_')) {
      return json({
        ok: false,
        error: 'live_keys_blocked',
        message: 'Escrow is running in Stripe TEST mode only.',
      }, 503);
    }

    const body = await req.json();
    const inputTaskId = String(body.task_id || '').trim();
    const actorId = identity.uid;
    const hintPosterId = String(body.poster_id || '').trim();
    const hintWorkerId = String(body.worker_id || '').trim();
    if (!inputTaskId) return json({ ok: false, error: 'missing_task' }, 400);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { task, error: taskErr } = await fetchTaskRow(
      supabase,
      inputTaskId,
      actorId,
      hintPosterId,
      hintWorkerId,
    );
    if (!task) {
      return json({
        ok: false,
        error: 'task_not_found',
        details: taskErr ? errorMessage(taskErr) : undefined,
      }, 404);
    }

    const taskUuid = canonicalTaskId(task);
    const taskStatus = String(getField(task, 'status') || '').toLowerCase();
    if (taskStatus !== 'in_progress' && taskStatus !== 'completed') {
      return json({ ok: false, error: 'task_not_releasable' }, 400);
    }

    const posterId = String(getField(task, 'posted_by') || hintPosterId || '');
    const app = await fetchAcceptedApp(supabase, task, inputTaskId);
    const workerId = app ? String(getField(app, 'worker_id') || hintWorkerId || '') : hintWorkerId;

    if (!workerId) return json({ ok: false, error: 'no_accepted_worker' }, 400);

    const isPoster = actorId === posterId;
    const isWorker = actorId === workerId;
    if (!isPoster && !isWorker) return json({ ok: false, error: 'not_authorized' }, 403);

    const payment = await findHeldPayment(supabase, posterId, workerId, inputTaskId, taskUuid);
    if (!payment) return json({ ok: true, skipped: true, reason: 'no_payment' });

    const payStatus = String(getField(payment, 'status') || '').toLowerCase();
    if (payStatus === 'disputed') {
      return json({
        ok: false,
        error: 'payment_disputed',
        message: 'Escrow is frozen while a dispute is open. An admin must resolve it.',
      }, 409);
    }
    if (payStatus === 'paid' || payStatus === 'completed') {
      return json({
        ok: true,
        already: true,
        worker_payout: getField(payment, 'worker_payout'),
        platform_fee: getField(payment, 'platform_fee'),
      });
    }

    if (payStatus !== 'held') {
      return json({ ok: true, skipped: true, reason: 'payment_not_held' });
    }

    // Open dispute freeze (even if status not yet flipped)
    const { data: openDispute } = await supabase
      .from('disputes')
      .select('dispute_id')
      .eq('task_id', taskUuid || inputTaskId)
      .in('status', ['open', 'reviewing'])
      .limit(1);
    if (openDispute && openDispute.length) {
      return json({
        ok: false,
        error: 'payment_disputed',
        message: 'Escrow is frozen while a dispute is open.',
        dispute_id: openDispute[0].dispute_id,
      }, 409);
    }

    const { data: workerUser } = await supabase
      .from('users')
      .select('date_of_birth,graduated_at,payout_owner,guardian_consent_status,guardian_stripe_connect_id,guardian_stripe_payouts_enabled,stripe_connect_id,stripe_payouts_enabled')
      .eq('firebase_uid', workerId)
      .maybeSingle();

    const minorWorker = isMinor(workerUser?.date_of_birth);
    const payoutOwner = String(workerUser?.payout_owner || (minorWorker ? 'guardian' : 'self'));
    if (!minorWorker && payoutOwner !== 'self') {
      return json({
        ok: true,
        held: true,
        reason: 'adult_payout_setup_required',
        message: 'Payout remains held until the worker adds payout details in their own name.',
      });
    }
    const guardianOwnsPayout = minorWorker;
    if (guardianOwnsPayout && workerUser?.guardian_consent_status !== 'approved') {
      return json({ ok: false, error: 'guardian_consent_required' }, 400);
    }
    const connectId = guardianOwnsPayout
      ? (workerUser?.guardian_stripe_connect_id || '')
      : (workerUser?.stripe_connect_id || '');
    if (!connectId) {
      return json({
        ok: false,
        error: guardianOwnsPayout ? 'guardian_payout_setup_required' : 'worker_payout_setup_required',
      }, 400);
    }

    const workerPayout = Number(getField(payment, 'worker_payout') || 0);
    const workerPayoutCents = Math.round(workerPayout * 100);
    if (!workerPayoutCents || workerPayoutCents <= 0) {
      return json({ ok: false, error: 'invalid_payout_amount' }, 400);
    }

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
    const destinationAccount = await stripe.accounts.retrieve(connectId);
    if (!destinationAccount.payouts_enabled) {
      return json({
        ok: false,
        error: guardianOwnsPayout ? 'guardian_payout_setup_incomplete' : 'worker_payout_setup_incomplete',
      }, 400);
    }
    const paymentIntentId = String(getField(payment, 'stripe_id') || '');

    let sourceTransaction: string | undefined;
    if (paymentIntentId.startsWith('pi_')) {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      const charge = pi.latest_charge;
      sourceTransaction = typeof charge === 'string' ? charge : charge?.id;
    } else if (paymentIntentId.startsWith('cs_')) {
      try {
        const session = await stripe.checkout.sessions.retrieve(paymentIntentId);
        const piRef = session.payment_intent;
        const piId = typeof piRef === 'string' ? piRef : piRef?.id;
        if (piId) {
          const pi = await stripe.paymentIntents.retrieve(piId);
          const charge = pi.latest_charge;
          sourceTransaction = typeof charge === 'string' ? charge : charge?.id;
        }
      } catch (e) {
        console.warn('Could not resolve checkout session charge:', e);
      }
    }

    const transfer = await stripe.transfers.create({
      amount: workerPayoutCents,
      currency: 'cad',
      destination: connectId,
      ...(sourceTransaction ? { source_transaction: sourceTransaction } : {}),
      metadata: {
        project: 'quickgigs',
        task_id: taskUuid || inputTaskId,
        worker_id: workerId,
        poster_id: posterId,
        payout_owner: guardianOwnsPayout ? 'guardian' : 'self',
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
      .eq('payment_id', getField(payment, 'payment_id'));

    return json({
      ok: true,
      transfer_id: transfer.id,
      worker_payout: workerPayout,
      payout_owner: guardianOwnsPayout ? 'guardian' : 'self',
      platform_fee: Number(getField(payment, 'platform_fee') || 0),
      amount: Number(getField(payment, 'amount') || 0),
    });
  } catch (err) {
    console.error('release-payout error:', err);
    return json({ ok: false, error: errorMessage(err) }, 500);
  }
});
