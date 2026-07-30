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
    const task = input.task || input;
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    );
    const { data: actor } = await supabase
      .from('users')
      .select('name,account_status,status')
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
        message: 'A parent or guardian must approve this account before you can post gigs.',
      }, 403);
    }

    const row: Record<string, unknown> = {
      title: String(task.title || '').trim().slice(0, 100),
      description: String(task.description || '').trim().slice(0, 2000),
      category: String(task.category || 'other').toLowerCase().slice(0, 50),
      task_mode: String(task.task_mode || 'standard').toLowerCase().slice(0, 30),
      budget: Math.round(Number(task.budget) || 0),
      location: String(task.location || 'Calgary, AB').trim().slice(0, 100),
      status: 'open',
      posted_by: identity.uid,
      poster_name: String(actor.name || task.poster_name || 'Poster').slice(0, 120),
    };
    const optional = [
      'scheduled_at', 'scheduled_label', 'photo_urls', 'requires_photos',
      'budget_negotiable', 'rate_type', 'is_recurring', 'frequency',
      'hourly_rate', 'est_hours', 'lat', 'lng', 'precise_address',
    ];
    for (const key of optional) {
      if (task[key] != null && task[key] !== '') row[key] = task[key];
    }
    if (!row.title || Number(row.budget) < 20) {
      return json({ success: false, error: 'invalid_task' }, 400);
    }

    const { data, error } = await supabase.from('tasks').insert(row).select('*').single();
    if (error) throw error;
    return json({ success: true, data });
  } catch (err) {
    console.error('post-task error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ success: false, error: message }, message.includes('account_not_active') ? 403 : 500);
  }
});
