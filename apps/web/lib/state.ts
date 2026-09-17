import { loadFixtures } from '@reconcile/fixtures';
import type { FixtureSet } from '@reconcile/fixtures';
import { bucketAccounts, deriveSeverity, evaluate, ENGINE_VERSION } from '@reconcile/engine';
import type { AccountAssessment, IdentityLink, Policy, PolicyException } from '@reconcile/domain';
import {
  createStore,
  seedFromFixtures,
} from '@reconcile/store';
import type { AssessmentRun, PolicyVersion, SourceSnapshot, Store } from '@reconcile/store';
import { reconcileIncidents } from './incidents';
import type { Incident, IncidentState, StoredIncident } from './incidents';

export type { Incident, IncidentState, StoredIncident };
export type { AssessmentRun, PolicyVersion, SourceSnapshot };
export { createStore, ENGINE_VERSION };

export function settlingMinutes(): number {
  return Number(process.env.SETTLING_MINUTES ?? '0');
}

export async function withStore<T>(fn: (store: Store) => Promise<T>): Promise<T> {
  const store = createStore();
  try {
    await store.migrate();
    return await fn(store);
  } finally {
    await store.close();
  }
}

function lifecycleFor(
  sources: SourceSnapshot,
  links: { accountId: string; stripeCustomerId: string }[],
  graceHours: number,
  assessment: AccountAssessment,
): 'active_or_trialing' | 'grace' | 'other' {
  const link = links.find((l) => l.accountId === assessment.accountId);
  const customerIds = link ? [link.stripeCustomerId] : [];
  const graceMs = graceHours * 3_600_000;
  const now = Date.parse(assessment.evaluatedAt);
  let result: 'active_or_trialing' | 'grace' | 'other' = 'other';
  for (const sub of sources.stripe.subscriptions.filter((s) => customerIds.includes(s.customerId))) {
    if (sub.status === 'active' || sub.status === 'trialing') return 'active_or_trialing';
    if (
      sub.status === 'past_due' &&
      sub.firstFailedInvoiceDueAt &&
      now < Date.parse(sub.firstFailedInvoiceDueAt) + graceMs
    )
      result = 'grace';
  }
  return result;
}

export interface AssessmentSnapshot {
  fixtures: FixtureSet;
  sources: SourceSnapshot;
  publishedPolicy: PolicyVersion | null;
  policyVersions: PolicyVersion[];
  links: IdentityLink[];
  exceptions: PolicyException[];
  policy: Policy;
  assessments: AccountAssessment[];
  incidents: Incident[];
  buckets: Map<string, { bucket: 1 | 2 | 3 | 4; partialCoverage: boolean }>;
  evaluatedAt: string;
}

export async function runAssessment(opts: { reimportSources?: boolean } = {}): Promise<AssessmentSnapshot> {
  const fixtures = loadFixtures();
  return withStore(async (store) => {
    await seedFromFixtures(store, fixtures);
    const evaluatedAt = new Date().toISOString();
    if (opts.reimportSources) {
      await store.putSources({
        stripe: fixtures.stripe,
        app: fixtures.app,
        importedAt: evaluatedAt,
        origin: 'fixtures',
      });
    }
    const sources = (await store.getSources()) ?? {
      stripe: fixtures.stripe,
      app: fixtures.app,
      importedAt: evaluatedAt,
      origin: 'fixtures' as const,
    };
    const publishedPolicy = await store.getPublishedPolicy();
    const policy = publishedPolicy?.policy ?? fixtures.policy;
    const links = await store.listLinks();
    const exceptions = await store.listExceptions();

    const assessments = evaluate({
      stripe: sources.stripe,
      app: sources.app,
      links,
      policy,
      exceptions,
      evaluatedAt,
    });
    const { stored, incidents } = reconcileIncidents(
      await store.getIncidents(),
      assessments,
      evaluatedAt,
      settlingMinutes() * 60_000,
      {
        appComplete: sources.app.complete,
        severityFor: (a, f) =>
          deriveSeverity(
            f.kind === 'mismatch'
              ? f.expected
                ? 'expected_feature_missing'
                : 'unexpected_feature_enabled'
              : 'coverage_gap',
            {
              subscriptionState: lifecycleFor(
                sources,
                links,
                policy.lifecycle.pastDueGraceHours,
                a,
              ),
            },
          ),
      },
    );
    await store.putIncidents(stored);

    const incidentLikes = incidents.map((i) => ({
      accountId: i.accountId,
      state: i.state,
      kind: i.kind,
    }));
    const buckets = bucketAccounts(assessments, incidentLikes);

    const bucketCounts: [number, number, number, number] = [0, 0, 0, 0];
    for (const b of buckets.values()) bucketCounts[b.bucket - 1] += 1;
    let coveredPairs = 0;
    let totalPairs = 0;
    for (const a of assessments)
      for (const f of a.features) {
        totalPairs += 1;
        if (f.kind !== 'unknown') coveredPairs += 1;
      }
    await store.recordRun({
      id: `run_${evaluatedAt}`,
      evaluatedAt,
      policyVersion: policy.version,
      engineVersion: ENGINE_VERSION,
      counts: {
        population: assessments.length,
        buckets: bucketCounts,
        coveredPairs,
        totalPairs,
        incidentsOpen: incidents.filter((i) => i.state !== 'resolved').length,
      },
    });

    return {
      fixtures,
      sources,
      publishedPolicy,
      policyVersions: await store.listPolicyVersions(),
      links,
      exceptions,
      policy,
      assessments,
      incidents,
      buckets,
      evaluatedAt,
    };
  });
}

export function freshnessLabel(a: AccountAssessment): string {
  const ev = a.features[0]?.evidenceIds ?? [];
  let oldest: string | undefined;
  for (const e of ev) {
    const m = e.match(/@([^@#]+)/);
    if (m && (!oldest || m[1] < oldest)) oldest = m[1];
  }
  return oldest ?? 'unknown';
}
