import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authErrorStatus, requireFirebaseUser } from '../_shared/firebase-auth.ts';

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
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405);

  let identity;
  try {
    identity = await requireFirebaseUser(req);
  } catch (err) {
    return json({ success: false, error: err instanceof Error ? err.message : 'unauthorized' }, authErrorStatus(err));
  }

  try {
    const input = await req.json();
    const app = input.application || input;
    const taskId = String(app.task_id || '').trim();
    if (!taskId) return json({ success: false, error: 'missing_task_id' }, 400);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    );
    const { data: actor } = await supabase
      .from('users')
      .select('name,avatar_url,account_status,status')
      .eq('firebase_uid', identity.uid)
      .maybeSingle();
    if (
      !actor ||
      actor.account_status !== 'active' ||
      ['banned', 'blocked', 'suspended'].includes(String(actor.status || '').toLowerCase())
    ) {
      return json({
        success: false,
        error: 'account_not_active',
        message: 'A parent or guardian must approve this account before you can apply to gigs.',
      }, 403);
    }
    if (!String(actor.avatar_url || '').trim()) {
      return json({ success: false, error: 'profile_photo_required' }, 400);
    }

    const { data: task } = await supabase
      .from('tasks')
      .select('task_id,posted_by,status')
      .eq('task_id', taskId)
      .maybeSingle();
    if (!task) return json({ success: false, error: 'task_not_found' }, 404);
    if (task.posted_by === identity.uid) {
      return json({ success: false, error: 'cannot_apply_own_task' }, 400);
    }
    if (task.status !== 'open') return json({ success: false, error: 'task_not_open' }, 409);

    const { data: existing } = await supabase
      .from('applications')
      .select('app_id')
      .eq('task_id', taskId)
      .eq('worker_id', identity.uid)
      .limit(1);
    if (existing?.length) return json({ success: false, error: 'already_applied' }, 409);

    const row = {
      task_id: taskId,
      worker_id: identity.uid,
      worker_name: String(actor.name || app.worker_name || 'Tasker').slice(0, 120),
      message: String(app.message || '').trim().slice(0, 1000),
      price: Math.round(Number(app.price) || 0),
      status: 'pending',
    };
    if (!row.message || row.price < 1) return json({ success: false, error: 'invalid_application' }, 400);

    const { data, error } = await supabase.from('applications').insert(row).select('*').single();
    if (error) {
      if (String(error.code) === '23505') {
        return json({ success: false, error: 'already_applied' }, 409);
      }
      throw error;
    }
    return json({ success: true, data });
  } catch (err) {
    console.error('submit-application error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ success: false, error: message }, message.includes('account_not_active') ? 403 : 500);
  }
});
