// QuickGigs — auto-release / no-show flag timers (paused while disputed)
// Deploy: supabase functions deploy dispute-auto-rules --no-verify-jwt
// Cron: POST with header x-cron-secret = DISPUTE_CRON_SECRET (or GRADUATION_CRON_SECRET)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const cronSecret = Deno.env.get('DISPUTE_CRON_SECRET') || Deno.env.get('GRADUATION_CRON_SECRET') || '';
  const headerSecret = req.headers.get('x-cron-secret') || '';
  if (!cronSecret || headerSecret !== cronSecret) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const autoReleaseDays = Number(Deno.env.get('DISPUTE_AUTO_RELEASE_DAYS') || '3');
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey || stripeKey.startsWith('sk_live_')) {
    return json({ ok: false, error: 'stripe_not_configured_or_live_blocked' }, 503);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
  const now = Date.now();
  const releaseCutoff = new Date(now - autoReleaseDays * 86400000).toISOString();

  const results = {
    auto_released: 0 as number,
    no_show_flagged: 0 as number,
    skipped_disputed: 0 as number,
    errors: [] as string[],
  };

  try {
    // 1) Auto-release: tasker completed, poster silent, no open dispute, payment held
    const { data: candidates } = await supabase
      .from('tasks')
      .select('task_id,posted_by,worker_completed_at,poster_confirmed_at,evidence_frozen,scheduled_at,status')
      .eq('evidence_frozen', false)
      .not('worker_completed_at', 'is', null)
      .is('poster_confirmed_at', null)
      .lte('worker_completed_at', releaseCutoff)
      .in('status', ['in_progress', 'completed'])
      .limit(40);

    for (const task of candidates || []) {
      const taskId = String(task.task_id || '');
      try {
        const { data: openD } = await supabase
          .from('disputes')
          .select('dispute_id')
          .eq('task_id', taskId)
          .in('status', ['open', 'reviewing'])
          .limit(1);
        if (openD && openD.length) {
          results.skipped_disputed++;
          continue;
        }

        const { data: pays } = await supabase
          .from('payments')
          .select('*')
          .eq('task_id', taskId)
          .eq('status', 'held')
          .limit(1);
        const payment = pays?.[0] as Record<string, unknown> | undefined;
        if (!payment) continue;

        const workerId = String(getField(payment, 'worker_id') || '');
        const posterId = String(getField(payment, 'poster_id') || '');
        const workerPayoutCents = Math.round(Number(getField(payment, 'worker_payout') || 0) * 100);
        if (!workerId || workerPayoutCents <= 0) continue;

        const { data: workerUser } = await supabase
          .from('users')
          .select('date_of_birth,guardian_consent_status,guardian_stripe_connect_id,stripe_connect_id')
          .eq('firebase_uid', workerId)
          .maybeSingle();

        const minor = isMinor(workerUser?.date_of_birth);
        if (minor && workerUser?.guardian_consent_status !== 'approved') continue;
        const connectId = minor
          ? String(workerUser?.guardian_stripe_connect_id || '')
          : String(workerUser?.stripe_connect_id || '');
        if (!connectId) continue;

        const stripeRef = String(getField(payment, 'stripe_id') || '');
        let sourceTransaction: string | undefined;
        let piId = stripeRef;
        if (stripeRef.startsWith('cs_')) {
          const session = await stripe.checkout.sessions.retrieve(stripeRef);
          const pi = session.payment_intent;
          piId = typeof pi === 'string' ? pi : (pi?.id || '');
        }
        if (piId.startsWith('pi_')) {
          const pi = await stripe.paymentIntents.retrieve(piId);
          const charge = pi.latest_charge;
          sourceTransaction = typeof charge === 'string' ? charge : charge?.id;
        }

        const transfer = await stripe.transfers.create({
          amount: workerPayoutCents,
          currency: 'cad',
          destination: connectId,
          ...(sourceTransaction ? { source_transaction: sourceTransaction } : {}),
          metadata: {
            project: 'quickgigs',
            task_id: taskId,
            worker_id: workerId,
            poster_id: posterId,
            via: 'auto_release',
            payout_owner: minor ? 'guardian' : 'self',
          },
        });

        const completedAt = new Date().toISOString();
        await supabase.from('payments').update({
          status: 'paid',
          transfer_id: transfer.id,
          completed_at: completedAt,
        }).eq('payment_id', getField(payment, 'payment_id'));

        await supabase.from('tasks').update({
          status: 'completed',
          poster_confirmed_at: completedAt,
        }).eq('task_id', taskId);

        results.auto_released++;
      } catch (e) {
        results.errors.push(`${taskId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 2) No-show flag: past scheduled_at, never arrived/started, payment still held, no dispute
    const { data: overdue } = await supabase
      .from('tasks')
      .select('task_id,scheduled_at,evidence_frozen,status')
      .eq('evidence_frozen', false)
      .eq('status', 'in_progress')
      .not('scheduled_at', 'is', null)
      .lt('scheduled_at', new Date().toISOString())
      .limit(40);

    for (const task of overdue || []) {
      const taskId = String(task.task_id || '');
      try {
        const { data: openD } = await supabase
          .from('disputes')
          .select('dispute_id')
          .eq('task_id', taskId)
          .in('status', ['open', 'reviewing'])
          .limit(1);
        if (openD && openD.length) {
          results.skipped_disputed++;
          continue;
        }

        const { data: stamps } = await supabase
          .from('task_status_stamps')
          .select('stamp_type')
          .eq('task_id', taskId)
          .in('stamp_type', ['arrived', 'started']);
        if (stamps && stamps.length) continue;

        const { data: pays } = await supabase
          .from('payments')
          .select('payment_id,status')
          .eq('task_id', taskId)
          .eq('status', 'held')
          .limit(1);
        if (!pays || !pays.length) continue;

        // Flag for admin — do not auto-refund money without review (safer)
        await supabase.from('admin_actions').insert({
          admin_id: 'system',
          action: 'no_show_auto_flag',
          target_type: 'task',
          target_id: taskId,
          detail: JSON.stringify({
            reason: 'Tasker never marked arrived/started by scheduled_at',
            scheduled_at: task.scheduled_at,
            suggested: 'refund',
          }),
        });

        try {
          await supabase.from('notification_queue').insert({
            channel: 'email',
            template: 'no_show_flag',
            to_email: Deno.env.get('ADMIN_NOTIFY_EMAIL') || 'mowebsiteco@gmail.com',
            payload: {
              task_id: taskId,
              subject: `[QuickGigs] No-show flag — consider refund for task ${taskId}`,
            },
            status: 'pending',
          });
        } catch (_) { /* optional */ }

        results.no_show_flagged++;
      } catch (e) {
        results.errors.push(`noshow:${taskId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return json({ ok: true, auto_release_days: autoReleaseDays, ...results });
  } catch (err) {
    console.error('dispute-auto-rules error:', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
