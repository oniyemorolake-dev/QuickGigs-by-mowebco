// QuickGigs — anonymized public marketplace activity for the "Happening now" ticker.
// Deploy: supabase functions deploy marketplace-activity --no-verify-jwt
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

function privacyName(fullName: unknown) {
  const raw = String(fullName || '').trim();
  if (!raw) return 'Someone';
  const parts = raw.split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Someone';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

function cityMatch(location: unknown, city: string) {
  if (!city) return true;
  const loc = String(location || '').toLowerCase();
  return loc.includes(city.toLowerCase());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json({ ok: false, error: 'method_not_allowed' }, 405);
  }

  try {
    let city = '';
    let limit = 8;
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      city = String(body.city || '').trim();
      limit = Math.min(12, Math.max(3, Number(body.limit) || 8));
    } else {
      const url = new URL(req.url);
      city = String(url.searchParams.get('city') || '').trim();
      limit = Math.min(12, Math.max(3, Number(url.searchParams.get('limit')) || 8));
    }
    if (/^you$/i.test(city)) city = '';

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    );

    const since = new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(); // 72h

    const { data: posted } = await supabase
      .from('tasks')
      .select('task_id,title,budget,location,poster_name,created_at,status')
      .gte('created_at', since)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(40);

    const { data: accepted } = await supabase
      .from('applications')
      .select('app_id,task_id,worker_name,price,status,created_at,guardian_status')
      .eq('status', 'accepted')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(40);

    const { data: completedTasks } = await supabase
      .from('tasks')
      .select('task_id,title,budget,location,poster_name,status,worker_completed_at,created_at')
      .eq('status', 'completed')
      .gte('worker_completed_at', since)
      .order('worker_completed_at', { ascending: false })
      .limit(40);

    const taskIds = [
      ...new Set([
        ...((accepted || []).map((a) => String(a.task_id || ''))),
        ...((completedTasks || []).map((t) => String(t.task_id || ''))),
      ].filter(Boolean)),
    ];

    const { data: taskRows } = taskIds.length
      ? await supabase
        .from('tasks')
        .select('task_id,location,budget,title')
        .in('task_id', taskIds)
      : { data: [] as Array<Record<string, unknown>> };
    const taskMap = new Map((taskRows || []).map((t) => [String(t.task_id), t]));

    const { data: payments } = taskIds.length
      ? await supabase
        .from('payments')
        .select('task_id,worker_payout,amount,status')
        .in('task_id', taskIds)
      : { data: [] as Array<Record<string, unknown>> };
    const payMap = new Map(
      (payments || []).map((p) => [String(p.task_id), p]),
    );

    type Ev = {
      type: string;
      name: string;
      amount: number | null;
      at: string;
      id: string;
    };
    const events: Ev[] = [];

    (posted || []).forEach((t) => {
      if (city && !cityMatch(t.location, city)) return;
      events.push({
        type: 'posted',
        name: privacyName(t.poster_name),
        amount: Number(t.budget) || null,
        at: String(t.created_at || ''),
        id: `post-${t.task_id}`,
      });
    });

    (accepted || []).forEach((a) => {
      if (String(a.guardian_status || 'approved').toLowerCase() === 'pending_guardian') return;
      if (String(a.guardian_status || '').toLowerCase() === 'rejected') return;
      const task = taskMap.get(String(a.task_id)) || {};
      if (city && !cityMatch(task.location, city)) return;
      events.push({
        type: 'accepted',
        name: privacyName(a.worker_name),
        amount: Number(a.price) || Number(task.budget) || null,
        at: String(a.created_at || ''),
        id: `acc-${a.app_id}`,
      });
    });

    (completedTasks || []).forEach((t) => {
      if (city && !cityMatch(t.location, city)) return;
      const pay = payMap.get(String(t.task_id));
      const payout = pay ? Number(pay.worker_payout || pay.amount) : Number(t.budget);
      events.push({
        type: 'completed',
        name: 'Someone',
        amount: isFinite(payout) && payout > 0 ? payout : null,
        at: String(t.worker_completed_at || t.created_at || ''),
        id: `done-${t.task_id}`,
      });
    });

    events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return json({ ok: true, city: city || null, events: events.slice(0, limit) });
  } catch (err) {
    console.error('marketplace-activity error:', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
