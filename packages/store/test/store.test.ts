import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JsonFileStore, PostgresStore, seedFromFixtures } from '../src/index.js';
import type { PolicyVersion, Store } from '../src/index.js';
import postgres from 'postgres';
import type { Policy } from '@reconcile/domain';

const policy = (version: string): Policy => ({
  version,
  capabilities: ['reports'],
  priceMappings: [{ ruleId: 'plan:pro', priceId: 'price_pro', capabilities: ['reports'] }],
  lifecycle: { pastDueGraceHours: 72, trialGrantsAccess: true },
  freshness: { maxEvidenceAgeMinutes: 2880 },
});

const version = (v: string): PolicyVersion => ({
  version: v,
  policy: policy(v),
  publishedAt: new Date().toISOString(),
  publishedBy: 'tester',
});

interface Handle {
  store: Store;
  ps: ReturnType<Store['forProject']>;
}
function storeContract(name: string, makeStore: () => Promise<Store>) {
  async function make(): Promise<Handle> {
    const store = await makeStore();
    return { store, ps: store.forProject('proj_test') };
  }
  describe(name, () => {
    it('sources round-trip', async () => {
      const { store: root, ps: s } = await make();
      expect(await s.getSources()).toBeNull();
      const snap = {
        stripe: {
          runId: 'sr', complete: true, observedAt: '2026-09-16T00:00:00Z',
          permissionsMissing: [], customers: [], subscriptions: [],
        },
        app: { runId: 'ar', complete: true, observedAt: '2026-09-16T00:00:00Z', accounts: [] },
        importedAt: '2026-09-17T00:00:00Z',
        origin: 'fixtures' as const,
      };
      await s.putSources(snap);
      expect(await s.getSources()).toEqual(snap);
      await root.close();
    });

    it('publish rejects duplicate version and lists newest first', async () => {
      const { store: root, ps: s } = await make();
      await s.publishPolicy(version('v2'));
      await s.publishPolicy(version('v3'));
      const versions = await s.listPolicyVersions();
      expect(versions.map((v) => v.version)).toEqual(['v3', 'v2']);
      await expect(s.publishPolicy(version('v3'))).rejects.toThrow(/already exists/);
      expect((await s.getPublishedPolicy())!.version).toBe('v3');
      await root.close();
    });

    it('policy draft save/read/clear', async () => {
      const { store: root, ps: s } = await make();
      expect(await s.getPolicyDraft()).toBeNull();
      await s.savePolicyDraft({ policy: policy('v9'), updatedAt: '2026-09-17T00:00:00Z' });
      expect((await s.getPolicyDraft())!.policy.version).toBe('v9');
      await s.clearPolicyDraft();
      expect(await s.getPolicyDraft()).toBeNull();
      await root.close();
    });

    it('exceptions upsert/list/delete', async () => {
      const { store: root, ps: s } = await make();
      const ex = {
        id: 'ex1', accountId: 'a1', capability: 'reports', expected: true,
        reason: 'r', owner: 'o', expiresAt: '2026-12-01T00:00:00Z',
      };
      await s.upsertException(ex);
      await s.upsertException({ ...ex, reason: 'r2' });
      expect(await s.listExceptions()).toHaveLength(1);
      expect((await s.listExceptions())[0].reason).toBe('r2');
      await s.deleteException('ex1');
      expect(await s.listExceptions()).toEqual([]);
      await root.close();
    });

    it('link upsert replaces per accountId', async () => {
      const { store: root, ps: s } = await make();
      await s.upsertLink({ accountId: 'a1', stripeCustomerId: 'cus_1', reviewed: true });
      await s.upsertLink({ accountId: 'a1', stripeCustomerId: 'cus_2', reviewed: true });
      await s.upsertLink({ accountId: 'a2', stripeCustomerId: 'cus_3', reviewed: true });
      const links = await s.listLinks();
      expect(links).toHaveLength(2);
      expect(links.find((l) => l.accountId === 'a1')!.stripeCustomerId).toBe('cus_2');
      await s.deleteLink('a1');
      expect(await s.listLinks()).toHaveLength(1);
      await root.close();
    });

    it('incidents round-trip as record', async () => {
      const { store: root, ps: s } = await make();
      const inc = {
        firstSeenAt: '2026-09-17T00:00:00Z', lastConfirmedAt: '2026-09-17T00:00:00Z',
        occurrences: 1, state: 'candidate' as const,
        snapshot: {
          accountId: 'a1', ruleId: 'plan:pro', feature: 'reports',
          check: 'expected_feature_missing' as const, kind: 'mismatch' as const,
          severity: 'high' as const, expected: true, observed: false, evidenceIds: [],
        },
      };
      await s.putIncidents({ fp_x: inc });
      expect(await s.getIncidents()).toEqual({ fp_x: inc });
      await root.close();
    });

    it('runs newest first with limit', async () => {
      const { store: root, ps: s } = await make();
      const run = (id: string, at: string) => ({
        id, evaluatedAt: at, policyVersion: 'v1', engineVersion: 'e',
        counts: { population: 1, buckets: [0, 0, 0, 1] as [number, number, number, number], coveredPairs: 3, totalPairs: 3, incidentsOpen: 0 },
      });
      await s.recordRun(run('r1', '2026-09-17T00:00:00Z'));
      await s.recordRun(run('r2', '2026-09-17T01:00:00Z'));
      await s.recordRun(run('r3', '2026-09-17T02:00:00Z'));
      const runs = await s.listRuns();
      expect(runs.map((r) => r.id)).toEqual(['r3', 'r2', 'r1']);
      expect((await s.listRuns(2)).map((r) => r.id)).toEqual(['r3', 'r2']);
      await root.close();
    });

    it('seedFromFixtures seeds only empty collections', async () => {
      const { store: root } = await make();
      const fx = {
        stripe: {
          runId: 'sr', complete: true, observedAt: '2026-09-16T00:00:00Z',
          permissionsMissing: [], customers: [], subscriptions: [],
        },
        app: { runId: 'ar', complete: true, observedAt: '2026-09-16T00:00:00Z', accounts: [] },
        links: [{ accountId: 'a1', stripeCustomerId: 'cus_1', reviewed: true as const }],
        policy: policy('v1-2026-09-16'),
        exceptions: [],
      };
      const d = root.forProject('default');
      await seedFromFixtures(root, fx);
      expect((await d.getPublishedPolicy())!.version).toBe('v1-2026-09-16');
      expect(await d.listLinks()).toHaveLength(1);
      expect(await d.getSources()).not.toBeNull();
      expect(await root.listProjects()).toEqual([{ id: 'default', name: 'Default' }]);
      expect((await root.getUserByEmail('admin@local'))!.role).toBe('admin');
      await d.upsertLink({ accountId: 'a2', stripeCustomerId: 'cus_9', reviewed: true });
      await seedFromFixtures(root, fx);
      expect(await d.listLinks()).toHaveLength(2);
      await root.close();
    });

    it('project isolation via the store API', async () => {
      const { store: root } = await make();
      const inc = {
        firstSeenAt: '2026-09-17T00:00:00Z', lastConfirmedAt: '2026-09-17T00:00:00Z',
        occurrences: 1, state: 'confirmed' as const,
        snapshot: {
          accountId: 'a1', ruleId: 'plan:pro', feature: 'reports',
          check: 'expected_feature_missing' as const, kind: 'mismatch' as const,
          severity: 'high' as const, expected: true, observed: false, evidenceIds: [],
        },
      };
      await root.forProject('proj_a').putIncidents({ fp_a: inc });
      expect(await root.forProject('proj_b').getIncidents()).toEqual({});
      expect(await root.forProject('proj_a').getIncidents()).toHaveProperty('fp_a');
      await root.createProject({ id: 'proj_b', name: 'B' });
      await expect(root.createProject({ id: 'proj_b', name: 'B' })).rejects.toThrow();
      await root.close();
    });
  });
}

