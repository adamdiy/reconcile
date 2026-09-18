import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JsonFileStore, seedFromFixtures } from '@reconcile/store';
import { loadFixtures } from '@reconcile/fixtures';
import type { AccountAssessment } from '@reconcile/domain';
import { evaluateProject, diffAssessments } from '../src/index.js';

async function seeded() {
  const dir = mkdtempSync(path.join(tmpdir(), 'reconcile-core-'));
  const store = new JsonFileStore(dir);
  await store.migrate();
  const fixtures = loadFixtures();
  await seedFromFixtures(store, fixtures);
  return { store, fixtures };
}

describe('evaluateProject', () => {
  it('evaluates fixtures purely, persisting nothing', async () => {
    const { store, fixtures } = await seeded();
    const ps = store.forProject('default');
    const before = await ps.getIncidents();
    const ev = await evaluateProject(store, 'default', {
      fallback: { stripe: fixtures.stripe, app: fixtures.app, policy: fixtures.policy },
      settlingMs: 0,
    });
    expect(ev.assessments.length).toBe(13);
    expect(ev.incidents.length).toBeGreaterThan(0);
    expect(ev.bucketCounts.reduce((a, b) => a + b, 0)).toBe(13);
    // pure read: no writes to incidents or runs
    expect(await ps.getIncidents()).toEqual(before);
    expect(await ps.listRuns()).toEqual([]);
  });

  it('finds the acct_005 exports mismatch', async () => {
    const { store, fixtures } = await seeded();
    const ev = await evaluateProject(store, 'default', {
      fallback: { stripe: fixtures.stripe, app: fixtures.app, policy: fixtures.policy },
      settlingMs: 0,
    });
    const inc = ev.incidents.find(
      (i) => i.accountId === 'acct_005' && i.feature === 'exports',
    );
    expect(inc?.check).toBe('expected_feature_missing');
  });

  it('preserves existing incident workflow across evaluations', async () => {
    const { store, fixtures } = await seeded();
    const ps = store.forProject('default');
    const opts = {
      fallback: { stripe: fixtures.stripe, app: fixtures.app, policy: fixtures.policy },
      settlingMs: 0,
    };
    const first = await evaluateProject(store, 'default', opts);
    const fp = first.incidents.find((i) => i.accountId === 'acct_005')!.id;
    const target = first.stored[fp]!;
    target.workflow = { comments: [], assignee: 'tester@local' };
    await ps.putIncidents(first.stored);
    const second = await evaluateProject(store, 'default', opts);
    const again = second.stored[fp]!;
    expect(again.workflow?.assignee).toBe('tester@local');
  });
});

describe('diffAssessments', () => {
  const base = (features: AccountAssessment['features'], quantityChecks: AccountAssessment['quantityChecks'] = []): AccountAssessment => ({
    accountId: 'acct_1',
    policyVersion: 'v1',
    engineVersion: 'e1',
    evaluatedAt: '2026-09-17T00:00:00Z',
    accountReasons: [],
    features,
    integrity: [],
    quantityChecks,
  });

  it('classifies every transition kind', () => {
    const mk = (kind: 'match' | 'mismatch' | 'unknown', feature: string) =>
      kind === 'unknown'
        ? ({ kind, feature, reasons: ['stale_evidence'], evidenceIds: [] } as const)
        : kind === 'match'
          ? ({ kind, feature, ruleId: 'r', expected: true, evidenceIds: [] } as const)
          : ({ kind, feature, ruleId: 'r', expected: true, observed: false, evidenceIds: [] } as const);
    const before = base([
      mk('match', 'to_regress'),
      mk('mismatch', 'to_fix'),
      mk('match', 'to_unknown'),
      mk('unknown', 'to_assessed'),
      mk('match', 'to_remove'),
      mk('match', 'stay_same'),
    ]);
    const after = base([
      mk('mismatch', 'to_regress'),
      mk('match', 'to_fix'),
      mk('unknown', 'to_unknown'),
      mk('match', 'to_assessed'),
      mk('match', 'stay_same'),
      mk('match', 'newly_added'),
    ]);
    const d = diffAssessments([before], [after]);
    expect(d.regressions.map((p) => p.feature)).toEqual(['to_regress']);
    expect(d.fixes.map((p) => p.feature)).toEqual(['to_fix']);
    expect(d.newUnknowns.map((p) => p.feature)).toEqual(['to_unknown']);
    expect(d.newlyAssessed.map((p) => p.feature)).toEqual(['to_assessed']);
    expect(d.removed.map((p) => p.feature)).toEqual(['to_remove']);
    expect(d.added.map((p) => p.feature)).toEqual(['newly_added']);
    expect(d.unchanged).toBe(1);
  });

  it('includes integrity findings and quantity checks in the same shape', () => {
    const a1 = {
      ...base([]),
      integrity: [{ kind: 'duplicate_local_identity' as const, localRecordIds: ['lr1', 'lr2'], stripeSubscriptionId: 'sub_1', evidenceIds: [] }],
      quantityChecks: [{ kind: 'mismatch' as const, check: 'seats' as const, expected: 5, observed: 7, evidenceIds: [] }],
    };
    const d = diffAssessments([a1], [base([])]);
    expect(d.removed.map((p) => p.feature).sort()).toEqual(['integrity:duplicate_local_identity', 'seats']);
  });
});
