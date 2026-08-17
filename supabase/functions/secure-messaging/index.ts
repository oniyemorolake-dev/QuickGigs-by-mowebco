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

function isParty(conv: Record<string, unknown>, uid: string) {
  return String(conv.poster_id || '') === uid || String(conv.worker_id || '') === uid;
}

function cleanPatch(input: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  for (const key of ['poster_name', 'worker_name', 'task_title', 'task_category']) {
    if (input[key] != null) patch[key] = String(input[key]).trim().slice(0, 160);
  }
  if (input.status != null) {
    const status = String(input.status).toLowerCase();
    // Clients may not unlock chat — escrow webhook / confirm-checkout only.
    if (['application', 'in_progress', 'completed', 'closed'].includes(status)) patch.status = status;
  }
  // Intentionally ignore input.is_unlocked
  return patch;
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
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '').toLowerCase();
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    );
    const uid = identity.uid;

    async function relationshipValid(conv: Record<string, unknown>) {
      if (!isParty(conv, uid)) return false;
      const taskId = String(conv.task_id || '');
      const posterId = String(conv.poster_id || '');
      const workerId = String(conv.worker_id || '');
      if (!taskId || !posterId || !workerId) return false;
      const [{ data: task }, { data: app }] = await Promise.all([
        supabase.from('tasks').select('task_id,posted_by,status').eq('task_id', taskId).maybeSingle(),
        supabase
          .from('applications')
          .select('app_id,task_id,worker_id,status')
          .eq('task_id', taskId)
          .eq('worker_id', workerId)
          .in('status', ['accepted', 'completed'])
          .maybeSingle(),
      ]);
      return !!task && String(task.posted_by || '') === posterId && !!app;
    }

    async function getConversation(convId: string) {
      if (!convId) return null;
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('conv_id', convId)
        .maybeSingle();
      if (error) throw error;
      if (!data || !await relationshipValid(data)) return null;
      return data as Record<string, unknown>;
    }

    if (action === 'list' || action === 'for_task') {
      let query = supabase
        .from('conversations')
        .select('*')
        .or(`poster_id.eq.${uid},worker_id.eq.${uid}`)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });
      if (action === 'for_task') {
        const taskId = String(body.task_id || '').trim();
        if (!taskId) return json({ success: false, error: 'missing_task_id' }, 400);
        query = query.eq('task_id', taskId);
      }
      const { data, error } = await query;
      if (error) throw error;
      const checked = (await Promise.all((data || []).map(async (conv) => (
        await relationshipValid(conv) ? conv as Record<string, unknown> : null
      )))).filter(Boolean) as Array<Record<string, unknown>>;

      // Hydrate empty denormalized title/names (service role — avoids client RLS miss).
      const taskIds = [...new Set(checked.map((c) => String(c.task_id || '')).filter(Boolean))];
      const uids = [...new Set(checked.flatMap((c) => [String(c.poster_id || ''), String(c.worker_id || '')]).filter(Boolean))];
      const [{ data: taskRows }, { data: userRows }] = await Promise.all([
        taskIds.length
          ? supabase.from('tasks').select('task_id,title,category,poster_name').in('task_id', taskIds)
          : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
        uids.length
          ? supabase.from('users').select('firebase_uid,name').in('firebase_uid', uids)
          : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      ]);
      const taskMap = new Map((taskRows || []).map((t) => [String(t.task_id), t]));
      const nameMap = new Map((userRows || []).map((u) => [String(u.firebase_uid), String(u.name || '').trim()]));
      const generic = (n: string) => {
        const s = n.trim().toLowerCase();
        return !s || ['quickgigs user', 'a quickgigs member', 'quickgigs member', 'worker', 'poster', 'user', 'tasker'].includes(s);
      };
      const hydrated = checked.map((c) => {
        const out = { ...c };
        const task = taskMap.get(String(c.task_id || ''));
        const title = String(out.task_title || '').trim();
        if ((!title || generic(title)) && task && task.title) out.task_title = task.title;
        if (!out.task_category && task && task.category) out.task_category = task.category;
        const pn = String(out.poster_name || '').trim();
        const wn = String(out.worker_name || '').trim();
        const posterLookup = nameMap.get(String(c.poster_id || '')) || '';
        const workerLookup = nameMap.get(String(c.worker_id || '')) || '';
        if ((!pn || generic(pn)) && posterLookup && !generic(posterLookup)) out.poster_name = posterLookup;
        else if ((!pn || generic(pn)) && task && task.poster_name && !generic(String(task.poster_name))) {
          out.poster_name = task.poster_name;
        }
        if ((!wn || generic(wn)) && workerLookup && !generic(workerLookup)) out.worker_name = workerLookup;
        return out;
      });

      return json({ success: true, data: hydrated });
    }

    if (action === 'get') {
      const conv = await getConversation(String(body.conv_id || ''));
      if (!conv) return json({ success: false, error: 'conversation_not_found' }, 404);
      return json({ success: true, data: conv });
    }

    if (action === 'messages') {
      const conv = await getConversation(String(body.conv_id || ''));
      if (!conv) return json({ success: false, error: 'conversation_not_found' }, 404);
      const { data, error } = await supabase
        .from('messages')
        .select('message_id,conv_id,sender_id,body,created_at')
        .eq('conv_id', conv.conv_id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return json({ success: true, data: data || [] });
    }

    if (action === 'send') {
      const conv = await getConversation(String(body.conv_id || ''));
      if (!conv) return json({ success: false, error: 'conversation_not_found' }, 404);
      if (conv.is_unlocked !== true) return json({ success: false, error: 'conversation_locked' }, 403);
      const text = String(body.body || '').trim();
      if (!text || text.length > 2000) return json({ success: false, error: 'invalid_message' }, 400);
      const { data, error } = await supabase
        .from('messages')
        .insert({ conv_id: conv.conv_id, sender_id: uid, body: text })
        .select('message_id,conv_id,sender_id,body,created_at')
        .single();
      if (error) throw error;
      const preview = text.startsWith('[img]') ? '📷 Photo' : text.slice(0, 240);
      await supabase.from('conversations').update({
        last_message: preview,
        last_message_at: data.created_at,
        last_sender_id: uid,
      }).eq('conv_id', conv.conv_id);
      return json({ success: true, data });
    }

    if (action === 'mark_read') {
      const conv = await getConversation(String(body.conv_id || ''));
      if (!conv) return json({ success: false, error: 'conversation_not_found' }, 404);
      const field = String(conv.poster_id) === uid ? 'poster_last_read_at' : 'worker_last_read_at';
      const now = new Date().toISOString();
      const { error } = await supabase.from('conversations').update({ [field]: now }).eq('conv_id', conv.conv_id);
      if (error) throw error;
      return json({ success: true, data: { [field]: now } });
    }

    if (action === 'update') {
      const conv = await getConversation(String(body.conv_id || ''));
      if (!conv) return json({ success: false, error: 'conversation_not_found' }, 404);
      const patch = cleanPatch((body.patch || {}) as Record<string, unknown>);
      if (!Object.keys(patch).length) return json({ success: true, data: conv });
      const { data, error } = await supabase
        .from('conversations')
        .update(patch)
        .eq('conv_id', conv.conv_id)
        .select('*')
        .single();
      if (error) throw error;
      return json({ success: true, data });
    }

    if (action === 'create') {
      const input = (body.conversation || {}) as Record<string, unknown>;
      const taskId = String(input.task_id || '').trim();
      const posterId = String(input.poster_id || '').trim();
      const workerId = String(input.worker_id || '').trim();
      if (!taskId || !posterId || !workerId || (uid !== posterId && uid !== workerId)) {
        return json({ success: false, error: 'invalid_conversation_participants' }, 403);
      }
      const candidate = { task_id: taskId, poster_id: posterId, worker_id: workerId };
      if (!await relationshipValid(candidate)) {
        return json({ success: false, error: 'accepted_task_relationship_required' }, 403);
      }
      const { data: existing } = await supabase
        .from('conversations')
        .select('*')
        .eq('task_id', taskId)
        .eq('poster_id', posterId)
        .eq('worker_id', workerId)
        .maybeSingle();
      if (existing) return json({ success: true, data: existing, existing: true });
      const row = {
        task_id: taskId,
        poster_id: posterId,
        worker_id: workerId,
        poster_name: String(input.poster_name || '').slice(0, 160),
        worker_name: String(input.worker_name || '').slice(0, 160),
        task_title: String(input.task_title || '').slice(0, 160),
        task_category: String(input.task_category || '').slice(0, 80),
        status: ['in_progress', 'completed'].includes(String(input.status || '')) ? input.status : 'in_progress',
        // Always start locked — unlock only via verified payment (webhook / confirm-checkout)
        is_unlocked: false,
      };
      const { data, error } = await supabase.from('conversations').insert(row).select('*').single();
      if (error) throw error;
      return json({ success: true, data });
    }

    return json({ success: false, error: 'invalid_action' }, 400);
  } catch (err) {
    console.error('secure-messaging error:', err);
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
