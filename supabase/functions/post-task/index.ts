import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isTeenDateOfBirth } from '../_shared/age.ts';
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

function isCanadianCoordinate(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= 41.5 && lat <= 83.5 && lng >= -141.1 && lng <= -52.5;
}

async function geocodeCanadianLocation(location: string) {
  const query = String(location || '').trim();
  if (!query) return null;
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'ca');
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'en-CA,en',
        'User-Agent': 'QuickGigs/1.0 (https://quickgigs.ca)',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const rows = await response.json() as Array<{ lat?: string; lon?: string }>;
    const lat = Number(rows?.[0]?.lat);
    const lng = Number(rows?.[0]?.lon);
    if (!isCanadianCoordinate(lat, lng)) return null;
    return {
      lat: Math.round(lat * 100) / 100,
      lng: Math.round(lng * 100) / 100,
    };
  } catch {
    return null;
  }
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
    if (actor.poster_verified !== true) {
      return json({
        success: false,
        error: 'poster_payment_verification_required',
        verification_status: actor.poster_verification_status || 'unverified',
        message: 'Add a payment method to post.',
      }, 403);
    }

    const publicLocation = String(task.location || '').trim().slice(0, 100);
    const geocoded = await geocodeCanadianLocation(publicLocation);
    if (!geocoded) {
      return json({
        success: false,
        error: 'location_geocode_failed',
        message: 'Choose a valid Canadian city or area.',
      }, 422);
    }

    const row: Record<string, unknown> = {
      title: String(task.title || '').trim().slice(0, 100),
      description: String(task.description || '').trim().slice(0, 2000),
      category: String(task.category || 'other').toLowerCase().slice(0, 50),
      task_mode: String(task.task_mode || 'standard').toLowerCase().slice(0, 30),
      budget: Math.round(Number(task.budget) || 0),
      location: publicLocation,
      lat: geocoded.lat,
      lng: geocoded.lng,
      status: 'open',
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
