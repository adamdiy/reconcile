import { loadFixtures } from '@reconcile/fixtures';
import { createStore, seedFromFixtures } from '@reconcile/store';
import { PolicyEditor } from '../../../../components/PolicyEditor';

export const dynamic = 'force-dynamic';

export default async function PolicyPage() {
  const fx = loadFixtures();
  const store = createStore();
  try {
    await store.migrate();
    await seedFromFixtures(store, fx);
    const versions = await store.listPolicyVersions();
    const published = versions[0] ?? null;
    const draft = await store.getPolicyDraft();
    const today = new Date().toISOString().slice(0, 10);
    const nextVersion = `v${versions.length + 1}-${today}`;

    return (
      <main>
        <h1 className="mb-2 text-xl font-semibold">Policy</h1>
        <p className="text-sm text-gray-600">
          Publishing creates an immutable version and re-evaluates all accounts. A draft never
          affects results until published.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <section className="rounded border p-4">
            <h2 className="mb-2 font-medium">Published</h2>
            {published && (
              <p className="text-sm">
                <span className="font-mono">{published.version}</span> — published{' '}
                <span className="font-mono text-xs">{published.publishedAt}</span> by{' '}
                {published.publishedBy}
              </p>
            )}
            <h3 className="mt-3 mb-1 text-sm font-medium">Version history</h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500">
                  <th>version</th>
                  <th>published</th>
                  <th>by</th>
                  <th>mappings</th>
                  <th>note</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.version} className="border-t">
                    <td className="py-1 font-mono">{v.version}</td>
                    <td className="py-1 font-mono">{v.publishedAt}</td>
                    <td className="py-1">{v.publishedBy}</td>
                    <td className="py-1">{v.policy.priceMappings.length}</td>
                    <td className="py-1 text-gray-500">{v.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="rounded border p-4">
            <h2 className="mb-2 font-medium">Draft</h2>
            <PolicyEditor
              initial={draft?.policy ?? published?.policy ?? fx.policy}
              capabilities={(published?.policy ?? fx.policy).capabilities}
              defaultVersion={nextVersion}
            />
          </section>
        </div>
      </main>
    );
  } finally {
    await store.close();
  }
}
