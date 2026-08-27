import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isTeenDateOfBirth } from '../_shared/age.ts';
import { authErrorStatus, requireFirebaseUser } from '../_shared/firebase-auth.ts';
import { haversineKm, isCanadianCoordinate, roundCoord } from '../_shared/geo.ts';
import { geocodeCanada } from '../_shared/geocode-canada.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_MATCHES = 80;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function geocodeCanadianLocation(supabase: SupabaseClient, location: string) {
  return geocodeCanada(supabase, location);
}

type AlertUser = {
  firebase_uid: string;
  email?: string | null;
  name?: string | null;
  date_of_birth?: string | null;
  email_verified?: boolean | null;
  tasker_verified?: boolean | null;
  availability?: string | null;
  status?: string | null;
  notify_new_gigs?: boolean | null;
  notify_new_gigs_email?: boolean | null;
  alert_radius_km?: number | null;
  alert_categories?: string[] | null;
  alert_lat?: number | null;
  alert_lng?: number | null;
};

type TaskRow = {
  task_id?: string;
  title?: string;
  category?: string;
  location?: string;
  budget?: number;
  lat?: number | null;
  lng?: number | null;
  location_type?: string | null;
  age_preference?: string | null;
  posted_by?: string;
  status?: string;
};

function categoryMatches(prefs: string[] | null | undefined, category: string): boolean {
  if (!prefs || !prefs.length) return true; // empty = all categories
  const cat = String(category || '').toLowerCase();
  return prefs.some((p) => String(p || '').toLowerCase() === cat);
}

