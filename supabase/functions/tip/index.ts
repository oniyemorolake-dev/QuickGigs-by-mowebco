// tip — a poster tips the tasker after a finished gig.
//
// POST { action: 'create', task_id, amount_cents }  -> { client_secret, tip_id }
// POST { action: 'confirm', tip_id }                -> { status }
// POST { action: 'list', task_ids?: string[] }      -> { tips: [...] }  (poster or tasker; settles any left pending)
//
// Deploy: supabase functions deploy tip --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { authErrorStatus, requireFirebaseUser } from '../_shared/firebase-auth.ts';
import { settleTip, TIP_MAX_CENTS, TIP_MIN_CENTS, TIP_PROJECT, tipDestination } from '../_shared/tips.ts';

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TIPS_PER_GIG = 3;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  let identity;
  try {
    identity = await requireFirebaseUser(req);
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'unauthorized' }, authErrorStatus(err));
  }
  const actorId = identity.uid;

  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') || '';
    if (!stripeKey) return json({ ok: false, error: 'stripe_not_configured' }, 503);
    // Live keys are refused unless the STRIPE_LIVE_MODE secret is 'true' (launch switch).
    if (stripeKey.startsWith('sk_live_') && Deno.env.get('STRIPE_LIVE_MODE') !== 'true') {
      return json({ ok: false, error: 'live_keys_blocked' }, 503);
    }
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!serviceKey) return json({ ok: false, error: 'service_role_missing' }, 503);

    const supabase = createClient(Deno.env.get('SUPABASE_URL') || '', serviceKey);
    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '').toLowerCase();

    if (action === 'list') {
      const ids = Array.isArray(body.task_ids)
        ? body.task_ids.map((v: unknown) => String(v)).filter((v: string) => UUID.test(v)).slice(0, 60)
        : [];
      let q = supabase
        .from('tips')
        .select('*')
        .or(`poster_id.eq.${actorId},worker_id.eq.${actorId}`)
        .in('status', ['pending', 'collected', 'paid'])
        .order('created_at', { ascending: false })
        .limit(200);
      if (ids.length) q = q.in('task_id', ids);
      const { data: rows, error } = await q;
      if (error) throw error;
      const out: Record<string, unknown>[] = [];
      for (const row of rows || []) {
        let status = String(row.status);
        // Finish anything Stripe has already taken money for.
        if (status === 'collected' || (status === 'pending' && Date.now() - Date.parse(row.created_at) > 20000)) {
          try { status = (await settleTip(supabase, stripe, row)).status; } catch (e) { console.warn('settle failed', row.tip_id, e); }
        }
        if (status === 'pending' || status === 'expired' || status === 'failed') continue;
        out.push({
          tip_id: row.tip_id,
          task_id: row.task_id,
          amount_cents: row.amount_cents,
          status,
          mine: row.poster_id === actorId ? 'sent' : 'received',
          created_at: row.created_at,
        });
      }
      return json({ ok: true, tips: out });
    }

    if (action === 'confirm') {
      const tipId = String(body.tip_id || '');
      if (!UUID.test(tipId)) return json({ ok: false, error: 'invalid_tip' }, 400);
      const { data: tip } = await supabase.from('tips').select('*').eq('tip_id', tipId).maybeSingle();
      if (!tip || (tip.poster_id !== actorId && tip.worker_id !== actorId)) {
        return json({ ok: false, error: 'tip_not_found' }, 404);
      }
      const result = await settleTip(supabase, stripe, tip);
      return json({ ok: true, status: result.status, amount_cents: tip.amount_cents });
    }

    if (action !== 'create') return json({ ok: false, error: 'invalid_action' }, 400);

    const taskId = String(body.task_id || '');
    const amountCents = Math.round(Number(body.amount_cents));
    if (!UUID.test(taskId)) return json({ ok: false, error: 'invalid_task' }, 400);
    if (!Number.isFinite(amountCents) || amountCents < TIP_MIN_CENTS || amountCents > TIP_MAX_CENTS) {
      return json({
        ok: false,
        error: 'invalid_amount',
        message: `A tip can be between $${TIP_MIN_CENTS / 100} and $${TIP_MAX_CENTS / 100}.`,
      }, 400);
    }

    const { data: task } = await supabase
      .from('tasks')
      .select('task_id,title,posted_by,status')
      .eq('task_id', taskId)
      .maybeSingle();
    if (!task) return json({ ok: false, error: 'task_not_found' }, 404);
    if (String(task.posted_by) !== actorId) {
      return json({ ok: false, error: 'not_authorized', message: 'Only the poster can tip on this gig.' }, 403);
    }
    if (String(task.status).toLowerCase() !== 'completed') {
      return json({ ok: false, error: 'task_not_completed', message: 'You can tip once the gig is marked complete.' }, 409);
    }

    // The tasker is whoever was paid for this gig. Never taken from the request.
    const { data: pays } = await supabase
      .from('payments')
      .select('worker_id,status')
      .eq('task_id', taskId)
      .eq('poster_id', actorId)
      .in('status', ['held', 'paid', 'completed'])
      .order('created_at', { ascending: false })
      .limit(1);
    const workerId = String(pays?.[0]?.worker_id || '');
    if (!workerId) return json({ ok: false, error: 'no_paid_tasker', message: 'There is no paid tasker on this gig to tip.' }, 409);
    if (workerId === actorId) return json({ ok: false, error: 'cannot_tip_self' }, 400);

    const { data: openDispute } = await supabase
      .from('disputes')
      .select('dispute_id')
      .eq('task_id', taskId)
      .in('status', ['open', 'reviewing'])
      .limit(1);
    if (openDispute && openDispute.length) {
      return json({ ok: false, error: 'task_disputed', message: 'Tips are paused while a dispute is open on this gig.' }, 409);
    }

    const destination = await tipDestination(supabase, workerId);
    if (!destination) {
      return json({ ok: false, error: 'worker_payout_setup_required', message: 'This tasker cannot receive tips yet.' }, 409);
    }

    const { data: prior } = await supabase
      .from('tips')
      .select('tip_id,status,created_at')
      .eq('task_id', taskId)
      .eq('poster_id', actorId)
      .in('status', ['pending', 'collected', 'paid']);
    const counted = (prior || []).filter((t: { status: string; created_at: string }) =>
      t.status !== 'pending' || Date.now() - Date.parse(t.created_at) < 3600000
    );
    if (counted.filter((t: { status: string }) => t.status !== 'pending').length >= MAX_TIPS_PER_GIG) {
      return json({ ok: false, error: 'tip_limit', message: `You can tip up to ${MAX_TIPS_PER_GIG} times on one gig.` }, 429);
    }
    if (counted.filter((t: { status: string }) => t.status === 'pending').length >= 6) {
      return json({ ok: false, error: 'rate_limited', message: 'Too many attempts. Try again in a little while.' }, 429);
    }

    const { data: tip, error: insertError } = await supabase
      .from('tips')
      .insert({ task_id: taskId, poster_id: actorId, worker_id: workerId, amount_cents: amountCents, status: 'pending' })
      .select('*')
      .single();
    if (insertError) throw insertError;

    const { data: poster } = await supabase
      .from('users')
      .select('poster_stripe_customer_id')
      .eq('firebase_uid', actorId)
      .maybeSingle();

    const meta = {
      project: TIP_PROJECT,
      purpose: 'tip',
      tip_id: String(tip.tip_id),
      task_id: taskId,
      poster_id: actorId,
      worker_id: workerId,
    };
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: String(poster?.poster_stripe_customer_id || '') || undefined,
      ui_mode: 'embedded',
      redirect_on_completion: 'never',
      currency: 'cad',
      line_items: [{
        price_data: {
          currency: 'cad',
          product_data: {
            name: ('Tip: ' + String(task.title || 'SwiftGigs gig')).substring(0, 120),
            description: 'SwiftGigs tip (CAD). 100% goes to your tasker.',
          },
          unit_amount: amountCents,
        },
        quantity: 1,
      }],
      payment_intent_data: { metadata: meta },
      metadata: meta,
    });

    await supabase.from('tips').update({ stripe_session_id: session.id }).eq('tip_id', tip.tip_id);

    return json({
      ok: true,
      tip_id: tip.tip_id,
      session_id: session.id,
      client_secret: session.client_secret,
      amount_cents: amountCents,
    });
  } catch (err) {
    console.error('tip error:', err);
    return json({ ok: false, error: 'tip_failed', message: err instanceof Error ? err.message : String(err) }, 500);
  }
});
