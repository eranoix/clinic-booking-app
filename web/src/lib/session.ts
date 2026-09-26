/**
 * The admin session cookie: `v1.<expiry>.<signature>`, signed with HMAC-SHA256.
 * Web Crypto only, so it runs in middleware and route handlers. The key is
 * derived from ADMIN_PASSWORD (and SESSION_SECRET when set), so changing the
 * password signs everyone out and the cookie carries nothing about it.
 */
export const SESSION_COOKIE = 'qp_admin';
export const SESSION_HOURS = 12;

const enc = new TextEncoder();

/** Sign-in is on only when ADMIN_PASSWORD is set to something. */
export function adminPassword(): string | null {
  const p = process.env.ADMIN_PASSWORD;
  return p && p.length > 0 ? p : null;
}

async function key(password: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    'SHA-256',
    enc.encode(`clinic-booking-app admin session\0${password}\0${process.env.SESSION_SECRET ?? ''}`),
  );
  return crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

function b64url(bytes: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(payload: string, password: string): Promise<string> {
  return b64url(await crypto.subtle.sign('HMAC', await key(password), enc.encode(payload)));
}

/** Compare without stopping at the first difference, so timing says nothing. */
export function constantTimeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function issueSession(password: string, now = Date.now()): Promise<string> {
  const payload = `v1.${now + SESSION_HOURS * 3_600_000}`;
  return `${payload}.${await sign(payload, password)}`;
}

export async function verifySession(cookie: string | undefined, password: string, now = Date.now()): Promise<boolean> {
  if (!cookie) return false;
  const parts = cookie.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;
  const expiry = Number(parts[1]);
  if (!Number.isFinite(expiry) || expiry <= now) return false;
  return constantTimeEqual(parts[2]!, await sign(`v1.${parts[1]}`, password));
}
