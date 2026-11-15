// push — phone and desktop notifications (Web Push).
//
// POST { action: 'key' }                                   -> { public_key }
// POST { action: 'subscribe', subscription: {endpoint, keys:{p256dh, auth}} }
// POST { action: 'unsubscribe', endpoint }
// POST { action: 'test' }                                   -> sends a test notification to the caller's devices
//
// Deploy: supabase functions deploy push --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authErrorStatus, requireFirebaseUser } from '../_shared/firebase-auth.ts';
import { b64urlDecode, getVapid, isPushEndpoint, pushToUser } from '../_shared/webpush.ts';

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

const MAX_DEVICES = 8;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  let identity;
  try {
    identity = await requireFirebaseUser(req);
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'unauthorized' }, authErrorStatus(err));
  }
  const uid = identity.uid;

  try {
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!serviceKey) return json({ ok: false, error: 'service_role_missing' }, 503);
    const supabase = createClient(Deno.env.get('SUPABASE_URL') || '', serviceKey);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '').toLowerCase();

    if (action === 'key') {
      const vapid = await getVapid(supabase);
      return json({ ok: true, public_key: vapid.publicKey });
    }

    if (action === 'subscribe') {
      const s = body.subscription || {};
      const endpoint = String(s.endpoint || '');
      const p256dh = String(s.keys?.p256dh || '');
      const auth = String(s.keys?.auth || '');
      if (!isPushEndpoint(endpoint) || endpoint.length > 1000) {
        return json({ ok: false, error: 'invalid_endpoint' }, 400);
      }
      let keysOk = false;
      try { keysOk = b64urlDecode(p256dh).length === 65 && b64urlDecode(auth).length === 16; } catch { keysOk = false; }
      if (!keysOk) return json({ ok: false, error: 'invalid_keys' }, 400);

      // One row per device. A device that signs in as someone else moves to them.
      const { error } = await supabase.from('push_subscriptions').upsert({
        endpoint,
        user_id: uid,
        p256dh,
        auth,
        user_agent: String(req.headers.get('user-agent') || '').slice(0, 200),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'endpoint' });
      if (error) throw error;

      // Keep only the newest few devices per person.
      const { data: mine } = await supabase
        .from('push_subscriptions')
        .select('endpoint,updated_at')
        .eq('user_id', uid)
        .order('updated_at', { ascending: false });
      const extra = (mine || []).slice(MAX_DEVICES).map((r: { endpoint: string }) => r.endpoint);
      if (extra.length) await supabase.from('push_subscriptions').delete().in('endpoint', extra);

      return json({ ok: true, devices: Math.min((mine || []).length, MAX_DEVICES) });
    }

    if (action === 'unsubscribe') {
      const endpoint = String(body.endpoint || '');
      if (endpoint) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', uid);
      }
      return json({ ok: true });
    }

    if (action === 'test') {
      const { data: verdict } = await supabase.rpc('qg_rate_limit_hit', {
        p_uid: uid, p_action: 'push_test', p_limit: 5, p_window_seconds: 600,
      });
      if (verdict && (verdict as Record<string, unknown>).allowed === false) {
        return json({ ok: false, error: 'rate_limited', message: 'Try again in a few minutes.' }, 429);
      }
      const r = await pushToUser(supabase, uid, {
        title: 'SwiftGigs notifications are on',
        body: 'You will hear about messages, offers and payments here.',
        url: '/dashboard.html',
        tag: 'qg-test',
      });
      return json({ ok: true, sent: r.sent, devices: r.devices });
    }

    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (err) {
    console.error('push error:', err);
    return json({ ok: false, error: 'push_failed' }, 500);
  }
});
