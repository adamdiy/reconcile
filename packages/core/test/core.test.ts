import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JsonFileStore, seedFromFixtures } from '@reconcile/store';
import { loadFixtures } from '@reconcile/fixtures';
import { evaluateProject } from '../src/index.js';

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
    expect(ev.assessments.length).toBe(12);
    expect(ev.incidents.length).toBeGreaterThan(0);
    expect(ev.bucketCounts.reduce((a, b) => a + b, 0)).toBe(12);
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
