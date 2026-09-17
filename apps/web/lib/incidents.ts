import { fingerprint, deriveSeverity } from '@reconcile/engine';
import type { CheckKind, Severity } from '@reconcile/domain';
import type {
  AccountAssessment,
  FeatureEvaluation,
  Incident,
  IncidentState,
  IncidentSnapshot,
  StoredIncident,
} from '@reconcile/domain';

export type { CheckKind, Incident, IncidentState, IncidentSnapshot, Severity, StoredIncident };

export function checkFor(f: FeatureEvaluation): CheckKind {
  if (f.kind === 'mismatch')
    return f.expected ? 'expected_feature_missing' : 'unexpected_feature_enabled';
  return 'coverage_gap';
}

export interface ReconcileContext {
  appComplete: boolean;
  severityFor: (a: AccountAssessment, f: FeatureEvaluation) => Severity;
}

interface Detection {
  id: string;
  snapshot: IncidentSnapshot;
  assessment: AccountAssessment;
}

export function reconcileIncidents(
  prev: Record<string, StoredIncident>,
  assessments: AccountAssessment[],
  now: string,
  settlingMs: number,
  ctx: ReconcileContext,
): { stored: Record<string, StoredIncident>; incidents: Incident[] } {
  const nowMs = Date.parse(now);
  const stored: Record<string, StoredIncident> = {};
  for (const [k, v] of Object.entries(prev)) stored[k] = { ...v, snapshot: { ...v.snapshot } };
  const incidents: Incident[] = [];
  const detections = new Map<string, Detection>();

  for (const a of assessments) {
    for (const f of a.features) {
      if (f.kind !== 'mismatch') continue;
      const id = fingerprint(a.accountId, f.ruleId, f.feature);
      detections.set(id, {
        id,
        assessment: a,
        snapshot: {
          accountId: a.accountId,
          ruleId: f.ruleId,
          feature: f.feature,
          check: checkFor(f),
          kind: 'mismatch',
          severity: ctx.severityFor(a, f),
          expected: f.expected,
          observed: f.observed,
          evidenceIds: f.evidenceIds,
        },
      });
    }
    for (const finding of a.integrity) {
      const id = fingerprint(
        a.accountId,
        'integrity',
        finding.stripeSubscriptionId ?? finding.localRecordIds.join(','),
      );
      detections.set(id, {
        id,
        assessment: a,
        snapshot: {
          accountId: a.accountId,
          ruleId: 'integrity:duplicate_local_identity',
          feature: finding.stripeSubscriptionId ?? 'unknown',
          check: 'duplicate_local_identity',
          kind: 'integrity',
          severity: deriveSeverity('duplicate_local_identity'),
          evidenceIds: finding.evidenceIds,
        },
      });
    }
  }

  for (const [id, det] of detections) {
    const prevEntry = stored[id];
    const reopen = prevEntry?.state === 'resolved';
    const firstSeenAt = !prevEntry || reopen ? now : prevEntry.firstSeenAt;
    const occurrences = !prevEntry || reopen ? 1 : prevEntry.occurrences + 1;
    const state: IncidentState =
      nowMs - Date.parse(firstSeenAt) >= settlingMs && occurrences >= 1 ? 'confirmed' : 'candidate';
    stored[id] = {
      firstSeenAt,
      lastConfirmedAt: now,
      occurrences,
      state,
      snapshot: det.snapshot,
    };
    incidents.push({ id, ...det.snapshot, state, firstSeenAt, lastConfirmedAt: now, occurrences });
  }

  const byAccount = new Map(assessments.map((a) => [a.accountId, a]));

  for (const [id, entry] of Object.entries(stored)) {
    if (detections.has(id)) continue;
    const snap = entry.snapshot;
    const assessment = byAccount.get(snap.accountId);

    let resolved = false;
    let stale = false;
    let reason: string | undefined;

    if (!assessment) {
      if (ctx.appComplete) {
        resolved = true;
        reason = 'subject_removed';
      } else {
        stale = true;
      }
    } else if (assessment.accountReasons.length > 0) {
      stale = true;
    } else if (snap.kind === 'integrity') {
      const stillDuplicate = assessment.integrity.some(
        (f) =>
          fingerprint(
            snap.accountId,
            'integrity',
            f.stripeSubscriptionId ?? f.localRecordIds.join(','),
          ) === id,
      );
      if (stillDuplicate) {
        // should not happen: detection set would have contained it
        stale = true;
      } else {
        resolved = true;
        reason = 'verified_remediated';
      }
    } else {
      const feature = assessment.features.find((f) => f.feature === snap.feature);
      if (feature?.kind === 'match') {
        resolved = true;
        reason = 'verified_remediated';
      } else {
        stale = true;
      }
    }

    if (entry.state === 'resolved') {
      incidents.push({
        id,
        ...snap,
        state: 'resolved',
        resolutionReason: entry.resolutionReason,
        firstSeenAt: entry.firstSeenAt,
        lastConfirmedAt: entry.lastConfirmedAt,
        occurrences: entry.occurrences,
      });
      continue;
    }
    if (resolved) {
      entry.state = 'resolved';
      entry.resolutionReason = reason;
      entry.evidenceStale = false;
    } else if (stale) {
      entry.evidenceStale = true;
    }
    incidents.push({
      id,
      ...snap,
      state: entry.state,
      resolutionReason: entry.resolutionReason,
      evidenceStale: entry.evidenceStale,
      firstSeenAt: entry.firstSeenAt,
      lastConfirmedAt: entry.lastConfirmedAt,
      occurrences: entry.occurrences,
    });
  }

  return { stored, incidents };
}
