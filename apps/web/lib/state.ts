import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadFixtures, toEvaluationInput } from '@reconcile/fixtures';
import type { FixtureSet } from '@reconcile/fixtures';
import { bucketAccounts, deriveSeverity, evaluate } from '@reconcile/engine';
import type { AccountAssessment, FeatureEvaluation } from '@reconcile/domain';
import type { Severity } from '@reconcile/engine';
import { reconcileIncidents } from './incidents';
import type { Incident, IncidentState, StoredIncident } from './incidents';

export type { Incident, IncidentState, StoredIncident };

const stateDir = path.resolve(process.cwd(), '.reconcile');
const stateFile = path.join(stateDir, 'incidents.json');

export function settlingMinutes(): number {
  return Number(process.env.SETTLING_MINUTES ?? '0');
}

function readState(): Record<string, StoredIncident> {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(s: Record<string, StoredIncident>): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile, JSON.stringify(s, null, 2));
}

export function readPolicyDraft(): {
  mappings: { ruleId: string; priceId: string; capabilities: string[] }[];
  writtenAt: string;
} | null {
  try {
    return JSON.parse(readFileSync(path.join(stateDir, 'policy-draft.json'), 'utf8'));
  } catch {
    return null;
  }
}

function lifecycleFor(
  fx: FixtureSet,
  assessment: AccountAssessment,
): 'active_or_trialing' | 'grace' | 'other' {
  const link = fx.links.find((l) => l.accountId === assessment.accountId);
  const customerIds = link ? [link.stripeCustomerId] : [];
  const graceMs = fx.policy.lifecycle.pastDueGraceHours * 3_600_000;
  const now = Date.parse(assessment.evaluatedAt);
  let result: 'active_or_trialing' | 'grace' | 'other' = 'other';
  for (const sub of fx.stripe.subscriptions.filter((s) => customerIds.includes(s.customerId))) {
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

function severityFor(fx: FixtureSet, a: AccountAssessment, f: FeatureEvaluation): Severity {
  return deriveSeverity(
    f.kind === 'mismatch'
      ? f.expected
        ? 'expected_feature_missing'
        : 'unexpected_feature_enabled'
      : 'coverage_gap',
    { subscriptionState: lifecycleFor(fx, a) },
  );
}

export interface AssessmentSnapshot {
  fixtures: FixtureSet;
  assessments: AccountAssessment[];
  incidents: Incident[];
  buckets: Map<string, { bucket: 1 | 2 | 3 | 4; partialCoverage: boolean }>;
  evaluatedAt: string;
}

export function runAssessment(): AssessmentSnapshot {
  const fixtures = loadFixtures();
  const evaluatedAt = new Date().toISOString();
  const assessments = evaluate(toEvaluationInput(fixtures, evaluatedAt));
  const { stored, incidents } = reconcileIncidents(
    readState(),
    assessments,
    evaluatedAt,
    settlingMinutes() * 60_000,
    {
      appComplete: fixtures.app.complete,
      severityFor: (a, f) => severityFor(fixtures, a, f),
    },
  );
  writeState(stored);
  const incidentLikes = incidents.map((i) => ({ accountId: i.accountId, state: i.state, kind: i.kind }));
  const buckets = bucketAccounts(assessments, incidentLikes);
  return { fixtures, assessments, incidents, buckets, evaluatedAt };
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
