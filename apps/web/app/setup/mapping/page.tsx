import { loadFixtures } from '@reconcile/fixtures';
import { readPolicyDraft } from '../../../lib/state';
import { MappingPanel } from '../../../components/MappingPanel';

export const dynamic = 'force-dynamic';

export default function MappingPage() {
  const fx = loadFixtures();
  const draft = readPolicyDraft();
  const published = new Map(fx.policy.priceMappings.map((m) => [m.priceId, m]));

  return (
    <main>
      <h1 className="mb-2 text-xl font-semibold">Price → capability mapping</h1>
      <p className="text-sm text-gray-600">
        Published policy <span className="font-mono">{fx.policy.version}</span>. Suggestions are a
        draft only — a human confirms; publishing is out of scope for this demo.
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section className="rounded border p-4">
          <h2 className="mb-2 font-medium">Fixture prices</h2>
          <ul className="space-y-1 text-sm">
            {fx.prices.map((p) => (
              <li key={p.id} className="font-mono text-xs">
                {p.id} — {p.nickname} ({p.unitAmount} {p.currency})
                {published.has(p.id) && (
                  <span className="text-gray-500">
                    {' '}
                    → {published.get(p.id)!.capabilities.join(', ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <h3 className="mt-3 mb-1 text-sm font-medium">Capabilities</h3>
          <p className="font-mono text-xs">{fx.policy.capabilities.join(', ')}</p>
        </section>

        <section className="rounded border p-4">
          <h2 className="mb-2 font-medium">Draft vs published</h2>
          {!draft || draft.mappings.length === 0 ? (
            <p className="text-sm text-gray-500">
              No draft yet. Use “Suggest mapping” then Confirm to write{' '}
              <span className="font-mono">.reconcile/policy-draft.json</span>.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500">
                  <th>price</th>
                  <th>published</th>
                  <th>draft</th>
                  <th>diff</th>
                </tr>
              </thead>
              <tbody>
                {draft.mappings.map((m) => {
                  const pub = published.get(m.priceId);
                  const same =
                    pub &&
                    pub.capabilities.length === m.capabilities.length &&
                    pub.capabilities.every((c) => m.capabilities.includes(c));
                  return (
                    <tr key={m.priceId} className="border-t">
                      <td className="py-1 font-mono">{m.priceId}</td>
                      <td className="py-1 font-mono">{pub ? pub.capabilities.join(',') : '—'}</td>
                      <td className="py-1 font-mono">{m.capabilities.join(',')}</td>
                      <td className="py-1">{same ? 'same' : 'changed'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {draft && (
            <p className="mt-2 text-xs text-gray-500">draft written {draft.writtenAt}</p>
          )}
        </section>
      </div>

      <MappingPanel />
    </main>
  );
}
