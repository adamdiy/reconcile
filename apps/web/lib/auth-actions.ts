'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createStore, seedFromFixtures } from '@reconcile/store';
import { loadFixtures } from '@reconcile/fixtures';
import { SESSION_COOKIE, signProjectSwitch, signSession, verifyPassword, requireSession } from './auth';

export async function login(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const store = createStore();
  try {
    await store.migrate();
    await seedFromFixtures(store, loadFixtures());
    const user = await store.getUserByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash))
      redirect('/login?error=invalid+credentials');
    const projectId = user.projectIds[0] ?? 'default';
    const jar = await cookies();
    jar.set(SESSION_COOKIE, signSession({ userId: user.id, email: user.email, role: user.role, projectId }), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
  } finally {
    await store.close();
  }
  redirect('/');
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}

export async function switchProject(projectId: string): Promise<void> {
  const session = await requireSession();
  const store = createStore();
  try {
    await store.migrate();
    const user = await store.getUserByEmail(session.email);
    if (!user || (!user.projectIds.includes(projectId) && session.role !== 'admin'))
      throw new Error('not a member of that project');
    const projects = await store.listProjects();
    if (!projects.some((p) => p.id === projectId)) throw new Error('unknown project');
    (await cookies()).set(SESSION_COOKIE, signProjectSwitch(session, projectId), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
  } finally {
    await store.close();
  }
  redirect('/');
}
