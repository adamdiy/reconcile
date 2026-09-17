import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { UserRole } from '@reconcile/domain';

export const SESSION_COOKIE = 'reconcile_session';
const TTL_MS = 7 * 24 * 3600 * 1000;

export interface Session {
  userId: string;
  email: string;
  role: UserRole;
  projectId: string;
  exp: number;
}

export function sessionSecret(): string {
  const s = process.env.RECONCILE_SESSION_SECRET;
  if (!s) {
    console.warn('RECONCILE_SESSION_SECRET is unset; using an insecure dev default');
    return 'reconcile-dev-secret';
  }
  return s;
}

export function signSession(s: Omit<Session, 'exp'>): string {
  const payload = Buffer.from(JSON.stringify({ ...s, exp: Date.now() + TTL_MS })).toString('base64url');
  const sig = createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function parseSessionCookie(value: string | undefined): Session | null {
  if (!value) return null;
  const [payload, sig] = value.split('.');
  if (!payload || !sig) return null;
  const expect = createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session;
    if (!s.exp || s.exp < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  try {
    const store = await cookies();
    return parseSessionCookie(store.get(SESSION_COOKIE)?.value);
  } catch {
    return null; // outside request scope (tests, CLI)
  }
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect('/login');
  return s;
}

const ROLE_RANK: Record<UserRole, number> = { viewer: 0, reviewer: 1, admin: 2 };

/** Like requireRole but returns the session or null (for rendering a 403 page). */
export async function sessionWithRole(min: UserRole): Promise<Session | null> {
  const s = await getSession();
  if (!s || ROLE_RANK[s.role] < ROLE_RANK[min]) return null;
  return s;
}

export async function requireRole(min: UserRole): Promise<Session> {
  const s = await requireSession();
  if (ROLE_RANK[s.role] < ROLE_RANK[min]) throw new Error('forbidden');
  return s;
}

export function verifyPassword(password: string, passwordHash: string): boolean {
  const [salt, hash] = passwordHash.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 32).toString('hex');
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));
}

/** Re-seal an existing session with a different active project. */
export function signProjectSwitch(s: Session, projectId: string): string {
  return signSession({ userId: s.userId, email: s.email, role: s.role, projectId });
}
