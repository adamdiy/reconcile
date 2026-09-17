import type {
  AccountAssessment,
  AccountObservation,
  EvaluationInput,
  FeatureEvaluation,
  IntegrityFinding,
  StripeSubscriptionFact,
  UnknownReason,
} from '@reconcile/domain';
import { createHash } from 'node:crypto';

export const ENGINE_VERSION = '0.1.0-hackathon';

type Revisioned = { observedAt: string; sourceRevision?: string };

function revisionKey(r: Revisioned): [string, string] {
  return [r.sourceRevision ?? '', r.observedAt];
}

function compareRevision(a: Revisioned, b: Revisioned): number {
  const [ar, at] = revisionKey(a);
  const [br, bt] = revisionKey(b);
  if (ar !== br) return ar < br ? -1 : 1;
  if (at !== bt) return at < bt ? -1 : 1;
  return 0;
}

export function canonicalize<T extends Revisioned>(items: T[], keyOf: (item: T) => string): Map<string, T> {
  const out = new Map<string, T>();
  for (const item of items) {
    const key = keyOf(item);
    const prev = out.get(key);
    if (!prev || compareRevision(item, prev) > 0) out.set(key, item);
  }
  return out;
}

export interface Subject {
  accountId: string;
  account?: AccountObservation;
  customerIds: string[];
  collectorCustomerIds: string[];
  linkCount: number;
  synthetic: boolean;
  absentFromCompleteInventory: boolean;
}

export function buildPopulation(input: EvaluationInput): Subject[] {
  const accounts = canonicalize(input.app.accounts, (a) => a.accountId);
  const linksByAccount = new Map<string, string[]>();
  const linksByCustomer = new Map<string, string>();
  for (const link of input.links) {
    linksByAccount.set(link.accountId, [...(linksByAccount.get(link.accountId) ?? []), link.stripeCustomerId]);
    linksByCustomer.set(link.stripeCustomerId, link.accountId);
  }
  const subjects = new Map<string, Subject>();
  const get = (accountId: string): Subject => {
    let s = subjects.get(accountId);
    if (!s) {
      s = {
        accountId,
        customerIds: [],
        collectorCustomerIds: [],
        linkCount: 0,
        synthetic: false,
        absentFromCompleteInventory: false,
      };
      subjects.set(accountId, s);
    }
    return s;
  };
  for (const account of accounts.values()) {
    const s = get(account.accountId);
    s.account = account;
    s.collectorCustomerIds = [...account.stripeCustomerIds].sort();
  }
  const linkedCustomerIntoAccount = new Set<string>();
  for (const [accountId, customerIds] of linksByAccount) {
    const s = get(accountId);
    s.linkCount = customerIds.length;
    s.customerIds = [...customerIds].sort();
    for (const c of customerIds) linkedCustomerIntoAccount.add(c);
  }
  const customers = canonicalize(input.stripe.customers, (c) => c.id);
  const collectorReferenced = new Set<string>();
  for (const account of accounts.values()) for (const c of account.stripeCustomerIds) collectorReferenced.add(c);
  for (const customer of customers.values()) {
    const linkedAccount = linksByCustomer.get(customer.id);
    if (linkedAccount && !accounts.has(linkedAccount)) {
      const s = get(linkedAccount);
      if (!s.customerIds.includes(customer.id)) s.customerIds.push(customer.id);
      s.customerIds.sort();
      s.absentFromCompleteInventory = input.app.complete;
    } else if (!linkedAccount && !collectorReferenced.has(customer.id)) {
      const s = get(`stripe:${customer.id}`);
      s.synthetic = true;
      if (!s.customerIds.includes(customer.id)) s.customerIds.push(customer.id);
    }
  }
  return [...subjects.values()].sort((a, b) => (a.accountId < b.accountId ? -1 : 1));
}

export type CheckKind =
  | 'unexpected_feature_enabled'
  | 'expected_feature_missing'
  | 'wrong_feature_set'
  | 'duplicate_local_identity'
  | 'coverage_gap'
  | 'monitoring_health';

export type Severity = 'low' | 'medium' | 'high';

