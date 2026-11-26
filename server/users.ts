// User accounts. Stored in Netlify Blobs when running on Netlify, otherwise in
// a local JSON file (.data/users.json). Passwords are hashed with scrypt.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getStore } from '@netlify/blobs';

export interface User {
  email: string;
  name?: string;
  role: 'admin' | 'member';
  hash: string; // scrypt$N$salt$hash
  createdAt: number;
  lastLoginAt?: number;
  mustChangePassword?: boolean;
}
export type PublicUser = Omit<User, 'hash'>;

interface Store {
  get(email: string): Promise<User | null>;
  set(u: User): Promise<void>;
  remove(email: string): Promise<void>;
  list(): Promise<User[]>;
}

const key = (email: string) => `user/${encodeURIComponent(email.toLowerCase())}`;

function blobStore(): Store {
  const s = getStore({ name: 'plotscope-users', consistency: 'strong' });
  return {
    get: async (e) => ((await s.get(key(e), { type: 'json' })) as User | null) ?? null,
    set: (u) => s.setJSON(key(u.email), u),
    remove: (e) => s.delete(key(e)),
    list: async () => {
      const { blobs } = await s.list({ prefix: 'user/' });
      const all = await Promise.all(blobs.map((b) => s.get(b.key, { type: 'json' }) as Promise<User | null>));
      return all.filter((u): u is User => !!u);
    },
  };
}

function fileStore(): Store {
  const file = path.resolve(process.cwd(), '.data/users.json');
  const read = (): Record<string, User> => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  };
  const write = (all: Record<string, User>) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(all, null, 2));
  };
  return {
    get: async (e) => read()[e.toLowerCase()] ?? null,
    set: async (u) => { const a = read(); a[u.email.toLowerCase()] = u; write(a); },
    remove: async (e) => { const a = read(); delete a[e.toLowerCase()]; write(a); },
    list: async () => Object.values(read()),
  };
}

let store: Store | null = null;
export function users(): Store {
  if (!store) {
    const onNetlify = !!(process.env.NETLIFY || process.env.NETLIFY_BLOBS_CONTEXT || (globalThis as any).Netlify);
    store = onNetlify ? blobStore() : fileStore();
  }
  return store;
}

// ---------- passwords ----------
const N = 16384;
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32, { N, r: 8, p: 1 });
  return `scrypt$${N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function checkPassword(password: string, stored: string): boolean {
  const [alg, n, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const want = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(password, Buffer.from(salt, 'base64'), want.length, { N: Number(n), r: 8, p: 1 });
  return crypto.timingSafeEqual(want, got);
}

/** Same work as a real check, so unknown emails can't be detected by timing. */
const DUMMY = hashPassword('not-a-real-password');
export function checkNoUser(password: string) {
  checkPassword(password, DUMMY);
  return false;
}

export function passwordProblem(p: unknown): string | null {
  if (typeof p !== 'string' || p.length < 10) return 'Use at least 10 characters.';
  if (p.length > 200) return 'That password is too long.';
  if (!/[a-zA-Z]/.test(p) || !/[^a-zA-Z]/.test(p)) return 'Mix letters with numbers or symbols.';
  return null;
}

export const validEmail = (e: unknown): e is string => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length < 200;

export function toPublic(u: User): PublicUser {
  const { hash: _hash, ...rest } = u;
  return rest;
}
