// QuickGigs — Sync Stripe Connect account status to users row
// Deploy: supabase functions deploy sync-connect-status --no-verify-jwt
// Readiness: charges_enabled && payouts_enabled → stripe_payouts_enabled

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { authErrorStatus, requireFirebaseUser } from '../_shared/firebase-auth.ts';
import { ageFromDateOfBirth } from '../_shared/age.ts';
import { connectAccountReady } from '../_shared/connect-ready.ts';

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

    try {
      await req.json();
    } catch {
      /* body optional */
    }
    const workerId = identity.uid;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: userRow, error: userErr } = await supabase
      .from('users')
      .select('stripe_connect_id,date_of_birth,graduated_at,payout_owner')
      .eq('firebase_uid', workerId)
      .maybeSingle();

    if (userErr) {
      return json({ ok: false, error: 'user_lookup_failed', details: userErr.message }, 500);
    }

    const connectId = userRow?.stripe_connect_id || '';
    if (!connectId) {
      return json({
        ok: true,
        connected: false,
        payouts_enabled: false,
        charges_enabled: false,
        ready: false,
      });
    }

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
    let account: Stripe.Account;
    try {
      account = await stripe.accounts.retrieve(connectId);
    } catch (retrieveErr) {
      console.error('stripe.accounts.retrieve failed:', retrieveErr);
      return json({
        ok: false,
        error: 'stripe_account_retrieve_failed',
        details: retrieveErr instanceof Error ? retrieveErr.message : String(retrieveErr),
      }, 502);
    }

    const ready = connectAccountReady(account);
    const age = ageFromDateOfBirth(userRow?.date_of_birth);
    const graduatedAdult = age != null && age >= 18 && Boolean(userRow?.graduated_at);
    const userPatch: Record<string, unknown> = {
      stripe_payouts_enabled: ready.ready,
    };
    if (graduatedAdult && ready.ready) userPatch.payout_owner = 'self';

    const { error: updateErr } = await supabase
      .from('users')
      .update(userPatch)
      .eq('firebase_uid', workerId);
    if (updateErr) {
      console.error('Failed to sync connect status:', updateErr);
      return json({
        ok: false,
        error: 'connect_status_save_failed',
        details: updateErr.message,
      }, 500);
    }

    let released = 0;
    // Workers cannot self-release. Held payouts for completed tasks wait for poster
    // complete-task → release-payout. Count eligible held rows for UI only.
    if (graduatedAdult && ready.ready) {
      const { data: heldPayments } = await supabase
        .from('payments')
        .select('task_id')
        .eq('worker_id', workerId)
        .eq('status', 'held');
      const heldTaskIds = (heldPayments || []).map((payment) => String(payment.task_id || '')).filter(Boolean);
      const { data: completedTasks } = heldTaskIds.length
        ? await supabase.from('tasks').select('task_id').in('task_id', heldTaskIds).eq('status', 'completed')
        : { data: [] as Array<{ task_id: string }> };
      released = (completedTasks || []).length;
    }

    return json({
      ok: true,
      connected: true,
      ready: ready.ready,
      payouts_enabled: ready.ready,
      charges_enabled: ready.charges_enabled,
      stripe_payouts_enabled_flag: ready.payouts_enabled,
      details_submitted: ready.details_submitted,
      payout_owner: graduatedAdult && ready.ready ? 'self' : userRow?.payout_owner,
      held_completed_awaiting_poster_release: released,
      held_payouts_released: 0,
    });
  } catch (err) {
    console.error('sync-connect-status error:', err);
    return json({ ok: false, error: String(err) }, 500);
  }
});
