import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
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

function ratingSummary(rows: Array<Record<string, unknown>>, posterId: string) {
  const relevant = rows.filter((row) => String(row.reviewee_id || '') === posterId);
  if (!relevant.length) return { average: null, count: 0 };
  const total = relevant.reduce((sum, row) => sum + Number(row.rating || 0), 0);
  return { average: Math.round(total / relevant.length * 10) / 10, count: relevant.length };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  try {
    const body = await req.json();
    const token = String(body.token || '').trim();
    const action = String(body.action || 'list').toLowerCase();
    const claims = await verifyGuardianToken(token, 'guardian_queue');
    if (!claims.guardianEmail) return json({ ok: false, error: 'invalid_guardian_token' }, 403);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    );
    const { data: teen } = await supabase
      .from('users')
      .select('firebase_uid,name,guardian_email,date_of_birth,guardian_stripe_payouts_enabled,guardian_stripe_connect_id')
      .eq('firebase_uid', claims.uid)
      .maybeSingle();
    if (
      !teen ||
      String(teen.guardian_email || '').trim().toLowerCase() !== claims.guardianEmail.toLowerCase()
    ) return json({ ok: false, error: 'guardian_access_revoked' }, 403);

    if (action === 'approve' || action === 'reject') {
      const applicationId = String(body.application_id || '').trim();
      if (!applicationId) return json({ ok: false, error: 'missing_application_id' }, 400);
      const reviewedAt = new Date().toISOString();
      const nextStatus = action === 'approve' ? 'approved' : 'rejected';
      const { data: application, error } = await supabase
        .from('applications')
        .update({ guardian_status: nextStatus, guardian_reviewed_at: reviewedAt })
        .eq('app_id', applicationId)
        .eq('worker_id', claims.uid)
        .eq('guardian_status', 'pending_guardian')
        .select('app_id,task_id,worker_id,worker_name,message,price')
        .maybeSingle();
      if (error) throw error;
      if (!application) return json({ ok: false, error: 'already_reviewed_or_not_found' }, 409);

      const { data: task } = await supabase
        .from('tasks')
        .select('task_id,title,posted_by')
        .eq('task_id', application.task_id)
        .maybeSingle();
      if (action === 'approve' && task?.posted_by) {
        await supabase.from('user_notifications').insert({
          user_id: task.posted_by,
          type: 'application_received',
          title: 'New application received',
          body: `${application.worker_name || 'A tasker'} applied for “${task.title || 'your task'}”.`,
          link: `mytasks.html?tab=posted&expand=${encodeURIComponent(String(task.task_id || ''))}`,
          payload: { task_id: task.task_id, app_id: application.app_id },
        });
      }
      await supabase.from('user_notifications').insert({
        user_id: claims.uid,
        type: action === 'approve' ? 'guardian_application_approved' : 'guardian_application_rejected',
        title: action === 'approve' ? 'Guardian approved your application' : 'Guardian did not approve this gig',
        body: action === 'approve'
          ? `Your application for “${task?.title || 'the gig'}” was sent to the poster.`
          : `Your guardian didn't approve “${task?.title || 'this gig'}”.`,
        link: 'mytasks.html?tab=applied',
        payload: { task_id: application.task_id, app_id: application.app_id },
      });
      return json({ ok: true, status: nextStatus });
    }

    if (action !== 'list') return json({ ok: false, error: 'invalid_action' }, 400);
    const { data: applications, error: appsError } = await supabase
      .from('applications')
      .select('app_id,task_id,worker_id,worker_name,message,price,guardian_status,guardian_distance_km,created_at')
      .eq('worker_id', claims.uid)
      .eq('guardian_status', 'pending_guardian')
      .order('created_at', { ascending: false });
    if (appsError) throw appsError;

    const taskIds = [...new Set((applications || []).map((app) => String(app.task_id || '')).filter(Boolean))];
    const { data: tasks } = taskIds.length
      ? await supabase
        .from('tasks')
        .select('task_id,title,description,category,budget,location,poster_name,posted_by,age_preference,scheduled_at,scheduled_label')
        .in('task_id', taskIds)
      : { data: [] as Array<Record<string, unknown>> };
    const posterIds = [...new Set((tasks || []).map((task) => String(task.posted_by || '')).filter(Boolean))];
    const { data: reviews } = posterIds.length
      ? await supabase.from('reviews').select('reviewee_id,rating').in('reviewee_id', posterIds)
      : { data: [] as Array<Record<string, unknown>> };
    const { data: posters } = posterIds.length
      ? await supabase.from('users').select('firebase_uid,poster_verified').in('firebase_uid', posterIds)
      : { data: [] as Array<Record<string, unknown>> };
    const taskMap = new Map((tasks || []).map((task) => [String(task.task_id), task]));
    const posterMap = new Map((posters || []).map((row) => [String(row.firebase_uid), row]));

    const items = (applications || []).map((app) => {
      const task = taskMap.get(String(app.task_id)) || {};
      const posterId = String(task.posted_by || '');
      const poster = posterMap.get(posterId) || {};
      return {
        application_id: app.app_id,
        teen_name: teen.name,
        application_message: app.message,
        offer_price: app.price,
        distance_km: app.guardian_distance_km,
        created_at: app.created_at,
        task: {
          title: task.title,
          description: task.description,
          category: task.category,
          budget: task.budget,
          location: task.location,
          poster_name: task.poster_name,
          poster_rating: ratingSummary((reviews || []) as Array<Record<string, unknown>>, posterId),
          poster_verified: poster.poster_verified === true,
          age_preference: task.age_preference,
          scheduled_at: task.scheduled_at || null,
          scheduled_label: task.scheduled_label || null,
        },
      };
    });
    return json({
      ok: true,
      teen: {
        name: teen.name,
        guardian_stripe_payouts_enabled: teen.guardian_stripe_payouts_enabled === true,
      },
      items,
    });
  } catch (err) {
    console.error('guardian-queue error:', err);
    const message = err instanceof Error ? err.message : String(err);
    const status = /token|signature|expired|jwt/i.test(message) ? 410 : 500;
    return json({ ok: false, error: message }, status);
  }
});
