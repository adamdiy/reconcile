import { redirect } from 'next/navigation';
import { getSession } from '../../../lib/auth';
import { runAssessment, withStore } from '../../../lib/state';
import { seedFromFixtures } from '@reconcile/store';
import { loadFixtures } from '@reconcile/fixtures';
import type { AssessmentRun } from '../../../lib/state';

function Sparkline({ values, label }: { values: number[]; label: string }) {
  const w = 160;
  const h = 40;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const points = values
    .map((v, i) => `${(i / Math.max(values.length - 1, 1)) * w},${h - ((v - min) / span) * h}`)
    .join(' ');
  return (
    <figure className="rounded border p-3">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-10 w-40" role="img" aria-label={label}>
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <figcaption className="mt-1 text-xs text-gray-500">{label}</figcaption>
    </figure>
  );
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export default async function MetricsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const snap = await runAssessment({ projectId: session.projectId });
  const { runs, jobs, lastTick } = await withStore(async (store) => {
    await seedFromFixtures(store, loadFixtures());
    return {
      runs: (await store.forProject(session.projectId).listRuns(60)).reverse(),
      jobs: await store.listJobs(session.projectId, 500),
      lastTick: await store.getWorkerHeartbeat(),
    };
  });

  const coverageSeries = runs.map((r: AssessmentRun) =>
    r.counts.totalPairs > 0 ? Math.round((r.counts.coveredPairs / r.counts.totalPairs) * 100) : 0,
  );
  const incidentSeries = runs.map((r: AssessmentRun) => r.counts.incidentsOpen);

  const now = Date.now();
  const ageHours = (iso: string) => Math.round(((now - Date.parse(iso)) / 3_600_000) * 10) / 10;
  const sourceAges = (['stripe', 'app'] as const).map((side) => ({
    side,
    observedAt: snap.sources[side].observedAt,
    ageHours: ageHours(snap.sources[side].observedAt),
    complete: snap.sources[side].complete,
  }));

  const cutoff = now - 30 * 86_400_000;
  const latencies = Object.values(
    snap.incidents
      .filter((i) => Date.parse(i.firstSeenAt) >= cutoff)
      .map((i) => Date.parse(i.firstSeenAt) - Date.parse(snap.sources.app.observedAt))
      .filter((d) => d >= 0),
  );
  const detectionLatencyH = median(latencies);

  const unknownReasons: Record<string, number> = {};
  for (const a of snap.assessments)
    for (const f of a.features)
      if (f.kind === 'unknown')
        for (const r of f.reasons) unknownReasons[r] = (unknownReasons[r] ?? 0) + 1;

  const jobCounts = { queued: 0, running: 0, dead: 0 };
  for (const j of jobs)
    if (j.status === 'queued' || j.status === 'running' || j.status === 'dead')
      jobCounts[j.status] += 1;

  return (
    <main className="space-y-6">
      <h1 className="text-xl font-semibold">Metrics — {session.projectId}</h1>

      <div className="flex flex-wrap gap-4">
        <Sparkline values={coverageSeries} label="coverage % over runs" />
        <Sparkline values={incidentSeries} label="open incidents over runs" />
      </div>

      <section>
        <h2 className="mb-1 font-medium">Source staleness</h2>
        <ul className="text-sm">
          {sourceAges.map((s) => (
            <li key={s.side}>
              <code>{s.side}</code>: observed {s.ageHours}h ago ({s.observedAt}) ·{' '}
              {s.complete ? 'complete' : 'incomplete'}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-1 font-medium">Detection latency</h2>
        <p className="text-sm">
          Median delay from source observation to incident creation (last 30d):{' '}
          {detectionLatencyH === null
            ? 'n/a'
            : `${Math.round((detectionLatencyH / 3_600_000) * 10) / 10}h`}
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-medium">Unknown-reason breakdown</h2>
        <table className="text-left text-sm">
          <tbody>
            {Object.entries(unknownReasons).map(([reason, count]) => (
              <tr key={reason} className="border-b">
                <td className="py-1 pr-6 font-mono text-xs">{reason}</td>
                <td>{count}</td>
              </tr>
            ))}
            {Object.keys(unknownReasons).length === 0 && (
              <tr>
                <td className="py-1 text-gray-500">No unknown evaluations.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-1 font-medium">Job health</h2>
        <p className="text-sm">
          queued {jobCounts.queued} · running {jobCounts.running} · dead {jobCounts.dead} · last
          worker tick: <code className="text-xs">{lastTick ?? 'never'}</code>
        </p>
      </section>
    </main>
  );
}
