import { sessionWithRole } from '../../../../lib/auth';
import { withStore } from '../../../../lib/state';
import { loadFixtures } from '@reconcile/fixtures';
import { seedFromFixtures } from '@reconcile/store';
import { createUserAction } from '../../../../lib/actions';
import { NewUserForm } from '../../../../components/NewUserForm';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const admin = await sessionWithRole('admin');
  if (!admin)
    return (
      <main className="pt-12">
        <h1 className="text-xl font-semibold">403 — Forbidden</h1>
        <p className="mt-2 text-sm text-gray-600">Your role does not allow this page.</p>
      </main>
    );
  const { users, projects } = await withStore(async (store) => {
    await seedFromFixtures(store, loadFixtures());
    return { users: await store.listUsers(), projects: await store.listProjects() };
  });
  return (
    <main>
      <h1 className="mb-4 text-xl font-semibold">Users</h1>
      <table className="mb-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="py-1 pr-3">Email</th>
            <th className="py-1 pr-3">Role</th>
            <th className="py-1 pr-3">Projects</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b">
              <td className="py-1 pr-3 font-mono text-xs">{u.email}</td>
              <td className="py-1 pr-3">{u.role}</td>
              <td className="py-1 pr-3 font-mono text-xs">{u.projectIds.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="mb-2 font-medium">Add user</h2>
      <NewUserForm projects={projects.map((p) => p.id)} action={createUserAction} />
    </main>
  );
}
