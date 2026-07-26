// QuickGigs — Stripe Checkout for accepted task (poster pays)
// Deploy: supabase functions deploy create-checkout --no-verify-jwt
// Secrets: STRIPE_SECRET_KEY, SITE_URL (https://quickgigs.ca), SUPABASE_SERVICE_ROLE_KEY

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
  const price = getField(app, 'price');
  if (price != null && price !== '') return Number(price);
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
  supabase: ReturnType<typeof createClient>,
  taskUuid: string,
) {
  if (!taskUuid) return null;
  const { data, error } = await supabase.from('applications').select('*').eq('task_id', taskUuid);
  if (error) return null;
  return findAcceptedApp(data) || null;
}

async function matchInProgressTaskByWorker(
  supabase: ReturnType<typeof createClient>,
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
  supabase: ReturnType<typeof createClient>,
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
  supabase: ReturnType<typeof createClient>,
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
  supabase: ReturnType<typeof createClient>,
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
  supabase: ReturnType<typeof createClient>,
  row: Record<string, unknown>,
) {
  const taskId = String(row.task_id || '');
  const keys = relationTaskKeys(null, taskId);
  let existing: { payment_id?: string }[] | null = null;
  let findErr: unknown = null;

  for (const key of keys.length ? keys : [taskId]) {
    const res = await supabase
      .from('payments')
      .select('payment_id')
      .eq('task_id', key)
      .eq('status', 'pending')
      .limit(1);
    if (res.error) {
      findErr = res.error;
      continue;
    }
    if (res.data && res.data.length) {
      existing = res.data;
      break;
    }
  }

  if (findErr && !existing) return { ok: false, error: errorMessage(findErr) };

  if (existing && existing[0]?.payment_id) {
    const { error: updErr } = await supabase
      .from('payments')
      .update(row)
      .eq('payment_id', existing[0].payment_id);
    if (updErr) return { ok: false, error: errorMessage(updErr) };
    return { ok: true };
  }

  const { error: insErr } = await supabase.from('payments').insert(row);
  if (insErr) return { ok: false, error: errorMessage(insErr) };
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) return json({ ok: false, error: 'stripe_not_configured' }, 503);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceKey) {
      return json({ ok: false, error: 'supabase_service_role_not_configured' }, 503);
    }

    const body = await req.json();
    const taskId = String(body.task_id || '').trim();
    const posterId = String(body.poster_id || '').trim();
    if (!taskId || !posterId) return json({ ok: false, error: 'missing_task_or_poster' }, 400);

    const supabase = createClient(supabaseUrl, serviceKey);

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

    const paymentTaskId = canonicalTaskId(task) || String(
      getField(app, 'task_id') || taskId,
    );

    let storageTaskId = paymentTaskId;
    for (const key of relationTaskKeys(task, paymentTaskId)) {
      const { data: convs } = await supabase
        .from('conversations')
        .select('task_id')
        .eq('task_id', key)
        .eq('poster_id', posterId)
        .eq('worker_id', workerId)
        .limit(1);
      if (convs && convs[0]?.task_id != null) {
        storageTaskId = String(convs[0].task_id);
        break;
      }
    }
    if (storageTaskId === paymentTaskId) {
      const { data: byPair } = await supabase
        .from('conversations')
        .select('task_id')
        .eq('poster_id', posterId)
        .eq('worker_id', workerId)
        .in('status', ['in_progress', 'application'])
        .order('created_at', { ascending: false })
        .limit(1);
      if (byPair && byPair[0]?.task_id != null) {
        storageTaskId = String(byPair[0].task_id);
      }
    }

    const paidKeys = relationTaskKeys(task, storageTaskId);
    let alreadyPaid = false;
    for (const key of paidKeys) {
      const { data: existingPayments } = await supabase
        .from('payments')
        .select('payment_id')
        .eq('task_id', key)
        .in('status', ['held', 'completed', 'paid'])
        .limit(1);
      if (existingPayments && existingPayments.length) {
        alreadyPaid = true;
        break;
      }
    }
    if (alreadyPaid) {
      return json({ ok: false, error: 'already_paid' }, 409);
    }

    const amount = resolveAmount(task, app);
    if (!amount || amount <= 0) return json({ ok: false, error: 'invalid_amount' }, 400);
    if (amount < 0.5) return json({ ok: false, error: 'amount_below_minimum' }, 400);

    const amountCents = Math.round(amount * 100);
    const platformFeePercent = Number(Deno.env.get('PLATFORM_FEE_PERCENT') || '25');
    const platformFeeCents = Math.round(amountCents * (platformFeePercent / 100));
    const workerPayoutCents = amountCents - platformFeeCents;

    const { data: workerUser } = await supabase
      .from('users')
      .select('stripe_connect_id, stripe_payouts_enabled')
      .eq('firebase_uid', workerId)
      .maybeSingle();

    const workerConnectId = workerUser?.stripe_connect_id || '';
    const title = String(getField(task, 'title') || 'QuickGigs task');

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
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
        payment_intent_data: {
          metadata: {
            project: 'quickgigs',
            task_id: storageTaskId,
            poster_id: posterId,
            worker_id: workerId,
            worker_connect_id: workerConnectId || '',
          },
        },
        metadata: {
          project: 'quickgigs',
          task_id: storageTaskId,
          poster_id: posterId,
          worker_id: workerId,
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
      task_id: storageTaskId,
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
      amount,
      worker_has_payouts: !!workerConnectId,
    });
  } catch (err) {
    console.error('create-checkout error:', err);
    return json({ ok: false, error: 'checkout_failed', details: errorMessage(err) }, 500);
  }
});
