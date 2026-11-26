// Signed session cookies (HMAC-SHA256) using only Web Crypto, so the same code
// runs in the Netlify edge function (Deno), the Netlify function and local Node.

export const COOKIE = 'ps_session';
export const SESSION_DAYS = 7;

export interface Session {
  email: string;
  role: 'admin' | 'member';
  exp: number; // ms since epoch
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

function equal(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export async function signSession(s: Omit<Session, 'exp'>, secret: string, days = SESSION_DAYS): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ ...s, exp: Date.now() + days * 864e5 })));
  return `${payload}.${b64url(await hmac(secret, payload))}`;
}

export async function verifySession(token: string | undefined, secret: string): Promise<Session | null> {
  if (!token || !secret) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  try {
    if (!equal(fromB64url(sig), await hmac(secret, payload))) return null;
    const s = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Session;
    if (!s.email || typeof s.exp !== 'number' || s.exp < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

export function readCookie(header: string | null | undefined, name = COOKIE) {
  for (const part of (header || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function sessionCookie(token: string, secure: boolean, days = SESSION_DAYS) {
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${days * 86400}${secure ? '; Secure' : ''}`;
}

export function clearCookie(secure: boolean) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

/** Pages and endpoints reachable without signing in. */
export function isPublicPath(pathname: string) {
  return (
    pathname === '/login' ||
    pathname === '/login.html' ||
    pathname.startsWith('/api/auth/') ||
    pathname === '/api/health' ||
    pathname.startsWith('/assets/login') ||
    pathname === '/favicon.ico'
  );
}
