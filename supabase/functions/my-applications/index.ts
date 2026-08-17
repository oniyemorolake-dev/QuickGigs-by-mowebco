import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authErrorStatus, requireFirebaseUser } from '../_shared/firebase-auth.ts';

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

const APP_SELECT =
  'app_id,task_id,worker_id,worker_name,message,price,status,guardian_status,guardian_reviewed_at,guardian_distance_km,created_at,counter_price,counter_by,counter_round,last_counter_at';
const TASK_SELECT =
  'task_id,title,category,created_at,posted_by,poster_name,status,budget,location';

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
    const body = await req.json().catch(() => ({}));
    const includePosted = body.include_posted_tasks !== false;
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    );
    const uid = identity.uid;

    const { data: apps, error } = await supabase
      .from('applications')
      .select(APP_SELECT)
      .eq('worker_id', uid)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const appRows = apps || [];
    const taskIds = [...new Set(appRows.map((a) => String(a.task_id || '')).filter(Boolean))];
    const { data: relatedTasks } = taskIds.length
      ? await supabase.from('tasks').select(TASK_SELECT).in('task_id', taskIds)
      : { data: [] as Array<Record<string, unknown>> };
    const taskMap = new Map((relatedTasks || []).map((t) => [String(t.task_id), t]));

    const enrichedApps = appRows.map((a) => {
      const task = taskMap.get(String(a.task_id || '')) || null;
      if (!task) return a;
      return {
        ...a,
        task_title: task.title || '',
        task_category: task.category || '',
        task_status: task.status || '',
        task_created_at: task.created_at || '',
        posted_by: task.posted_by || '',
        poster_name: task.poster_name || '',
        task_budget: task.budget,
        task_location: task.location || '',
        task,
      };
    });

    let postedTasks: Array<Record<string, unknown>> = [];
    if (includePosted) {
      const { data: mine, error: mineErr } = await supabase
        .from('tasks')
        .select(TASK_SELECT)
        .eq('posted_by', uid)
        .order('created_at', { ascending: false })
        .limit(100);
      if (mineErr) throw mineErr;
      postedTasks = mine || [];
    }

    return json({
      ok: true,
      success: true,
      data: enrichedApps,
      tasks: postedTasks,
    });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
