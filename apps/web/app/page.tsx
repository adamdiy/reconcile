import Link from 'next/link';
import { runAssessment, settlingMinutes } from '../lib/state';
import { coverageIncidents } from '../lib/coverage';
import { RecheckButton } from '../components/RecheckButton';

export const dynamic = 'force-dynamic';

const BUCKET_LABELS = [
  'Confirmed mismatch',
  'Pending mismatch',
  'Incomplete / stale / unsupported',
  'Fully assessed',
] as const;

export default function OverviewPage() {
  const snap = runAssessment();
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

  return (
    <main>
      <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
        Simulated sources — fixture data
      </div>
      <div className="mb-6 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
        <div>
          <div className="text-gray-500">Stripe inventory</div>
          <div className="font-mono text-xs">{snap.fixtures.stripe.runId}</div>
          <div className="font-mono text-xs">{snap.fixtures.stripe.observedAt}</div>
        </div>
        <div>
          <div className="text-gray-500">App inventory</div>
          <div className="font-mono text-xs">{snap.fixtures.app.runId}</div>
          <div className="font-mono text-xs">{snap.fixtures.app.observedAt}</div>
        </div>
        <div>
          <div className="text-gray-500">Policy version</div>
          <div className="font-mono text-xs">{snap.fixtures.policy.version}</div>
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
          Coverage gaps: {coverage.length} open (unmapped identity, stale evidence, unsupported
          models).
          {partial.size > 0 && (
            <span> Partial-coverage badge on {partial.size} account(s).</span>
          )}
        </div>
      </div>
      <RecheckButton />
    </main>
  );
}
