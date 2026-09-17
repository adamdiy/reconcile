import Link from 'next/link';
import '../globals.css';
import type { ReactNode } from 'react';
import { getSession } from '../../lib/auth';
import { withStore } from '../../lib/state';
import { loadFixtures } from '@reconcile/fixtures';
import { seedFromFixtures } from '@reconcile/store';
import { logout, switchProject } from '../../lib/auth-actions';
import { ensureWorkerStarted } from '../../lib/worker';

export const metadata = { title: 'Reconcile' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  await ensureWorkerStarted();
  const session = await getSession();
  const projects = session
    ? await withStore(async (store) => {
        await seedFromFixtures(store, loadFixtures());
        return store.listProjects();
      })
    : [];

  return (
    <html lang="en">
      <body className="mx-auto max-w-6xl p-6 text-gray-900">
        <header className="mb-6 flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-lg font-semibold">
              Reconcile
            </Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/">Overview</Link>
              <Link href="/incidents">Incidents</Link>
              <Link href="/runs">Runs</Link>
              <Link href="/jobs">Jobs</Link>
              <Link href="/notifications">Outbox</Link>
              <Link href="/audit">Audit</Link>
              <Link href="/metrics">Metrics</Link>
              <Link href="/setup/policy">Policy</Link>
              <Link href="/setup/exceptions">Exceptions</Link>
              <Link href="/setup/identity">Identity</Link>
              <Link href="/setup/mapping">AI mapping</Link>
              {session?.role === 'admin' && (
                <>
                  <Link href="/settings/users">Users</Link>
                  <Link href="/settings/projects">Projects</Link>
                  <Link href="/settings/notifications">Notify</Link>
                  <Link href="/settings/ai">AI</Link>
                </>
              )}
            </nav>
          </div>
          {session && (
            <div className="flex items-center gap-3 text-xs text-gray-600">
              <form action={async (fd: FormData) => {
                'use server';
                await switchProject(String(fd.get('project')));
              }}>
                <select
                  name="project"
                  defaultValue={session.projectId}
                  className="rounded border px-1 py-0.5 font-mono"
                  onChange={undefined}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id}
                    </option>
                  ))}
                </select>
                <button className="ml-1 underline">switch</button>
              </form>
              <span>
                {session.email} <span className="text-gray-400">({session.role})</span>
              </span>
              <form action={logout}>
                <button className="underline">log out</button>
              </form>
            </div>
          )}
        </header>
        {children}
      </body>
    </html>
  );
}
