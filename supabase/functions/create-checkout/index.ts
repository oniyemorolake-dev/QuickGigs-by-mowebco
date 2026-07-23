// QuickGigs — Stripe Checkout for accepted task (poster pays)
// Deploy: supabase functions deploy create-checkout --no-verify-jwt
// Secrets: STRIPE_SECRET_KEY, SITE_URL (https://quickgigs.ca)

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

function resolveAmount(task: Record<string, unknown>, app: Record<string, unknown>) {
  const price = getField(app, 'price');
  if (price != null && price !== '') return Number(price);
  const budget = getField(task, 'budget');
  return Number(budget || 0);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) return json({ ok: false, error: 'stripe_not_configured' }, 503);

    const body = await req.json();
    const taskId = String(body.task_id || '').trim();
    const posterId = String(body.poster_id || '').trim();
    const returnPage = String(body.return_page || 'payment').toLowerCase();
    if (!taskId || !posterId) return json({ ok: false, error: 'missing_task_or_poster' }, 400);

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

    const postedBy = String(getField(task, 'posted_by') || '');
    if (postedBy !== posterId) return json({ ok: false, error: 'not_task_poster' }, 403);

    const status = String(getField(task, 'status') || '').toLowerCase();
    if (status !== 'in_progress') return json({ ok: false, error: 'task_not_in_progress' }, 400);

    const { data: apps, error: appErr } = await supabase
      .from('applications')
      .select('*')
      .eq('task_id', taskId)
      .eq('status', 'accepted')
      .limit(1);
    if (appErr) throw appErr;
    const app = apps && apps[0];
    if (!app) return json({ ok: false, error: 'no_accepted_worker' }, 400);

    const workerId = String(getField(app, 'worker_id') || '');
    if (!workerId) return json({ ok: false, error: 'worker_missing' }, 400);
    if (workerId === posterId) return json({ ok: false, error: 'cannot_pay_self' }, 400);

    const { data: existingPayments } = await supabase
      .from('payments')
      .select('*')
      .eq('task_id', taskId)
      .in('status', ['held', 'completed', 'paid'])
      .limit(1);
    if (existingPayments && existingPayments.length) {
      return json({ ok: false, error: 'already_paid' }, 409);
    }

    const amount = resolveAmount(task, app);
    if (!amount || amount <= 0) return json({ ok: false, error: 'invalid_amount' }, 400);

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

    let returnUrl = `${siteUrl}/payment.html?task=${encodeURIComponent(taskId)}&paid=1&session_id={CHECKOUT_SESSION_ID}`;
    if (returnPage === 'mytasks') {
      returnUrl = `${siteUrl}/mytasks.html?tab=inprogress&paid=1&task=${encodeURIComponent(taskId)}&session_id={CHECKOUT_SESSION_ID}`;
    } else if (returnPage === 'chat') {
      const returnConv = String(body.return_conv || '').trim();
      const convQs = returnConv ? `&conv=${encodeURIComponent(returnConv)}` : '';
      returnUrl = `${siteUrl}/chat.html?paid=1&task=${encodeURIComponent(taskId)}${convQs}&session_id={CHECKOUT_SESSION_ID}`;
    }

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });

    const paymentIntentData: Stripe.Checkout.SessionCreateParams['payment_intent_data'] = {
      metadata: {
        project: 'quickgigs',
        task_id: taskId,
        poster_id: posterId,
        worker_id: workerId,
        worker_connect_id: workerConnectId || '',
      },
    };
    // Escrow: full charge lands on platform; worker paid on task complete via release-payout

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      ui_mode: 'embedded',
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
      payment_intent_data: paymentIntentData,
      metadata: {
        project: 'quickgigs',
        task_id: taskId,
        poster_id: posterId,
        worker_id: workerId,
      },
    });

    await supabase
      .from('payments')
      .delete()
      .eq('task_id', taskId)
      .eq('status', 'pending');

    await supabase.from('payments').insert({
      task_id: taskId,
      poster_id: posterId,
      worker_id: workerId,
      amount,
      platform_fee: platformFeeCents / 100,
      worker_payout: workerPayoutCents / 100,
      stripe_id: session.id,
      status: 'pending',
    });

    return json({
      ok: true,
      client_secret: session.client_secret,
      session_id: session.id,
      amount,
      worker_has_payouts: !!workerConnectId,
    });
  } catch (err) {
    console.error('create-checkout error:', err);
    return json({ ok: false, error: String(err) }, 500);
  }
});
