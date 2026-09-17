import { runAssessment } from '../../../lib/state';
import { coverageIncidents } from '../../../lib/coverage';
import { ENGINE_VERSION } from '../../../lib/state';

export const dynamic = 'force-dynamic';

export default async function ReportPage() {
  const snap = await runAssessment();
  const coverage = coverageIncidents(snap.assessments);
  const counts = [0, 0, 0, 0];
  for (const b of snap.buckets.values()) counts[b.bucket - 1] += 1;
  const confirmed = snap.incidents.filter((i) => i.state === 'confirmed');
  const open = snap.incidents.filter((i) => i.state !== 'resolved');
  const integrity = snap.assessments.flatMap((a) =>
    a.integrity.map((f) => ({ accountId: a.accountId, finding: f })),
  );
  let covered = 0;
  let total = 0;
  for (const a of snap.assessments)
    for (const f of a.features) {
      total += 1;
      if (f.kind !== 'unknown') covered += 1;
    }

  return (
    <main>
      <h1 className="text-2xl font-bold">Reconcile assessment report</h1>
      <p className="mt-1 text-gray-600">
        Operational verification report — not a compliance certification. Sources are simulated.
      </p>

      <h2 className="mt-6 border-b pb-1 font-semibold">Run summary</h2>
      <table className="mt-2 text-sm">
        <tbody>
          <tr><td className="pr-4 text-gray-500">evaluated at</td><td className="font-mono">{snap.evaluatedAt}</td></tr>
          <tr><td className="pr-4 text-gray-500">population</td><td>{snap.assessments.length} subjects</td></tr>
          <tr><td className="pr-4 text-gray-500">buckets</td><td className="font-mono">confirmed {counts[0]} · pending {counts[1]} · incomplete/stale {counts[2]} · assessed {counts[3]}</td></tr>
          <tr><td className="pr-4 text-gray-500">feature coverage</td><td className="font-mono">{covered}/{total} (account, feature) pairs</td></tr>
          <tr><td className="pr-4 text-gray-500">open incidents</td><td>{open.length} ({confirmed.length} confirmed)</td></tr>
        </tbody>
      </table>

      <h2 className="mt-6 border-b pb-1 font-semibold">Confirmed incidents</h2>
      <table className="mt-2 w-full border-collapse text-xs">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="py-1 pr-2">Account</th><th className="py-1 pr-2">Check</th>
            <th className="py-1 pr-2">Feature</th><th className="py-1 pr-2">Expected → observed</th>
            <th className="py-1 pr-2">Severity</th><th className="py-1 pr-2">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {confirmed.map((i) => (
            <tr key={i.id} className="border-b align-top">
              <td className="py-1 pr-2 font-mono">{i.accountId}</td>
              <td className="py-1 pr-2">{i.check}</td>
              <td className="py-1 pr-2 font-mono">{i.feature}</td>
              <td className="py-1 pr-2 font-mono">{String(i.expected)} → {String(i.observed)}</td>
              <td className="py-1 pr-2">{i.severity}</td>
              <td className="py-1 pr-2 font-mono break-all">{i.evidenceIds.join(' ')}</td>
            </tr>
          ))}
          {confirmed.length === 0 && (
            <tr><td colSpan={6} className="py-3 text-gray-500">No confirmed incidents.</td></tr>
          )}
        </tbody>
      </table>

      <h2 className="mt-6 border-b pb-1 font-semibold">Coverage gaps by reason</h2>
      <ul className="mt-2 list-inside list-disc text-xs">
        {Object.entries(
          coverage.reduce<Record<string, string[]>>((acc, i) => {
            const reason = i.reasons?.[0] ?? 'unknown';
            acc[reason] = [...(acc[reason] ?? []), i.accountId];
            return acc;
          }, {}),
        ).map(([reason, accounts]) => (
          <li key={reason}>
            <span className="font-mono">{reason}</span>: {accounts.join(', ')}
          </li>
        ))}
        {coverage.length === 0 && <li className="text-gray-500">none</li>}
      </ul>

      <h2 className="mt-6 border-b pb-1 font-semibold">Integrity findings</h2>
      <ul className="mt-2 list-inside list-disc text-xs">
        {integrity.map(({ accountId, finding }, i) => (
          <li key={i}>
            <span className="font-mono">{accountId}</span>: {finding.kind} — records{' '}
            <span className="font-mono">{finding.localRecordIds.join(', ')}</span> share{' '}
            <span className="font-mono">{finding.stripeSubscriptionId}</span>
          </li>
        ))}
        {integrity.length === 0 && <li className="text-gray-500">none</li>}
      </ul>

      <footer className="mt-8 border-t pt-2 text-xs text-gray-500">
        Generated {snap.evaluatedAt}, policy {snap.policy.version}, engine {ENGINE_VERSION},
        sources: {snap.sources.stripe.runId} / {snap.sources.app.runId} — simulated sources, fixture data.
      </footer>
    </main>
  );
}
