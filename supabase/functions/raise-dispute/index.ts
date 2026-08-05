// QuickGigs — raise dispute + freeze escrow
// Deploy: supabase functions deploy raise-dispute --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authErrorStatus, requireFirebaseUser } from '../_shared/firebase-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const REASONS = new Set(['not_done', 'not_as_described', 'no_show', 'payment', 'other']);

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const taskId = String(body.task_id || '').trim();
    const reason = String(body.reason || 'other').toLowerCase();
    const detail = String(body.detail || body.details || '').trim().slice(0, 1500);
    if (!taskId) return json({ ok: false, error: 'missing_task_id' }, 400);
    if (!REASONS.has(reason)) return json({ ok: false, error: 'invalid_reason' }, 400);
    if (detail.length < 3) return json({ ok: false, error: 'detail_required' }, 400);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data: tasks } = await supabase.from('tasks').select('*').eq('task_id', taskId).limit(1);
    const task = tasks?.[0] as Record<string, unknown> | undefined;
    if (!task) return json({ ok: false, error: 'task_not_found' }, 404);

    const posterId = String(getField(task, 'posted_by') || '');
    const { data: apps } = await supabase
      .from('applications')
      .select('worker_id,status')
      .eq('task_id', taskId)
      .in('status', ['accepted', 'completed'])
      .limit(5);
    const workerId = apps?.[0] ? String(getField(apps[0] as Record<string, unknown>, 'worker_id') || '') : '';

    if (identity.uid !== posterId && identity.uid !== workerId) {
      return json({ ok: false, error: 'not_authorized' }, 403);
    }

    const { data: openExisting } = await supabase
      .from('disputes')
      .select('dispute_id,status')
      .eq('task_id', taskId)
      .in('status', ['open', 'reviewing'])
      .limit(1);
    if (openExisting && openExisting.length) {
      return json({
        ok: true,
        already: true,
        dispute_id: openExisting[0].dispute_id,
        message: 'A dispute is already open for this task. Escrow remains frozen.',
      });
    }

    const { data: pays } = await supabase
      .from('payments')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
      .limit(10);

    const payment = (pays || []).find((p) => {
      const st = String(p.status || '').toLowerCase();
      return st === 'held' || st === 'disputed' || st === 'paid';
    }) as Record<string, unknown> | undefined;

    if (!payment) {
      return json({ ok: false, error: 'no_funded_payment', message: 'Disputes require a funded (held) escrow payment.' }, 400);
    }
    const payStatus = String(getField(payment, 'status') || '').toLowerCase();
    if (payStatus === 'paid') {
      return json({
        ok: false,
        error: 'already_released_use_admin',
        message: 'Payout already released. Contact support — escrow cannot be re-frozen.',
      }, 409);
    }
    if (payStatus !== 'held' && payStatus !== 'disputed') {
      return json({ ok: false, error: 'payment_not_disputable' }, 400);
    }

    const againstId = identity.uid === posterId ? workerId : posterId;
    const now = new Date().toISOString();

    const { data: dispute, error: dErr } = await supabase
      .from('disputes')
      .insert({
        task_id: taskId,
        raised_by: identity.uid,
        against_id: againstId || null,
        reason,
        detail,
        status: 'open',
        payment_id: getField(payment, 'payment_id') || null,
        created_at: now,
      })
      .select('*')
      .single();
    if (dErr) throw dErr;

    const disputeId = dispute.dispute_id;
    await supabase
      .from('payments')
      .update({ status: 'disputed', dispute_id: disputeId })
      .eq('payment_id', getField(payment, 'payment_id'));

    await supabase
      .from('tasks')
      .update({ evidence_frozen: true })
      .eq('task_id', taskId);

    // Admin notification (in-app style via admin_actions audit + notification_queue if available)
    try {
      await supabase.from('admin_actions').insert({
        admin_id: 'system',
        action: 'dispute_opened',
        target_type: 'dispute',
        target_id: String(disputeId),
        detail: JSON.stringify({
          task_id: taskId,
          raised_by: identity.uid,
          reason,
          payment_id: getField(payment, 'payment_id'),
        }),
      });
    } catch (auditErr) {
      console.warn('admin_actions insert failed', auditErr);
    }

    const adminEmail = Deno.env.get('ADMIN_NOTIFY_EMAIL') || 'mowebsiteco@gmail.com';
    try {
      await supabase.from('notification_queue').insert({
        channel: 'email',
        template: 'dispute_opened',
        to_email: adminEmail,
        payload: {
          task_id: taskId,
          dispute_id: disputeId,
          reason,
          raised_by: identity.uid,
          subject: `[QuickGigs] Dispute opened — task ${taskId}`,
        },
        status: 'pending',
      });
    } catch (qErr) {
      console.warn('notification_queue insert failed', qErr);
    }

    // Notify other party in-app if table exists
    if (againstId) {
      try {
        await supabase.from('user_notifications').insert({
          user_id: againstId,
          type: 'dispute_opened',
          title: 'A dispute was opened',
          body: 'Escrow is frozen until an admin reviews the evidence.',
          link: 'mytasks.html?tab=inprogress',
          meta: { task_id: taskId, dispute_id: disputeId },
        });
      } catch (_) { /* optional */ }
    }

    return json({
      ok: true,
      dispute_id: disputeId,
      payment_status: 'disputed',
      frozen: true,
      message: 'Escrow frozen. An admin will review the evidence record.',
    });
  } catch (err) {
    console.error('raise-dispute error:', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
