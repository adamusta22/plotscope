// Sign-in, sign-out, first-time setup, password changes and team management.
import { clearCookie, readCookie, Session, sessionCookie, signSession, verifySession } from './session';
import { checkNoUser, checkPassword, hashPassword, passwordProblem, toPublic, User, users, validEmail } from './users';

const env = (k: string) => (typeof process !== 'undefined' ? process.env[k] : undefined) || '';
export const authEnabled = () => !!env('SESSION_SECRET');

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

// Slow down password guessing: 8 failed attempts per IP per 15 minutes.
const failures = new Map<string, number[]>();
function tooManyFailures(ip: string) {
  const now = Date.now();
  const list = (failures.get(ip) || []).filter((t) => now - t < 15 * 60_000);
  failures.set(ip, list);
  return list.length >= 8;
}
const noteFailure = (ip: string) => failures.set(ip, [...(failures.get(ip) || []), Date.now()]);

/** The signed-in user for this request, re-checked against the account store. */
export async function currentUser(req: Request): Promise<{ session: Session; user: User } | null> {
  const session = await verifySession(readCookie(req.headers.get('cookie')), env('SESSION_SECRET'));
  if (!session) return null;
  const user = await users().get(session.email);
  return user ? { session, user } : null; // removed accounts lose access immediately
}

async function body(req: Request): Promise<any> {
  try { return await req.json(); } catch { return {}; }
}

async function startSession(user: User, secure: boolean, extra: Record<string, unknown> = {}) {
  const token = await signSession({ email: user.email, role: user.role }, env('SESSION_SECRET'));
  user.lastLoginAt = Date.now();
  await users().set(user);
  return json(200, { ok: true, user: toPublic(user), ...extra }, { 'Set-Cookie': sessionCookie(token, secure) });
}

/** Handles /api/auth/* and /api/team*. Returns null for other paths. */
export async function handleAuth(req: Request, ip: string): Promise<Response | null> {
  const url = new URL(req.url);
  const p = url.pathname;
  if (!p.startsWith('/api/auth/') && !p.startsWith('/api/team')) return null;
  const secure = url.protocol === 'https:';
  if (!authEnabled()) return json(200, { enabled: false });

  // ----- public -----
  if (p === '/api/auth/status') {
    const me = await currentUser(req);
    const count = (await users().list()).length;
    return json(200, { enabled: true, needsSetup: count === 0, user: me ? toPublic(me.user) : null });
  }

  if (p === '/api/auth/setup' && req.method === 'POST') {
    const b = await body(req);
    if ((await users().list()).length) return json(409, { error: 'Setup has already been completed. Sign in instead.' });
    if (!env('SETUP_CODE') || b.code !== env('SETUP_CODE')) {
      noteFailure(ip);
      return json(403, { error: 'That setup code is not right.' });
    }
    if (!validEmail(b.email)) return json(400, { error: 'Enter a valid email address.' });
    const problem = passwordProblem(b.password);
    if (problem) return json(400, { error: problem });
    const user: User = { email: b.email.trim().toLowerCase(), name: String(b.name || '').slice(0, 80) || undefined, role: 'admin', hash: hashPassword(b.password), createdAt: Date.now() };
    await users().set(user);
    return startSession(user, secure);
  }

  if (p === '/api/auth/login' && req.method === 'POST') {
    if (tooManyFailures(ip)) return json(429, { error: 'Too many attempts. Wait 15 minutes and try again.' });
    const b = await body(req);
    const email = String(b.email || '').trim().toLowerCase();
    const user = validEmail(email) ? await users().get(email) : null;
    const ok = user ? checkPassword(String(b.password || ''), user.hash) : checkNoUser(String(b.password || ''));
    if (!ok || !user) {
      noteFailure(ip);
      return json(401, { error: 'Email or password is incorrect.' });
    }
    return startSession(user, secure);
  }

  if (p === '/api/auth/logout' && req.method === 'POST') {
    return json(200, { ok: true }, { 'Set-Cookie': clearCookie(secure) });
  }

  // ----- signed in -----
  const me = await currentUser(req);
  if (!me) return json(401, { error: 'Please sign in.' });

  if (p === '/api/auth/me') return json(200, { user: toPublic(me.user) });

  if (p === '/api/auth/password' && req.method === 'POST') {
    const b = await body(req);
    if (!checkPassword(String(b.current || ''), me.user.hash)) return json(400, { error: 'Your current password is incorrect.' });
    const problem = passwordProblem(b.next);
    if (problem) return json(400, { error: problem });
    me.user.hash = hashPassword(b.next);
    me.user.mustChangePassword = false;
    await users().set(me.user);
    return json(200, { ok: true });
  }

  // ----- admin: team management -----
  if (p.startsWith('/api/team')) {
    if (me.user.role !== 'admin') return json(403, { error: 'Only administrators can manage the team.' });

    if (req.method === 'GET') {
      const list = (await users().list()).map(toPublic).sort((a, b) => a.email.localeCompare(b.email));
      return json(200, { users: list });
    }
    const b = await body(req);
    const email = String(b.email || '').trim().toLowerCase();
    if (!validEmail(email)) return json(400, { error: 'Enter a valid email address.' });

    if (req.method === 'POST' && p === '/api/team') {
      if (await users().get(email)) return json(409, { error: 'That person already has an account.' });
      const problem = passwordProblem(b.password);
      if (problem) return json(400, { error: problem });
      const user: User = { email, name: String(b.name || '').slice(0, 80) || undefined, role: b.role === 'admin' ? 'admin' : 'member', hash: hashPassword(b.password), createdAt: Date.now(), mustChangePassword: true };
      await users().set(user);
      return json(200, { user: toPublic(user) });
    }

    const target = await users().get(email);
    if (!target) return json(404, { error: 'No account with that email.' });

    if (req.method === 'POST' && p === '/api/team/reset') {
      const problem = passwordProblem(b.password);
      if (problem) return json(400, { error: problem });
      target.hash = hashPassword(b.password);
      target.mustChangePassword = true;
      await users().set(target);
      return json(200, { ok: true });
    }

    if (req.method === 'POST' && p === '/api/team/role') {
      const admins = (await users().list()).filter((u) => u.role === 'admin');
      if (target.role === 'admin' && b.role !== 'admin' && admins.length <= 1) return json(400, { error: 'There must be at least one administrator.' });
      target.role = b.role === 'admin' ? 'admin' : 'member';
      await users().set(target);
      return json(200, { user: toPublic(target) });
    }

    if (req.method === 'DELETE') {
      if (target.email === me.user.email) return json(400, { error: 'You cannot remove your own account.' });
      const admins = (await users().list()).filter((u) => u.role === 'admin');
      if (target.role === 'admin' && admins.length <= 1) return json(400, { error: 'There must be at least one administrator.' });
      await users().remove(email);
      return json(200, { ok: true });
    }
  }

  return json(404, { error: 'not found' });
}
