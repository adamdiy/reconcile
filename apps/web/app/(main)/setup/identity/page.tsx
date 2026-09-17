import { runAssessment } from '../../../../lib/state';
import { LinkRow } from '../../../../components/LinkRow';

export const dynamic = 'force-dynamic';

export default async function IdentityPage() {
  const snap = await runAssessment();
  const linkedAccounts = new Set(snap.links.map((l) => l.accountId));
  const linkedCustomers = new Set(snap.links.map((l) => l.stripeCustomerId));
  const unlinkedAccounts = snap.sources.app.accounts.filter((a) => !linkedAccounts.has(a.accountId));
  const collectorReferenced = new Set(
    snap.sources.app.accounts.flatMap((a) => a.stripeCustomerIds),
  );
  const unlinkedCustomers = snap.sources.stripe.customers.filter(
    (c) => !linkedCustomers.has(c.id) && !collectorReferenced.has(c.id),
  );

  return (
    <main>
      <h1 className="mb-2 text-xl font-semibold">Identity review queue</h1>
      <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
        Only reviewed links are authoritative; collector suggestions never change results until
        confirmed.
      </p>

      <h2 className="mt-4 mb-2 font-medium">Accounts without a reviewed link</h2>
      <table className="w-full border-collapse text-sm">
        <tbody>
          {unlinkedAccounts.map((a) => (
            <tr key={a.accountId} className="border-b">
              <td className="py-1 pr-3 font-mono text-xs">{a.accountId}</td>
              <td className="py-1 pr-3 text-xs">
                collector suggests:{' '}
                <span className="font-mono">{a.stripeCustomerIds.join(', ') || '—'}</span>
              </td>
              <td className="py-1">
                <LinkRow accountId={a.accountId} suggestions={a.stripeCustomerIds} />
              </td>
            </tr>
          ))}
          {unlinkedAccounts.length === 0 && (
            <tr><td colSpan={3} className="py-3 text-gray-500">all accounts linked</td></tr>
          )}
        </tbody>
      </table>

      <h2 className="mt-6 mb-2 font-medium">Stripe customers with no link</h2>
      <ul className="list-inside list-disc font-mono text-xs">
        {unlinkedCustomers.map((c) => (
          <li key={c.id}>
            {c.id}
            {c.deleted && ' (deleted)'}
          </li>
        ))}
        {unlinkedCustomers.length === 0 && <li className="text-gray-500">none</li>}
      </ul>

      <h2 className="mt-6 mb-2 font-medium">Reviewed links</h2>
      <table className="w-full border-collapse text-sm">
        <tbody>
          {snap.links.map((l) => (
            <tr key={l.accountId} className="border-b">
              <td className="py-1 pr-3 font-mono text-xs">{l.accountId}</td>
              <td className="py-1 pr-3 font-mono text-xs">{l.stripeCustomerId}</td>
              <td className="py-1">
                <LinkRow accountId={l.accountId} linked />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
