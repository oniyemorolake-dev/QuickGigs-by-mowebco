import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authErrorStatus, requireFirebaseUser } from '../_shared/firebase-auth.ts';
import { geocodeCanada } from '../_shared/geocode-canada.ts';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405);

  try {
    await requireFirebaseUser(req);
  } catch (err) {
    return json(
      { success: false, error: err instanceof Error ? err.message : 'unauthorized' },
      authErrorStatus(err),
    );
  }

  try {
    const input = await req.json();
    const query = String(input.query || input.location || input.postal || '').trim();
    if (!query) {
      return json({ success: false, error: 'missing_query', message: 'Enter a postal code or city.' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    );

    const result = await geocodeCanada(supabase, query);
    if (!result) {
      return json({
        success: false,
        error: 'geocode_failed',
        message: 'Could not find that location in Canada. Try a postal code or "City, Province".',
      }, 422);
    }

    return json({
      success: true,
      data: {
        city: result.city,
        province: result.province,
        location: result.location,
        lat: result.lat,
        lng: result.lng,
        postal_code: result.postal_code,
        cached: result.cached,
      },
    });
  } catch (err) {
    console.error('geocode-canada error:', err);
    return json({ success: false, error: 'server_error' }, 500);
  }
});
