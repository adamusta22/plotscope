// Front door: every page and API call needs a signed-in session, except the
// login page itself. Sign-in is switched on by the SESSION_SECRET variable.
import { isPublicPath, readCookie, verifySession } from '../../server/session.ts';

declare const Netlify: { env: { get(key: string): string | undefined } };

export default async (req: Request, context: { next: () => Promise<Response> }) => {
  const secret = Netlify.env.get('SESSION_SECRET');
  if (!secret) return context.next();
  const url = new URL(req.url);
  if (isPublicPath(url.pathname) || url.pathname.startsWith('/assets/')) return context.next();
  const session = await verifySession(readCookie(req.headers.get('cookie')), secret);
  if (session) return context.next();
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/lr/')) {
    return new Response(JSON.stringify({ error: 'Please sign in.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const next = url.pathname === '/' ? '' : `?next=${encodeURIComponent(url.pathname + url.search)}`;
  return Response.redirect(new URL(`/login${next}`, url), 302);
};

export const config = { path: '/*' };