export interface SeverityContext {
  subscriptionState?: 'active_or_trialing' | 'grace' | 'other';
  bothPlansPaid?: boolean;
  consecutiveMissedCadences?: number;
}

export function deriveSeverity(check: CheckKind, ctx: SeverityContext = {}): Severity {
  switch (check) {
    case 'unexpected_feature_enabled':
      return 'high';
    case 'expected_feature_missing':
      return ctx.subscriptionState === 'grace' ? 'medium' : 'high';
    case 'wrong_feature_set':
      return ctx.bothPlansPaid === false ? 'low' : 'medium';
    case 'duplicate_local_identity':
      return 'medium';
    case 'coverage_gap':
      return 'low';
    case 'monitoring_health':
      return (ctx.consecutiveMissedCadences ?? 0) >= 2 ? 'medium' : 'low';
  }
}

export function fingerprint(accountId: string, ruleId: string, feature: string): string {
  const digest = createHash('sha256').update(`${accountId}|${ruleId}|${feature}`).digest('hex').slice(0, 16);
  return `fp_${digest}`;
}

export type IncidentLike = {
  accountId: string;
  state: string;
  kind: 'mismatch' | 'integrity' | 'coverage' | 'health';
};

export interface Bucket {
  bucket: 1 | 2 | 3 | 4;
  partialCoverage: boolean;
}

export function bucketAccounts(
  assessments: AccountAssessment[],
  incidents: IncidentLike[],
): Map<string, Bucket> {
  const out = new Map<string, Bucket>();
  for (const a of assessments) {
    const hasConfirmed = incidents.some(
      (i) => i.accountId === a.accountId && i.kind === 'mismatch' && i.state === 'confirmed',
    );
    const hasMismatch = a.features.some((f) => f.kind === 'mismatch');
    const hasUnknownFeature = a.features.some((f) => f.kind === 'unknown');
    let bucket: Bucket['bucket'];
    if (hasConfirmed) bucket = 1;
    else if (hasMismatch) bucket = 2;
    else if (a.accountReasons.length > 0) bucket = 3;
    else bucket = 4;
    const partialCoverage = hasUnknownFeature && a.accountReasons.length === 0;
    out.set(a.accountId, { bucket, partialCoverage });
  }
  return out;
}

interface Entitlement {
  subscription: StripeSubscriptionFact;
  mapping: { ruleId: string; priceId: string; capabilities: string[] };
}

function cancelEffectiveTime(sub: StripeSubscriptionFact): string | undefined {
  if (sub.cancelAt) return sub.cancelAt;
  if (sub.cancelAtPeriodEnd) return sub.currentPeriodEnd;
  return undefined;
}

function isEntitling(sub: StripeSubscriptionFact, input: EvaluationInput, evaluatedMs: number): boolean {
  switch (sub.status) {
    case 'trialing':
      return input.policy.lifecycle.trialGrantsAccess;
    case 'active': {
      const eff = cancelEffectiveTime(sub);
      if (eff && Date.parse(eff) <= evaluatedMs) return false;
      return true;
    }
    case 'past_due': {
      if (!sub.firstFailedInvoiceDueAt) return false;
      const graceEnd =
        Date.parse(sub.firstFailedInvoiceDueAt) + input.policy.lifecycle.pastDueGraceHours * 3_600_000;
      return evaluatedMs < graceEnd;
    }
    default:
      return false;
  }
}

function graceEndIso(sub: StripeSubscriptionFact, graceHours: number): string | undefined {
  if (!sub.firstFailedInvoiceDueAt) return undefined;
  return new Date(Date.parse(sub.firstFailedInvoiceDueAt) + graceHours * 3_600_000).toISOString();
}

const POTENTIALLY_ENTITLING = new Set(['trialing', 'active', 'past_due', 'paused']);

