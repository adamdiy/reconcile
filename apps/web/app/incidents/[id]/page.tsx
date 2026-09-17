import Link from 'next/link';
import { notFound } from 'next/navigation';
import { runAssessment, settlingMinutes } from '../../../lib/state';
import { coverageIncidents } from '../../../lib/coverage';
import { RecheckButton } from '../../../components/RecheckButton';

export const dynamic = 'force-dynamic';

const CHECK_TITLES: Record<string, string> = {
  expected_feature_missing: 'Expected feature missing',
  unexpected_feature_enabled: 'Unexpected feature enabled',
  duplicate_local_identity: 'Duplicate local subscription identity',
  coverage_gap: 'Coverage gap',
  monitoring_health: 'Monitoring health',
};

export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const snap = runAssessment();
  const incidents = [...snap.incidents, ...coverageIncidents(snap.assessments)];
  const inc = incidents.find((i) => i.id === id);
  if (!inc) notFound();

  const assessment = snap.assessments.find((a) => a.accountId === inc.accountId);
  const exceptions = snap.fixtures.exceptions.filter(
    (e) => e.accountId === inc.accountId && (inc.feature === '*' || e.capability === inc.feature),
  );
  const rule = snap.fixtures.policy.priceMappings.find((m) => m.ruleId === inc.ruleId);

  const explanation =
    inc.state === 'confirmed'
      ? `Confirmed: the discrepancy was seen in ${inc.occurrences} evaluations and a second evaluation at least ${settlingMinutes()} minute(s) after the candidate still shows the mismatch.`
      : inc.state === 'resolved'
        ? `Resolved (${inc.resolutionReason}): the latest evaluation no longer shows this discrepancy with fresh matching evidence.`
        : `Candidate: recorded on first detection (occurrences: ${inc.occurrences}); will confirm only if a second evaluation at least ${settlingMinutes()} minute(s) later still shows the mismatch.`;

  const hypotheses =
    inc.check === 'unexpected_feature_enabled'
      ? [
          'Hypothesis: access was granted manually in the application without a billing change.',
          'Hypothesis: the subscription lapsed but the app-side entitlement job has not run.',
          'Hypothesis: a provisioning bug granted the feature during signup.',
        ]
      : inc.check === 'expected_feature_missing'
        ? [
            'Hypothesis: the entitlement sync job failed or dropped this account.',
            'Hypothesis: a recent plan change was not propagated to the access table.',
          ]
        : inc.check === 'duplicate_local_identity'
          ? ['Hypothesis: the same Stripe subscription was written into two local billing rows.']
          : ['Hypothesis: setup or source coverage is incomplete; review the reasons listed.'];

  return (
    <main>
      <p className="text-sm text-gray-500">
        <Link href="/incidents" className="underline">
          Incidents
        </Link>{' '}
        / {inc.id}
      </p>
      <h1 className="mt-2 text-xl font-semibold">
        {CHECK_TITLES[inc.check] ?? inc.check}: <span className="font-mono">{inc.feature}</span> on{' '}
        <Link href={`/accounts/${inc.accountId}`} className="font-mono underline">
          {inc.accountId}
        </Link>
      </h1>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section className="rounded border p-4">
          <h2 className="mb-2 font-medium">Expected vs observed</h2>
          {inc.state === 'resolved' && (
            <p className="mb-2 text-xs text-gray-500">
              Values at last confirmed mismatch (historical) — see{' '}
              <Link href={`/accounts/${inc.accountId}`} className="underline">
                the account page
              </Link>{' '}
              for current access.
            </p>
          )}
          {inc.expected === undefined ? (
            <p className="text-sm">No boolean expectation (coverage / integrity incident).</p>
          ) : (
            <table className="text-sm">
              <tbody>
                <tr>
                  <td className="pr-4 text-gray-500">expected</td>
                  <td className="font-mono">{String(inc.expected)}</td>
                </tr>
                <tr>
                  <td className="pr-4 text-gray-500">observed</td>
                  <td className="font-mono">{String(inc.observed)}</td>
                </tr>
              </tbody>
            </table>
          )}
          <div className="mt-2 text-sm">
            severity: <strong>{inc.severity}</strong> — state: <strong>{inc.state}</strong>
          </div>
        </section>

        <section className="rounded border p-4">
          <h2 className="mb-2 font-medium">Why {inc.state}</h2>
          <p className="text-sm">{explanation}</p>
          {inc.resolutionReason && (
            <p className="mt-1 text-sm text-gray-500">resolution: {inc.resolutionReason}</p>
          )}
          {inc.evidenceStale && (
            <p className="mt-1 text-sm text-amber-700">
              Awaiting fresh evidence: the latest evaluation could not confirm or clear this
              incident (stale, incomplete or unmapped sources).
            </p>
          )}
        </section>
      </div>

      <section className="mt-4 rounded border p-4">
        <h2 className="mb-2 font-medium">Evidence</h2>
        <ul className="list-inside list-disc font-mono text-xs">
          {inc.evidenceIds.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
        <div className="mt-2 text-sm">
          Applicable rule: <span className="font-mono">{inc.ruleId}</span>
          {rule && (
            <span className="text-gray-500">
              {' '}
              (price {rule.priceId} → {rule.capabilities.join(', ')})
            </span>
          )}
        </div>
        {assessment && assessment.accountReasons.length > 0 && (
          <div className="mt-1 text-sm">
            Account reasons:{' '}
            <span className="font-mono">{assessment.accountReasons.join(', ')}</span>
          </div>
        )}
      </section>

      {exceptions.length > 0 && (
        <section className="mt-4 rounded border p-4">
          <h2 className="mb-2 font-medium">Exceptions</h2>
          <ul className="text-sm">
            {exceptions.map((e) => (
              <li key={e.id}>
                <span className="font-mono">{e.id}</span>: {e.capability} expected=
                {String(e.expected)} until <span className="font-mono">{e.expiresAt}</span> —{' '}
                {e.reason} (owner {e.owner})
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-4 rounded border p-4">
        <h2 className="mb-2 font-medium">Possible causes (hypotheses, not verified)</h2>
        <ul className="list-inside list-disc text-sm text-gray-700">
          {hypotheses.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      </section>

      <div className="mt-4">
        <RecheckButton />
      </div>
    </main>
  );
}
