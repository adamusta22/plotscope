// Local / self-hosted server: serves the built web app and the API.
// On Netlify this file is not used — see netlify/functions/api.mts.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

// Load ANTHROPIC_API_KEY etc. from .env if present (Node 21.7+)
try { process.loadEnvFile('.env'); } catch { /* no .env file */ }

const { handle } = await import('./handler');

const PORT = Number(process.env.PORT || 8787);
const DIST = path.resolve(process.cwd(), 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.map': 'application/json',
};

function serveStatic(pathname: string, res: http.ServerResponse) {
  let file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('Web app not built. Run npm run build.'); }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

const { isPublicPath, readCookie, verifySession } = await import('./session');

/** Same front-door rule as the Netlify edge function (netlify/edge-functions/auth.ts). */
async function signedIn(req: http.IncomingMessage) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return true;
  return !!(await verifySession(readCookie(req.headers.cookie), secret));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const open = isPublicPath(url.pathname) || url.pathname.startsWith('/assets/');
  if (!open && !(await signedIn(req))) {
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/lr/')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Please sign in.' }));
    }
    res.writeHead(302, { Location: `/login${url.pathname === '/' ? '' : `?next=${encodeURIComponent(url.pathname + url.search)}`}` });
    return res.end();
  }
  if (!url.pathname.startsWith('/api/')) {
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(url.pathname === '/login' ? '/login.html' : url.pathname, res);
    res.writeHead(405);
    return res.end();
  }
  // Adapt Node request -> standard Request, and the Response back.
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const request = new Request(url, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    signal: ac.signal,
    // @ts-expect-error Node needs duplex for streamed request bodies
    duplex: 'half',
  });
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const response = await handle(request, ip);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (!response.body) return res.end();
  Readable.fromWeb(response.body as any).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Plotscope server on http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) console.log('  ! ANTHROPIC_API_KEY not set: the AI assistant will be unavailable until it is.');
});
