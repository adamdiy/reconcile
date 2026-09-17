import { describe, expect, it } from 'vitest';
import type { AccountAssessment } from '@reconcile/domain';
import { fingerprint } from '@reconcile/engine';
import { reconcileIncidents } from '../lib/incidents';
import type { StoredIncident } from '../lib/incidents';

const T0 = '2026-09-17T00:00:00Z';
const T1 = '2026-09-17T00:10:00Z';

const ctx = { appComplete: true, severityFor: () => 'high' as const };

function assessment(overrides: Partial<AccountAssessment> = {}): AccountAssessment {
  return {
    accountId: 'acct_1',
    policyVersion: 'v1',
    engineVersion: 'test',
    evaluatedAt: T1,
    accountReasons: [],
    features: [],
    integrity: [],
    quantityChecks: [],
    ...overrides,
  };
}

function mismatchState(): {
  prev: Record<string, StoredIncident>;
  id: string;
} {
  const id = fingerprint('acct_1', 'plan:pro', 'exports');
  return {
    id,
    prev: {
      [id]: {
        firstSeenAt: T0,
        lastConfirmedAt: T0,
        occurrences: 1,
        state: 'candidate',
        snapshot: {
          accountId: 'acct_1',
          ruleId: 'plan:pro',
          feature: 'exports',
          check: 'expected_feature_missing',
          kind: 'mismatch',
          severity: 'high',
          expected: true,
          observed: false,
          evidenceIds: ['app:acct_1@x'],
        },
      },
    },
  };
}

const mismatchFeature = {
  kind: 'mismatch' as const,
  ruleId: 'plan:pro',
  feature: 'exports',
  expected: true,
  observed: false,
  evidenceIds: ['app:acct_1@x'],
};

describe('reconcileIncidents', () => {
  it('mismatch still present after settling confirms', () => {
    const { prev } = mismatchState();
    const a = assessment({ features: [mismatchFeature] });
    const { incidents } = reconcileIncidents(prev, [a], T1, 5 * 60_000, ctx);
    expect(incidents[0].state).toBe('confirmed');
    expect(incidents[0].occurrences).toBe(2);
  });

  it('mismatch present but settling not elapsed stays candidate', () => {
    const { prev } = mismatchState();
    const a = assessment({ features: [mismatchFeature] });
    const { incidents } = reconcileIncidents(prev, [a], T1, 60 * 60_000, ctx);
    expect(incidents[0].state).toBe('candidate');
  });

  it('mismatch gone and feature now matches resolves verified_remediated', () => {
    const { prev } = mismatchState();
    const a = assessment({
      features: [
        {
          kind: 'match',
          ruleId: 'plan:pro',
          feature: 'exports',
          expected: true,
          evidenceIds: ['app:acct_1@y'],
        },
      ],
    });
    const { incidents, stored } = reconcileIncidents(prev, [a], T1, 0, ctx);
    expect(incidents[0].state).toBe('resolved');
    expect(incidents[0].resolutionReason).toBe('verified_remediated');
    expect(stored[incidents[0].id].state).toBe('resolved');
  });

  it('mismatch gone but evidence unknown keeps state and marks evidenceStale', () => {
    const { prev } = mismatchState();
    const a = assessment({
      accountReasons: ['stale_evidence'],
      features: [
        { kind: 'unknown', feature: 'exports', reasons: ['stale_evidence'], evidenceIds: [] },
      ],
    });
    const { incidents } = reconcileIncidents(prev, [a], T1, 0, ctx);
    expect(incidents[0].state).toBe('candidate');
    expect(incidents[0].evidenceStale).toBe(true);
  });

  it('feature-level unknown (not account-level) also keeps state', () => {
    const { prev } = mismatchState();
    const a = assessment({
      features: [
        {
          kind: 'unknown',
          feature: 'exports',
          reasons: ['unobserved_feature'],
          evidenceIds: [],
        },
      ],
    });
    const { incidents } = reconcileIncidents(prev, [a], T1, 0, ctx);
    expect(incidents[0].state).toBe('candidate');
    expect(incidents[0].evidenceStale).toBe(true);
  });

  it('account absent from a complete inventory resolves subject_removed', () => {
    const { prev } = mismatchState();
    const { incidents } = reconcileIncidents(prev, [], T1, 0, ctx);
    expect(incidents[0].state).toBe('resolved');
    expect(incidents[0].resolutionReason).toBe('subject_removed');
  });

  it('account absent from an incomplete inventory keeps state (stale evidence)', () => {
    const { prev } = mismatchState();
    const { incidents } = reconcileIncidents(prev, [], T1, 0, { ...ctx, appComplete: false });
    expect(incidents[0].state).toBe('candidate');
    expect(incidents[0].evidenceStale).toBe(true);
  });

  it('integrity incident resolves only when account clean and finding gone', () => {
    const id = fingerprint('acct_1', 'integrity', 'sub_1');
    const prev: Record<string, StoredIncident> = {
      [id]: {
        firstSeenAt: T0,
        lastConfirmedAt: T0,
        occurrences: 1,
        state: 'confirmed',
        snapshot: {
          accountId: 'acct_1',
          ruleId: 'integrity:duplicate_local_identity',
          feature: 'sub_1',
          check: 'duplicate_local_identity',
          kind: 'integrity',
          severity: 'medium',
          evidenceIds: [],
        },
      },
    };
    const clean = reconcileIncidents(prev, [assessment()], T1, 0, ctx);
    expect(clean.incidents[0].state).toBe('resolved');
    expect(clean.incidents[0].resolutionReason).toBe('verified_remediated');
    const dirty = reconcileIncidents(
      prev,
      [assessment({ accountReasons: ['incomplete_inventory'] })],
      T1,
      0,
      ctx,
    );
    expect(dirty.incidents[0].state).toBe('confirmed');
    expect(dirty.incidents[0].evidenceStale).toBe(true);
  });

  it('workflow metadata survives a re-evaluation run', () => {
    const { prev, id } = mismatchState();
    prev[id].workflow = {
      assignee: 'rev@local',
      snoozedUntil: '2026-09-20T00:00:00Z',
      acceptedRisk: { reason: 'legacy', by: 'admin@local', at: T0 },
      comments: [{ by: 'rev@local', at: T0, text: 'checking' }],
    };
    const a = assessment({ features: [mismatchFeature] });
    const { incidents, stored } = reconcileIncidents(prev, [a], T1, 0, ctx);
    expect(incidents[0].workflow).toEqual(prev[id].workflow);
    expect(stored[id].workflow).toEqual(prev[id].workflow);
  });
});
