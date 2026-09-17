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
import { getSession } from './auth';
import { newJob } from '@reconcile/jobs';
import { ruleMatches, notificationFor, idempotencyKey } from '@reconcile/notify';
import type { ProjectStore } from '@reconcile/store';

/** After a recorded assessment, enqueue one notify job per matching incident transition. */
async function enqueueTransitionNotifications(
  store: Store,
  ps: ProjectStore,
  projectId: string,
  prev: Record<string, StoredIncident>,
  incidents: Incident[],
  at: string,
): Promise<void> {
  const rules = await ps.listNotificationRules();
  if (rules.length === 0) return;
  for (const inc of incidents) {
    const before = prev[inc.id];
    if (!before) continue;
    const prevLabel = before.state === 'resolved' ? (before.resolutionReason ?? 'resolved') : before.state;
    const nextLabel = inc.state === 'resolved' ? (inc.resolutionReason ?? 'resolved') : inc.state;
    if (prevLabel === nextLabel) continue;
    // Snoozed or accepted-risk incidents never notify.
    const wf = inc.workflow;
    if (wf?.acceptedRisk) continue;
    if (wf?.snoozedUntil && wf.snoozedUntil > at) continue;
    const transition = {
      fingerprint: inc.id,
      accountId: inc.accountId,
      checkKind: inc.check,
      feature: inc.feature,
      severity: inc.severity,
      to: nextLabel,
      at,
    };
    for (const rule of rules) {
      if (!ruleMatches(rule, transition)) continue;
      const notification = notificationFor(projectId, rule, transition);
      await store.enqueueJob(
        newJob('notify', projectId, idempotencyKey(rule.id, transition), at, {
          ruleId: rule.id,
          notification,
        }),
      );
    }
  }
}
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

export async function withProject<T>(
  projectId: string,
  fn: (store: Store, ps: ProjectStore) => Promise<T>,
): Promise<T> {
  return withStore(async (store) => {
    await seedFromFixtures(store, loadFixtures());
    return fn(store, store.forProject(projectId));
  });
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
    if (sub.pauseCollection === true || sub.status === 'paused') continue;
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
  projectId: string;
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

export async function runAssessment(
  opts: { reimportSources?: boolean; record?: boolean; projectId?: string } = {},
): Promise<AssessmentSnapshot> {
  const fixtures = loadFixtures();
  const projectId = opts.projectId ?? (await getSession())?.projectId ?? 'default';
  return withStore(async (store) => {
    await seedFromFixtures(store, fixtures);
    const ps = store.forProject(projectId);
    const evaluatedAt = new Date().toISOString();
    if (opts.reimportSources) {
      await ps.putSources({
        stripe: fixtures.stripe,
        app: fixtures.app,
        importedAt: evaluatedAt,
        origin: 'fixtures',
        origins: { stripe: 'fixtures', app: 'fixtures' },
      });
    }
    const sources = (await ps.getSources()) ?? {
      stripe: fixtures.stripe,
      app: fixtures.app,
      importedAt: evaluatedAt,
      origin: 'fixtures' as const,
      origins: { stripe: 'fixtures' as const, app: 'fixtures' as const },
    };
    const publishedPolicy = await ps.getPublishedPolicy();
    const policy = publishedPolicy?.policy ?? fixtures.policy;
    const links = await ps.listLinks();
    const exceptions = await ps.listExceptions();

    const assessments = evaluate({
      stripe: sources.stripe,
      app: sources.app,
      links,
      policy,
      exceptions,
      evaluatedAt,
    });
    const prevIncidents = await ps.getIncidents();
    const { stored, incidents } = reconcileIncidents(
      prevIncidents,
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
    await ps.putIncidents(stored);

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
    const unknownReasons: Record<string, number> = {};
    for (const a of assessments)
      for (const f of a.features)
        if (f.kind === 'unknown')
          for (const r of f.reasons) unknownReasons[r] = (unknownReasons[r] ?? 0) + 1;
    const nextTransitionAt = assessments
      .map((a) => a.nextTransitionAt)
      .filter((t): t is string => Boolean(t))
      .sort()[0];
    if (opts.record) {
      await ps.recordRun({
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
          unknownReasons,
        },
        nextTransitionAt,
      });
      await enqueueTransitionNotifications(store, ps, projectId, prevIncidents, incidents, evaluatedAt);
    }

    return {
      projectId,
      fixtures,
      sources,
      publishedPolicy,
      policyVersions: await ps.listPolicyVersions(),
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
