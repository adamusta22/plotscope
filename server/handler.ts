// Platform-neutral API handler (standard Request -> Response).
// Used by the Netlify function (netlify/functions/api.mts) and by the local
// Node server (server/index.ts).
import Anthropic from '@anthropic-ai/sdk';
import { runAgentStep } from './agent';
import { pricePaid } from '../src/lib/api';
import { localPlanFor } from '../src/lib/localplan';
import type { AgentEvent } from '../src/lib/agentTypes';

const env = (k: string) => (typeof process !== 'undefined' ? process.env[k] : undefined);
const MAX_BODY = 5_000_000;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError || (!(err instanceof Anthropic.APIError) && /authentication method/.test(String((err as Error)?.message)))) return 'The AI assistant is not configured: set ANTHROPIC_API_KEY in the site settings.';
  if (err instanceof Anthropic.RateLimitError) return 'The AI service is busy (rate limited). Try again in a moment.';
  if (err instanceof Anthropic.BadRequestError) return `The AI request was rejected: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the AI service.';
  if (err instanceof Anthropic.APIError) return `AI service error ${err.status}.`;
  return (err as Error)?.message || 'Unexpected error';
}

/**
 * Best-effort per-visitor limit on new AI questions. Serverless instances
 * don't share memory, so treat this as a speed bump: the real cap is the
 * monthly spend limit you set in the Anthropic Console.
 */
const hits = new Map<string, number[]>();
function rateLimited(ip: string) {
  const perHour = Number(env('AGENT_REQUESTS_PER_HOUR') || 30);
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3_600_000);
  if (list.length >= perHour) return true;
  list.push(now);
  hits.set(ip, list);
  return false;
}

export async function handle(req: Request, clientIp = 'unknown'): Promise<Response> {
  const url = new URL(req.url);
  try {
    if (url.pathname === '/api/health') {
      return json(200, { ok: true, ai: Boolean(env('ANTHROPIC_API_KEY') || env('ANTHROPIC_AUTH_TOKEN')) });
    }

    if (url.pathname === '/api/price-paid') {
      const pcs = (url.searchParams.get('postcodes') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 40);
      return json(200, await pricePaid(pcs, Number(url.searchParams.get('since')) || undefined));
    }

    if (url.pathname === '/api/local-plan') {
      return json(200, await localPlanFor(url.searchParams.get('lpa') || ''));
    }

    if (url.pathname === '/api/agent' && req.method === 'POST') {
      const text = await req.text();
      if (text.length > MAX_BODY) return json(413, { error: 'Conversation too long. Start a new conversation.' });
      const body = JSON.parse(text || '{}');
      const state = Array.isArray(body.state) ? body.state : [];
      const question = typeof body.question === 'string' ? body.question.trim().slice(0, 20000) : undefined;
      if (!question && !state.length) return json(400, { error: 'question required' });
      if (question && rateLimited(clientIp)) return json(429, { error: 'Hourly AI limit reached. Try again later.' });

      const enc = new TextEncoder();
      const ac = new AbortController();
      req.signal?.addEventListener('abort', () => ac.abort());
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const emit = (e: AgentEvent) => {
            try { controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { /* client gone */ }
          };
          try {
            const r = await runAgentStep({ state, question, context: body.context || {} }, emit, ac.signal);
            emit({ type: 'step', messages: r.messages, done: r.done });
          } catch (err) {
            if (!ac.signal.aborted) {
              console.error('[agent]', err);
              emit({ type: 'error', message: describeError(err) });
            }
          }
          try { controller.close(); } catch { /* already closed */ }
        },
        cancel() { ac.abort(); },
      });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' } });
    }

    return json(404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    return json(500, { error: describeError(err) });
  }
}
