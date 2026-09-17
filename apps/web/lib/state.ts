import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadFixtures, toEvaluationInput } from '@reconcile/fixtures';
import type { FixtureSet } from '@reconcile/fixtures';
import { bucketAccounts, deriveSeverity, evaluate, fingerprint } from '@reconcile/engine';
import type { AccountAssessment, FeatureEvaluation } from '@reconcile/domain';
import type { CheckKind, Severity } from '@reconcile/engine';

export type IncidentState = 'candidate' | 'confirmed' | 'resolved';

export interface Incident {
  id: string;
  accountId: string;
  ruleId: string;
  feature: string;
  check: CheckKind;
  kind: 'mismatch' | 'integrity' | 'coverage' | 'health';
  severity: Severity;
  state: IncidentState;
  firstSeenAt: string;
  lastConfirmedAt: string;
  occurrences: number;
  expected?: boolean;
  observed?: boolean;
  reasons?: string[];
  evidenceIds: string[];
  resolutionReason?: string;
}

const stateDir = path.resolve(process.cwd(), '.reconcile');
const stateFile = path.join(stateDir, 'incidents.json');

export function settlingMinutes(): number {
  return Number(process.env.SETTLING_MINUTES ?? '0');
}

interface Stored {
  firstSeenAt: string;
  lastConfirmedAt: string;
  occurrences: number;
  state: IncidentState;
  resolutionReason?: string;
  snapshot: Omit<Incident, 'id' | 'firstSeenAt' | 'lastConfirmedAt' | 'occurrences' | 'state' | 'resolutionReason'>;
}

function readState(): Record<string, Stored> {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(s: Record<string, Stored>): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile, JSON.stringify(s, null, 2));
}

export function readPolicyDraft(): { mappings: { ruleId: string; priceId: string; capabilities: string[] }[]; writtenAt: string } | null {
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

function checkFor(f: FeatureEvaluation): CheckKind {
  if (f.kind === 'mismatch') return f.expected ? 'expected_feature_missing' : 'unexpected_feature_enabled';
  return 'coverage_gap';
}

function severityFor(fx: FixtureSet, a: AccountAssessment, f: FeatureEvaluation): Severity {
  return deriveSeverity(checkFor(f), { subscriptionState: lifecycleFor(fx, a) });
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
  const stored = readState();
  const now = evaluatedAt;
  const settlingMs = settlingMinutes() * 60_000;
  const seen = new Set<string>();
  const incidents: Incident[] = [];

  for (const a of assessments) {
    for (const f of a.features) {
      if (f.kind !== 'mismatch') continue;
      const id = fingerprint(a.accountId, f.ruleId, f.feature);
      seen.add(id);
      const prev = stored[id];
      const firstSeenAt = prev?.firstSeenAt ?? now;
      const occurrences = (prev?.occurrences ?? 0) + (prev ? 1 : 1);
      let state: IncidentState = 'candidate';
      if (prev && Date.parse(now) - Date.parse(prev.firstSeenAt) >= settlingMs && prev.occurrences >= 1)
        state = 'confirmed';
      const inc: Incident = {
        id,
        accountId: a.accountId,
        ruleId: f.ruleId,
        feature: f.feature,
        check: checkFor(f),
        kind: 'mismatch',
        severity: severityFor(fixtures, a, f),
        state,
        firstSeenAt,
        lastConfirmedAt: now,
        occurrences,
        expected: f.expected,
        observed: f.observed,
        evidenceIds: f.evidenceIds,
      };
      incidents.push(inc);
      stored[id] = {
        firstSeenAt,
        lastConfirmedAt: now,
        occurrences,
        state,
        snapshot: {
          accountId: inc.accountId,
          ruleId: inc.ruleId,
          feature: inc.feature,
          check: inc.check,
          kind: inc.kind,
          severity: inc.severity,
          expected: inc.expected,
          observed: inc.observed,
          evidenceIds: inc.evidenceIds,
        },
      };
    }
    for (const finding of a.integrity) {
      const id = fingerprint(a.accountId, 'integrity', finding.stripeSubscriptionId ?? finding.localRecordIds.join(','));
      seen.add(id);
      const prev = stored[id];
      const firstSeenAt = prev?.firstSeenAt ?? now;
      const inc: Incident = {
        id,
        accountId: a.accountId,
        ruleId: 'integrity:duplicate_local_identity',
        feature: finding.stripeSubscriptionId ?? 'unknown',
        check: 'duplicate_local_identity',
        kind: 'integrity',
        severity: deriveSeverity('duplicate_local_identity'),
        state: prev && Date.parse(now) - Date.parse(prev.firstSeenAt) >= settlingMs ? 'confirmed' : 'candidate',
        firstSeenAt,
        lastConfirmedAt: now,
        occurrences: (prev?.occurrences ?? 0) + 1,
        evidenceIds: finding.evidenceIds,
      };
      incidents.push(inc);
      stored[id] = {
        firstSeenAt,
        lastConfirmedAt: now,
        occurrences: inc.occurrences,
        state: inc.state,
        snapshot: {
          accountId: inc.accountId,
          ruleId: inc.ruleId,
          feature: inc.feature,
          check: inc.check,
          kind: inc.kind,
          severity: inc.severity,
          evidenceIds: inc.evidenceIds,
        },
      };
    }
  }

  for (const [id, s] of Object.entries(stored)) {
    if (!seen.has(id) && s.state !== 'resolved') {
      s.state = 'resolved';
      s.resolutionReason = 'verified_remediated';
      incidents.push({ id, ...s.snapshot, state: 'resolved', firstSeenAt: s.firstSeenAt, lastConfirmedAt: s.lastConfirmedAt, occurrences: s.occurrences, resolutionReason: 'verified_remediated' });
    } else if (!seen.has(id) && s.state === 'resolved') {
      incidents.push({ id, ...s.snapshot, state: 'resolved', firstSeenAt: s.firstSeenAt, lastConfirmedAt: s.lastConfirmedAt, occurrences: s.occurrences, resolutionReason: s.resolutionReason });
    }
  }

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
