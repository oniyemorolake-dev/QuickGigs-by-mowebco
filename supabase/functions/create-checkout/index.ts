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

async function fetchTaskRow(supabase: ReturnType<typeof createClient>, taskId: string) {
  type Attempt = { col: 'id' | 'task_id'; val: string | number };
  const attempts: Attempt[] = [];

  if (isNumericId(taskId)) {
    attempts.push({ col: 'id', val: parseInt(taskId, 10) });
  }
  if (isUuidLike(taskId)) {
    attempts.push({ col: 'task_id', val: taskId });
  }
  if (!attempts.length) {
    attempts.push({ col: 'task_id', val: taskId });
  }

  let lastErr: unknown = null;
  for (const attempt of attempts) {
    const { data, error } = await supabase.from('tasks').select('*').eq(attempt.col, attempt.val).limit(1);
    if (error) {
      lastErr = error;
      continue;
    }
    if (data && data[0]) return { task: data[0] as Record<string, unknown>, error: null };
  }
  return { task: null, error: lastErr };
}

async function fetchAcceptedApp(
  supabase: ReturnType<typeof createClient>,
  task: Record<string, unknown>,
  inputTaskId: string,
) {
  const keys = relationTaskKeys(task, inputTaskId);
  let lastErr: unknown = null;

  for (const key of keys) {
    const { data, error } = await supabase.from('applications').select('*').eq('task_id', key);
    if (error) {
      lastErr = error;
      continue;
    }
    const accepted = (data || []).find((row) =>
      String(getField(row as Record<string, unknown>, 'status') || '').toLowerCase() === 'accepted'
    );
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
    const returnPage = String(body.return_page || 'payment').toLowerCase();
    if (!taskId || !posterId) return json({ ok: false, error: 'missing_task_or_poster' }, 400);

    const supabase = createClient(supabaseUrl, serviceKey);

    const { task, error: taskErr } = await fetchTaskRow(supabase, taskId);
    if (taskErr) {
      return json({ ok: false, error: 'task_lookup_failed', details: errorMessage(taskErr) }, 500);
    }
    if (!task) return json({ ok: false, error: 'task_not_found' }, 404);

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

    const paymentTaskId = String(
      getField(app, 'task_id') || getField(task, 'id') || getField(task, 'task_id') || taskId,
    );

    const paidKeys = relationTaskKeys(task, paymentTaskId);
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
    const siteUrl = (Deno.env.get('SITE_URL') || 'https://quickgigs.ca').replace(/\/$/, '');

    const returnConv = String(body.return_conv || '').trim();
    const convQs = returnConv ? `conv=${encodeURIComponent(returnConv)}&` : '';
    let returnUrl =
      `${siteUrl}/chat.html?${convQs}paid=1&task=${encodeURIComponent(paymentTaskId)}&session_id={CHECKOUT_SESSION_ID}`;
    if (returnPage === 'mytasks' || returnPage === 'payment') {
      returnUrl =
        `${siteUrl}/chat.html?paid=1&task=${encodeURIComponent(paymentTaskId)}&session_id={CHECKOUT_SESSION_ID}`;
    }

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        ui_mode: 'embedded',
        redirect_on_completion: 'never',
        currency: 'cad',
        return_url: returnUrl,
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
            task_id: paymentTaskId,
            poster_id: posterId,
            worker_id: workerId,
            worker_connect_id: workerConnectId || '',
          },
        },
        metadata: {
          project: 'quickgigs',
          task_id: paymentTaskId,
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
      amount,
      worker_has_payouts: !!workerConnectId,
    });
  } catch (err) {
    console.error('create-checkout error:', err);
    return json({ ok: false, error: 'checkout_failed', details: errorMessage(err) }, 500);
  }
});
