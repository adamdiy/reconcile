import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JsonFileStore, seedFromFixtures } from '@reconcile/store';
import { loadFixtures } from '@reconcile/fixtures';
import { evaluateProject } from '@reconcile/core';
import type { AccountAssessment } from '@reconcile/domain';
import {
  approveRepair,
  executeRepair,
  proposeRepair,
  rejectRepair,
  renderTemplate,
  verifyRepairs,
} from '../lib/repairs';

async function seeded() {
  const dir = mkdtempSync(path.join(tmpdir(), 'repairs-'));
  const store = new JsonFileStore(dir);
  const fixtures = loadFixtures();
  await seedFromFixtures(store, fixtures, 'default', {});
  const ps = store.forProject('default');
  const ev = await evaluateProject(store, 'default', {
    fallback: { stripe: fixtures.stripe, app: fixtures.app, policy: fixtures.policy },
    settlingMs: 0,
  });
  return { store, ps, ev, dir };
}

function mismatchAssessment(ev: { assessments: AccountAssessment[] }, accountId: string, feature: string) {
  const a = ev.assessments.find((x) => x.accountId === accountId)!;
  expect(a.features.find((f) => f.feature === feature)?.kind).toBe('mismatch');
  return a;
}

const NOW = '2026-09-17T12:00:00.000Z';

describe('reviewed repairs', () => {
  it('rejects approval by the proposer (four-eyes), accepts a different approver', async () => {
    const { store, ps, ev } = await seeded();
    const a = mismatchAssessment(ev, 'acct_005', 'exports');
    const action = await proposeRepair(ps, {
      incidentId: 'fp_x',
      commandId: 'rc_demo_grant',
      assessment: a,
      proposer: 'admin@local',
      now: NOW,
    });
    await expect(
      approveRepair(store, ps, { actionId: action.id, approver: 'admin@local', now: NOW }),
    ).rejects.toThrow('four-eyes');
    const approved = await approveRepair(store, ps, {
      actionId: action.id,
      approver: 'ops@local',
      now: NOW,
    });
    expect(approved.state).toBe('approved');
    const job = await store.getJobByIdempotencyKey(`repair:exec:${action.id}:${action.idempotencyKey}`);
    expect(job?.kind).toBe('repair');
  });

  it('fails when the observed precondition changed before execution', async () => {
    const { store, ps, ev } = await seeded();
    const a = mismatchAssessment(ev, 'acct_005', 'exports');
    const action = await proposeRepair(ps, {
      incidentId: 'fp_x', commandId: 'rc_demo_grant', assessment: a, proposer: 'r@local', now: NOW,
    });
    await approveRepair(store, ps, { actionId: action.id, approver: 'ops@local', now: NOW });
    const done = await executeRepair(ps, action.id, {
      evaluateAccount: async () => ({ observed: true, fresh: true, matches: false }),
      now: NOW,
    });
    expect(done.state).toBe('failed');
    expect(done.log.at(-1)?.detail).toBe('precondition changed');
  });

  it('expires when past expiresAt', async () => {
    const { store, ps, ev } = await seeded();
    const a = mismatchAssessment(ev, 'acct_005', 'exports');
    const action = await proposeRepair(ps, {
      incidentId: 'fp_x', commandId: 'rc_demo_grant', assessment: a, proposer: 'r@local',
      expiresHours: 1, now: NOW,
    });
    await approveRepair(store, ps, { actionId: action.id, approver: 'ops@local', now: NOW });
    const late = '2026-09-18T14:00:00.000Z';
    const done = await executeRepair(ps, action.id, { now: late });
    expect(done.state).toBe('expired');
  });

  it('writes an outbox line with a stable idempotency key across retries', async () => {
    const { store, ps, ev, dir } = await seeded();
    const a = mismatchAssessment(ev, 'acct_005', 'exports');
    const action = await proposeRepair(ps, {
      incidentId: 'fp_x', commandId: 'rc_demo_grant', assessment: a, proposer: 'r@local', now: NOW,
    });
    await approveRepair(store, ps, { actionId: action.id, approver: 'ops@local', now: NOW });
    const evaluate = async () => ({ observed: false, fresh: true, matches: false });
    const done1 = await executeRepair(ps, action.id, { evaluateAccount: evaluate, outboxDir: dir, now: NOW });
    expect(done1.state).toBe('executed');
    const done2 = await executeRepair(ps, action.id, { evaluateAccount: evaluate, outboxDir: dir, now: NOW });
    expect(done2.state).toBe('executed');
    const lines = readFileSync(path.join(dir, 'repairs-outbox.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1); // second call returns early — only one line
    expect(JSON.parse(lines[0]).idempotencyKey).toBe(action.idempotencyKey);
  });

  it('marks verified when the feature later matches', async () => {
    const { store, ps, ev } = await seeded();
    const a = mismatchAssessment(ev, 'acct_005', 'exports');
    const action = await proposeRepair(ps, {
      incidentId: 'fp_x', commandId: 'rc_demo_grant', assessment: a, proposer: 'r@local', now: NOW,
    });
    await approveRepair(store, ps, { actionId: action.id, approver: 'ops@local', now: NOW });
    await executeRepair(ps, action.id, {
      evaluateAccount: async () => ({ observed: false, fresh: true, matches: false }),
      outboxDir: mkdtempSync(path.join(tmpdir(), 'o-')),
      now: NOW,
    });
    const healed = ev.assessments.map((x) =>
      x.accountId !== 'acct_005'
        ? x
        : {
            ...x,
            features: x.features.map((f) =>
              f.feature === 'exports' ? { ...f, kind: 'match' as const, observed: true } : f,
            ),
          },
    );
    const changed = await verifyRepairs(ps, healed, {}, NOW);
    expect(changed.map((c) => c.state)).toEqual(['verified']);
  });

  it('reject only in proposed/approved state', async () => {
    const { ps, ev } = await seeded();
    const a = mismatchAssessment(ev, 'acct_005', 'exports');
    const action = await proposeRepair(ps, {
      incidentId: 'fp_x', commandId: 'rc_demo_grant', assessment: a, proposer: 'r@local', now: NOW,
    });
    const rejected = await rejectRepair(ps, { actionId: action.id, actor: 'ops@local', now: NOW });
    expect(rejected.state).toBe('rejected');
  });

  it('interpolates templates', () => {
    expect(
      renderTemplate('https://x/grant?a={{accountId}}&c={{capability}}&d={{desired}}&k={{idempotencyKey}}', {
        accountId: 'acct_1', capability: 'exports', desired: true, idempotencyKey: 'k1',
      }),
    ).toBe('https://x/grant?a=acct_1&c=exports&d=true&k=k1');
  });
});
