import Link from 'next/link';
import { runAssessment, settlingMinutes } from '../../lib/state';
import { coverageIncidents } from '../../lib/coverage';
import { RecheckButton } from '../../components/RecheckButton';
import { ImportFixturesButton } from '../../components/ImportFixturesButton';
import { getSession } from '../../lib/auth';

export const dynamic = 'force-dynamic';

const BUCKET_LABELS = [
  'Confirmed mismatch',
  'Pending mismatch',
  'Incomplete / stale / unsupported',
  'Fully assessed',
] as const;

export default async function OverviewPage() {
  const session = await getSession();
  const snap = await runAssessment();
  const origins = snap.sources.origins ?? {
    stripe: snap.sources.origin,
    app: snap.sources.origin,
  };
  const simulated = origins.stripe === 'fixtures' && origins.app === 'fixtures';
  const coverage = coverageIncidents(snap.assessments);
  const counts = [0, 0, 0, 0, 0];
  const partial = new Set<string>();
  for (const [accountId, b] of snap.buckets) {
    counts[b.bucket] += 1;
    if (b.partialCoverage) partial.add(accountId);
  }
  let covered = 0;
  let uncovered = 0;
  for (const a of snap.assessments)
    for (const f of a.features) {
      if (f.kind === 'unknown') uncovered += 1;
      else covered += 1;
    }
  const now = Date.now();
  const snoozedCount = snap.incidents.filter(
    (i) => i.workflow?.snoozedUntil && Date.parse(i.workflow.snoozedUntil) > now,
  ).length;
  const acceptedCount = snap.incidents.filter((i) => i.workflow?.acceptedRisk).length;

  return (
    <main>
      {simulated ? (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
          Simulated sources — fixture data
        </div>
      ) : (
        <div className="mb-4 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm">
          Live connector data — last import {snap.sources.importedAt}
        </div>
      )}
      <div className="mb-6 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
        <div>
          <div className="text-gray-500">
            Stripe inventory <span className="text-xs">({origins.stripe})</span>
          </div>
          <div className="font-mono text-xs">{snap.sources.stripe.runId}</div>
          <div className="font-mono text-xs">{snap.sources.stripe.observedAt}</div>
          {!snap.sources.stripe.complete && (
            <div className="text-xs text-red-600">incomplete inventory</div>
          )}
          {snap.sources.stripe.permissionsMissing.length > 0 && (
            <div className="text-xs text-red-600">
              missing permissions: {snap.sources.stripe.permissionsMissing.join(', ')}
            </div>
          )}
        </div>
        <div>
          <div className="text-gray-500">
            App inventory <span className="text-xs">({origins.app})</span>
          </div>
          <div className="font-mono text-xs">{snap.sources.app.runId}</div>
          <div className="font-mono text-xs">{snap.sources.app.observedAt}</div>
          {!snap.sources.app.complete && (
            <div className="text-xs text-red-600">incomplete inventory</div>
          )}
        </div>
        <div>
          <div className="text-gray-500">Policy version</div>
          <div className="font-mono text-xs">
            {snap.publishedPolicy
              ? `${snap.publishedPolicy.version} published ${snap.publishedPolicy.publishedAt}`
              : snap.fixtures.policy.version}
          </div>
        </div>
        <div>
          <div className="text-gray-500">Population</div>
          <div className="text-xl font-semibold">{snap.assessments.length}</div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {BUCKET_LABELS.map((label, i) => (
          <Link
            key={label}
            href={`/incidents?bucket=${i + 1}`}
            className="rounded border p-4 hover:bg-gray-50"
          >
            <div className="text-xs text-gray-500">
              {i + 1}. {label}
            </div>
            <div className="text-2xl font-semibold">{counts[i + 1]}</div>
          </Link>
        ))}
      </div>

      {snap.assessments.some((a) => a.quantityChecks.length > 0) && (
        <div className="mb-6 rounded border p-4">
          <h2 className="mb-2 font-medium">Seats & usage</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="py-1 pr-3">account</th>
                <th className="py-1 pr-3">check</th>
                <th className="py-1 pr-3">expected</th>
                <th className="py-1 pr-3">observed</th>
                <th className="py-1 pr-3">result</th>
              </tr>
            </thead>
            <tbody>
              {snap.assessments.flatMap((a) =>
                a.quantityChecks.map((q, i) => (
                  <tr key={`${a.accountId}-${i}`} className="border-b">
                    <td className="py-1 pr-3 font-mono text-xs">{a.accountId}</td>
                    <td className="py-1 pr-3 font-mono text-xs">
                      {q.check === 'seats' ? 'seats' : `usage:${q.metric}`}
                    </td>
                    <td className="py-1 pr-3 font-mono">{q.expected}</td>
                    <td className="py-1 pr-3 font-mono">{q.observed ?? '—'}</td>
                    <td className={`py-1 pr-3 ${q.kind === 'mismatch' ? 'text-red-600' : q.kind === 'unknown' ? 'text-amber-700' : ''}`}>
                      {q.kind}
                      {q.kind === 'unknown' && 'reasons' in q && (
                        <span className="text-xs text-gray-500"> ({q.reasons.join(',')})</span>
                      )}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="mb-6 text-sm">
        <div>
          Feature coverage: <strong>{covered}</strong> of <strong>{covered + uncovered}</strong>{' '}
          (account, feature) pairs covered ({uncovered} uncovered)
        </div>
        <div className="mt-1 text-gray-600">
          Detection envelope: collector recheck latency + {settlingMinutes()} min settling (demo
          settling is {settlingMinutes()} min). Evaluated at{' '}
          <span className="font-mono text-xs">{snap.evaluatedAt}</span>.
        </div>
        <div className="mt-1 text-gray-600">
          <Link href="/runs" className="underline">
            Assessment runs
          </Link>
          {' · '}
          <Link href="/report" className="underline">
            Printable report
          </Link>
          {' · '}
          <a href="/api/report.csv" className="underline">
            Incidents CSV
          </a>
        </div>
        <div className="mt-1 text-gray-600">
          Coverage gaps: {coverage.length} open (unmapped identity, stale evidence, unsupported
          models).
          {partial.size > 0 && (
            <span> Partial-coverage badge on {partial.size} account(s).</span>
          )}
        </div>
        {(snoozedCount > 0 || acceptedCount > 0) && (
          <div className="mt-1 text-gray-600">
            {snoozedCount} snoozed, {acceptedCount} accepted risk
          </div>
        )}
      </div>
      {(session?.role === 'reviewer' || session?.role === 'admin') && (
        <div className="flex items-center gap-3">
          <RecheckButton />
          <ImportFixturesButton />
          <span className="text-xs text-gray-500">Import fixtures is a simulated collector</span>
        </div>
      )}
    </main>
  );
}
