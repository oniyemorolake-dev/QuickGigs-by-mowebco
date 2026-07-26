// QuickGigs — Mark task complete (service role; UUID + legacy id safe)
// Deploy: supabase functions deploy complete-task --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

function isNumericId(val: string): boolean {
  return /^\d+$/.test(String(val || '').trim());
}

function isUuidLike(val: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(val || '').trim(),
  );
}

function canonicalTaskId(task: Record<string, unknown>): string {
  return String(getField(task, 'task_id') || getField(task, 'id') || '');
}

type Sb = ReturnType<typeof createClient>;

async function loadTaskByAnyId(supabase: Sb, taskKey: string) {
  if (!taskKey) return null;
  // Avoid querying UUID column with bare integers
  if (!isUuidLike(taskKey) && isNumericId(taskKey)) return null;
  const { data } = await supabase.from('tasks').select('*').eq('task_id', taskKey).limit(1);
  return data?.[0] ? data[0] as Record<string, unknown> : null;
}

async function resolveTask(
  supabase: Sb,
  inputTaskId: string,
  actorId: string,
  hintPosterId: string,
  hintWorkerId: string,
) {
  if (isUuidLike(inputTaskId)) {
    const direct = await loadTaskByAnyId(supabase, inputTaskId);
    if (direct) return direct;
  }

  const posterId = hintPosterId || actorId;
  const workerId = hintWorkerId;

  // 1) Payment row for poster+worker → UUID task_id
  if (posterId && workerId) {
    const { data: pays } = await supabase
      .from('payments')
      .select('task_id,status')
      .eq('poster_id', posterId)
      .eq('worker_id', workerId)
      .order('created_at', { ascending: false })
      .limit(10);
    for (const p of pays || []) {
      const tid = String(getField(p as Record<string, unknown>, 'task_id') || '');
      if (isUuidLike(tid)) {
        const t = await loadTaskByAnyId(supabase, tid);
        if (t) return t;
      }
    }
  }

  // 2) Conversation (legacy bigint) → poster/worker → poster in_progress tasks
  if (isNumericId(inputTaskId)) {
    const { data: convs } = await supabase
      .from('conversations')
      .select('poster_id,worker_id,task_id')
      .eq('task_id', parseInt(inputTaskId, 10))
      .limit(5);
    for (const conv of convs || []) {
      const cPoster = String(getField(conv as Record<string, unknown>, 'poster_id') || posterId);
      const cWorker = String(getField(conv as Record<string, unknown>, 'worker_id') || workerId);
      const found = await resolvePosterInProgress(supabase, cPoster, cWorker);
      if (found) return found;
    }
  }

  // 3) Accepted applications for worker (task_id may be legacy or UUID)
  if (workerId) {
    const { data: apps } = await supabase
      .from('applications')
      .select('*')
      .eq('worker_id', workerId)
      .eq('status', 'accepted');
    for (const app of apps || []) {
      const appTaskId = String(getField(app as Record<string, unknown>, 'task_id') || '');
      if (isUuidLike(appTaskId)) {
        const t = await loadTaskByAnyId(supabase, appTaskId);
        if (t && (!posterId || String(getField(t, 'posted_by') || '') === posterId)) return t;
      }
    }
  }

  // 4) Poster in_progress (+ optional worker match via apps/conversations)
  if (posterId) {
    const found = await resolvePosterInProgress(supabase, posterId, workerId);
    if (found) return found;
  }

  return null;
}

