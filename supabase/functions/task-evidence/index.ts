// QuickGigs — task evidence stamps + photos
// Deploy: supabase functions deploy task-evidence --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { haversineKm } from '../_shared/geo.ts';
import { authErrorStatus, requireFirebaseUser } from '../_shared/firebase-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STAMP_TYPES = new Set(['on_my_way', 'arrived', 'started', 'completed']);
const PHOTO_KINDS = new Set(['before', 'after', 'progress']);

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

async function loadTask(supabase: ReturnType<typeof createClient>, taskId: string) {
  const { data } = await supabase.from('tasks').select('*').eq('task_id', taskId).limit(1);
  return (data && data[0] ? data[0] : null) as Record<string, unknown> | null;
}

async function loadAcceptedWorker(supabase: ReturnType<typeof createClient>, taskId: string) {
  const { data } = await supabase
    .from('applications')
    .select('worker_id,status')
    .eq('task_id', taskId)
    .in('status', ['accepted', 'completed'])
    .limit(5);
  const row = (data || []).find((a) =>
    ['accepted', 'completed'].includes(String(getField(a as Record<string, unknown>, 'status') || '').toLowerCase())
  );
  return row ? String(getField(row as Record<string, unknown>, 'worker_id') || '') : '';
}

async function isParty(
  supabase: ReturnType<typeof createClient>,
  task: Record<string, unknown>,
  uid: string,
) {
  const posterId = String(getField(task, 'posted_by') || '');
  if (uid === posterId) return { ok: true, role: 'poster' as const, posterId, workerId: await loadAcceptedWorker(supabase, String(getField(task, 'task_id') || '')) };
  const workerId = await loadAcceptedWorker(supabase, String(getField(task, 'task_id') || ''));
  if (uid === workerId) return { ok: true, role: 'worker' as const, posterId, workerId };
  const { data: admin } = await supabase.from('admins').select('user_id').eq('user_id', uid).maybeSingle();
  if (admin) return { ok: true, role: 'admin' as const, posterId, workerId };
  return { ok: false, role: null as null, posterId, workerId };
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
    const action = String(body.action || 'get').toLowerCase();
    const taskId = String(body.task_id || '').trim();
    if (!taskId) return json({ ok: false, error: 'missing_task_id' }, 400);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const task = await loadTask(supabase, taskId);
    if (!task) return json({ ok: false, error: 'task_not_found' }, 404);

    const party = await isParty(supabase, task, identity.uid);
    if (!party.ok) return json({ ok: false, error: 'not_authorized' }, 403);

    if (action === 'get' || action === 'get_evidence') {
      const [{ data: stamps }, { data: photos }, { data: disputes }, { data: payments }, { data: reviews }] =
        await Promise.all([
          supabase.from('task_status_stamps').select('*').eq('task_id', taskId).order('stamped_at'),
          supabase.from('task_evidence_photos').select('*').eq('task_id', taskId).order('created_at'),
          supabase.from('disputes').select('*').eq('task_id', taskId).order('created_at', { ascending: false }),
          supabase.from('payments').select('*').eq('task_id', taskId).order('created_at', { ascending: false }).limit(5),
          supabase.from('reviews').select('*').eq('task_id', taskId).order('created_at', { ascending: false }),
        ]);

      let messages: unknown[] = [];
      if (party.posterId && party.workerId) {
        const { data: convs } = await supabase
          .from('conversations')
          .select('conv_id')
          .eq('poster_id', party.posterId)
          .eq('worker_id', party.workerId)
          .limit(5);
        const convIds = (convs || []).map((c) => c.conv_id).filter(Boolean);
        if (convIds.length) {
          const { data: msgs } = await supabase
            .from('messages')
            .select('message_id,conv_id,sender_id,body,created_at')
            .in('conv_id', convIds)
            .order('created_at', { ascending: true })
            .limit(200);
          messages = msgs || [];
        }
      }

      return json({
        ok: true,
        task_id: taskId,
        task: {
          title: getField(task, 'title'),
          status: getField(task, 'status'),
          lat: getField(task, 'lat'),
          lng: getField(task, 'lng'),
          location: getField(task, 'location'),
          precise_address: getField(task, 'precise_address'),
          scheduled_at: getField(task, 'scheduled_at'),
          worker_completed_at: getField(task, 'worker_completed_at'),
          poster_confirmed_at: getField(task, 'poster_confirmed_at'),
          evidence_frozen: getField(task, 'evidence_frozen'),
          photo_urls: getField(task, 'photo_urls'),
          posted_by: party.posterId,
        },
        worker_id: party.workerId,
        stamps: stamps || [],
        evidence_photos: photos || [],
        disputes: disputes || [],
        payments: payments || [],
        reviews: reviews || [],
        messages,
      });
    }

    if (action === 'stamp') {
      if (party.role !== 'worker') return json({ ok: false, error: 'worker_only' }, 403);
      if (getField(task, 'evidence_frozen') === true) {
        return json({ ok: false, error: 'task_frozen_by_dispute' }, 409);
      }
      const stampType = String(body.stamp_type || '').toLowerCase();
      if (!STAMP_TYPES.has(stampType)) return json({ ok: false, error: 'invalid_stamp_type' }, 400);

      const taskStatus = String(getField(task, 'status') || '').toLowerCase();
      if (taskStatus !== 'in_progress' && stampType !== 'completed') {
        return json({ ok: false, error: 'task_not_in_progress' }, 400);
      }

      let lat: number | null = null;
      let lng: number | null = null;
      let distanceM: number | null = null;
      let locationStatus = 'none';

      if (stampType === 'arrived') {
        const rawLat = Number(body.lat);
        const rawLng = Number(body.lng);
        const locDenied = body.location_denied === true || body.location_status === 'denied';
        const locUnavailable = body.location_unavailable === true || body.location_status === 'unavailable';
        if (locDenied) {
          locationStatus = 'denied';
        } else if (locUnavailable || !Number.isFinite(rawLat) || !Number.isFinite(rawLng)) {
          locationStatus = 'unavailable';
        } else {
          lat = rawLat;
          lng = rawLng;
          locationStatus = 'ok';
          const taskLat = Number(getField(task, 'lat'));
          const taskLng = Number(getField(task, 'lng'));
          if (Number.isFinite(taskLat) && Number.isFinite(taskLng)) {
            distanceM = Math.round(haversineKm(lat, lng, taskLat, taskLng) * 1000);
          }
        }
      }

      const now = new Date().toISOString();
      const row = {
        task_id: taskId,
        worker_id: identity.uid,
        stamp_type: stampType,
        stamped_at: now,
        lat,
        lng,
        distance_m: distanceM,
        location_status: locationStatus,
      };

      const { data: upserted, error: upErr } = await supabase
        .from('task_status_stamps')
        .upsert(row, { onConflict: 'task_id,worker_id,stamp_type' })
        .select('*')
        .single();
      if (upErr) throw upErr;

      const taskPatch: Record<string, unknown> = {};
      if (stampType === 'completed') {
        taskPatch.worker_completed_at = now;
      }
      if (Object.keys(taskPatch).length) {
        await supabase.from('tasks').update(taskPatch).eq('task_id', taskId);
      }

      return json({
        ok: true,
        stamp: upserted,
        stamped_at: now,
        distance_m: distanceM,
        location_status: locationStatus,
      });
    }

    if (action === 'add_photo') {
      if (party.role !== 'worker' && party.role !== 'poster') {
        return json({ ok: false, error: 'not_authorized' }, 403);
      }
      const url = String(body.url || '').trim();
      const kind = String(body.kind || 'progress').toLowerCase();
      if (!url || !/^https?:\/\//i.test(url)) return json({ ok: false, error: 'invalid_url' }, 400);
      if (!PHOTO_KINDS.has(kind)) return json({ ok: false, error: 'invalid_kind' }, 400);

      const { data: photo, error: photoErr } = await supabase
        .from('task_evidence_photos')
        .insert({
          task_id: taskId,
          uploaded_by: identity.uid,
          kind,
          url,
        })
        .select('*')
        .single();
      if (photoErr) throw photoErr;
      return json({ ok: true, photo });
    }

    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (err) {
    console.error('task-evidence error:', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
