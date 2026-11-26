import { useEffect, useState } from 'react';
import { Icon } from './Icon';

export interface Me {
  email: string;
  name?: string;
  role: 'admin' | 'member';
  lastLoginAt?: number;
  createdAt: number;
  mustChangePassword?: boolean;
}

async function api(path: string, method = 'GET', body?: unknown) {
  const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}

export const initials = (u: Me) => (u.name || u.email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join('');

/** Generates a readable temporary password, e.g. "plot-river-4821-oak". */
function tempPassword() {
  const words = ['plot', 'river', 'oak', 'field', 'stone', 'brook', 'hill', 'lane', 'acre', 'ridge', 'meadow', 'cedar', 'harbour', 'orchard'];
  const pick = () => words[crypto.getRandomValues(new Uint32Array(1))[0] % words.length];
  const num = (crypto.getRandomValues(new Uint32Array(1))[0] % 9000) + 1000;
  return `${pick()}-${pick()}-${num}-${pick()}`;
}

export function AccountMenu({ me, onClose, onTeam, onPassword }: { me: Me; onClose: () => void; onTeam: () => void; onPassword: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <>
      <div className="menu-backdrop" onClick={onClose} />
      <div className="account-menu" role="menu">
        <div className="am-head">
          <span className="avatar lg">{initials(me)}</span>
          <div>
            <b>{me.name || me.email}</b>
            <span>{me.name ? me.email : ''}{me.role === 'admin' ? `${me.name ? ' · ' : ''}Administrator` : ''}</span>
          </div>
        </div>
        {me.role === 'admin' && (
          <button role="menuitem" onClick={onTeam}><Icon name="user" size={16} /> Team &amp; access</button>
        )}
        <button role="menuitem" onClick={onPassword}><Icon name="keyboard" size={16} /> Change password</button>
        <button
          role="menuitem"
          className="danger"
          onClick={async () => {
            await api('/api/auth/logout', 'POST').catch(() => {});
            location.replace('/login');
          }}
        >
          <Icon name="external" size={16} /> Sign out
        </button>
      </div>
    </>
  );
}

export function PasswordDialog({ onClose, toast }: { onClose: () => void; toast: (t: string) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-bg" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr('');
          try {
            await api('/api/auth/password', 'POST', { current, next });
            toast('Password changed');
            onClose();
          } catch (ex) {
            setErr((ex as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h3>Change password</h3>
        <label>Current password<input id="pw-current" className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
        <label>New password<input id="pw-next" className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></label>
        <p className="muted small">At least 10 characters, with letters and numbers or symbols.</p>
        {err && <div className="callout bad">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !current || !next}>Save password</button>
        </div>
      </form>
    </div>
  );
}

export function TeamPanel({ me, onClose, toast }: { me: Me; onClose: () => void; toast: (t: string) => void }) {
  const [list, setList] = useState<Me[] | null>(null);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ name: '', email: '', role: 'member' as 'member' | 'admin', password: tempPassword() });
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const load = () => api('/api/team').then((j) => setList(j.users)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setErr('');
    try {
      await fn();
      toast(ok);
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => toast('Copied')).catch(() => {});

  return (
    <div className="board-overlay team">
      <header className="board-head">
        <div>
          <h2>Team &amp; access</h2>
          <p className="muted">Everyone who can sign in to Plotscope. New people get a temporary password and choose their own when they first sign in.</p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
      </header>
      <div className="team-body">
        <section className="team-add">
          <h3>Add a person</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const { email, password } = form;
              run(async () => {
                await api('/api/team', 'POST', form);
                setIssued({ email, password });
                setForm({ name: '', email: '', role: 'member', password: tempPassword() });
              }, `Added ${email}`);
            }}
          >
            <label>Name<input id="team-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jane Smith" /></label>
            <label>Email<input id="team-email" className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@company.co.uk" /></label>
            <label>Access
              <select id="team-role" className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'member' | 'admin' })}>
                <option value="member">Member: use Plotscope</option>
                <option value="admin">Administrator: also manage the team</option>
              </select>
            </label>
            <label>Temporary password
              <div className="row">
                <input id="team-pw" className="input mono" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                <button type="button" className="btn" onClick={() => setForm({ ...form, password: tempPassword() })} title="Generate another">New</button>
              </div>
            </label>
            <button className="btn primary block" disabled={!form.email}>Add person</button>
          </form>
          {issued && (
            <div className="issued">
              <b>Send these sign-in details to {issued.email}</b>
              <code>{`Sign in at ${location.origin}/login\nEmail: ${issued.email}\nTemporary password: ${issued.password}`}</code>
              <button className="btn sm" onClick={() => copy(`Sign in to Plotscope at ${location.origin}/login\nEmail: ${issued.email}\nTemporary password: ${issued.password}\nYou'll choose your own password when you first sign in.`)}>Copy message</button>
              <span className="muted small">This password is shown once. Send it privately (not in a group chat).</span>
            </div>
          )}
        </section>

        <section className="team-list">
          <h3>People {list && <span className="muted">({list.length})</span>}</h3>
          {err && <div className="callout bad">{err}</div>}
          {!list && !err && <div className="skeleton"><i /><i /><i /></div>}
          <ul>
            {list?.map((u) => (
              <li key={u.email}>
                <span className="avatar">{initials(u)}</span>
                <div className="who">
                  <b>{u.name || u.email}{u.email === me.email && <em className="tag">You</em>}</b>
                  <span>{u.name ? `${u.email} · ` : ''}{u.lastLoginAt ? `Last signed in ${new Date(u.lastLoginAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Not signed in yet'}{u.mustChangePassword ? ' · Temporary password' : ''}</span>
                </div>
                <select className="input sm" aria-label={`Access for ${u.email}`} value={u.role} disabled={u.email === me.email} onChange={(e) => run(() => api('/api/team/role', 'POST', { email: u.email, role: e.target.value }), 'Access updated')}>
                  <option value="member">Member</option>
                  <option value="admin">Administrator</option>
                </select>
                {u.email !== me.email && (
                  confirm === u.email ? (
                    <span className="row">
                      <button className="btn sm danger" onClick={() => { setConfirm(null); run(() => api('/api/team', 'DELETE', { email: u.email }), `Removed ${u.email}`); }}>Remove</button>
                      <button className="btn sm ghost" onClick={() => setConfirm(null)}>Keep</button>
                    </span>
                  ) : (
                    <span className="row">
                      <button className="btn sm ghost" onClick={() => {
                        const pw = tempPassword();
                        run(async () => { await api('/api/team/reset', 'POST', { email: u.email, password: pw }); setIssued({ email: u.email, password: pw }); }, `Password reset for ${u.email}`);
                      }}>Reset password</button>
                      <button className="btn sm ghost danger" onClick={() => setConfirm(u.email)}>Remove…</button>
                    </span>
                  )
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
