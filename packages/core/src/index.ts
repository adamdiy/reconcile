import { bucketAccounts, deriveSeverity, evaluate } from '@reconcile/engine';
import type {
  AccountAssessment,
  IdentityLink,
  Incident,
  Policy,
  PolicyException,
  StoredIncident,
} from '@reconcile/domain';
import type { PolicyVersion, SourceSnapshot, Store } from '@reconcile/store';
import { reconcileIncidents } from './incidents.js';

export { reconcileIncidents, checkFor } from './incidents.js';
export type { ReconcileContext } from './incidents.js';

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

export interface ProjectEvaluation {
  projectId: string;
  sources: SourceSnapshot;
  publishedPolicy: PolicyVersion | null;
  policy: Policy;
  links: IdentityLink[];
  exceptions: PolicyException[];
  assessments: AccountAssessment[];
  prevIncidents: Record<string, StoredIncident>;
  stored: Record<string, StoredIncident>;
  incidents: Incident[];
  buckets: Map<string, { bucket: 1 | 2 | 3 | 4; partialCoverage: boolean }>;
  bucketCounts: [number, number, number, number];
  coveredPairs: number;
  totalPairs: number;
  unknownReasons: Record<string, number>;
  nextTransitionAt?: string;
  evaluatedAt: string;
}

export interface EvaluateOptions {
  fallback: { stripe: SourceSnapshot['stripe']; app: SourceSnapshot['app']; policy: Policy };
  settlingMs: number;
  evaluatedAt?: string;
}

/**
 * Pure read evaluation: reads sources/policy/links/exceptions/incidents and
 * computes assessments + reconciled incident state in memory. No writes — the
 * caller decides what to persist.
 */
export async function evaluateProject(
  store: Store,
  projectId: string,
  opts: EvaluateOptions,
): Promise<ProjectEvaluation> {
  const ps = store.forProject(projectId);
  const evaluatedAt = opts.evaluatedAt ?? new Date().toISOString();
  const sources = (await ps.getSources()) ?? {
    stripe: opts.fallback.stripe,
    app: opts.fallback.app,
    importedAt: evaluatedAt,
    origin: 'fixtures' as const,
    origins: { stripe: 'fixtures' as const, app: 'fixtures' as const },
  };
  const publishedPolicy = await ps.getPublishedPolicy();
  const policy = publishedPolicy?.policy ?? opts.fallback.policy;
  const links = await ps.listLinks();
  const exceptions = await ps.listExceptions();
  const prevIncidents = await ps.getIncidents();

  const assessments = evaluate({
    stripe: sources.stripe,
    app: sources.app,
    links,
    policy,
    exceptions,
    evaluatedAt,
  });
  const { stored, incidents } = reconcileIncidents(
    prevIncidents,
    assessments,
    evaluatedAt,
    opts.settlingMs,
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
            subscriptionState: lifecycleFor(sources, links, policy.lifecycle.pastDueGraceHours, a),
          },
        ),
    },
  );

  const buckets = bucketAccounts(
    assessments,
    incidents.map((i) => ({ accountId: i.accountId, state: i.state, kind: i.kind })),
  );
  const bucketCounts: [number, number, number, number] = [0, 0, 0, 0];
  for (const b of buckets.values()) bucketCounts[b.bucket - 1] += 1;
  let coveredPairs = 0;
  let totalPairs = 0;
  const unknownReasons: Record<string, number> = {};
  for (const a of assessments)
    for (const f of a.features) {
      totalPairs += 1;
      if (f.kind !== 'unknown') coveredPairs += 1;
      else for (const r of f.reasons) unknownReasons[r] = (unknownReasons[r] ?? 0) + 1;
    }
  const nextTransitionAt = assessments
    .map((a) => a.nextTransitionAt)
    .filter((t): t is string => Boolean(t))
    .sort()[0];

  return {
    projectId,
    sources,
    publishedPolicy,
    policy,
    links,
    exceptions,
    assessments,
    prevIncidents,
    stored,
    incidents,
    buckets,
    bucketCounts,
    coveredPairs,
    totalPairs,
    unknownReasons,
    nextTransitionAt,
    evaluatedAt,
  };
}
