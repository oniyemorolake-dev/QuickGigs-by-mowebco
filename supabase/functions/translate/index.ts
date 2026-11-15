// translate — turns the app's English text into another language, once.
//
// POST { action: 'status' }                      -> { enabled, languages }
// POST { action: 'translate', lang, texts: [] }  -> { out: [] }  (same order; null = keep English)
//
// Every phrase is cached in public.translations, so Google is only called for
// text never seen before in that language. A monthly character cap
// (TRANSLATE_MONTHLY_CHAR_CAP, default 400,000) keeps usage inside the free
// allowance: past the cap, new text simply stays in English.
//
// Needs the GOOGLE_TRANSLATE_API_KEY secret. Without it the feature is off and
// the app never offers a language switch.
//
// Deploy: supabase functions deploy translate --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

// App language code -> Google's code.
const LANGS: Record<string, string> = {
  fr: 'fr', es: 'es', zh: 'zh-CN', pa: 'pa', hi: 'hi', tl: 'tl', ar: 'ar',
  ur: 'ur', pt: 'pt', vi: 'vi', ko: 'ko', uk: 'uk', fa: 'fa', de: 'de', it: 'it',
};
const MAX_TEXTS = 80;
const MAX_LEN = 300;

async function sha(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(bytes.slice(0, 16)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  try {
    const apiKey = Deno.env.get('GOOGLE_TRANSLATE_API_KEY') || '';
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'translate');

    if (action === 'status') {
      return json({ ok: true, enabled: !!apiKey, languages: Object.keys(LANGS) });
    }
    if (!apiKey) return json({ ok: false, error: 'translation_off' }, 503);

    const lang = String(body.lang || '').toLowerCase();
    const target = LANGS[lang];
    if (!target) return json({ ok: false, error: 'unsupported_language' }, 400);

    const texts: string[] = (Array.isArray(body.texts) ? body.texts : [])
      .slice(0, MAX_TEXTS)
      .map((t: unknown) => String(t == null ? '' : t));
    if (!texts.length) return json({ ok: true, out: [] });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    );

    const out: (string | null)[] = texts.map(() => null);
    const hashes = await Promise.all(texts.map((t) => sha(t)));
    const usable = texts.map((t) => t.trim().length > 0 && t.length <= MAX_LEN);

    const wanted = [...new Set(hashes.filter((_h, i) => usable[i]))];
    const cached = new Map<string, string>();
    if (wanted.length) {
      const { data: rows } = await supabase
        .from('translations')
        .select('src_hash,out')
        .eq('lang', lang)
        .in('src_hash', wanted);
      for (const r of rows || []) cached.set(String(r.src_hash), String(r.out));
    }

    const missIdx: number[] = [];
    const seen = new Set<string>();
    texts.forEach((_t, i) => {
      if (!usable[i]) return;
      const hit = cached.get(hashes[i]);
      if (hit != null) { out[i] = hit; return; }
      if (!seen.has(hashes[i])) { seen.add(hashes[i]); missIdx.push(i); }
    });

    if (missIdx.length) {
      // Per-visitor limit on NEW text only; cached text is always free to serve.
      const ip = String(req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
      const { data: verdict } = await supabase.rpc('qg_rate_limit_hit', {
        p_uid: 'ip:' + ip,
        p_action: 'translate_new',
        p_limit: 30,
        p_window_seconds: 300,
      });
      const allowed = !verdict || (verdict as Record<string, unknown>).allowed !== false;

      const chars = missIdx.reduce((sum, i) => sum + texts[i].length, 0);
      const cap = Number(Deno.env.get('TRANSLATE_MONTHLY_CHAR_CAP') || 400000);
      let reserved = false;
      if (allowed) {
        const { data: ok } = await supabase.rpc('qg_translate_reserve', { p_chars: chars, p_cap: cap });
        reserved = ok === true;
      }

      if (reserved) {
        const res = await fetch(
          'https://translation.googleapis.com/language/translate/v2?key=' + encodeURIComponent(apiKey),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ q: missIdx.map((i) => texts[i]), source: 'en', target, format: 'text' }),
          },
        );
        if (res.ok) {
          const data = await res.json();
          const list = data?.data?.translations || [];
          const fresh: Record<string, unknown>[] = [];
          const byHash = new Map<string, string>();
          missIdx.forEach((i, n) => {
            const translated = list[n]?.translatedText;
            if (typeof translated !== 'string' || !translated) return;
            const clean = decodeEntities(translated);
            byHash.set(hashes[i], clean);
            fresh.push({ lang, src_hash: hashes[i], src: texts[i], out: clean });
          });
          if (fresh.length) {
            await supabase.from('translations').upsert(fresh, { onConflict: 'lang,src_hash', ignoreDuplicates: true });
          }
          texts.forEach((_t, i) => {
            if (out[i] == null && usable[i] && byHash.has(hashes[i])) out[i] = byHash.get(hashes[i]) as string;
          });
        } else {
          console.error('translate: provider error', res.status, (await res.text()).slice(0, 300));
        }
      }
    }

    return json({ ok: true, out });
  } catch (err) {
    console.error('translate error:', err);
    return json({ ok: false, error: 'translate_failed' }, 500);
  }
});
