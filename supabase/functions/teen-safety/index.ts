// QuickGigs — teen live job safety (check-ins, location share, guardian alerts)
// Deploy: supabase functions deploy teen-safety --no-verify-jwt
// Auth: Firebase JWT for teen actions; guardian_queue JWT for guardian actions.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authErrorStatus, requireFirebaseUser } from '../_shared/firebase-auth.ts';
import { verifyGuardianToken } from '../_shared/guardian-token.ts';

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

function cfgMinutes(key: string, fallback: number) {
  // Edge cannot read client QG_CONFIG; use env overrides or defaults matching client.
  const raw = Deno.env.get(key);
  const n = raw != null ? Number(raw) : NaN;
  return isFinite(n) && n > 0 ? n : fallback;
}

function checkInIntervalMs() {
  return cfgMinutes('TEEN_CHECKIN_INTERVAL_MINUTES', 20) * 60 * 1000;
}
function checkInResponseMs() {
  return cfgMinutes('TEEN_CHECKIN_RESPONSE_MINUTES', 5) * 60 * 1000;
}

function mapsLink(lat: number | null, lng: number | null) {
  if (lat == null || lng == null || !isFinite(lat) || !isFinite(lng)) return '';
  return `https://maps.google.com/?q=${encodeURIComponent(`${lat},${lng}`)}`;
}

async function queueGuardianEmail(
  supabase: ReturnType<typeof createClient>,
  opts: {
    teenUid: string;
    guardianEmail: string;
    type: string;
    subject: string;
    body: string;
    payload?: Record<string, unknown>;
  },
) {
  const email = String(opts.guardianEmail || '').trim().toLowerCase();
  if (!email) return;
  const payload = opts.payload || {};
  const { data: queued } = await supabase.from('notification_queue').insert({
    user_id: `guardian:${opts.teenUid}`,
    email,
    type: opts.type,
    subject: opts.subject,
    body_text: opts.body,
    payload,
  }).select('notification_id').maybeSingle();

  // In-app if guardian also has a QuickGigs account (matched by email).
  const { data: guardianUser } = await supabase
    .from('users')
    .select('firebase_uid')
    .ilike('email', email)
    .maybeSingle();
  if (guardianUser?.firebase_uid) {
    await supabase.from('user_notifications').insert({
      user_id: guardianUser.firebase_uid,
      type: opts.type,
      title: opts.subject,
      body: opts.body.slice(0, 280),
      link: String(payload.link || 'guardian-portal.html'),
      payload: { ...payload, teen_uid: opts.teenUid },
    });
  }

  // Flush email via Resend (same pattern as graduate-account) so alerts are not cron-only.
  const resendKey = Deno.env.get('RESEND_API_KEY') || '';
  if (resendKey && queued?.notification_id) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          from: Deno.env.get('FROM_EMAIL') || 'QuickGigs <notifications@quickgigs.ca>',
          to: [email],
          subject: opts.subject,
          text: opts.body + '\n\n— QuickGigs\nhttps://quickgigs.ca',
        }),
      });
      await supabase
        .from('notification_queue')
        .update(response.ok
          ? { sent_at: new Date().toISOString(), error_message: null }
          : { error_message: (await response.text()).slice(0, 500) })
        .eq('notification_id', queued.notification_id);
    } catch (err) {
      console.warn('guardian email flush failed', err);
    }
  }
}

async function loadTeen(supabase: ReturnType<typeof createClient>, uid: string) {
  const { data } = await supabase
    .from('users')
    .select('firebase_uid,name,email,phone,guardian_email,guardian_name,date_of_birth,account_status,guardian_consent_status')
    .eq('firebase_uid', uid)
    .maybeSingle();
  return data as Record<string, unknown> | null;
}

