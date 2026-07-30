// QuickGigs — Sync Stripe Connect account status to users row
// Deploy: supabase functions deploy sync-connect-status --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { authErrorStatus, requireFirebaseUser } from '../_shared/firebase-auth.ts';
import { ageFromDateOfBirth } from '../_shared/age.ts';

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
      return json({ ok: false, error: authErr instanceof Error ? authErr.message : 'unauthorized' }, authErrorStatus(authErr));
    }
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) return json({ ok: false, error: 'stripe_not_configured' }, 503);

    const body = await req.json();
    const workerId = identity.uid;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: userRow } = await supabase
      .from('users')
      .select('stripe_connect_id,date_of_birth,graduated_at,payout_owner')
      .eq('firebase_uid', workerId)
      .maybeSingle();

    const connectId = userRow?.stripe_connect_id || '';
    if (!connectId) return json({ ok: true, connected: false, payouts_enabled: false });

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
    const account = await stripe.accounts.retrieve(connectId);
    const payoutsEnabled = !!(account.payouts_enabled && account.details_submitted);

    const age = ageFromDateOfBirth(userRow?.date_of_birth);
    const graduatedAdult = age != null && age >= 18 && Boolean(userRow?.graduated_at);
    const userPatch: Record<string, unknown> = { stripe_payouts_enabled: payoutsEnabled };
    if (graduatedAdult && payoutsEnabled) userPatch.payout_owner = 'self';
    await supabase
      .from('users')
      .update(userPatch)
      .eq('firebase_uid', workerId);

    let released = 0;
    if (graduatedAdult && payoutsEnabled) {
      const { data: heldPayments } = await supabase
        .from('payments')
        .select('task_id')
        .eq('worker_id', workerId)
        .eq('status', 'held');
      const heldTaskIds = (heldPayments || []).map((payment) => String(payment.task_id || '')).filter(Boolean);
      const { data: completedTasks } = heldTaskIds.length
        ? await supabase.from('tasks').select('task_id').in('task_id', heldTaskIds).eq('status', 'completed')
        : { data: [] as Array<{ task_id: string }> };
      const completedIds = new Set((completedTasks || []).map((task) => String(task.task_id || '')));
      const releaseUrl = `${(Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '')}/functions/v1/release-payout`;
      for (const payment of heldPayments || []) {
        if (!completedIds.has(String(payment.task_id || ''))) continue;
        const releaseResponse = await fetch(releaseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': req.headers.get('authorization') || '',
          },
          body: JSON.stringify({ task_id: String(payment.task_id || ''), worker_id: workerId }),
        });
        const release = await releaseResponse.json().catch(() => ({}));
        if (releaseResponse.ok && release.ok && release.transfer_id) released += 1;
      }
    }

    return json({
      ok: true,
      connected: true,
      payouts_enabled: payoutsEnabled,
      details_submitted: !!account.details_submitted,
      payout_owner: graduatedAdult && payoutsEnabled ? 'self' : userRow?.payout_owner,
      held_payouts_released: released,
    });
  } catch (err) {
    console.error('sync-connect-status error:', err);
    return json({ ok: false, error: String(err) }, 500);
  }
});
