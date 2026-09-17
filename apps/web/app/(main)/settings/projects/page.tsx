import { getSession, sessionWithRole } from '../../../../lib/auth';
import { withStore } from '../../../../lib/state';
import { loadFixtures } from '@reconcile/fixtures';
import { seedFromFixtures } from '@reconcile/store';
import { createProjectAction } from '../../../../lib/actions';
import { switchProject } from '../../../../lib/auth-actions';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const session = await getSession();
  const admin = await sessionWithRole('admin');
  if (!admin)
    return (
      <main className="pt-12">
        <h1 className="text-xl font-semibold">403 — Forbidden</h1>
        <p className="mt-2 text-sm text-gray-600">Your role does not allow this page.</p>
      </main>
    );
  const projects = await withStore(async (store) => {
    await seedFromFixtures(store, loadFixtures());
    return store.listProjects();
  });
  return (
    <main>
      <h1 className="mb-4 text-xl font-semibold">Projects</h1>
      <table className="mb-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="py-1 pr-3">ID</th>
            <th className="py-1 pr-3">Name</th>
            <th className="py-1 pr-3"></th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id} className="border-b">
              <td className="py-1 pr-3 font-mono text-xs">{p.id}</td>
              <td className="py-1 pr-3">{p.name}</td>
              <td className="py-1 pr-3">
                {session?.projectId === p.id ? (
                  <span className="text-xs text-gray-500">active</span>
                ) : (
                  <form action={switchProject.bind(null, p.id)}>
                    <button className="text-xs underline">Switch</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="mb-2 font-medium">Create project</h2>
      <form
        action={async (fd: FormData) => {
          'use server';
          await createProjectAction(String(fd.get('id')), String(fd.get('name')));
        }}
        className="flex gap-2 text-sm"
      >
        <input name="id" required placeholder="project-id" className="rounded border px-2 py-1 font-mono" />
        <input name="name" placeholder="name" className="rounded border px-2 py-1" />
        <button className="rounded bg-blue-600 px-3 py-1 text-white">Create</button>
      </form>
    </main>
  );
}