storeContract('JsonFileStore', async () =>
  new JsonFileStore(mkdtempSync(path.join(tmpdir(), 'reconcile-store-'))),
);

const pgUrl = process.env.DATABASE_URL;
describe.skipIf(!pgUrl)('PostgresStore', () => {
  storeContract('PostgresStore', async () => {
    const s = new PostgresStore(pgUrl!);
    await s.migrate();
    // isolate contract state between runs
    const raw = (s as unknown as { sql: { unsafe: (q: string) => Promise<unknown> } }).sql;
    for (const t of ['sources', 'policy_versions', 'policy_draft', 'exceptions', 'identity_links', 'incidents', 'runs', 'projects', 'users'])
      await raw.unsafe(`TRUNCATE ${t}`);
    return s;
  });

  it('isolates incidents per project, enforced by RLS', async () => {
    const s = new PostgresStore(pgUrl!);
    await s.migrate();
    const raw = (s as unknown as { sql: postgres.Sql }).sql;
    await raw.unsafe('TRUNCATE incidents');
    const inc = {
      firstSeenAt: '2026-09-17T00:00:00Z', lastConfirmedAt: '2026-09-17T00:00:00Z',
      occurrences: 1, state: 'confirmed' as const,
      snapshot: {
        accountId: 'a1', ruleId: 'plan:pro', feature: 'reports',
        check: 'expected_feature_missing' as const, kind: 'mismatch' as const,
        severity: 'high' as const, expected: true, observed: false, evidenceIds: [],
      },
    };
    await s.forProject('A').putIncidents({ fp_a: inc });
    expect(await s.forProject('B').getIncidents()).toEqual({});
    expect(await s.forProject('A').getIncidents()).toHaveProperty('fp_a');

    // RLS check without set_config: a non-superuser connection sees zero rows.
    // Requires a loginable reconcile_app role; skipped if the local role has no password.
    const appUrl = process.env.DATABASE_URL_APP;
    if (appUrl) {
      const app = postgres(appUrl);
      try {
        const rows = await app`SELECT count(*)::int AS n FROM incidents`;
        expect(rows[0].n).toBe(0);
        const rowsA = await app.begin(async (tx) => {
          await tx`select set_config('app.project_id', 'A', true)`;
          return tx`SELECT count(*)::int AS n FROM incidents`;
        });
        expect(rowsA[0].n).toBe(1);
      } finally {
        await app.end();
      }
    }
    await s.close();
  });
});
