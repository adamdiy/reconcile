import Link from 'next/link';
import { loadFixtures } from '@reconcile/fixtures';
import { withProject } from '../../../../lib/state';
import { requireSession } from '../../../../lib/auth';
import { MappingPanel } from '../../../../components/MappingPanel';

export const dynamic = 'force-dynamic';

export default async function MappingPage() {
  const session = await requireSession();
  const fx = loadFixtures();
  return withProject(session.projectId, async (_store, ps) => {
    const published = (await ps.getPublishedPolicy())?.policy ?? fx.policy;
    const draft = await ps.getPolicyDraft();
    const publishedMap = new Map(published.priceMappings.map((m) => [m.priceId, m]));

    return (
      <main>
        <h1 className="mb-2 text-xl font-semibold">AI mapping suggestions</h1>
        <p className="text-sm text-gray-600">
          Published policy <span className="font-mono">{published.version}</span>. Suggestions are a
          draft only — a human confirms; they land in the{' '}
          <Link href="/setup/policy" className="underline">
            policy draft
          </Link>{' '}
          and never affect results until published.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <section className="rounded border p-4">
            <h2 className="mb-2 font-medium">Fixture prices</h2>
            <ul className="space-y-1 text-sm">
              {fx.prices.map((p) => (
                <li key={p.id} className="font-mono text-xs">
                  {p.id} — {p.nickname} ({p.unitAmount} {p.currency})
                  {publishedMap.has(p.id) && (
                    <span className="text-gray-500">
                      {' '}
                      → {publishedMap.get(p.id)!.capabilities.join(', ')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <h3 className="mt-3 mb-1 text-sm font-medium">Capabilities</h3>
            <p className="font-mono text-xs">{published.capabilities.join(', ')}</p>
          </section>

          <section className="rounded border p-4">
            <h2 className="mb-2 font-medium">Draft vs published</h2>
            {!draft || draft.policy.priceMappings.length === 0 ? (
              <p className="text-sm text-gray-500">
                No draft yet. Use “Suggest mapping” then Confirm to start a draft, editable at{' '}
                <Link href="/setup/policy" className="underline">
                  /setup/policy
                </Link>
                .
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full table-fixed text-xs">
                  <thead>
                    <tr className="text-left text-gray-500">
                      <th className="w-1/4">price</th>
                      <th className="w-1/4">published</th>
                      <th className="w-1/3">draft</th>
                      <th>diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.policy.priceMappings.map((m) => {
                      const pub = publishedMap.get(m.priceId);
                      const same =
                        pub &&
                        pub.capabilities.length === m.capabilities.length &&
                        pub.capabilities.every((c) => m.capabilities.includes(c));
                      return (
                        <tr key={m.priceId} className="border-t">
                          <td className="py-1 pr-2 font-mono break-words">{m.priceId}</td>
                          <td className="py-1 pr-2 font-mono break-words">
                            {pub ? pub.capabilities.join(', ') : '—'}
                          </td>
                          <td className="py-1 pr-2 font-mono break-words">
                            {m.capabilities.join(', ')}
                          </td>
                          <td className="py-1 pr-2">{same ? 'same' : 'changed'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {draft && (
              <p className="mt-2 text-xs text-gray-500">draft updated {draft.updatedAt}</p>
            )}
          </section>
        </div>

        <MappingPanel />
      </main>
    );
  });
}
