import { jwtVerify, SignJWT } from 'npm:jose@5.9.6';

const encoder = new TextEncoder();

function signingKey(): Uint8Array {
  const secret = Deno.env.get('GUARDIAN_CONSENT_SECRET') || '';
  if (secret.length < 32) throw new Error('guardian_consent_secret_not_configured');
  return encoder.encode(secret);
}

export async function signGuardianToken(
  uid: string,
  purpose: 'guardian_consent' | 'guardian_payout',
  expiresIn = '7d',
): Promise<string> {
  return await new SignJWT({ purpose })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(uid)
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime(expiresIn)
    .sign(signingKey());
}

export async function verifyGuardianToken(
  token: string,
  purpose: 'guardian_consent' | 'guardian_payout',
): Promise<{ uid: string; jti: string }> {
  const { payload } = await jwtVerify(token, signingKey(), { algorithms: ['HS256'] });
  if (payload.purpose !== purpose || !payload.sub || !payload.jti) {
    throw new Error('invalid_guardian_token');
  }
  return { uid: String(payload.sub), jti: String(payload.jti) };
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
