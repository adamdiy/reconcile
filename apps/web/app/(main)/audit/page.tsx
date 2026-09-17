import { requireSession } from '../../../lib/auth';
import { withStore } from '../../../lib/state';
import { captureBaseline, deleteBaseline, getBaselineWithDiff } from '../../../lib/audit-actions';
import { DiffSummary } from '../../../components/DiffTable';
import { CaptureBaselineForm } from '../../../components/CaptureBaselineForm';

export const dynamic = 'force-dynamic';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ compare?: string }>;
}) {
  const session = await requireSession();
  const { compare } = await searchParams;
  const baselines = await withStore(async (store) =>
    store.forProject(session.projectId).listBaselines(),
  );
  const comparison = compare ? await getBaselineWithDiff(compare) : null;
  const canWrite = session.role === 'reviewer' || session.role === 'admin';

  return (
    <main>
      <h1 className="mb-2 text-xl font-semibold">Migration audit</h1>
      <p className="text-sm text-gray-600">
        Baselines freeze the assessment snapshot (accounts, features, seats/usage, integrity) so a
        source or policy migration can be compared pair-by-pair.
      </p>

      {canWrite && <CaptureBaselineForm action={captureBaseline} />}

      <table className="mt-4 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="py-1 pr-3">name</th>
            <th className="py-1 pr-3">captured</th>
            <th className="py-1 pr-3">policy / engine</th>
            <th className="py-1 pr-3">sources</th>
            <th className="py-1 pr-3">population</th>
            <th className="py-1 pr-3">pairs</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {baselines.map((b) => (
            <tr key={b.id} className="border-b">
              <td className="py-1 pr-3">
                {b.name}
                {b.note && <span className="ml-2 text-xs text-gray-500">{b.note}</span>}
              </td>
              <td className="py-1 pr-3 font-mono text-xs">{b.createdAt}</td>
              <td className="py-1 pr-3 font-mono text-xs">
                {b.policyVersion} / {b.engineVersion}
              </td>
              <td className="py-1 pr-3 font-mono text-xs">
                stripe {b.sourceObservedAt.stripe} · app {b.sourceObservedAt.app}
              </td>
              <td className="py-1 pr-3">{b.counts.population}</td>
              <td className="py-1 pr-3 font-mono text-xs">
                {b.counts.coveredPairs}/{b.counts.totalPairs}
              </td>
              <td className="py-1">
                <a href={`/audit?compare=${b.id}`} className="mr-2 text-xs text-blue-600">
                  compare to now
                </a>
                <a href={`/audit/${b.id}/report`} className="mr-2 text-xs text-blue-600">
                  print report
                </a>
                <a href={`/api/audit/${b.id}.csv`} className="mr-2 text-xs text-blue-600">
                  csv
                </a>
                {canWrite && (
                  <form
                    className="inline"
                    action={async () => {
                      'use server';
                      await deleteBaseline(b.id);
                    }}
                  >
                    <button className="text-xs text-red-600">delete</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
          {baselines.length === 0 && (
            <tr>
              <td colSpan={7} className="py-4 text-center text-gray-500">
                no baselines captured yet
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {comparison?.baseline && comparison.diff && comparison.current && (
        <section className="mt-6 rounded border p-4">
          <h2 className="mb-2 font-medium">
            Compare: {comparison.baseline.name} → now
          </h2>
          <p className="mb-2 text-xs text-gray-500">
            baseline policy {comparison.baseline.policyVersion} / engine{' '}
            {comparison.baseline.engineVersion} / sources{' '}
            {comparison.baseline.sourceObservedAt.stripe} +{' '}
            {comparison.baseline.sourceObservedAt.app} — current policy{' '}
            {comparison.current.policyVersion} / engine {comparison.current.engineVersion} /
            sources {comparison.current.sourceObservedAt.stripe} +{' '}
            {comparison.current.sourceObservedAt.app}
          </p>
          <p className="mb-2 text-xs text-gray-500">
            population {comparison.baseline.counts.population} → {comparison.current.population}
          </p>
          <DiffSummary diff={comparison.diff} />
        </section>
      )}
    </main>
  );
}
