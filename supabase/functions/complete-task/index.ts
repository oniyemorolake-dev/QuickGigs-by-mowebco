// QuickGigs — Mark task complete (service role; verifies row updates)
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

function taskIdKeys(...vals: (string | number | undefined | null)[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const add = (v: unknown) => {
    if (v == null || v === '') return;
    const s = String(v);
    if (seen.has(s)) return;
    seen.add(s);
    keys.push(s);
  };
  vals.forEach(add);
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

type Sb = ReturnType<typeof createClient>;

async function findAcceptedAppForTask(supabase: Sb, taskKey: string) {
  if (!taskKey) return null;
  const { data } = await supabase.from('applications').select('*').eq('task_id', taskKey);
  return findAcceptedApp(data) || null;
}

async function resolveByPosterWorker(
  supabase: Sb,
  posterId: string,
  workerId: string,
  inputTaskId: string,
) {
  if (!posterId || !workerId) return null;

  const { data: posterTasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('posted_by', posterId)
    .in('status', ['in_progress', 'completed']);

  const matches: Record<string, unknown>[] = [];
  const inputKeys = new Set(taskIdKeys(inputTaskId));

  for (const t of posterTasks || []) {
    const row = t as Record<string, unknown>;
    const tid = canonicalTaskId(row);
    let accepted = tid ? await findAcceptedAppForTask(supabase, tid) : null;
    if (!accepted) {
      for (const key of inputKeys) {
        accepted = await findAcceptedAppForTask(supabase, key);
        if (accepted && String(getField(accepted, 'worker_id') || '') === workerId) break;
        accepted = null;
      }
    }
    if (!accepted) continue;
    if (String(getField(accepted, 'worker_id') || '') !== workerId) continue;
    matches.push(row);
  }

  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];

  const byInput = matches.find((t) => inputKeys.has(canonicalTaskId(t)));
  if (byInput) return byInput;

  const inProgress = matches.filter((t) =>
    String(getField(t, 'status') || '').toLowerCase() === 'in_progress'
  );
  return inProgress[0] || matches[0];
}

async function resolveTask(
  supabase: Sb,
  inputTaskId: string,
  actorId: string,
  hintPosterId: string,
  hintWorkerId: string,
) {
  if (isUuidLike(inputTaskId)) {
    const { data } = await supabase.from('tasks').select('*').eq('task_id', inputTaskId).limit(1);
    if (data?.[0]) return data[0] as Record<string, unknown>;
  }

  // Direct eq for numeric/text task_id (legacy rows)
  for (const key of taskIdKeys(inputTaskId)) {
    const { data } = await supabase.from('tasks').select('*').eq('task_id', key).limit(1);
    if (data?.[0]) return data[0] as Record<string, unknown>;
  }

  // Conversations are often legacy BIGINT task ids
  for (const key of taskIdKeys(inputTaskId)) {
    const n = isNumericId(key) ? Number(key) : key;
    const { data: convs } = await supabase
      .from('conversations')
      .select('*')
      .eq('task_id', n)
      .limit(5);
    for (const conv of convs || []) {
      const posterId = String(getField(conv as Record<string, unknown>, 'poster_id') || '');
      const workerId = String(getField(conv as Record<string, unknown>, 'worker_id') || '');
      const found = await resolveByPosterWorker(supabase, posterId, workerId, inputTaskId);
      if (found) return found;
    }
  }

  const posterId = hintPosterId || actorId;
  const workerId = hintWorkerId;
  if (posterId && workerId) {
    const found = await resolveByPosterWorker(supabase, posterId, workerId, inputTaskId);
    if (found) return found;
  }

  // Actor is worker: find their accepted app, then task
  if (actorId) {
    const { data: workerApps } = await supabase
      .from('applications')
      .select('*')
      .eq('worker_id', actorId)
      .eq('status', 'accepted');
    for (const app of workerApps || []) {
      const appTaskId = String(getField(app as Record<string, unknown>, 'task_id') || '');
      if (!appTaskId) continue;
      if (taskIdKeys(inputTaskId).includes(appTaskId) || (workerApps || []).length === 1) {
        const { data } = await supabase.from('tasks').select('*').eq('task_id', appTaskId).limit(1);
        if (data?.[0]) return data[0] as Record<string, unknown>;
      }
    }
  }

  // Last resort: single in-progress task for poster
  if (hintPosterId) {
    const { data: rows } = await supabase
      .from('tasks')
      .select('*')
      .eq('posted_by', hintPosterId)
      .eq('status', 'in_progress');
    if (rows && rows.length === 1) return rows[0] as Record<string, unknown>;
  }

  return null;
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
    // Try numeric cast for BIGINT columns
    if (isNumericId(tid)) {
      const { data: data2, error: err2 } = await supabase
        .from('tasks')
        .update({ status: 'completed' })
        .eq('task_id', parseInt(tid, 10))
        .select('task_id,status')
        .limit(1);
      if (err2) return { ok: false as const, error: err2.message };
      if (data2 && data2.length) return { ok: true as const, task_id: String(data2[0].task_id) };
    }
    return { ok: false as const, error: 'task_update_matched_zero_rows' };
  }

  return { ok: true as const, task_id: String(data[0].task_id) };
}

async function completeApplication(
  supabase: Sb,
  task: Record<string, unknown>,
  inputTaskId: string,
  workerId: string,
) {
  if (!workerId) return;
  const tid = canonicalTaskId(task);
  const keys = taskIdKeys(tid, inputTaskId, getField(task, 'task_id'));

  for (const key of keys) {
    const { data: apps } = await supabase
      .from('applications')
      .select('*')
      .eq('task_id', key)
      .eq('worker_id', workerId)
      .eq('status', 'accepted');
    for (const app of apps || []) {
      const appId = getField(app as Record<string, unknown>, 'app_id')
        || getField(app as Record<string, unknown>, 'id')
        || getField(app as Record<string, unknown>, 'application_id');
      if (appId) {
        await supabase.from('applications').update({ status: 'completed' }).eq('app_id', appId);
        await supabase.from('applications').update({ status: 'completed' }).eq('id', appId);
      } else {
        await supabase
          .from('applications')
          .update({ status: 'completed' })
          .eq('task_id', key)
          .eq('worker_id', workerId)
          .eq('status', 'accepted');
      }
    }
  }
}

async function lockConversations(
  supabase: Sb,
  task: Record<string, unknown>,
  inputTaskId: string,
  posterId: string,
  workerId: string,
) {
  const keys = taskIdKeys(canonicalTaskId(task), inputTaskId);
  for (const key of keys) {
    const filters = isNumericId(key)
      ? [key, parseInt(key, 10)]
      : [key];
    for (const f of filters) {
      const { data: convs } = await supabase.from('conversations').select('conv_id').eq('task_id', f);
      for (const conv of convs || []) {
        if (conv?.conv_id) {
          await supabase
            .from('conversations')
            .update({ is_unlocked: false, status: 'completed' })
            .eq('conv_id', conv.conv_id);
        }
      }
    }
  }
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
    if (canonicalFromClient) {
      const { data } = await supabase
        .from('tasks')
        .select('*')
        .eq('task_id', canonicalFromClient)
        .limit(1);
      task = data?.[0] ? data[0] as Record<string, unknown> : null;
    }
    if (!task) {
      task = await resolveTask(supabase, inputTaskId, actorId, hintPosterId, hintWorkerId);
    }
    if (!task && hintPosterId && hintWorkerId) {
      task = await resolveByPosterWorker(supabase, hintPosterId, hintWorkerId, inputTaskId);
    }
    if (!task) {
      return json({
        ok: false,
        success: false,
        error: 'task_not_found',
        details: `Could not resolve task ${inputTaskId} for actor ${actorId}`,
      }, 404);
    }

    const posterId = String(getField(task, 'posted_by') || hintPosterId || '');
    let workerId = hintWorkerId;
    const accepted = await findAcceptedAppForTask(supabase, canonicalTaskId(task));
    if (accepted) workerId = String(getField(accepted, 'worker_id') || workerId);
    if (!workerId) {
      for (const key of taskIdKeys(inputTaskId)) {
        const app = await findAcceptedAppForTask(supabase, key);
        if (app) {
          workerId = String(getField(app, 'worker_id') || '');
          break;
        }
      }
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

    await completeApplication(supabase, task, inputTaskId, workerId);
    await lockConversations(supabase, task, inputTaskId, posterId, workerId);

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
