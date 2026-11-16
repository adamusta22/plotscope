import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Load ANTHROPIC_API_KEY etc. from .env if present (Node 21.7+)
try { process.loadEnvFile('.env'); } catch { /* no .env file */ }

import Anthropic from '@anthropic-ai/sdk';
import { runAgent } from './agent';
import { pricePaid } from '../src/lib/api';
import { localPlanFor } from '../src/lib/localplan';
import type { AgentEvent } from '../src/lib/agentTypes';

const PORT = Number(process.env.PORT || 8787);
const DIST = path.resolve(process.cwd(), 'dist');
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const AGENT_PER_HOUR = Number(process.env.AGENT_REQUESTS_PER_HOUR || 30);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.map': 'application/json',
};

/** Serve the built web app (production). Unknown paths fall back to index.html. */
function serveStatic(pathname: string, res: http.ServerResponse) {
  let file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
  if (!file.startsWith(DIST)) return json(res, 403, { error: 'forbidden' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) return json(res, 404, { error: 'Web app not built. Run npm run build.' });
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

/** Optional site-wide password (HTTP Basic auth, any username). */
function authorised(req: http.IncomingMessage) {
  if (!APP_PASSWORD) return true;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const pass = Buffer.from(h.slice(6), 'base64').toString().split(':').slice(1).join(':');
  const a = Buffer.from(pass), b = Buffer.from(APP_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Simple per-IP hourly limit on AI requests, to cap spend. */
const hits = new Map<string, number[]>();
function rateLimited(req: http.IncomingMessage) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3_600_000);
  if (list.length >= AGENT_PER_HOUR) return true;
  list.push(now);
  hits.set(ip, list);
  return false;
}

function readJson(req: http.IncomingMessage, limit = 2_000_000): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) reject(new Error('Body too large'));
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError || (!(err instanceof Anthropic.APIError) && /authentication method/.test(String((err as Error)?.message)))) return 'The AI assistant is not configured: set ANTHROPIC_API_KEY on the server.';
  if (err instanceof Anthropic.RateLimitError) return 'The AI service is busy (rate limited). Try again in a moment.';
  if (err instanceof Anthropic.BadRequestError) return `The AI request was rejected: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the AI service.';
  if (err instanceof Anthropic.APIError) return `AI service error ${err.status}.`;
  return (err as Error)?.message || 'Unexpected error';
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (!authorised(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Plotscope", charset="UTF-8"' });
    return res.end('Password required');
  }
  try {
    if (url.pathname === '/api/health') {
      return json(res, 200, { ok: true, ai: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) });
    }

    if (url.pathname === '/api/price-paid') {
      const pcs = (url.searchParams.get('postcodes') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 40);
      return json(res, 200, await pricePaid(pcs, Number(url.searchParams.get('since')) || undefined));
    }

    if (url.pathname === '/api/local-plan') {
      return json(res, 200, await localPlanFor(url.searchParams.get('lpa') || ''));
    }

    if (url.pathname === '/api/agent' && req.method === 'POST') {
      const body = await readJson(req);
      if (rateLimited(req)) return json(res, 429, { error: 'Hourly AI limit reached. Try again later.' });
      if (!Array.isArray(body.messages) || !body.messages.length) return json(res, 400, { error: 'messages required' });
      const history = body.messages
        .filter((m: any) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
        .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 20000) }));
      if (history[history.length - 1]?.role !== 'user') return json(res, 400, { error: 'last message must be from the user' });

      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      const ac = new AbortController();
      res.on('close', () => ac.abort());
      const emit = (e: AgentEvent) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`); };
      try {
        await runAgent(history, body.context || {}, emit, ac.signal);
        emit({ type: 'done' });
      } catch (err) {
        if (!ac.signal.aborted) {
          console.error('[agent]', err);
          emit({ type: 'error', message: describeError(err) });
        }
      }
      return res.end();
    }

    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(url.pathname, res);
    json(res, 405, { error: 'method not allowed' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: describeError(err) });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`Plotscope API on http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) console.log('  ! ANTHROPIC_API_KEY not set: the AI assistant will be unavailable until it is.');
});
