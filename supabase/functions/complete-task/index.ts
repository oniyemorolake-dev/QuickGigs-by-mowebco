// QuickGigs — Mark task complete (service role; fixes legacy task id mismatches)
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

function taskIdKeys(...vals: (string | number | undefined | null)[]): (string | number)[] {
  const keys: (string | number)[] = [];
  const seen = new Set<string>();
  const add = (v: unknown) => {
    if (v == null || v === '') return;
    const s = String(v);
    if (seen.has(s)) return;
    seen.add(s);
    keys.push(v as string | number);
    if (isNumericId(s)) keys.push(parseInt(s, 10));
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

async function findAcceptedAppForTaskUuid(
  supabase: ReturnType<typeof createClient>,
  taskUuid: string,
) {
  if (!taskUuid) return null;
  const { data } = await supabase.from('applications').select('*').eq('task_id', taskUuid);
  return findAcceptedApp(data) || null;
}

async function fetchTaskRow(
  supabase: ReturnType<typeof createClient>,
  taskId: string,
  actorId: string,
  hintPosterId?: string,
  hintWorkerId?: string,
) {
  if (isUuidLike(taskId)) {
    const { data } = await supabase.from('tasks').select('*').eq('task_id', taskId).limit(1);
    if (data && data[0]) return data[0] as Record<string, unknown>;
  }

  for (const key of taskIdKeys(taskId)) {
    const { data: apps } = await supabase.from('applications').select('*').eq('task_id', key);
    const accepted = findAcceptedApp(apps);
    if (accepted) {
      const appTaskId = String(getField(accepted, 'task_id') || '');
      if (isUuidLike(appTaskId)) {
        const { data } = await supabase.from('tasks').select('*').eq('task_id', appTaskId).limit(1);
        if (data && data[0]) return data[0] as Record<string, unknown>;
      }
    }
  }

  if (hintPosterId) {
    const { data: posterTasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('posted_by', hintPosterId)
      .in('status', ['in_progress', 'completed']);
    for (const t of posterTasks || []) {
      const uuid = canonicalTaskId(t as Record<string, unknown>);
      if (!uuid) continue;
      const accepted = await findAcceptedAppForTaskUuid(supabase, uuid);
      if (!accepted) continue;
      if (hintWorkerId && String(getField(accepted, 'worker_id') || '') !== hintWorkerId) continue;
      if (taskIdKeys(taskId).some((k) => String(k) === uuid || String(k) === String(getField(t as Record<string, unknown>, 'task_id')))) {
        return t as Record<string, unknown>;
      }
    }
    const inProgress = (posterTasks || []).filter((t) =>
      String(getField(t as Record<string, unknown>, 'status') || '').toLowerCase() === 'in_progress'
    );
    if (inProgress.length === 1) return inProgress[0] as Record<string, unknown>;
  }

  if (hintWorkerId || actorId) {
    const workerId = hintWorkerId || actorId;
    const { data: workerApps } = await supabase
      .from('applications')
      .select('*')
      .eq('worker_id', workerId)
      .eq('status', 'accepted');
    for (const app of workerApps || []) {
      const appTaskId = String(getField(app as Record<string, unknown>, 'task_id') || '');
      if (taskIdKeys(taskId).some((k) => String(k) === appTaskId) || (workerApps || []).length === 1) {
        if (isUuidLike(appTaskId)) {
          const { data } = await supabase.from('tasks').select('*').eq('task_id', appTaskId).limit(1);
          if (data && data[0]) return data[0] as Record<string, unknown>;
        }
      }
    }
  }

  for (const key of taskIdKeys(taskId)) {
    const { data: convs } = await supabase.from('conversations').select('*').eq('task_id', key).limit(5);
    for (const conv of convs || []) {
      const posterId = String(getField(conv as Record<string, unknown>, 'poster_id') || '');
      const workerId = String(getField(conv as Record<string, unknown>, 'worker_id') || '');
      const { data: posterTasks } = await supabase
        .from('tasks')
        .select('*')
        .eq('posted_by', posterId)
        .in('status', ['in_progress', 'completed']);
      for (const t of posterTasks || []) {
        const uuid = canonicalTaskId(t as Record<string, unknown>);
        const accepted = uuid ? await findAcceptedAppForTaskUuid(supabase, uuid) : null;
        if (accepted && String(getField(accepted, 'worker_id') || '') === workerId) {
          return t as Record<string, unknown>;
        }
      }
    }
  }

  return null;
}

async function fetchAcceptedApp(
  supabase: ReturnType<typeof createClient>,
  task: Record<string, unknown>,
  inputTaskId: string,
) {
  const taskUuid = canonicalTaskId(task);
  if (taskUuid) {
    const byUuid = await findAcceptedAppForTaskUuid(supabase, taskUuid);
    if (byUuid) return byUuid;
  }
  for (const key of taskIdKeys(inputTaskId, taskUuid)) {
    const { data } = await supabase.from('applications').select('*').eq('task_id', key);
    const accepted = findAcceptedApp(data);
    if (accepted) return accepted;
  }
  const workerId = String(getField(task, 'worker_id') || '');
  if (workerId) {
    const { data } = await supabase
      .from('applications')
      .select('*')
      .eq('worker_id', workerId)
      .eq('status', 'accepted');
    return findAcceptedApp(data);
  }
  return null;
}

async function lockConversations(
  supabase: ReturnType<typeof createClient>,
  taskId: string,
  posterId: string,
  workerId: string,
) {
  for (const key of taskIdKeys(taskId)) {
    const { data: convs } = await supabase
      .from('conversations')
      .select('conv_id')
      .eq('task_id', key);
    for (const conv of convs || []) {
      if (conv?.conv_id) {
        await supabase
          .from('conversations')
          .update({ is_unlocked: false, status: 'completed' })
          .eq('conv_id', conv.conv_id);
      }
    }
  }
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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    let task: Record<string, unknown> | null = null;
    if (canonicalFromClient && isUuidLike(canonicalFromClient)) {
      const { data } = await supabase.from('tasks').select('*').eq('task_id', canonicalFromClient).limit(1);
      task = data && data[0] ? data[0] as Record<string, unknown> : null;
    }
    if (!task) {
      task = await fetchTaskRow(supabase, inputTaskId, actorId, hintPosterId, hintWorkerId);
    }
    if (!task) return json({ ok: false, success: false, error: 'task_not_found' }, 404);

    const taskUuid = canonicalTaskId(task);
    const posterId = String(getField(task, 'posted_by') || hintPosterId || '');
    const app = await fetchAcceptedApp(supabase, task, inputTaskId);
    const workerId = app ? String(getField(app, 'worker_id') || hintWorkerId || '') : hintWorkerId;

    if (!posterId) return json({ ok: false, success: false, error: 'poster_missing' }, 400);
    if (actorId !== posterId && actorId !== workerId) {
      return json({ ok: false, success: false, error: 'not_authorized' }, 403);
    }

    const currentStatus = String(getField(task, 'status') || '').toLowerCase();
    if (currentStatus !== 'in_progress' && currentStatus !== 'completed') {
      return json({ ok: false, success: false, error: 'task_not_in_progress' }, 400);
    }

    if (currentStatus !== 'completed' && taskUuid) {
      const { error: taskErr } = await supabase
        .from('tasks')
        .update({ status: 'completed' })
        .eq('task_id', taskUuid);
      if (taskErr) return json({ ok: false, success: false, error: taskErr.message }, 500);
    }

    if (app) {
      const appId = getField(app, 'app_id') || getField(app, 'id') || getField(app, 'application_id');
      if (appId) {
        await supabase.from('applications').update({ status: 'completed' }).eq('app_id', appId);
      } else {
        for (const key of taskIdKeys(inputTaskId, taskUuid, getField(app, 'task_id'))) {
          await supabase
            .from('applications')
            .update({ status: 'completed' })
            .eq('task_id', key)
            .eq('worker_id', workerId)
            .eq('status', 'accepted');
        }
      }
    }

    if (posterId && workerId) {
      await lockConversations(supabase, inputTaskId, posterId, workerId);
    }

    return json({
      ok: true,
      success: true,
      task_id: taskUuid || inputTaskId,
      poster_id: posterId,
      worker_id: workerId,
    });
  } catch (err) {
    console.error('complete-task error:', err);
    return json({ ok: false, success: false, error: String(err) }, 500);
  }
});
