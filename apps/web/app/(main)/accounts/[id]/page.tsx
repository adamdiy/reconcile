import Link from 'next/link';
import { notFound } from 'next/navigation';
import { runAssessment } from '../../../../lib/state';

export const dynamic = 'force-dynamic';

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const snap = await runAssessment();
  const a = snap.assessments.find((x) => x.accountId === id);
  if (!a) notFound();

  const links = snap.links.filter((l) => l.accountId === id);
  const customerIds = new Set(links.map((l) => l.stripeCustomerId));
  const subs = snap.sources.stripe.subscriptions.filter((s) => customerIds.has(s.customerId));
  const observation = snap.sources.app.accounts.find((x) => x.accountId === id);
  const bucket = snap.buckets.get(id);
  const exceptions = snap.exceptions.filter((e) => e.accountId === id);

  return (
    <main>
      <p className="text-sm text-gray-500">
        <Link href="/" className="underline">
          Overview
        </Link>{' '}
        / account
      </p>
      <h1 className="mt-2 font-mono text-xl font-semibold">{a.accountId}</h1>
      <div className="mt-1 text-sm text-gray-600">
        bucket {bucket?.bucket}
        {bucket?.partialCoverage ? ' (partial coverage)' : ''} — evaluated {a.evaluatedAt}
        {a.nextTransitionAt && (
          <span>
            {' '}
            — next policy-relevant transition:{' '}
            <span className="font-mono">{a.nextTransitionAt}</span>
          </span>
        )}
      </div>
      {a.accountReasons.length > 0 && (
        <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
          account reasons: <span className="font-mono">{a.accountReasons.join(', ')}</span>
        </div>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section className="rounded border p-4">
          <h2 className="mb-2 font-medium">Billing identities</h2>
          {links.length === 0 && (
            <p className="text-sm text-gray-500">
              no reviewed identity link
              {observation && observation.stripeCustomerIds.length > 0 && (
                <>
                  {' '}
                  — collector suggests{' '}
                  <span className="font-mono">{observation.stripeCustomerIds.join(', ')}</span>
                </>
              )}
            </p>
          )}
          <ul className="text-sm">
            {links.map((l) => (
              <li key={l.stripeCustomerId} className="font-mono">
                {l.stripeCustomerId} (reviewed)
              </li>
            ))}
          </ul>
          {subs.length > 0 && (
            <>
              <h3 className="mt-3 mb-1 text-sm font-medium">Subscriptions</h3>
              <ul className="space-y-1 text-sm">
                {subs.map((s) => (
                  <li key={s.id} className="font-mono text-xs">
                    {s.id} — {s.status}
                    {s.cancelAtPeriodEnd && ` (cancels ${s.cancelAt ?? s.currentPeriodEnd})`}
                    {s.trialEnd && ` trial ends ${s.trialEnd}`}
                    {s.firstFailedInvoiceDueAt && ` first failed invoice ${s.firstFailedInvoiceDueAt}`}
                    {s.zeroValue && ' [zero_value]'}
                    <br />
                    items: {s.items.map((i) => `${i.priceId}x${i.quantity}`).join(', ')}
                  </li>
                ))}
              </ul>
            </>
          )}
          {exceptions.length > 0 && (
            <>
              <h3 className="mt-3 mb-1 text-sm font-medium">Exceptions</h3>
              <ul className="text-xs">
                {exceptions.map((e) => (
                  <li key={e.id}>
                    <span className="font-mono">{e.id}</span> {e.capability}={String(e.expected)}{' '}
                    until {e.expiresAt}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="rounded border p-4">
          <h2 className="mb-2 font-medium">Expected vs observed access</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th>Capability</th>
                <th>Result</th>
                <th>Expected</th>
                <th>Observed</th>
              </tr>
            </thead>
            <tbody>
              {a.features.map((f) => (
                <tr key={f.feature} className="border-t">
                  <td className="py-1 font-mono text-xs">{f.feature}</td>
                  <td className="py-1">{f.kind}</td>
                  <td className="py-1 font-mono text-xs">
                    {f.kind === 'unknown' ? `(${f.reasons.join(',')})` : String(f.expected)}
                  </td>
                  <td className="py-1 font-mono text-xs">
                    {f.kind === 'mismatch'
                      ? String(f.observed)
                      : f.kind === 'match'
                        ? String(f.expected)
                        : '—'}
                  </td>
                </tr>
              ))}
              {(a.quantityChecks ?? []).map((q) => (
                <tr key={q.check + (q.metric ?? '')} className="border-t">
                  <td className="py-1 font-mono text-xs">
                    {q.check === 'seats' ? 'seats' : `usage:${q.metric}`}
                  </td>
                  <td className="py-1">{q.kind}</td>
                  <td className="py-1 font-mono text-xs">
                    {q.kind === 'unknown' ? `(${q.reasons.join(',')})` : q.expected}
                  </td>
                  <td className="py-1 font-mono text-xs">
                    {q.kind === 'unknown' ? '—' : (q.observed ?? '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {observation && (
            <p className="mt-2 text-xs text-gray-500">
              observed via {observation.method} at {observation.observedAt}; omitted keys are
              unknown, not false.
            </p>
          )}
        </section>
      </div>

      {a.integrity.length > 0 && (
        <section className="mt-4 rounded border border-red-300 bg-red-50 p-4">
          <h2 className="mb-2 font-medium">Integrity findings</h2>
          {a.integrity.map((f, i) => (
            <div key={i} className="text-sm">
              {f.kind}: local records <span className="font-mono">{f.localRecordIds.join(', ')}</span>{' '}
              share subscription <span className="font-mono">{f.stripeSubscriptionId}</span>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
