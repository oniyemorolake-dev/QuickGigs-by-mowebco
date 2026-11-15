// Web Push for SwiftGigs: VAPID (RFC 8292) + aes128gcm payload encryption
// (RFC 8291), written against WebCrypto only so there is no dependency to break.
//
// The VAPID key pair is created on first use and kept in public.push_config,
// a server-only table. The private key never leaves the server.

// deno-lint-ignore no-explicit-any
type Sb = any;

export type PushSub = { endpoint: string; p256dh: string; auth: string };
export type Vapid = { publicKey: string; privateJwk: JsonWebKey };

const enc = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64urlDecode(text: string): Uint8Array {
  const t = String(text || '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** Only real browser push services may be called (no arbitrary URLs). */
export function isPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return h === 'fcm.googleapis.com' ||
      h === 'updates.push.services.mozilla.com' ||
      h.endsWith('.push.apple.com') ||
      h.endsWith('.notify.windows.com') ||
      h.endsWith('.push.services.mozilla.com');
  } catch {
    return false;
  }
}

export async function generateVapid(): Promise<Vapid> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKey: b64urlEncode(raw), privateJwk };
}

/** Load the key pair, creating it the first time. */
export async function getVapid(supabase: Sb): Promise<Vapid> {
  const read = async () => {
    const { data } = await supabase.from('push_config').select('public_key,private_jwk').eq('id', 1).maybeSingle();
    return data && data.public_key && data.private_jwk
      ? { publicKey: String(data.public_key), privateJwk: data.private_jwk as JsonWebKey }
      : null;
  };
  const existing = await read();
  if (existing) return existing;
  const fresh = await generateVapid();
  // If two requests race, the first insert wins and both read the same row back.
  await supabase.from('push_config').upsert(
    { id: 1, public_key: fresh.publicKey, private_jwk: fresh.privateJwk },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  return (await read()) || fresh;
}

async function vapidHeader(endpoint: string, vapid: Vapid, subject: string): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  })));
  const key = await crypto.subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(header + '.' + claims)));
  return 'vapid t=' + header + '.' + claims + '.' + b64urlEncode(sig) + ', k=' + vapid.publicKey;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** RFC 8291 aes128gcm body for one push message. */
export async function encryptPayload(sub: PushSub, plaintext: Uint8Array): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(sub.p256dh);
  const authSecret = b64urlDecode(sub.auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('bad_subscription_keys');

  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // 0x02 marks the last (only) record.
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))));

  const head = new Uint8Array(16 + 4 + 1 + asPublic.length);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = asPublic.length;
  head.set(asPublic, 21);
  return concat(head, sealed);
}

export type PushResult = { ok: boolean; status: number; gone: boolean };

export async function sendPush(
  sub: PushSub,
  message: Record<string, unknown>,
  vapid: Vapid,
  subject = 'mailto:support@quickgigs.ca',
): Promise<PushResult> {
  if (!isPushEndpoint(sub.endpoint)) return { ok: false, status: 0, gone: true };
  const body = await encryptPayload(sub, enc.encode(JSON.stringify(message)));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': await vapidHeader(sub.endpoint, vapid, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
      'Urgency': 'high',
    },
    body,
  });
  try { await res.arrayBuffer(); } catch { /* drained */ }
  return { ok: res.status >= 200 && res.status < 300, status: res.status, gone: res.status === 404 || res.status === 410 };
}

/** Send one message to every device a person has turned notifications on for. */
export async function pushToUser(
  supabase: Sb,
  userId: string,
  message: { title: string; body: string; url?: string; tag?: string },
): Promise<{ sent: number; devices: number }> {
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('endpoint,p256dh,auth')
    .eq('user_id', userId)
    .limit(10);
  if (!subs || !subs.length) return { sent: 0, devices: 0 };
  const vapid = await getVapid(supabase);
  let sent = 0;
  for (const s of subs) {
    try {
      const r = await sendPush(s as PushSub, message, vapid);
      if (r.ok) {
        sent++;
        await supabase.from('push_subscriptions').update({ last_ok_at: new Date().toISOString() }).eq('endpoint', s.endpoint);
      } else if (r.gone) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
      } else {
        console.warn('push refused', r.status, new URL(s.endpoint).hostname);
      }
    } catch (err) {
      console.warn('push failed', err);
    }
  }
  return { sent, devices: subs.length };
}
