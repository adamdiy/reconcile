import Link from 'next/link';
import { Suspense } from 'react';
import { runAssessment, freshnessLabel } from '../../lib/state';
import { coverageIncidents } from '../../lib/coverage';
import { IncidentFilters } from '../../components/IncidentFilters';
import type { Incident } from '../../lib/state';

export const dynamic = 'force-dynamic';

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const snap = runAssessment();
  const rows: Incident[] = [...snap.incidents, ...coverageIncidents(snap.assessments)];

  let filtered = rows;
  if (sp.check) filtered = filtered.filter((r) => r.check === sp.check);
  if (sp.severity) filtered = filtered.filter((r) => r.severity === sp.severity);
  if (sp.state) filtered = filtered.filter((r) => r.state === sp.state);
  if (sp.bucket) {
    const inBucket = new Set(
      [...snap.buckets.entries()].filter(([, b]) => b.bucket === Number(sp.bucket)).map(([id]) => id),
    );
    filtered = filtered.filter((r) => inBucket.has(r.accountId));
  }
  filtered = [...filtered].sort((a, b) => a.id.localeCompare(b.id));

  const freshnessOf = (accountId: string) => {
    const a = snap.assessments.find((x) => x.accountId === accountId);
    return a ? freshnessLabel(a) : 'unknown';
  };

  return (
    <main>
      <h1 className="mb-4 text-xl font-semibold">Incident inbox</h1>
      <Suspense>
        <IncidentFilters />
      </Suspense>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="py-1 pr-3">Account</th>
            <th className="py-1 pr-3">Check</th>
            <th className="py-1 pr-3">Capability</th>
            <th className="py-1 pr-3">First observed</th>
            <th className="py-1 pr-3">Last confirmed</th>
            <th className="py-1 pr-3">Severity</th>
            <th className="py-1 pr-3">Source freshness</th>
            <th className="py-1 pr-3">State</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="py-1 pr-3 font-mono text-xs">
                <Link href={`/accounts/${r.accountId}`} className="underline">
                  {r.accountId}
                </Link>
              </td>
              <td className="py-1 pr-3">
                <Link href={`/incidents/${r.id}`} className="underline">
                  {r.check}
                </Link>
              </td>
              <td className="py-1 pr-3 font-mono text-xs">{r.feature}</td>
              <td className="py-1 pr-3 font-mono text-xs">{r.firstSeenAt}</td>
              <td className="py-1 pr-3 font-mono text-xs">{r.lastConfirmedAt}</td>
              <td className="py-1 pr-3">{r.severity}</td>
              <td className="py-1 pr-3 font-mono text-xs">{freshnessOf(r.accountId)}</td>
              <td className="py-1 pr-3">{r.state}</td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={8} className="py-4 text-center text-gray-500">
                No incidents match the filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
