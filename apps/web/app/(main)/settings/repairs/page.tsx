import { getSession } from '../../../../lib/auth';
import { withProject } from '../../../../lib/state';
import { deleteRepairCommand, upsertRepairCommand } from '../../../../lib/repair-actions';
import { RepairCommandForm } from '../../../../components/RepairCommandForm';

export const dynamic = 'force-dynamic';

export default async function RepairsSettingsPage() {
  const session = await getSession();
  if (session?.role !== 'admin') {
    return (
      <main>
        <h1 className="text-xl font-semibold">403</h1>
        <p className="mt-2 text-sm text-gray-600">repair commands are admin-managed.</p>
      </main>
    );
  }
  const commands = await withProject(session.projectId, async (_s, ps) => ps.listRepairCommands());
  return (
    <main>
      <h1 className="text-xl font-semibold">Repair commands</h1>
      <p className="mt-1 text-sm text-gray-600">
        Commands are the customer's own endpoints (or the demo local outbox). Reconcile calls
        them only after a reviewer proposes and a different admin approves.
      </p>
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500">
            <th>id</th>
            <th>name</th>
            <th>kind</th>
            <th>capabilities</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {commands.map((c) => (
            <tr key={c.id} className="border-t">
              <td className="py-1 font-mono text-xs">{c.id}</td>
              <td className="py-1">{c.name}</td>
              <td className="py-1 font-mono text-xs">{c.kind}</td>
              <td className="py-1 font-mono text-xs">{c.capabilities.join(', ')}</td>
              <td className="py-1">
                <form action={deleteRepairCommand.bind(null, c.id)}>
                  <button className="text-xs underline text-red-600">delete</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="mb-2 mt-6 font-medium">Add command</h2>
      <RepairCommandForm action={upsertRepairCommand} />
    </main>
  );
}
