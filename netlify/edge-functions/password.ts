// Optional site-wide password. Set APP_PASSWORD in Netlify's environment
// variables to turn it on (any username works); leave it unset for a public site.
// Runs at the edge before the website and the API, on every Netlify plan.
declare const Netlify: { env: { get(key: string): string | undefined } };

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default async (req: Request, context: { next: () => Promise<Response> }) => {
  const password = Netlify.env.get('APP_PASSWORD');
  if (!password) return context.next();
  const header = req.headers.get('authorization') || '';
  if (header.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6));
      const given = decoded.slice(decoded.indexOf(':') + 1);
      if (safeEqual(given, password)) return context.next();
    } catch {
      /* malformed header */
    }
  }
  return new Response('Password required', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Plotscope", charset="UTF-8"' } });
};

export const config = { path: '/*' };
