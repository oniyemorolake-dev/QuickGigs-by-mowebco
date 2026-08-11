// Supabase Edge Function — send queued email via Resend (INTERNAL ONLY)
// Deploy: supabase functions deploy send-notification --no-verify-jwt
// Secrets: RESEND_API_KEY, FROM_EMAIL, NOTIFICATION_SEND_SECRET (or GRADUATION_CRON_SECRET)
//
// Auth: requires header x-qg-notification-secret matching NOTIFICATION_SEND_SECRET
// (or GRADUATION_CRON_SECRET as fallback). Does NOT accept arbitrary public email blasts —
// prefers notification_id from notification_queue; free-form email only for secret holders.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-qg-notification-secret',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const expected =
      Deno.env.get('NOTIFICATION_SEND_SECRET') ||
      Deno.env.get('GRADUATION_CRON_SECRET') ||
      '';
    if (!expected || expected.length < 16) {
      return json({ ok: false, error: 'notification_secret_not_configured' }, 503);
    }
    const provided = req.headers.get('x-qg-notification-secret') || '';
    if (!provided || !timingSafeEqual(provided, expected)) {
      return json({ ok: false, error: 'unauthorized' }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const notificationId = body.notification_id ? String(body.notification_id) : '';
    let email = String(body.email || '').trim();
    let subject = String(body.subject || 'QuickGigs update');
    let text = String(body.body || body.body_text || '');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Prefer queue row — prevents arbitrary email content from becoming the primary path
    if (notificationId) {
      const { data: row, error } = await supabase
        .from('notification_queue')
        .select('*')
        .eq('notification_id', notificationId)
        .maybeSingle();
      if (error || !row) return json({ ok: false, error: 'notification_not_found' }, 404);
      if (row.sent_at) return json({ ok: true, already: true });
      email = String(row.email || email || '').trim();
      subject = String(row.subject || subject);
      text = String(row.body || row.body_text || text);
    }

    if (!email) {
      return json({ ok: false, error: 'missing_email' }, 400);
    }

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) {
      return json({ ok: false, error: 'resend_not_configured' }, 503);
    }

    const from = Deno.env.get('FROM_EMAIL') || 'QuickGigs <notify@quickgigs.ca>';
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + resendKey,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject,
        text,
      }),
    });

    const resendData = await res.json();
    if (!res.ok) {
      console.error('Resend error:', resendData);
      return json({ ok: false, error: 'resend_failed' }, 502);
    }

    if (notificationId) {
      await supabase
        .from('notification_queue')
        .update({ sent_at: new Date().toISOString(), error_message: null })
        .eq('notification_id', notificationId);
    }

    return json({ ok: true, id: resendData.id });
  } catch (err) {
    console.error('send-notification error:', err);
    return json({ ok: false, error: 'send_failed' }, 500);
  }
});
