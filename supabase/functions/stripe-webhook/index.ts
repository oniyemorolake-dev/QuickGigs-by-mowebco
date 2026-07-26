// QuickGigs — Stripe webhook (checkout completed → unlock chat)
// Deploy: supabase functions deploy stripe-webhook --no-verify-jwt
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
// Stripe Dashboard → Webhooks → endpoint URL = .../functions/v1/stripe-webhook
// Events: checkout.session.completed

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

Deno.serve(async (req) => {
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!stripeKey || !webhookSecret) {
    return new Response('Stripe not configured', { status: 503 });
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

  if (event.type !== 'checkout.session.completed') {
    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  if (session.metadata?.project !== 'quickgigs') {
    return new Response(JSON.stringify({ ignored: true }), {
      headers: { 'Content-Type': 'application/json' },
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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  await supabase
    .from('payments')
    .update({
      status: 'held',
      stripe_id: paymentIntentId,
      completed_at: new Date().toISOString(),
    })
    .eq('task_id', taskId)
    .eq('poster_id', posterId);

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

  return new Response(JSON.stringify({ ok: true, task_id: taskId }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
