import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authErrorStatus, requireFirebaseUser } from '../_shared/firebase-auth.ts';
import { ageFromDateOfBirth, isTeenDateOfBirth } from '../_shared/age.ts';
import { signGuardianToken } from '../_shared/guardian-token.ts';

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

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (n: number) => n * Math.PI / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function emailGuardian(
  guardianEmail: string,
  teenName: string,
  taskTitle: string,
  queueUrl: string,
) {
  const resendKey = Deno.env.get('RESEND_API_KEY') || '';
  if (!resendKey) throw new Error('resend_not_configured');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('FROM_EMAIL') || 'QuickGigs <notify@quickgigs.ca>',
      to: [guardianEmail],
      subject: `Review ${teenName}'s QuickGigs application`,
      text: `${teenName} wants to apply for “${taskTitle}”. Review the task and approve or reject the request:\n\n${queueUrl}\n\nThis secure link expires in 7 days.`,
    }),
  });
  if (!response.ok) throw new Error(`guardian_email_failed:${await response.text()}`);
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
      .select('name,avatar_url,account_status,status,date_of_birth,guardian_email,guardian_consent_status,is_tasker,tasker_verified,tasker_verification_status')
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
    if (actor.is_tasker !== true) {
      return json({
        success: false,
        error: 'tasker_role_required',
        message: 'Enable Tasker mode before applying to gigs.',
      }, 403);
    }
    if (!String(actor.avatar_url || '').trim()) {
      return json({ success: false, error: 'profile_photo_required' }, 400);
    }
    if (actor.tasker_verified !== true) {
      return json({
        success: false,
        error: 'tasker_identity_verification_required',
        verification_status: actor.tasker_verification_status || 'unverified',
        message: 'Verify your identity to start working.',
      }, 403);
    }

    const { data: task } = await supabase
      .from('tasks')
      .select('task_id,title,posted_by,status,age_preference,lat,lng')
      .eq('task_id', taskId)
      .maybeSingle();
    if (!task) return json({ success: false, error: 'task_not_found' }, 404);
    if (task.posted_by === identity.uid) {
      return json({ success: false, error: 'cannot_apply_own_task' }, 400);
    }
    if (task.status !== 'open') return json({ success: false, error: 'task_not_open' }, 409);
    const actorAge = ageFromDateOfBirth(actor.date_of_birth);
    if (actorAge != null && actorAge < 16) {
      return json({ success: false, error: 'underage' }, 403);
    }
    const isTeen = isTeenDateOfBirth(actor.date_of_birth);
    const agePreference = String(task.age_preference || 'adults_only');
    if (isTeen && agePreference === 'adults_only') {
      return json({ success: false, error: 'adults_only_task' }, 403);
    }
    if (isTeen && (
      actor.guardian_consent_status !== 'approved' ||
      !String(actor.guardian_email || '').trim()
    )) {
      return json({ success: false, error: 'guardian_consent_required' }, 403);
    }

    const { data: existing } = await supabase
      .from('applications')
      .select('app_id')
      .eq('task_id', taskId)
      .eq('worker_id', identity.uid)
      .limit(1);
    if (existing?.length) return json({ success: false, error: 'already_applied' }, 409);

    let distanceKm: number | null = null;
    const originLat = Number(app.origin_lat);
    const originLng = Number(app.origin_lng);
    if (
      Number.isFinite(originLat) && Number.isFinite(originLng) &&
      Number.isFinite(Number(task.lat)) && Number.isFinite(Number(task.lng))
    ) {
      distanceKm = Math.round(
        haversineKm(originLat, originLng, Number(task.lat), Number(task.lng)) * 10,
      ) / 10;
    }

    const row = {
      task_id: taskId,
      worker_id: identity.uid,
      worker_name: String(actor.name || app.worker_name || 'Tasker').slice(0, 120),
      message: String(app.message || '').trim().slice(0, 1000),
      price: Math.round(Number(app.price) || 0),
      status: 'pending',
      guardian_status: isTeen ? 'pending_guardian' : 'approved',
      guardian_reviewed_at: isTeen ? null : new Date().toISOString(),
      guardian_distance_km: distanceKm,
    };
    if (!row.message || row.price < 1) return json({ success: false, error: 'invalid_application' }, 400);

    const { data, error } = await supabase.from('applications').insert(row).select('*').single();
    if (error) {
      if (String(error.code) === '23505') {
        return json({ success: false, error: 'already_applied' }, 409);
      }
      throw error;
    }
    let guardianEmailSent = false;
    if (isTeen && data?.app_id) {
      const guardianEmail = String(actor.guardian_email || '').trim().toLowerCase();
      const token = await signGuardianToken(identity.uid, 'guardian_queue', '7d', {
        guardian_email: guardianEmail,
        application_id: String(data.app_id),
      });
      const siteUrl = (Deno.env.get('SITE_URL') || 'https://quickgigs.ca').replace(/\/$/, '');
      const queueUrl = `${siteUrl}/guardian-portal.html?token=${encodeURIComponent(token)}`;
      try {
        await emailGuardian(guardianEmail, String(actor.name || 'Your teen'), String(task.title || 'a gig'), queueUrl);
        guardianEmailSent = true;
      } catch (emailErr) {
        console.error('guardian application email failed:', emailErr);
      }
    }
    return json({
      success: true,
      data,
      guardian_status: row.guardian_status,
      guardian_email_sent: guardianEmailSent,
    });
  } catch (err) {
    console.error('submit-application error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ success: false, error: message }, message.includes('account_not_active') ? 403 : 500);
  }
});
