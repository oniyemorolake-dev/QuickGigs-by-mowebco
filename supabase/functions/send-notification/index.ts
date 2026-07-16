// Supabase Edge Function — send queued email via Resend
// Deploy: supabase functions deploy send-notification --no-verify-jwt
// Secrets: RESEND_API_KEY, FROM_EMAIL (e.g. QuickGigs <notify@quickgigs.ca>)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const notificationId = body.notification_id;
    const email = body.email;
    const subject = body.subject || 'QuickGigs update';
    const text = body.body || body.body_text || '';

    if (!email) {
      return new Response(JSON.stringify({ ok: false, error: 'missing_email' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) {
      return new Response(JSON.stringify({ ok: false, error: 'resend_not_configured' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const from = Deno.env.get('FROM_EMAIL') || 'QuickGigs <notify@quickgigs.ca>';
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + resendKey,
        'Content-Type': 'application/json',
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
      throw new Error(resendData.message || 'Resend API error');
    }

    if (notificationId) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );
      await supabase
        .from('notification_queue')
        .update({ sent_at: new Date().toISOString(), error_message: null })
        .eq('notification_id', notificationId);
    }

    return new Response(JSON.stringify({ ok: true, id: resendData.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
