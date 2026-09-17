import { loadFixtures } from '@reconcile/fixtures';
import type { FixtureSet } from '@reconcile/fixtures';
import { evaluateProject } from '@reconcile/core';
import { ENGINE_VERSION } from '@reconcile/engine';
import type { AccountAssessment, IdentityLink, Policy, PolicyException } from '@reconcile/domain';
import {
  createStore,
  seedFromFixtures,
} from '@reconcile/store';
import type { AssessmentRun, PolicyVersion, SourceSnapshot, Store } from '@reconcile/store';
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
    if (opts.reimportSources) {
      const now = new Date().toISOString();
      await ps.putSources({
        stripe: fixtures.stripe,
        app: fixtures.app,
        importedAt: now,
        origin: 'fixtures',
        origins: { stripe: 'fixtures', app: 'fixtures' },
      });
    }
    const ev = await evaluateProject(store, projectId, {
      fallback: { stripe: fixtures.stripe, app: fixtures.app, policy: fixtures.policy },
      settlingMs: settlingMinutes() * 60_000,
    });
    const {
      evaluatedAt, sources, publishedPolicy, policy, links, exceptions,
      assessments, prevIncidents, stored, incidents, buckets,
      bucketCounts, coveredPairs, totalPairs, unknownReasons, nextTransitionAt,
    } = ev;
    await ps.putIncidents(stored);
    const { verifyRepairs } = await import('./repairs');
    await verifyRepairs(ps, assessments);

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
