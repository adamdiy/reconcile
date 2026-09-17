import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JsonFileStore, PostgresStore } from '@reconcile/store';
import type { Store } from '@reconcile/store';
import { newJob, planSchedules, runWorkerOnce, retryAtFor } from '../src/index.js';

const now = new Date('2026-09-17T10:00:00Z');
const past = new Date(now.getTime() - 60_000).toISOString();

async function contractSuite(name: string, makeStore: () => Promise<Store>) {
  describe(name, () => {
    it('enqueue is idempotent on unfinished jobs', async () => {
      const store = await makeStore();
      const j = newJob('assess', 'p1', 'key-1', past);
      const first = await store.enqueueJob(j);
      const second = await store.enqueueJob({ ...j, id: 'job_other' });
      expect(second.id).toBe(first.id);
      expect(await store.listJobs('p1')).toHaveLength(1);
      await store.close();
    });

    it('lease → complete succeeds', async () => {
      const store = await makeStore();
      await store.enqueueJob(newJob('assess', 'p1', 'k', past));
      const ran = await runWorkerOnce(store, { assess: async () => {} }, now);
      expect(ran).toBe(true);
      const jobs = await store.listJobs('p1');
      expect(jobs[0].status).toBe('succeeded');
      expect(jobs[0].attempts).toBe(1);
      await store.close();
    });

    it('failed handler retries with backoff, then dies at maxAttempts', async () => {
      const store = await makeStore();
      const job = newJob('assess', 'p1', 'k2', past);
      job.maxAttempts = 2;
      await store.enqueueJob(job);
      const boom = { assess: async () => { throw new Error('boom'); } };
      await runWorkerOnce(store, boom, now);
      let j = (await store.listJobs('p1'))[0];
      expect(j.status).toBe('failed');
      expect(j.attempts).toBe(1);
      expect(Date.parse(j.runAfter)).toBeGreaterThan(now.getTime());
      // second attempt exhausts attempts → dead
      const later = new Date(now.getTime() + 3 * 60_000);
      await store.enqueueJob(newJob('digest', 'p1', 'noop', later.toISOString())); // keep planning busy
      await runWorkerOnce(store, boom, later);
      j = (await store.listJobs('p1')).find((x) => x.idempotencyKey === 'k2')!;
      expect(j.status).toBe('dead');
      await store.close();
    });

    it('does not lease jobs scheduled in the future', async () => {
      const store = await makeStore();
      await store.enqueueJob(newJob('assess', 'p1', 'k3', '2027-01-01T00:00:00Z'));
      const leased = await store.leaseNextJob(now.toISOString(), 60_000);
      expect(leased).toBeNull();
      await store.close();
    });

    it('planSchedules enqueues assess + digest for enabled projects, idempotently', async () => {
      const store = await makeStore();
      await store.createProject({ id: 'p1', name: 'P1' });
      await store.putSchedule({ projectId: 'p1', scanIntervalMinutes: 60, digestHour: 8, enabled: true });
      await planSchedules(store, now);
      const first = await store.listJobs('p1');
      const keys = first.map((j) => j.idempotencyKey);
      expect(keys).toContain(`assess:p1:${Math.floor(now.getTime() / 3_600_000)}`);
      expect(keys).toContain('digest:p1:2026-09-17');
      await planSchedules(store, now);
      expect(await store.listJobs('p1')).toHaveLength(first.length);
      // disabled schedule stops planning
      await store.putSchedule({ projectId: 'p1', scanIntervalMinutes: 60, digestHour: 8, enabled: false });
      const count = (await store.listJobs('p1')).length;
      await planSchedules(store, now);
      expect(await store.listJobs('p1')).toHaveLength(count);
      await store.close();
    });
  });
}

await contractSuite('JsonFileStore jobs', async () =>
  new JsonFileStore(mkdtempSync(path.join(tmpdir(), 'reconcile-jobs-'))),
);

describe.skipIf(!process.env.DATABASE_URL)('PostgresStore jobs', () => {
  it('runs the full job lifecycle', async () => {
    const store = new PostgresStore(process.env.DATABASE_URL!);
    await store.migrate();
    const j = newJob('assess', 'pgp', `k-${Date.now()}`, past);
    await store.enqueueJob(j);
    const dup = await store.enqueueJob({ ...j, id: 'job_dup' });
    expect(dup.id).toBe(j.id);
    const leased = await store.leaseNextJob(new Date().toISOString(), 60_000);
    expect(leased).not.toBeNull();
    await store.completeJob(leased!.id, new Date().toISOString());
    const jobs = await store.listJobs('pgp');
    expect(jobs.find((x) => x.id === j.id)?.status).toBe('succeeded');
    await store.close();
  });
});

describe('retryAtFor', () => {
  it('grows exponentially and returns null at maxAttempts', () => {
    const job = newJob('assess', 'p', 'k', past);
    job.attempts = 1;
    const r1 = Date.parse(retryAtFor(job, now.getTime())!);
    job.attempts = 3;
    const r3 = Date.parse(retryAtFor(job, now.getTime())!);
    expect(r1 - now.getTime()).toBeGreaterThan(30_000);
    expect(r1 - now.getTime()).toBeLessThan(90_000);
    expect(r3 - now.getTime()).toBeGreaterThan(3 * 60_000);
    job.attempts = 5;
    expect(retryAtFor(job, now.getTime())).toBeNull();
  });
});
