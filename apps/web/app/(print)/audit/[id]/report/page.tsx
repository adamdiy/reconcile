import { notFound } from 'next/navigation';
import { requireSession } from '../../../../../lib/auth';
import { runAssessment, withStore } from '../../../../../lib/state';
import { diffAssessments } from '@reconcile/core';

export const dynamic = 'force-dynamic';

export default async function AuditReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const baseline = await withStore(async (store) =>
    store.forProject(session.projectId).getBaseline(id),
  );
  if (!baseline) notFound();
  const snap = await runAssessment({ projectId: session.projectId });
  const diff = diffAssessments(baseline.assessments, snap.assessments);

  const rows = (
    title: string,
    pairs: { accountId: string; feature: string }[],
  ) => (
    <>
      <h2 className="mt-6 border-b pb-1 font-semibold">
        {title} ({pairs.length})
      </h2>
      <table className="mt-2 w-full border-collapse text-xs">
        <tbody>
          {pairs.map((p, i) => (
            <tr key={i} className="border-b">
              <td className="py-1 pr-2 font-mono">{p.accountId}</td>
              <td className="py-1 pr-2 font-mono">{p.feature}</td>
            </tr>
          ))}
          {pairs.length === 0 && (
            <tr><td colSpan={2} className="py-3 text-gray-500">none</td></tr>
          )}
        </tbody>
      </table>
    </>
  );

  return (
    <main>
      <h1 className="text-2xl font-bold">Migration audit — {baseline.name}</h1>
      <p className="mt-1 text-gray-600">
        Baseline {baseline.id}, captured {baseline.createdAt} by {baseline.createdBy}.
        {baseline.note ? ` Note: ${baseline.note}` : ''}
      </p>

      <h2 className="mt-6 border-b pb-1 font-semibold">Baseline vs current</h2>
      <table className="mt-2 text-sm">
        <tbody>
          <tr><td className="pr-4 text-gray-500">policy</td><td className="font-mono">{baseline.policyVersion} → {snap.policy.version}</td></tr>
          <tr><td className="pr-4 text-gray-500">engine</td><td className="font-mono">{baseline.engineVersion} → {snap.assessments[0]?.engineVersion ?? baseline.engineVersion}</td></tr>
          <tr><td className="pr-4 text-gray-500">stripe observed</td><td className="font-mono">{baseline.sourceObservedAt.stripe} → {snap.sources.stripe.observedAt}</td></tr>
          <tr><td className="pr-4 text-gray-500">app observed</td><td className="font-mono">{baseline.sourceObservedAt.app} → {snap.sources.app.observedAt}</td></tr>
          <tr><td className="pr-4 text-gray-500">population</td><td className="font-mono">{baseline.counts.population} → {snap.assessments.length}</td></tr>
          <tr><td className="pr-4 text-gray-500">covered pairs</td><td className="font-mono">{baseline.counts.coveredPairs}/{baseline.counts.totalPairs} baseline</td></tr>
          <tr><td className="pr-4 text-gray-500">unchanged pairs</td><td className="font-mono">{diff.unchanged}</td></tr>
        </tbody>
      </table>

      {rows('Regressions', diff.regressions)}
      {rows('Fixes', diff.fixes)}
      {rows('Newly unknown', diff.newUnknowns)}
      {rows('Newly assessed', diff.newlyAssessed)}
      {rows('Added pairs', diff.added)}
      {rows('Removed pairs', diff.removed)}

      <footer className="mt-8 border-t pt-2 text-xs text-gray-500">
        Generated {snap.evaluatedAt} — baseline captured {baseline.createdAt}.
      </footer>
    </main>
  );
}
