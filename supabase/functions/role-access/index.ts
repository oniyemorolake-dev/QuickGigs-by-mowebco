import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ageFromDateOfBirth } from '../_shared/age.ts';
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
    const action = String(body.action || 'status').toLowerCase();
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: user, error } = await supabase
      .from('users')
      .select('firebase_uid,status,account_status,date_of_birth,is_tasker,is_poster,last_active_mode,roles_updated_at')
      .eq('firebase_uid', identity.uid)
      .maybeSingle();
    if (error) throw error;
    if (!user) return json({ success: false, error: 'account_not_found' }, 404);
    if (['banned', 'blocked', 'suspended'].includes(String(user.status || '').toLowerCase())) {
      return json({ success: false, error: 'account_not_active' }, 403);
    }

    const age = ageFromDateOfBirth(user.date_of_birth);
    const isTeen = age != null && age < 18;
    let next = {
      is_tasker: user.is_tasker === true,
      is_poster: user.is_poster === true,
      last_active_mode: String(user.last_active_mode || (user.is_poster ? 'poster' : 'tasker')),
      roles_updated_at: user.roles_updated_at,
    };
    console.info('role-access request', {
      uid: identity.uid,
      action,
      is_tasker: next.is_tasker,
      is_poster: next.is_poster,
      is_teen: isTeen,
      last_active_mode: next.last_active_mode,
    });

    if (isTeen && next.is_poster) {
      const { data: corrected, error: correctionError } = await supabase
        .from('users')
        .update({
          is_tasker: true,
          is_poster: false,
          last_active_mode: 'tasker',
          roles_updated_at: new Date().toISOString(),
        })
        .eq('firebase_uid', identity.uid)
        .select('is_tasker,is_poster,last_active_mode,roles_updated_at')
        .single();
      if (correctionError) throw correctionError;
      next = corrected;
    }

    if (action === 'status') {
      return json({ success: true, ...next, is_teen: isTeen });
    }

    const patch: Record<string, unknown> = { roles_updated_at: new Date().toISOString() };
    if (action === 'enable_tasker') {
      patch.is_tasker = true;
      patch.last_active_mode = 'tasker';
    } else if (action === 'enable_poster') {
      if (isTeen) {
        return json({
          success: false,
          error: 'teen_poster_unavailable',
          message: 'Poster mode becomes available when you turn 18.',
        }, 403);
      }
      patch.is_poster = true;
      patch.last_active_mode = 'poster';
    } else if (action === 'set_mode') {
      const mode = String(body.mode || '').toLowerCase();
      if (!['tasker', 'poster'].includes(mode)) {
        return json({ success: false, error: 'invalid_mode' }, 400);
      }
      if (mode === 'tasker' && !next.is_tasker) {
        return json({ success: false, error: 'tasker_role_required' }, 403);
      }
      if (mode === 'poster' && (!next.is_poster || isTeen)) {
        return json({ success: false, error: isTeen ? 'teen_poster_unavailable' : 'poster_role_required' }, 403);
      }
      patch.last_active_mode = mode;
    } else {
      return json({ success: false, error: 'invalid_action' }, 400);
    }

    const { data: updated, error: updateError } = await supabase
      .from('users')
      .update(patch)
      .eq('firebase_uid', identity.uid)
      .select('is_tasker,is_poster,last_active_mode,roles_updated_at')
      .single();
    if (updateError) {
      console.error('role-access update failed', {
        uid: identity.uid,
        action,
        patch,
        code: updateError.code,
        message: updateError.message,
        details: updateError.details,
        hint: updateError.hint,
      });
      return json({
        success: false,
        error: updateError.message || 'role_update_failed',
        code: updateError.code || null,
        details: updateError.details || null,
        hint: updateError.hint || null,
        action,
      }, 500);
    }
    console.info('role-access update succeeded', { uid: identity.uid, action, updated });
    return json({ success: true, ...updated, is_teen: isTeen });
  } catch (err) {
    console.error('role-access error:', err);
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
