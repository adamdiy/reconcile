import type { AccountAssessment } from '@reconcile/domain';
import type { Incident } from './state';

export function coverageIncidents(assessments: AccountAssessment[]): Incident[] {
  const out: Incident[] = [];
  for (const a of assessments) {
    for (const reason of a.accountReasons) {
      out.push({
        id: `cov:${a.accountId}:${reason}`,
        accountId: a.accountId,
        ruleId: `coverage:${reason}`,
        feature: '*',
        check: 'coverage_gap',
        kind: 'coverage',
        severity: 'low',
        state: 'candidate',
        firstSeenAt: a.evaluatedAt,
        lastConfirmedAt: a.evaluatedAt,
        occurrences: 1,
        reasons: [reason],
        evidenceIds: a.features[0]?.evidenceIds ?? [],
      });
    }
  }
  return out;
}
