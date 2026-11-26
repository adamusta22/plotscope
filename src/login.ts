import './login.css';

type Mode = 'login' | 'setup' | 'change';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = $<HTMLFormElement>('form');
const err = $<HTMLParagraphElement>('error');
const submit = $<HTMLButtonElement>('submit');
let mode: Mode = 'login';
let currentPassword = '';

const next = (() => {
  const n = new URLSearchParams(location.search).get('next') || '/';
  return n.startsWith('/') && !n.startsWith('//') ? n : '/';
})();

function setMode(m: Mode) {
  mode = m;
  $('setup-fields').hidden = m !== 'setup';
  $('login-fields').hidden = m === 'change';
  $('change-fields').hidden = m !== 'change';
  $('footer').hidden = m !== 'login';
  $('heading').textContent = m === 'setup' ? 'Set up Plotscope' : m === 'change' ? 'Choose your password' : 'Sign in';
  $('pw-meter').hidden = m !== 'setup';
  $('intro').textContent =
    m === 'setup' ? 'Create the administrator account. You can add the rest of your team once you are in.' :
    m === 'change' ? 'You signed in with a temporary password. Choose your own to carry on.' :
    'Use the email and password your administrator gave you.';
  $('submit-label').textContent = m === 'setup' ? 'Create account' : m === 'change' ? 'Save password' : 'Sign in';
  ($<HTMLInputElement>('password')).autocomplete = m === 'setup' ? 'new-password' : 'current-password';
  (m === 'setup' ? $<HTMLInputElement>('code') : m === 'change' ? $<HTMLInputElement>('newpw') : $<HTMLInputElement>('email')).focus();
}

function showError(msg: string) {
  err.textContent = msg;
  err.hidden = !msg;
}

async function post(path: string, body: unknown) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Something went wrong (${r.status}).`);
  return j;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');
  submit.disabled = true;
  const email = $<HTMLInputElement>('email').value.trim();
  const password = $<HTMLInputElement>('password').value;
  try {
    if (mode === 'change') {
      await post('/api/auth/password', { current: currentPassword, next: $<HTMLInputElement>('newpw').value });
      location.replace(next);
      return;
    }
    if (!email || !password) throw new Error('Enter your email and password.');
    const res = mode === 'setup'
      ? await post('/api/auth/setup', { code: $<HTMLInputElement>('code').value.trim(), name: $<HTMLInputElement>('name').value.trim(), email, password })
      : await post('/api/auth/login', { email, password });
    if (res.user?.mustChangePassword) {
      currentPassword = password;
      setMode('change');
    } else {
      location.replace(next);
    }
  } catch (ex) {
    showError((ex as Error).message);
  } finally {
    submit.disabled = false;
  }
});

/** Live checks against the server's password rules (10+ characters, letters plus a number or symbol). */
function meter(input: string, len: string, mix: string) {
  const el = $<HTMLInputElement>(input);
  const update = () => {
    const v = el.value;
    $(len).classList.toggle('ok', v.length >= 10);
    $(mix).classList.toggle('ok', /[a-zA-Z]/.test(v) && /[^a-zA-Z]/.test(v));
  };
  el.addEventListener('input', update);
  update();
}
meter('password', 'rule-len', 'rule-mix');
meter('newpw', 'newrule-len', 'newrule-mix');

document.querySelectorAll<HTMLButtonElement>('.show').forEach((b) =>
  b.addEventListener('click', () => {
    const input = $<HTMLInputElement>(b.dataset.for!);
    input.type = input.type === 'password' ? 'text' : 'password';
    b.textContent = input.type === 'password' ? 'Show' : 'Hide';
    b.setAttribute('aria-label', input.type === 'password' ? 'Show password' : 'Hide password');
  }),
);

fetch('/api/auth/status', { credentials: 'same-origin' })
  .then((r) => r.json())
  .then((s) => {
    if (s.user && !s.user.mustChangePassword) return location.replace(next);
    if (s.enabled === false) return location.replace('/');
    setMode(s.needsSetup ? 'setup' : 'login');
  })
  .catch(() => setMode('login'));
