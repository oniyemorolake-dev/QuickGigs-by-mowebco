import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Source of truth: `admins` table keyed by Firebase UID. */
export async function isQgAdmin(
  supabase: ReturnType<typeof createClient>,
  uid: string,
): Promise<boolean> {
  const id = String(uid || '').trim();
  if (!id) return false;
  const { data } = await supabase.from('admins').select('user_id').eq('user_id', id).maybeSingle();
  return !!data;
}

export function forbiddenJson() {
  return new Response(JSON.stringify({ success: false, ok: false, error: 'forbidden' }), {
    status: 403,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export { corsHeaders };