async function notifyMatchingTaskers(supabase: SupabaseClient, task: TaskRow) {
  if (String(task.status || '').toLowerCase() !== 'open') return { notified: 0 };
  const locationType = String(task.location_type || 'in_person').toLowerCase();
  if (locationType === 'remote') return { notified: 0, skipped: 'remote_task' };
  const taskLat = Number(task.lat);
  const taskLng = Number(task.lng);
  if (!isCanadianCoordinate(taskLat, taskLng)) return { notified: 0, skipped: 'no_coords' };

  const posterId = String(task.posted_by || '');
  const agePref = String(task.age_preference || 'adults_only');
  const category = String(task.category || 'other').toLowerCase();
  const taskId = String(task.task_id || '');
  const title = String(task.title || 'New gig');
  const location = String(task.location || '');
  const budget = Number(task.budget) || 0;
  const link = taskId
    ? `https://quickgigs.ca/browsetask.html?task=${encodeURIComponent(taskId)}`
    : 'https://quickgigs.ca/browsetask.html';

  const { data: candidates, error } = await supabase
    .from('users')
    .select(
      'firebase_uid,email,name,date_of_birth,email_verified,tasker_verified,availability,status,' +
      'notify_new_gigs,notify_new_gigs_email,alert_radius_km,alert_categories,alert_lat,alert_lng',
    )
    .eq('is_tasker', true)
    .eq('notify_new_gigs', true)
    .eq('account_status', 'active')
    .limit(500);

  if (error) {
    console.error('gig-alert query failed:', error.message);
    return { notified: 0, error: error.message };
  }

  type Ranked = { user: AlertUser; km: number };
  const ranked: Ranked[] = [];

  for (const raw of (candidates || []) as AlertUser[]) {
    const uid = String(raw.firebase_uid || '');
    if (!uid || uid === posterId) continue;
    if (['banned', 'blocked', 'suspended'].includes(String(raw.status || '').toLowerCase())) continue;
    // Verified taskers only (email_verified; tasker_verified is email-based at launch)
    if (raw.email_verified !== true && raw.tasker_verified !== true) continue;
    if (String(raw.availability || '').toLowerCase() === 'busy') continue;
    if (agePref === 'adults_only' && isTeenDateOfBirth(raw.date_of_birth)) continue;
    if (!categoryMatches(raw.alert_categories, category)) continue;

    const uLat = Number(raw.alert_lat);
    const uLng = Number(raw.alert_lng);
    if (!isCanadianCoordinate(uLat, uLng)) continue;

    const radius = [20, 50, 100].includes(Number(raw.alert_radius_km))
      ? Number(raw.alert_radius_km)
      : 50;
    const km = haversineKm(taskLat, taskLng, uLat, uLng);
    if (km > radius) continue;
    ranked.push({ user: raw, km });
  }

  ranked.sort((a, b) => a.km - b.km);
  const winners = ranked.slice(0, MAX_MATCHES);
  if (!winners.length) return { notified: 0 };

  const notifRows = winners.map(({ user, km }) => ({
    user_id: user.firebase_uid,
    type: 'new_gig_match',
    title: 'New gig near you',
    body: `“${title}” · ${location || 'Nearby'}${budget ? ' · $' + budget : ''} · ~${km < 10 ? km.toFixed(1) : Math.round(km)} km`,
    link,
    payload: {
      taskId,
      taskTitle: title,
      category,
      location,
      budget,
      distanceKm: Math.round(km * 10) / 10,
      link,
    },
  }));

  const { error: insertErr } = await supabase.from('user_notifications').insert(notifRows);
  if (insertErr) {
    console.error('gig-alert in-app insert failed:', insertErr.message);
    return { notified: 0, error: insertErr.message };
  }

  // Optional email (best-effort, capped)
  const resendKey = Deno.env.get('RESEND_API_KEY') || '';
  const from = Deno.env.get('FROM_EMAIL') || 'QuickGigs <notify@quickgigs.ca>';
  let emailed = 0;
  if (resendKey) {
    for (const { user, km } of winners) {
      if (user.notify_new_gigs_email !== true) continue;
      const email = String(user.email || '').trim();
      if (!email || !email.includes('@')) continue;
      if (emailed >= 40) break;
      try {
        const subject = `New gig near you: “${title}”`;
        const text =
          `A new QuickGigs task matches your alerts:\n\n` +
          `“${title}”\n` +
          `${location || 'Near you'}${budget ? ' · $' + budget : ''}\n` +
          `About ${km < 10 ? km.toFixed(1) : Math.round(km)} km away\n\n` +
          `Open the gig:\n${link}\n\n` +
          `Manage alerts in your Tasker profile settings.\n\n— QuickGigs`;
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({ from, to: [email], subject, text }),
        });
        if (res.ok) emailed += 1;
      } catch (e) {
        console.warn('gig-alert email failed', e);
      }
    }
  }

  return { notified: winners.length, emailed };
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
      .select('name,account_status,status,date_of_birth,is_poster,poster_verified,poster_verification_status')
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
    if (actor.is_poster !== true || isTeenDateOfBirth(actor.date_of_birth)) {
      return json({
        success: false,
        error: isTeenDateOfBirth(actor.date_of_birth) ? 'teen_poster_unavailable' : 'poster_role_required',
        message: isTeenDateOfBirth(actor.date_of_birth)
          ? 'Poster mode becomes available when you turn 18.'
          : 'Enable Poster mode before posting tasks.',
      }, 403);
    }
    const publishStatus = String(task.status || task.publish_status || 'open').toLowerCase() === 'draft'
      ? 'draft'
      : 'open';

    if (publishStatus === 'open' && actor.poster_verified !== true) {
      return json({
        success: false,
        error: 'poster_payment_verification_required',
        verification_status: actor.poster_verification_status || 'unverified',
        message: 'Add a payment method to post.',
      }, 403);
    }

    const locationType = String(task.location_type || 'in_person').toLowerCase() === 'remote'
      ? 'remote'
      : 'in_person';
    const publicLocation = String(task.location || '').trim().slice(0, 100);

    let geocoded: Awaited<ReturnType<typeof geocodeCanada>> | null = null;
    if (locationType === 'in_person') {
      if (!publicLocation) {
        return json({
          success: false,
          error: 'location_required',
          message: 'Enter a Canadian city, area, or postal code for in-person tasks.',
        }, 422);
      }
      geocoded = await geocodeCanadianLocation(supabase, publicLocation);
      if (!geocoded) {
        return json({
          success: false,
          error: 'location_geocode_failed',
          message: 'Choose a valid Canadian city, area, or postal code.',
        }, 422);
      }
    }

    const category = String(task.category || 'other').toLowerCase().slice(0, 50);
    const { data: catRow } = await supabase
      .from('task_categories')
      .select('requires_enhanced_verification')
      .eq('id', category)
      .maybeSingle();
    const enhanced = catRow?.requires_enhanced_verification === true ||
      ['care', 'childcare', 'eldercare', 'in-home-care', 'inhome'].includes(category);

    const row: Record<string, unknown> = {
      title: String(task.title || '').trim().slice(0, 100),
      description: String(task.description || '').trim().slice(0, 2000),
      category,
      task_mode: String(task.task_mode || 'standard').toLowerCase().slice(0, 30),
      budget: Math.round(Number(task.budget) || 0),
      location: locationType === 'remote' ? (publicLocation || 'Remote / Online') : (geocoded!.location || publicLocation),
      location_type: locationType,
      lat: locationType === 'remote' ? null : geocoded!.lat,
      lng: locationType === 'remote' ? null : geocoded!.lng,
      status: publishStatus,
      requires_enhanced_verification: enhanced,
      posted_by: identity.uid,
      poster_name: String(actor.name || task.poster_name || 'Poster').slice(0, 120),
      age_preference: ['teens_welcome', 'any_with_guardian'].includes(String(task.age_preference || ''))
        ? String(task.age_preference)
        : 'adults_only',
    };
    const optional = [
      'scheduled_at', 'scheduled_label', 'photo_urls', 'requires_photos',
      'budget_negotiable', 'rate_type', 'is_recurring', 'frequency',
      'hourly_rate', 'est_hours', 'precise_address',
    ];
    for (const key of optional) {
      if (task[key] != null && task[key] !== '') row[key] = task[key];
    }
    if (!row.title || Number(row.budget) < 20) {
      return json({
        success: false,
        error: 'amount_below_minimum',
        message: 'Tasks must be at least $20 CAD.',
        min_amount: 20,
      }, 400);
    }

    const { data, error } = await supabase.from('tasks').insert(row).select('*').single();
    if (error) throw error;

    // Server-side fan-out (never block post on notify failures)
    let alerts: Record<string, unknown> = { notified: 0 };
    if (publishStatus === 'open' && data) {
      try {
        alerts = await notifyMatchingTaskers(supabase, data as TaskRow);
      } catch (alertErr) {
        console.error('gig-alert fan-out error:', alertErr);
      }
    }

    return json({ success: true, data, alerts });
  } catch (err) {
    console.error('post-task error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ success: false, error: message }, message.includes('account_not_active') ? 403 : 500);
  }
});
