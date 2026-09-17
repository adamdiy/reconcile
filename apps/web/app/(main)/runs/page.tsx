import { withStore } from '../../../lib/state';

export const dynamic = 'force-dynamic';

export default async function RunsPage() {
  const runs = await withStore((s) => s.listRuns(50));
  return (
    <main>
      <h1 className="mb-4 text-xl font-semibold">Assessment runs</h1>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="py-1 pr-3">Evaluated</th>
            <th className="py-1 pr-3">Policy</th>
            <th className="py-1 pr-3">Engine</th>
            <th className="py-1 pr-3">Population</th>
            <th className="py-1 pr-3">Confirmed / Pending / Incomplete / Assessed</th>
            <th className="py-1 pr-3">Coverage</th>
            <th className="py-1 pr-3">Open incidents</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="py-1 pr-3 font-mono text-xs">{r.evaluatedAt}</td>
              <td className="py-1 pr-3 font-mono text-xs">{r.policyVersion}</td>
              <td className="py-1 pr-3 font-mono text-xs">{r.engineVersion}</td>
              <td className="py-1 pr-3">{r.counts.population}</td>
              <td className="py-1 pr-3 font-mono text-xs">{r.counts.buckets.join(' / ')}</td>
              <td className="py-1 pr-3 font-mono text-xs">
                {r.counts.coveredPairs}/{r.counts.totalPairs}
              </td>
              <td className="py-1 pr-3">{r.counts.incidentsOpen}</td>
            </tr>
          ))}
          {runs.length === 0 && (
            <tr>
              <td colSpan={7} className="py-4 text-center text-gray-500">
                No runs recorded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