async function resolvePosterInProgress(supabase: Sb, posterId: string, workerId: string) {
  if (!posterId) return null;
  const { data: posterTasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('posted_by', posterId)
    .eq('status', 'in_progress');

  const rows = (posterTasks || []) as Record<string, unknown>[];
  if (!rows.length) {
    const { data: done } = await supabase
      .from('tasks')
      .select('*')
      .eq('posted_by', posterId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(5);
    return (done && done[0]) ? done[0] as Record<string, unknown> : null;
  }
  if (rows.length === 1) return rows[0];
  if (!workerId) return rows[0];

  for (const t of rows) {
    const tid = canonicalTaskId(t);
    // Match accepted app on UUID
    if (tid) {
      const { data: apps } = await supabase
        .from('applications')
        .select('worker_id,status')
        .eq('task_id', tid)
        .eq('status', 'accepted')
        .limit(5);
      if ((apps || []).some((a) => String(getField(a as Record<string, unknown>, 'worker_id') || '') === workerId)) {
        return t;
      }
    }
    // Match conversation by poster+worker (legacy id on conv)
    const { data: convs } = await supabase
      .from('conversations')
      .select('conv_id')
      .eq('poster_id', posterId)
      .eq('worker_id', workerId)
      .in('status', ['in_progress', 'application'])
      .limit(1);
    if (convs && convs.length) {
      // Prefer the in-progress task that is "current" — if multiple poster tasks, pick first with payment
      const { data: pay } = await supabase
        .from('payments')
        .select('task_id')
        .eq('poster_id', posterId)
        .eq('worker_id', workerId)
        .order('created_at', { ascending: false })
        .limit(1);
      const payTid = pay?.[0] ? String(getField(pay[0] as Record<string, unknown>, 'task_id') || '') : '';
      if (payTid && payTid === tid) return t;
    }
  }

  // Fallback: payment UUID for this pair
  const { data: pay } = await supabase
    .from('payments')
    .select('task_id')
    .eq('poster_id', posterId)
    .eq('worker_id', workerId)
    .order('created_at', { ascending: false })
    .limit(1);
  const payTid = pay?.[0] ? String(getField(pay[0] as Record<string, unknown>, 'task_id') || '') : '';
  if (isUuidLike(payTid)) {
    const t = await loadTaskByAnyId(supabase, payTid);
    if (t) return t;
  }

  return rows[0];
}

async function markTaskCompleted(supabase: Sb, task: Record<string, unknown>) {
  const tid = canonicalTaskId(task);
  if (!tid) return { ok: false as const, error: 'task_id_missing' };

  if (String(getField(task, 'status') || '').toLowerCase() === 'completed') {
    return { ok: true as const, task_id: tid, already: true };
  }

  const { data, error } = await supabase
    .from('tasks')
    .update({ status: 'completed' })
    .eq('task_id', tid)
    .select('task_id,status')
    .limit(1);

  if (error) return { ok: false as const, error: error.message };
  if (!data || !data.length) {
    return { ok: false as const, error: 'task_update_matched_zero_rows' };
  }
  return { ok: true as const, task_id: String(data[0].task_id) };
}

async function completeApps(
  supabase: Sb,
  task: Record<string, unknown>,
  inputTaskId: string,
  workerId: string,
) {
  if (!workerId) return;
  const tid = canonicalTaskId(task);
  const keys = [tid, inputTaskId].filter(Boolean);

  for (const key of keys) {
    await supabase
      .from('applications')
      .update({ status: 'completed' })
      .eq('task_id', key)
      .eq('worker_id', workerId)
      .eq('status', 'accepted');
  }

  // Also by worker only for this poster task when app task_id is legacy
  await supabase
    .from('applications')
    .update({ status: 'completed' })
    .eq('worker_id', workerId)
    .eq('status', 'accepted');
}

async function lockChats(supabase: Sb, posterId: string, workerId: string, inputTaskId: string) {
  if (posterId && workerId) {
    const { data: byPair } = await supabase
      .from('conversations')
      .select('conv_id')
      .eq('poster_id', posterId)
      .eq('worker_id', workerId);
    for (const conv of byPair || []) {
      if (conv?.conv_id) {
        await supabase
          .from('conversations')
          .update({ is_unlocked: false, status: 'completed' })
          .eq('conv_id', conv.conv_id);
      }
    }
  }
  if (isNumericId(inputTaskId)) {
    const { data: byLegacy } = await supabase
      .from('conversations')
      .select('conv_id')
      .eq('task_id', parseInt(inputTaskId, 10));
    for (const conv of byLegacy || []) {
      if (conv?.conv_id) {
        await supabase
          .from('conversations')
          .update({ is_unlocked: false, status: 'completed' })
          .eq('conv_id', conv.conv_id);
      }
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    const inputTaskId = String(body.task_id || '').trim();
    const actorId = String(body.actor_id || '').trim();
    const hintPosterId = String(body.poster_id || '').trim();
    const hintWorkerId = String(body.worker_id || '').trim();
    const canonicalFromClient = String(body.canonical_task_id || '').trim();

    if (!inputTaskId || !actorId) {
      return json({ ok: false, success: false, error: 'missing_task_or_actor' }, 400);
    }

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!serviceKey) {
      return json({ ok: false, success: false, error: 'service_role_missing' }, 503);
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey);

    let task: Record<string, unknown> | null = null;
    if (canonicalFromClient && isUuidLike(canonicalFromClient)) {
      task = await loadTaskByAnyId(supabase, canonicalFromClient);
    }
    if (!task) {
      task = await resolveTask(supabase, inputTaskId, actorId, hintPosterId, hintWorkerId);
    }
    if (!task) {
      return json({
        ok: false,
        success: false,
        error: 'task_not_found',
        details: `Could not resolve task ${inputTaskId} poster=${hintPosterId} worker=${hintWorkerId}`,
      }, 404);
    }

    const posterId = String(getField(task, 'posted_by') || hintPosterId || '');
    let workerId = hintWorkerId;
    if (!workerId) {
      const { data: apps } = await supabase
        .from('applications')
        .select('worker_id')
        .eq('task_id', canonicalTaskId(task))
        .eq('status', 'accepted')
        .limit(1);
      workerId = apps?.[0] ? String(getField(apps[0] as Record<string, unknown>, 'worker_id') || '') : '';
    }
    if (!workerId && posterId) {
      const { data: convs } = await supabase
        .from('conversations')
        .select('worker_id')
        .eq('poster_id', posterId)
        .in('status', ['in_progress', 'application'])
        .order('created_at', { ascending: false })
        .limit(1);
      workerId = convs?.[0] ? String(getField(convs[0] as Record<string, unknown>, 'worker_id') || '') : '';
    }

    if (!posterId) return json({ ok: false, success: false, error: 'poster_missing' }, 400);
    if (actorId !== posterId && actorId !== workerId) {
      return json({
        ok: false,
        success: false,
        error: 'not_authorized',
        details: `actor=${actorId} poster=${posterId} worker=${workerId}`,
      }, 403);
    }

    const status = String(getField(task, 'status') || '').toLowerCase();
    if (status !== 'in_progress' && status !== 'completed') {
      return json({
        ok: false,
        success: false,
        error: 'task_not_in_progress',
        details: `status=${status}`,
      }, 400);
    }

    const updated = await markTaskCompleted(supabase, task);
    if (!updated.ok) {
      return json({
        ok: false,
        success: false,
        error: updated.error,
        details: `task_id=${canonicalTaskId(task)}`,
      }, 500);
    }

    await completeApps(supabase, task, inputTaskId, workerId);
    await lockChats(supabase, posterId, workerId, inputTaskId);

    return json({
      ok: true,
      success: true,
      task_id: updated.task_id,
      poster_id: posterId,
      worker_id: workerId,
      already: !!updated.already,
    });
  } catch (err) {
    console.error('complete-task error:', err);
    return json({
      ok: false,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});
