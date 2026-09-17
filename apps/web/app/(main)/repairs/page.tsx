import Link from 'next/link';
import { getSession } from '../../../lib/auth';
import { withProject } from '../../../lib/state';
import { approveRepairForm, rejectRepairForm } from '../../../lib/repair-actions';

export const dynamic = 'force-dynamic';

export default async function RepairsPage() {
  const session = await getSession();
  const { commands, actions } = await withProject(session?.projectId ?? 'default', async (_s, ps) => ({
    commands: await ps.listRepairCommands(),
    actions: await ps.listRepairActions(),
  }));
  const isAdmin = session?.role === 'admin';
  const canReview = session?.role === 'admin' || session?.role === 'reviewer';

  return (
    <main>
      <h1 className="text-xl font-semibold">Repairs</h1>
      <p className="mt-1 text-sm text-gray-600">
        Reviewed repairs execute the customer's own command endpoint — Reconcile never writes
        to the customer app directly. Approvals require a different user than the proposer
        (four-eyes).
      </p>

      <section className="mt-4 rounded border p-4">
        <h2 className="mb-2 font-medium">Repair actions</h2>
        {actions.length === 0 && (
          <p className="text-sm text-gray-500">
            none yet — propose one from a mismatch incident's detail page
          </p>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500">
              <th>action</th>
              <th>capability</th>
              <th>desired</th>
              <th>state</th>
              <th>proposed</th>
              <th>approved</th>
              <th>expires</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {actions.map((a) => (
              <tr key={a.id} className="border-t align-top">
                <td className="py-1">
                  <span className="font-mono text-xs">{a.id}</span>
                  <br />
                  <Link href={`/accounts/${a.accountId}`} className="font-mono text-xs underline">
                    {a.accountId}
                  </Link>
                  <br />
                  <Link href={`/incidents/${a.incidentId}`} className="font-mono text-xs underline">
                    {a.incidentId.slice(0, 12)}…
                  </Link>
                </td>
                <td className="py-1 font-mono text-xs">{a.capability}</td>
                <td className="py-1 font-mono text-xs">{String(a.desired)}</td>
                <td className="py-1">
                  <strong>{a.state}</strong>
                  <div className="text-xs text-gray-500">
                    {a.log.at(-1)?.detail ?? ''}
                  </div>
                </td>
                <td className="py-1 text-xs">
                  {a.proposedBy}
                  <br />
                  {a.proposedAt.slice(0, 16)}
                </td>
                <td className="py-1 text-xs">
                  {a.approvedBy ?? '—'}
                  {a.approvedAt && (
                    <>
                      <br />
                      {a.approvedAt.slice(0, 16)}
                    </>
                  )}
                </td>
                <td className="py-1 text-xs">{a.expiresAt.slice(0, 16)}</td>
                <td className="py-1 text-xs">
                  {a.state === 'proposed' && isAdmin && a.proposedBy !== session?.email && (
                    <form
                      action={approveRepairForm.bind(null, a.id)}
                      className="inline"
                    >
                      <button className="underline">approve</button>
                    </form>
                  )}
                  {a.state === 'proposed' && isAdmin && a.proposedBy === session?.email && (
                    <span className="text-gray-400">four-eyes: needs another admin</span>
                  )}
                  {(a.state === 'proposed' || a.state === 'approved') && canReview && (
                    <form action={rejectRepairForm.bind(null, a.id)} className="inline">
                      <button className="ml-2 underline text-red-600">reject</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-4 rounded border p-4">
        <h2 className="mb-2 font-medium">Commands</h2>
        <ul className="text-sm">
          {commands.map((c) => (
            <li key={c.id} className="py-1">
              <span className="font-mono text-xs">{c.id}</span> — {c.name} (
              <span className="font-mono">{c.kind}</span>) covers{' '}
              <span className="font-mono">{c.capabilities.join(', ')}</span>
              {c.description && <div className="text-xs text-gray-500">{c.description}</div>}
            </li>
          ))}
        </ul>
        {isAdmin && (
          <p className="mt-2 text-xs">
            manage commands under{' '}
            <Link href="/settings/repairs" className="underline">
              settings/repairs
            </Link>
          </p>
        )}
      </section>
    </main>
  );
}
