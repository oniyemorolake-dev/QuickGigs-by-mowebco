import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5.9.6';

const PROJECT_ID = Deno.env.get('FIREBASE_PROJECT_ID') || 'quickgigs-7b12d';
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;
const FIREBASE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
);

export type FirebaseIdentity = {
  uid: string;
  email: string;
  emailVerified: boolean;
  phoneNumber: string;
};

export async function requireFirebaseUser(req: Request): Promise<FirebaseIdentity> {
  const header = req.headers.get('authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('missing_authorization');

  const { payload } = await jwtVerify(token, FIREBASE_JWKS, {
    issuer: ISSUER,
    audience: PROJECT_ID,
  });
  const uid = String(payload.sub || '').trim();
  if (!uid) throw new Error('invalid_firebase_token');

  return {
    uid,
    email: String(payload.email || ''),
    emailVerified: payload.email_verified === true,
    phoneNumber: String(payload.phone_number || '').trim(),
  };
}

export function authErrorStatus(err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err || '');
  return msg === 'missing_authorization' ? 401 : 403;
}