function isTeenUser(user: Record<string, unknown> | null) {
  if (!user) return false;
  const dob = String(user.date_of_birth || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return false;
  const birth = new Date(`${dob}T12:00:00Z`).getTime();
  if (!isFinite(birth)) return false;
  const ageMs = Date.now() - birth;
  const years = ageMs / (365.25 * 24 * 3600 * 1000);
  return years >= 16 && years < 18;
}

async function loadAcceptedWorker(supabase: ReturnType<typeof createClient>, taskId: string) {
  const { data } = await supabase
    .from('applications')
    .select('worker_id,status,guardian_status')
    .eq('task_id', taskId)
    .in('status', ['accepted', 'completed', 'in_progress'])
    .limit(10);
  const row = (data || []).find((a) => {
    const st = String(a.status || '').toLowerCase();
    return st === 'accepted' || st === 'in_progress' || st === 'completed';
  });
  return row ? String(row.worker_id || '') : '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || '').toLowerCase();
    const guardianToken = String(body.token || '').trim();
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    );

    // ── Guardian (token) actions ─────────────────────────────────────
    if (guardianToken && ['list_active', 'end_job', 'poll_overdue'].includes(action)) {
      let claims: { uid: string; guardianEmail?: string };
      try {
        claims = await verifyGuardianToken(guardianToken, 'guardian_queue');
      } catch {
        return json({ ok: false, error: 'invalid_guardian_token' }, 403);
      }
      if (!claims.guardianEmail || !claims.uid) {
        return json({ ok: false, error: 'invalid_guardian_token' }, 403);
      }
      const teen = await loadTeen(supabase, claims.uid);
      if (
        !teen ||
        String(teen.guardian_email || '').trim().toLowerCase() !== claims.guardianEmail.toLowerCase()
      ) {
        return json({ ok: false, error: 'guardian_access_revoked' }, 403);
      }

      if (action === 'poll_overdue') {
        const now = Date.now();
        const { data: sessions } = await supabase
          .from('teen_job_sessions')
          .select('*')
          .eq('teen_uid', claims.uid)
          .eq('status', 'active');
        let alerted = 0;
        for (const raw of sessions || []) {
          const s = raw as Record<string, unknown>;
          const due = s.next_check_in_due_at ? new Date(String(s.next_check_in_due_at)).getTime() : 0;
          const state = String(s.check_in_state || '');
          if (!due || state === 'need_help' || state === 'safety_alert') continue;
          if (now < due + checkInResponseMs()) {
            if (now >= due && state !== 'awaiting' && state !== 'overdue') {
              await supabase.from('teen_job_sessions').update({
                check_in_state: 'awaiting',
                updated_at: new Date().toISOString(),
              }).eq('session_id', s.session_id);
            }
            continue;
          }
          // Missed response window
          if (state === 'overdue' && s.last_alert_type === 'missed_check_in') continue;
          const loc = mapsLink(
            s.last_lat != null ? Number(s.last_lat) : null,
            s.last_lng != null ? Number(s.last_lng) : null,
          );
          await supabase.from('teen_job_sessions').update({
            check_in_state: 'overdue',
            alert_count: Number(s.alert_count || 0) + 1,
            last_alert_at: new Date().toISOString(),
            last_alert_type: 'missed_check_in',
            updated_at: new Date().toISOString(),
          }).eq('session_id', s.session_id);
          await queueGuardianEmail(supabase, {
            teenUid: claims.uid,
            guardianEmail: claims.guardianEmail,
            type: 'guardian_teen_missed_checkin',
            subject: `Missed check-in — ${teen.name || 'your teen'}`,
            body:
              `${teen.name || 'Your teen'} missed a safety check-in on an active QuickGigs job.\n\n` +
              (loc ? `Last shared location:\n${loc}\n\n` : '') +
              `Open the guardian portal to review or end the job.\n\n` +
              `QuickGigs is not an emergency responder. Call local emergency services if someone is in immediate danger.`,
            payload: { task_id: s.task_id, session_id: s.session_id, link: loc },
          });
          alerted += 1;
        }
        return json({ ok: true, alerted });
      }

      if (action === 'end_job') {
        const taskId = String(body.task_id || '').trim();
        if (!taskId) return json({ ok: false, error: 'missing_task_id' }, 400);
        const { data: session } = await supabase
          .from('teen_job_sessions')
          .update({
            status: 'ended_by_guardian',
            ended_at: new Date().toISOString(),
            end_reason: String(body.reason || 'guardian_ended'),
            location_share_active: false,
            last_lat: null,
            last_lng: null,
            updated_at: new Date().toISOString(),
          })
          .eq('task_id', taskId)
          .eq('teen_uid', claims.uid)
          .eq('status', 'active')
          .select('session_id,task_id')
          .maybeSingle();
        if (!session) return json({ ok: false, error: 'session_not_found' }, 404);

        // Soft-cancel in-progress task for safety pull-out
        await supabase
          .from('tasks')
          .update({ status: 'cancelled' })
          .eq('task_id', taskId)
          .eq('status', 'in_progress');

        await supabase.from('user_notifications').insert({
          user_id: claims.uid,
          type: 'guardian_ended_job',
          title: 'Guardian ended your active job',
          body: 'Your guardian ended this job for safety. Leave the meetup if you are still there and contact them.',
          link: 'mytasks.html?tab=inprogress',
          payload: { task_id: taskId },
        });
        return json({ ok: true, session });
      }

      // list_active
      const { data: sessions } = await supabase
        .from('teen_job_sessions')
        .select('*')
        .eq('teen_uid', claims.uid)
        .eq('status', 'active')
        .order('started_at', { ascending: false });
      const taskIds = [...new Set((sessions || []).map((s) => String(s.task_id || '')).filter(Boolean))];
      const { data: tasks } = taskIds.length
        ? await supabase
          .from('tasks')
          .select('task_id,title,category,budget,location,poster_name,posted_by,status,age_preference')
          .in('task_id', taskIds)
        : { data: [] as Array<Record<string, unknown>> };
      const posterIds = [...new Set((tasks || []).map((t) => String(t.posted_by || '')).filter(Boolean))];
      const { data: posters } = posterIds.length
        ? await supabase.from('users').select('firebase_uid,poster_verified,name').in('firebase_uid', posterIds)
        : { data: [] as Array<Record<string, unknown>> };
      const { data: reviews } = posterIds.length
        ? await supabase.from('reviews').select('reviewee_id,rating').in('reviewee_id', posterIds)
        : { data: [] as Array<Record<string, unknown>> };
      const taskMap = new Map((tasks || []).map((t) => [String(t.task_id), t]));
      const posterMap = new Map((posters || []).map((p) => [String(p.firebase_uid), p]));
      const ratingMap = new Map<string, { sum: number; n: number }>();
      (reviews || []).forEach((r) => {
        const id = String(r.reviewee_id || '');
        if (!id) return;
        const cur = ratingMap.get(id) || { sum: 0, n: 0 };
        cur.sum += Number(r.rating) || 0;
        cur.n += 1;
        ratingMap.set(id, cur);
      });

      const items = (sessions || []).map((s) => {
        const task = taskMap.get(String(s.task_id)) || {};
        const posterId = String(task.posted_by || '');
        const poster = posterMap.get(posterId) || {};
        const rat = ratingMap.get(posterId);
        const lat = s.last_lat != null ? Number(s.last_lat) : null;
        const lng = s.last_lng != null ? Number(s.last_lng) : null;
        return {
          session: s,
          task,
          poster: {
            name: poster.name || task.poster_name || 'Poster',
            verified: !!(poster.poster_verified === true || poster.poster_verified === 'true'),
            avgRating: rat && rat.n ? Math.round((rat.sum / rat.n) * 10) / 10 : null,
            reviewCount: rat ? rat.n : 0,
          },
          locationLink: s.location_share_active ? mapsLink(lat, lng) : '',
          teen: { name: teen.name, email: teen.email, phone: teen.phone },
        };
      });

      return json({
        ok: true,
        teen: { name: teen.name, email: teen.email, phone: teen.phone },
        items,
      });
    }

    // ── Teen (Firebase) actions ──────────────────────────────────────
    let identity;
    try {
      identity = await requireFirebaseUser(req);
    } catch (err) {
      return json({ ok: false, error: err instanceof Error ? err.message : 'unauthorized' }, authErrorStatus(err));
    }
    const uid = identity.uid;
    const teen = await loadTeen(supabase, uid);
    if (!isTeenUser(teen)) return json({ ok: false, error: 'not_teen' }, 403);
    const guardianEmail = String(teen?.guardian_email || '').trim().toLowerCase();
    if (!guardianEmail) return json({ ok: false, error: 'guardian_email_missing' }, 400);

    const taskId = String(body.task_id || '').trim();
    if (!taskId && action !== 'list_mine') return json({ ok: false, error: 'missing_task_id' }, 400);

    if (action === 'list_mine') {
      const { data } = await supabase
        .from('teen_job_sessions')
        .select('*')
        .eq('teen_uid', uid)
        .eq('status', 'active');
      return json({ ok: true, sessions: data || [] });
    }

    const workerId = await loadAcceptedWorker(supabase, taskId);
    if (workerId !== uid) return json({ ok: false, error: 'not_task_worker' }, 403);

    const { data: task } = await supabase
      .from('tasks')
      .select('task_id,title,category,budget,location,poster_name,posted_by,status,age_preference')
      .eq('task_id', taskId)
      .maybeSingle();
    if (!task) return json({ ok: false, error: 'task_not_found' }, 404);

    if (action === 'start_session') {
      const due = new Date(Date.now() + checkInIntervalMs()).toISOString();
      let homeDistance =
        body.home_distance_km != null && isFinite(Number(body.home_distance_km))
          ? Number(body.home_distance_km)
          : null;
      if (homeDistance == null) {
        const { data: appRow } = await supabase
          .from('applications')
          .select('guardian_distance_km')
          .eq('task_id', taskId)
          .eq('worker_id', uid)
          .maybeSingle();
        if (appRow?.guardian_distance_km != null) {
          homeDistance = Number(appRow.guardian_distance_km);
        }
      }
      const row = {
        task_id: taskId,
        teen_uid: uid,
        guardian_email: guardianEmail,
        status: 'active',
        check_in_state: 'ok',
        last_check_in_at: new Date().toISOString(),
        next_check_in_due_at: due,
        location_share_active: true,
        home_distance_km: homeDistance,
        updated_at: new Date().toISOString(),
      };
      const { data: existing } = await supabase
        .from('teen_job_sessions')
        .select('session_id')
        .eq('task_id', taskId)
        .eq('teen_uid', uid)
        .eq('status', 'active')
        .maybeSingle();
      let session;
      if (existing) {
        const { data } = await supabase
          .from('teen_job_sessions')
          .update(row)
          .eq('session_id', existing.session_id)
          .select('*')
          .maybeSingle();
        session = data;
      } else {
        const { data, error } = await supabase.from('teen_job_sessions').insert(row).select('*').maybeSingle();
        if (error) throw error;
        session = data;
        const { data: poster } = await supabase
          .from('users')
          .select('poster_verified,name')
          .eq('firebase_uid', String(task.posted_by || ''))
          .maybeSingle();
        await queueGuardianEmail(supabase, {
          teenUid: uid,
          guardianEmail,
          type: 'guardian_teen_job_start',
          subject: `Job started — ${teen?.name || 'your teen'}`,
          body:
            `${teen?.name || 'Your teen'} started an in-person QuickGigs job.\n\n` +
            `Task: ${task.title || 'Gig'}\n` +
            `Poster: ${poster?.name || task.poster_name || 'Poster'}` +
            `${poster?.poster_verified ? ' (verified)' : ''}\n` +
            (row.home_distance_km != null ? `Distance from home (approx): ${row.home_distance_km} km\n` : '') +
            `Time: ${new Date().toLocaleString()}\n\n` +
            `Open your guardian portal link to monitor check-ins and location during this job only.\n\n` +
            `QuickGigs is not an emergency responder.`,
          payload: { task_id: taskId, session_id: session?.session_id },
        });
      }
      return json({ ok: true, session });
    }

    const { data: session } = await supabase
      .from('teen_job_sessions')
      .select('*')
      .eq('task_id', taskId)
      .eq('teen_uid', uid)
      .eq('status', 'active')
      .maybeSingle();
    if (!session && action !== 'start_session') {
      return json({ ok: false, error: 'session_not_found' }, 404);
    }

    if (action === 'check_in') {
      const ok = body.ok !== false && body.need_help !== true;
      if (!ok) {
        const lat = body.lat != null ? Number(body.lat) : session.last_lat;
        const lng = body.lng != null ? Number(body.lng) : session.last_lng;
        await supabase.from('teen_job_sessions').update({
          check_in_state: 'need_help',
          last_check_in_at: new Date().toISOString(),
          last_lat: lat,
          last_lng: lng,
          last_location_at: lat != null ? new Date().toISOString() : session.last_location_at,
          alert_count: Number(session.alert_count || 0) + 1,
          last_alert_at: new Date().toISOString(),
          last_alert_type: 'need_help',
          updated_at: new Date().toISOString(),
        }).eq('session_id', session.session_id);
        const loc = mapsLink(lat != null ? Number(lat) : null, lng != null ? Number(lng) : null);
        await queueGuardianEmail(supabase, {
          teenUid: uid,
          guardianEmail,
          type: 'guardian_teen_need_help',
          subject: `Need help — ${teen?.name || 'your teen'}`,
          body:
            `${teen?.name || 'Your teen'} tapped “Need help” on an active QuickGigs job.\n\n` +
            `Task: ${task.title || 'Gig'}\n` +
            (loc ? `Live location:\n${loc}\n\n` : 'Location was not available.\n\n') +
            `Call them and consider ending the job from the guardian portal. If someone is in immediate danger, call local emergency services.\n\n` +
            `QuickGigs is not an emergency responder.`,
          payload: { task_id: taskId, link: loc },
        });
        return json({ ok: true, check_in_state: 'need_help' });
      }
      const due = new Date(Date.now() + checkInIntervalMs()).toISOString();
      const { data: updated } = await supabase.from('teen_job_sessions').update({
        check_in_state: 'ok',
        last_check_in_at: new Date().toISOString(),
        next_check_in_due_at: due,
        updated_at: new Date().toISOString(),
      }).eq('session_id', session.session_id).select('*').maybeSingle();
      return json({ ok: true, session: updated });
    }

    if (action === 'ping_location') {
      const lat = Number(body.lat);
      const lng = Number(body.lng);
      if (!isFinite(lat) || !isFinite(lng)) return json({ ok: false, error: 'invalid_coords' }, 400);
      const { data: updated } = await supabase.from('teen_job_sessions').update({
        last_lat: lat,
        last_lng: lng,
        last_location_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('session_id', session.session_id).select('*').maybeSingle();
      return json({ ok: true, session: updated, locationLink: mapsLink(lat, lng) });
    }

    if (action === 'safety_alert') {
      const lat = body.lat != null ? Number(body.lat) : session.last_lat;
      const lng = body.lng != null ? Number(body.lng) : session.last_lng;
      await supabase.from('teen_job_sessions').update({
        check_in_state: 'safety_alert',
        last_lat: lat,
        last_lng: lng,
        last_location_at: lat != null ? new Date().toISOString() : session.last_location_at,
        alert_count: Number(session.alert_count || 0) + 1,
        last_alert_at: new Date().toISOString(),
        last_alert_type: 'safety_alert',
        updated_at: new Date().toISOString(),
      }).eq('session_id', session.session_id);
      const loc = mapsLink(lat != null ? Number(lat) : null, lng != null ? Number(lng) : null);
      await queueGuardianEmail(supabase, {
        teenUid: uid,
        guardianEmail,
        type: 'guardian_teen_safety_alert',
        subject: `Safety alert — ${teen?.name || 'your teen'}`,
        body:
          `${teen?.name || 'Your teen'} triggered a Safety alert on an active QuickGigs job (may also be calling emergency services).\n\n` +
          `Task: ${task.title || 'Gig'}\n` +
          (loc ? `Live location:\n${loc}\n\n` : 'Location was not available.\n\n') +
          `Contact them immediately. If needed, call local emergency services.\n\n` +
          `QuickGigs is not an emergency responder and does not dispatch help.`,
        payload: { task_id: taskId, link: loc },
      });
      return json({ ok: true, check_in_state: 'safety_alert', locationLink: loc });
    }

    if (action === 'sync_stamp') {
      const stamp = String(body.stamp || '').trim();
      if (!stamp) return json({ ok: false, error: 'missing_stamp' }, 400);
      const { data: updated } = await supabase.from('teen_job_sessions').update({
        last_stamp: stamp,
        last_stamp_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('session_id', session.session_id).select('*').maybeSingle();
      await queueGuardianEmail(supabase, {
        teenUid: uid,
        guardianEmail,
        type: 'guardian_teen_stamp',
        subject: `Update — ${teen?.name || 'your teen'} · ${stamp.replace(/_/g, ' ')}`,
        body:
          `${teen?.name || 'Your teen'} marked “${stamp.replace(/_/g, ' ')}” on “${task.title || 'a gig'}”.\n\n` +
          `Open the guardian portal for live status.`,
        payload: { task_id: taskId, stamp },
      });
      return json({ ok: true, session: updated });
    }

    if (action === 'end_session') {
      const reason = String(body.reason || 'ended_complete');
      const { data: updated } = await supabase.from('teen_job_sessions').update({
        status: reason === 'cancelled' ? 'ended_cancelled' : 'ended_complete',
        ended_at: new Date().toISOString(),
        end_reason: reason,
        location_share_active: false,
        last_lat: null,
        last_lng: null,
        updated_at: new Date().toISOString(),
      }).eq('session_id', session.session_id).select('*').maybeSingle();
      return json({ ok: true, session: updated });
    }

    if (action === 'awaiting_check_in') {
      const { data: updated } = await supabase.from('teen_job_sessions').update({
        check_in_state: 'awaiting',
        updated_at: new Date().toISOString(),
      }).eq('session_id', session.session_id).select('*').maybeSingle();
      return json({ ok: true, session: updated });
    }

    if (action === 'report_missed') {
      if (String(session.check_in_state) === 'overdue' && session.last_alert_type === 'missed_check_in') {
        return json({ ok: true, already: true });
      }
      const lat = body.lat != null ? Number(body.lat) : session.last_lat;
      const lng = body.lng != null ? Number(body.lng) : session.last_lng;
      await supabase.from('teen_job_sessions').update({
        check_in_state: 'overdue',
        last_lat: lat,
        last_lng: lng,
        last_location_at: lat != null ? new Date().toISOString() : session.last_location_at,
        alert_count: Number(session.alert_count || 0) + 1,
        last_alert_at: new Date().toISOString(),
        last_alert_type: 'missed_check_in',
        updated_at: new Date().toISOString(),
      }).eq('session_id', session.session_id);
      const loc = mapsLink(lat != null ? Number(lat) : null, lng != null ? Number(lng) : null);
      await queueGuardianEmail(supabase, {
        teenUid: uid,
        guardianEmail,
        type: 'guardian_teen_missed_checkin',
        subject: `Missed check-in — ${teen?.name || 'your teen'}`,
        body:
          `${teen?.name || 'Your teen'} missed a safety check-in on an active QuickGigs job.\n\n` +
          `Task: ${task.title || 'Gig'}\n` +
          (loc ? `Last shared location:\n${loc}\n\n` : '') +
          `Open the guardian portal to review or end the job.\n\n` +
          `QuickGigs is not an emergency responder. Call local emergency services if someone is in immediate danger.`,
        payload: { task_id: taskId, link: loc },
      });
      return json({ ok: true, check_in_state: 'overdue' });
    }

    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (err) {
    console.error('teen-safety error', err);
    return json({ ok: false, error: err instanceof Error ? err.message : 'server_error' }, 500);
  }
});