export function evaluate(input: EvaluationInput): AccountAssessment[] {
  const evaluatedMs = Date.parse(input.evaluatedAt);
  const policy = input.policy;
  const engineVersion = input.engineVersion ?? ENGINE_VERSION;
  const staleMs = policy.freshness.maxEvidenceAgeMinutes * 60_000;

  const subs = canonicalize(input.stripe.subscriptions, (s) => s.id);
  const customers = canonicalize(input.stripe.customers, (c) => c.id);
  const subjects = buildPopulation(input);

  const subsByCustomer = new Map<string, StripeSubscriptionFact[]>();
  for (const sub of subs.values()) {
    subsByCustomer.set(sub.customerId, [...(subsByCustomer.get(sub.customerId) ?? []), sub]);
  }

  const capabilityRuleIds = new Map<string, string[]>();
  for (const m of policy.priceMappings) {
    for (const cap of m.capabilities) {
      capabilityRuleIds.set(cap, [...(capabilityRuleIds.get(cap) ?? []), m.ruleId]);
    }
  }
  const defaultRuleId = (cap: string): string =>
    capabilityRuleIds.get(cap)?.[0] ?? `${policy.ruleIdPrefix ?? 'policy'}:${cap}`;

  // integrity: duplicate local subscription identity across all accounts
  const bySubId = new Map<string, { accountId: string; localId: string }[]>();
  for (const s of subjects) {
    for (const rec of s.account?.localBillingRecords ?? []) {
      if (!rec.stripeSubscriptionId) continue;
      bySubId.set(rec.stripeSubscriptionId, [
        ...(bySubId.get(rec.stripeSubscriptionId) ?? []),
        { accountId: s.accountId, localId: rec.localId },
      ]);
    }
  }
  const integrityByAccount = new Map<string, IntegrityFinding[]>();
  for (const [subId, records] of bySubId) {
    if (records.length < 2) continue;
    const finding: IntegrityFinding = {
      kind: 'duplicate_local_identity',
      localRecordIds: records.map((r) => r.localId).sort(),
      stripeSubscriptionId: subId,
      evidenceIds: records.map((r) => `local:${r.accountId}:${r.localId}#${subId}`),
    };
    for (const accountId of new Set(records.map((r) => r.accountId))) {
      integrityByAccount.set(accountId, [...(integrityByAccount.get(accountId) ?? []), finding]);
    }
  }

  const assessments: AccountAssessment[] = subjects.map((subject) => {
    const evidence: string[] = [`policy:${policy.version}`];
    if (subject.account) {
      evidence.push(`app:${subject.accountId}@${subject.account.observedAt}`);
    } else if (subject.absentFromCompleteInventory) {
      evidence.push(`app:absent:${subject.accountId}@${input.app.observedAt}#complete-inventory`);
    }

    const subjectSubs: StripeSubscriptionFact[] = [];
    let customerDeleted = false;
    for (const cid of subject.customerIds) {
      const customer = customers.get(cid);
      if (customer) {
        evidence.push(`stripe:customer:${cid}@${customer.observedAt}`);
        if (customer.deleted) customerDeleted = true;
      }
      for (const sub of subsByCustomer.get(cid) ?? []) {
        subjectSubs.push(sub);
      }
    }
    subjectSubs.sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const sub of subjectSubs) {
      evidence.push(
        `stripe:sub:${sub.id}@${sub.observedAt}${sub.zeroValue ? '#zero_value' : ''}`,
      );
    }

    const reasons = new Set<UnknownReason>();
    if (!input.stripe.complete || !input.app.complete) reasons.add('incomplete_inventory');
    if (input.stripe.permissionsMissing.length > 0) reasons.add('missing_permission');
    if (subject.synthetic) reasons.add('unmapped_identity');
    else if (subject.linkCount === 0 && subject.collectorCustomerIds.length > 0)
      reasons.add('unmapped_identity');
    else if (
      subject.linkCount === 1 &&
      subject.collectorCustomerIds.length > 0 &&
      !subject.collectorCustomerIds.includes(subject.customerIds[0])
    )
      reasons.add('unmapped_identity');
    if (subject.linkCount > 1) reasons.add('ambiguous_identity');
    if (!input.stripe.complete || !input.app.complete) {
      // completeness unknown -> per-record staleness cannot establish absence either
    } else {
      if (subject.account && evaluatedMs - Date.parse(subject.account.observedAt) > staleMs)
        reasons.add('stale_evidence');
      for (const sub of subjectSubs)
        if (evaluatedMs - Date.parse(sub.observedAt) > staleMs) reasons.add('stale_evidence');
    }

    const candidateSubs = customerDeleted ? [] : subjectSubs;
    const entitlingSubs = candidateSubs.filter((s) => isEntitling(s, input, evaluatedMs));
    const malformed = candidateSubs.some(
      (s) =>
        POTENTIALLY_ENTITLING.has(s.status) &&
        (s.items.length !== 1 ||
          s.items.some((i) => i.quantity !== 1) ||
          s.scheduleId !== undefined ||
          s.pauseCollection === true ||
          s.status === 'paused'),
    );
    if (malformed || entitlingSubs.length > 1) reasons.add('unsupported_billing_model');

    const entitlements: Entitlement[] = [];
    for (const sub of entitlingSubs) {
      const priceId = sub.items[0]?.priceId;
      const mapping = policy.priceMappings.find((m) => m.priceId === priceId);
      if (!mapping) reasons.add('unsupported_policy');
      else entitlements.push({ subscription: sub, mapping });
    }

    const accountReasons = [...reasons].sort();
    const nextTransitions: number[] = [];
    for (const sub of entitlingSubs) {
      if (sub.status === 'trialing' && sub.trialEnd) nextTransitions.push(Date.parse(sub.trialEnd));
      if (sub.status === 'past_due') {
        const g = graceEndIso(sub, policy.lifecycle.pastDueGraceHours);
        if (g) nextTransitions.push(Date.parse(g));
      }
      if (sub.status === 'active') {
        const eff = cancelEffectiveTime(sub);
        if (eff) nextTransitions.push(Date.parse(eff));
      }
    }

    const features: FeatureEvaluation[] = policy.capabilities.map((cap) => {
      const baseEvidence = [...evidence];
      if (accountReasons.length > 0) {
        return { kind: 'unknown', feature: cap, reasons: accountReasons, evidenceIds: baseEvidence };
      }
      let expected = entitlements.some((e) => e.mapping.capabilities.includes(cap));
      let ruleId = expected
        ? entitlements.find((e) => e.mapping.capabilities.includes(cap))!.mapping.ruleId
        : defaultRuleId(cap);
      const capExceptions = input.exceptions.filter(
        (e) =>
          e.accountId === subject.accountId &&
          e.capability === cap &&
          Date.parse(e.expiresAt) > evaluatedMs,
      );
      for (const e of capExceptions) {
        baseEvidence.push(`exception:${e.id}`);
        nextTransitions.push(Date.parse(e.expiresAt));
      }
      if (new Set(capExceptions.map((e) => e.expected)).size > 1) {
        return {
          kind: 'unknown',
          ruleId,
          feature: cap,
          reasons: ['conflicting_exceptions'],
          evidenceIds: baseEvidence,
        };
      }
      if (capExceptions.length === 1) {
        expected = capExceptions[0].expected;
        ruleId = `exception:${capExceptions[0].id}`;
      }
      const observedRaw = subject.absentFromCompleteInventory
        ? false
        : subject.account?.access[cap];
      if (observedRaw === undefined) {
        return {
          kind: 'unknown',
          ruleId,
          feature: cap,
          reasons: ['unobserved_feature'],
          evidenceIds: baseEvidence,
        };
      }
      return observedRaw === expected
        ? { kind: 'match', ruleId, feature: cap, expected, evidenceIds: baseEvidence }
        : {
            kind: 'mismatch',
            ruleId,
            feature: cap,
            expected,
            observed: observedRaw,
            evidenceIds: baseEvidence,
          };
    });

    const future = nextTransitions.filter((t) => t > evaluatedMs).sort((a, b) => a - b);
    return {
      accountId: subject.accountId,
      policyVersion: policy.version,
      engineVersion,
      evaluatedAt: input.evaluatedAt,
      accountReasons,
      features,
      integrity: integrityByAccount.get(subject.accountId) ?? [],
      nextTransitionAt: future.length ? new Date(future[0]).toISOString() : undefined,
    };
  });

  return assessments;
}
