import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ageFromDateOfBirth } from '../_shared/age.ts';
import { authErrorStatus, requireFirebaseUser } from '../_shared/firebase-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Keep in sync with QG_CONFIG.termsVersions on the client. */
const TERMS = {
  tos: '2026-07-02',
  ica: '2026-08-03',
  poster_payment: '2026-08-03',
} as const;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function formatTaskerTermsVersion() {
  return `tos:${TERMS.tos};ica:${TERMS.ica}`;
}

function formatPosterTermsVersion() {
  return `tos:${TERMS.tos};poster_payment:${TERMS.poster_payment}`;
}

function consentAccepted(body: Record<string, unknown>): boolean {
  return body.terms_accepted === true || body.terms_accepted === 'true' || body.terms_accepted === 1;
}

function versionsMatchTasker(body: Record<string, unknown>): boolean {
  const tos = String(body.tos_version || body.terms_tos_version || '').trim();
  const ica = String(body.agreement_version || body.ica_version || '').trim();
  return tos === TERMS.tos && ica === TERMS.ica;
}

function versionsMatchPoster(body: Record<string, unknown>): boolean {
  const tos = String(body.tos_version || body.terms_tos_version || '').trim();
  const posterPay = String(body.agreement_version || body.poster_payment_version || '').trim();
  return tos === TERMS.tos && posterPay === TERMS.poster_payment;
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
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || 'status').toLowerCase();
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const selectBase =
      'firebase_uid,status,account_status,date_of_birth,is_tasker,is_poster,last_active_mode,roles_updated_at,' +
      'tasker_verified,tasker_verification_status,tasker_background_check_status,' +
      'poster_verified,poster_verification_status';
    const selectWithConsent =
      selectBase +
      ',tasker_terms_accepted_at,poster_terms_accepted_at,tasker_terms_version,poster_terms_version';

    let user: Record<string, unknown> | null = null;
    {
      const full = await supabase
        .from('users')
        .select(selectWithConsent)
        .eq('firebase_uid', identity.uid)
        .maybeSingle();
      if (full.error && /tasker_terms|poster_terms|column/i.test(String(full.error.message || ''))) {
        const basic = await supabase
          .from('users')
          .select(selectBase)
          .eq('firebase_uid', identity.uid)
          .maybeSingle();
        if (basic.error) throw basic.error;
        user = basic.data as Record<string, unknown> | null;
      } else if (full.error) {
        throw full.error;
      } else {
        user = full.data as Record<string, unknown> | null;
      }
    }
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
      tasker_terms_accepted_at: user.tasker_terms_accepted_at || null,
      poster_terms_accepted_at: user.poster_terms_accepted_at || null,
      tasker_terms_version: user.tasker_terms_version || null,
      poster_terms_version: user.poster_terms_version || null,
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
      next = {
        ...next,
        is_tasker: corrected.is_tasker === true,
        is_poster: corrected.is_poster === true,
        last_active_mode: String(corrected.last_active_mode || 'tasker'),
        roles_updated_at: corrected.roles_updated_at,
      };
    }

    if (action === 'status') {
      return json({
        success: true,
        ...next,
        is_teen: isTeen,
        terms_versions: TERMS,
      });
    }

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { roles_updated_at: now };

    if (action === 'enable_tasker') {
      if (next.is_tasker) {
        // Already enabled — switch mode only; no re-consent screen.
        patch.last_active_mode = 'tasker';
      } else {
        if (!consentAccepted(body) || !versionsMatchTasker(body)) {
          return json({
            success: false,
            error: 'tasker_consent_required',
            message: 'Agree to the QuickGigs Terms and Independent Contractor Agreement to enable Tasker mode.',
            terms_versions: TERMS,
          }, 400);
        }
        patch.is_tasker = true;
        patch.last_active_mode = 'tasker';
        patch.tasker_terms_accepted_at = now;
        patch.tasker_terms_version = formatTaskerTermsVersion();
        // Auto-ready tasker profile side
        if (!user.tasker_verification_status) patch.tasker_verification_status = 'unverified';
        if (!user.tasker_background_check_status) patch.tasker_background_check_status = 'not_started';
        if (user.tasker_verified == null) patch.tasker_verified = false;
      }
    } else if (action === 'enable_poster') {
      if (isTeen) {
        return json({
          success: false,
          error: 'teen_poster_unavailable',
          message: 'Poster mode becomes available when you turn 18.',
        }, 403);
      }
      if (next.is_poster) {
        patch.last_active_mode = 'poster';
      } else {
        if (!consentAccepted(body) || !versionsMatchPoster(body)) {
          return json({
            success: false,
            error: 'poster_consent_required',
            message: 'Agree to the QuickGigs Terms and Poster & Payment Terms to enable Poster mode.',
            terms_versions: TERMS,
          }, 400);
        }
        patch.is_poster = true;
        patch.last_active_mode = 'poster';
        patch.poster_terms_accepted_at = now;
        patch.poster_terms_version = formatPosterTermsVersion();
        if (!user.poster_verification_status) patch.poster_verification_status = 'unverified';
        if (user.poster_verified == null) patch.poster_verified = false;
      }
    } else if (action === 'set_mode') {
      const mode = String(body.mode || '').toLowerCase();
      if (!['tasker', 'poster'].includes(mode)) {
        return json({ success: false, error: 'invalid_mode' }, 400);
      }
      if (mode === 'tasker' && !next.is_tasker) {
        return json({ success: false, error: 'tasker_role_required' }, 403);
      }
      if (mode === 'poster' && (!next.is_poster || isTeen)) {
        return json({
          success: false,
          error: isTeen ? 'teen_poster_unavailable' : 'poster_role_required',
        }, 403);
      }
      patch.last_active_mode = mode;
    } else {
      return json({ success: false, error: 'invalid_action' }, 400);
    }

    const selectReturn =
      'is_tasker,is_poster,last_active_mode,roles_updated_at,' +
      'tasker_terms_accepted_at,poster_terms_accepted_at,tasker_terms_version,poster_terms_version';
    let updated: Record<string, unknown> | null = null;
    {
      const write = await supabase
        .from('users')
        .update(patch)
        .eq('firebase_uid', identity.uid)
        .select(selectReturn)
        .single();
      if (write.error && /tasker_terms|poster_terms|column/i.test(String(write.error.message || ''))) {
        if (action === 'enable_tasker' || action === 'enable_poster') {
          return json({
            success: false,
            error: 'consent_schema_missing',
            message: 'Apply supabase/role-enable-consent.sql before enabling a second role.',
          }, 503);
        }
        const basicWrite = await supabase
          .from('users')
          .update(patch)
          .eq('firebase_uid', identity.uid)
          .select('is_tasker,is_poster,last_active_mode,roles_updated_at')
          .single();
        if (basicWrite.error) {
          return json({
            success: false,
            error: basicWrite.error.message || 'role_update_failed',
            code: basicWrite.error.code || null,
            action,
          }, 500);
        }
        updated = basicWrite.data as Record<string, unknown>;
      } else if (write.error) {
      console.error('role-access update failed', {
        uid: identity.uid,
        action,
        patch,
        code: write.error.code,
        message: write.error.message,
        details: write.error.details,
        hint: write.error.hint,
      });
      const msg = String(write.error.message || '');
      if (msg.includes('tasker_consent_required') || msg.includes('poster_consent_required')) {
        return json({
          success: false,
          error: msg.includes('poster') ? 'poster_consent_required' : 'tasker_consent_required',
          terms_versions: TERMS,
        }, 400);
      }
      return json({
        success: false,
        error: write.error.message || 'role_update_failed',
        code: write.error.code || null,
        details: write.error.details || null,
        hint: write.error.hint || null,
        action,
      }, 500);
      } else {
        updated = write.data as Record<string, unknown>;
      }
    }
    console.info('role-access update succeeded', { uid: identity.uid, action, updated });
    return json({ success: true, ...updated, is_teen: isTeen, terms_versions: TERMS });
  } catch (err) {
    console.error('role-access error:', err);
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
