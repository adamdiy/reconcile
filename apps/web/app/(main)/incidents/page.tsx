import Link from 'next/link';
import { Suspense } from 'react';
import { runAssessment, freshnessLabel, settlingMinutes } from '../../../lib/state';
import { coverageIncidents } from '../../../lib/coverage';
import { IncidentFilters } from '../../../components/IncidentFilters';
import type { Incident } from '../../../lib/state';

export const dynamic = 'force-dynamic';

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const snap = await runAssessment();
  const rows: Incident[] = [...snap.incidents, ...coverageIncidents(snap.assessments)];

  const now = Date.now();
  const snoozed = (r: Incident) =>
    !!r.workflow?.snoozedUntil && Date.parse(r.workflow.snoozedUntil) > now;
  const accepted = (r: Incident) => !!r.workflow?.acceptedRisk;
  const tab = sp.filter ?? 'open';

  let filtered = rows;
  if (tab === 'open')
    filtered = filtered.filter((r) => r.state !== 'resolved' && !snoozed(r) && !accepted(r));
  else if (tab === 'snoozed') filtered = filtered.filter((r) => snoozed(r));
  else if (tab === 'accepted') filtered = filtered.filter((r) => accepted(r));
  else if (tab === 'resolved') filtered = filtered.filter((r) => r.state === 'resolved');
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
      <div className="mb-3 flex gap-2 text-sm">
        {(['open', 'snoozed', 'accepted', 'resolved', 'all'] as const).map((t) => (
          <Link
            key={t}
            href={`/incidents?filter=${t}`}
            className={`rounded border px-2 py-0.5 ${tab === t ? 'bg-gray-900 text-white' : 'text-gray-600'}`}
          >
            {t}
          </Link>
        ))}
      </div>
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
            <tr key={r.id} className={`border-b ${snoozed(r) || accepted(r) ? 'text-gray-400' : ''}`}>
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
              <td className="py-1 pr-3">
                {r.state}
                {snoozed(r) && (
                  <span className="ml-1 rounded bg-gray-200 px-1 text-xs">snoozed</span>
                )}
                {accepted(r) && (
                  <span className="ml-1 rounded bg-blue-100 px-1 text-xs">accepted</span>
                )}
                {r.state === 'candidate' && (
                  <div className="text-xs text-gray-500">
                    since {r.firstSeenAt}; confirms on next observation after{' '}
                    {new Date(Date.parse(r.firstSeenAt) + settlingMinutes() * 60_000).toISOString()}
                  </div>
                )}
                {r.state === 'confirmed' && (
                  <div className="text-xs text-gray-500">confirmed {r.lastConfirmedAt}</div>
                )}
              </td>
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
