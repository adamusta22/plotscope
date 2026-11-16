import { useEffect, useRef, useState } from 'react';
import type { AgentAction, AgentContext, AgentEvent } from '../lib/agentTypes';
import { Icon } from './Icon';

/** Raw API conversation (with tool calls and results), kept across panel switches. */
let agentState: unknown[] = [];
const MAX_STEPS = 25;

export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  tools?: { id: string; label: string; done: boolean }[];
  error?: string;
  pending?: boolean;
}

interface Props {
  chat: ChatMsg[];
  setChat: (f: (c: ChatMsg[]) => ChatMsg[]) => void;
  context: () => AgentContext;
  onAction: (a: AgentAction) => void;
  hasSelection: boolean;
  seed?: string | null;
  clearSeed: () => void;
}

export function AgentPanel({ chat, setChat, context, onAction, hasSelection, seed, clearSeed }: Props) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const ac = useRef<AbortController>();
  const inFlight = useRef(false);
  const seedSent = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then((j) => setAiReady(!!j.ai)).catch(() => setAiReady(false));
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [chat]);

  useEffect(() => {
    if (seed && seedSent.current !== seed) {
      seedSent.current = seed;
      clearSeed();
      send(seed);
    }
  }, [seed]);

  const patchLast = (f: (m: ChatMsg) => ChatMsg) => setChat((c) => [...c.slice(0, -1), f(c[c.length - 1])]);

  async function send(text: string) {
    text = text.trim();
    if (!text || inFlight.current) return;
    inFlight.current = true;
    setChat((c) => [...c, { role: 'user', content: text }, { role: 'assistant', content: '', tools: [], pending: true }]);
    setInput('');
    setBusy(true);
    ac.current = new AbortController();
    const notRunning = 'The Plotscope server is not reachable. Locally, start it with `npm run dev`.';
    try {
      // The server runs one model step per request (keeps each request short
      // enough for serverless hosts); we loop until the answer is complete.
      let question: string | undefined = text;
      for (let step = 0; step < MAX_STEPS; step++) {
        const payload = JSON.stringify({ state: agentState, question, context: context() });
        if (payload.length > 4_500_000) throw new Error('This conversation has got too long. Click **New conversation** to carry on.');
        const r = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, signal: ac.current.signal });
        if (!r.ok || !r.body) {
          const msg = await r.json().then((j) => j.error).catch(() => null);
          throw new Error(r.status === 429 ? 'You have hit the hourly AI limit. Try again later.' : r.status === 404 || r.status === 502 || r.status === 504 ? notRunning : msg || `Request failed (${r.status})`);
        }
        question = undefined;
        let finished = true;
        let gotStep = false;
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 2);
            if (!line.startsWith('data:')) continue;
            const ev = JSON.parse(line.slice(5)) as AgentEvent;
            if (ev.type === 'text') patchLast((m) => ({ ...m, content: m.content + ev.text }));
            else if (ev.type === 'thinking') patchLast((m) => ({ ...m, thinking: (m.thinking || '') + ev.text }));
            else if (ev.type === 'tool') patchLast((m) => ({ ...m, tools: [...(m.tools || []).filter((t) => t.id !== ev.id), { id: ev.id, label: ev.label, done: false }] }));
            else if (ev.type === 'tool_done') patchLast((m) => ({ ...m, tools: (m.tools || []).map((t) => (t.id === ev.id ? { ...t, done: true } : t)) }));
            else if (ev.type === 'action') onAction(ev.action);
            else if (ev.type === 'step') { agentState = ev.messages; finished = ev.done; gotStep = true; }
            else if (ev.type === 'error') { patchLast((m) => ({ ...m, error: ev.message })); finished = true; gotStep = true; }
          }
        }
        if (!gotStep) throw new Error('The connection dropped before the step finished (the host may have timed out). Try again or ask a narrower question.');
        if (finished) break;
        if (step === MAX_STEPS - 1) patchLast((m) => ({ ...m, error: 'Stopped after many steps. Ask a follow-up to continue.' }));
        // keep separate steps' text readable
        patchLast((m) => (m.content && !m.content.endsWith('\n') ? { ...m, content: m.content + '\n\n' } : m));
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') patchLast((m) => ({ ...m, error: (e as Error).message === 'Failed to fetch' ? notRunning : (e as Error).message }));
    } finally {
      patchLast((m) => ({ ...m, pending: false, tools: (m.tools || []).map((t) => ({ ...t, done: true })) }));
      setBusy(false);
      inFlight.current = false;
    }
  }

  const suggestions = hasSelection
    ? ['What does planning policy say about developing this site?', 'Find the local plan and relevant SPDs for this council', 'How many homes could this site take, and what is the land worth?', 'What evidence would I need for a planning application here?']
    : ['Find brownfield sites over 0.5 ha in the area on my map', 'Explain grey belt under the 2026 NPPF', 'Which councils near here lack a 5-year housing land supply?', 'Take me to Milton Keynes and switch on Green Belt and flood zones'];

  return (
    <div className="agent">
      <div className="agent-scroll" ref={scroller}>
        {chat.length === 0 && (
          <div className="agent-intro">
            <div className="agent-badge"><Icon name="spark" size={22} /></div>
            <h3>Planning assistant</h3>
            <p className="muted">
              Ask about any site. I can check constraints, read the NPPF, find the council's local plan and SPDs, search brownfield registers, pull sold prices, run appraisals and move the map for you.
            </p>
            {aiReady === false && (
              <div className="callout bad small">The AI server isn't available. Run <code>npm run dev</code> with <code>ANTHROPIC_API_KEY</code> set.</div>
            )}
          </div>
        )}
        {chat.map((m, i) => (
          <div key={i} className={'msg ' + m.role}>
            {m.role === 'assistant' && (m.tools?.length || m.thinking) ? (
              <div className="steps">
                {m.thinking && (
                  <details className="thinking">
                    <summary>Reasoning</summary>
                    <p>{m.thinking}</p>
                  </details>
                )}
                {m.tools?.map((t) => (
                  <div key={t.id} className={'step' + (t.done ? ' done' : '')}>
                    {t.done ? <Icon name="check" size={13} /> : <span className="spinner sm" />}
                    {t.label}
                  </div>
                ))}
              </div>
            ) : null}
            {m.content ? <div className="bubble" dangerouslySetInnerHTML={{ __html: m.role === 'assistant' ? md(m.content) : esc(m.content) }} /> : m.pending ? <div className="typing"><i /><i /><i /></div> : null}
            {m.error && <div className="callout bad small" dangerouslySetInnerHTML={{ __html: md(m.error) }} />}
          </div>
        ))}
      </div>

      {chat.length === 0 || !busy ? (
        <div className="suggest">
          {(chat.length ? suggestions.slice(0, 2) : suggestions).map((s) => (
            <button key={s} className="chip" onClick={() => send(s)} disabled={busy}>{s}</button>
          ))}
        </div>
      ) : null}

      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <textarea
          className="input"
          rows={2}
          value={input}
          placeholder={hasSelection ? 'Ask about this site…' : 'Ask about planning, policy or land…'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
        />
        {busy ? (
          <button type="button" className="btn" onClick={() => ac.current?.abort()}>Stop</button>
        ) : (
          <button className="btn primary" disabled={!input.trim()} aria-label="Send"><Icon name="send" size={16} /></button>
        )}
      </form>
      {chat.length > 0 && !busy && <button className="link small clear-chat" onClick={() => { agentState = []; setChat(() => []); }}>New conversation</button>}
    </div>
  );
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Minimal, safe markdown: headings, lists, bold, italics, code, links (http/https only). */
export function md(src: string) {
  const inline = (s: string) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
      .replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, '$1<i>$2</i>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of src.split('\n')) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^#{1,4}\s+(.*)/))) { close(); out.push(`<h5>${inline(m[1])}</h5>`); }
    else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if (!line.trim()) close();
    else { close(); out.push(`<p>${inline(line)}</p>`); }
  }
  close();
  return out.join('');
}
