import { createStripeConnector } from '@reconcile/connectors';
import { newJob } from '@reconcile/jobs';
import type { JobHandlers } from '@reconcile/jobs';
import { channelFor } from '@reconcile/notify';
import type { Notification } from '@reconcile/notify';
import { seedFromFixtures } from '@reconcile/store';
import type { Store } from '@reconcile/store';
import { loadFixtures } from '@reconcile/fixtures';
import type { Job, NotificationRule } from '@reconcile/domain';
import { createStore, runAssessment } from './state';
import { mergeSourceSnapshot } from './ingest';
import { executeRepair } from './repairs';

async function assessHandler(job: Job): Promise<void> {
  await runAssessment({ record: true, projectId: job.projectId });
}

async function stripeSyncHandler(job: Job, store: Store): Promise<void> {
  const inventory = await createStripeConnector(process.env).collect();
  await seedFromFixtures(store, loadFixtures());
  const result = await mergeSourceSnapshot(store.forProject(job.projectId), 'stripe', inventory);
  if (result === 'stale') throw new Error('collected snapshot is older than stored sources');
  await runAssessment({ record: true, projectId: job.projectId });
}

async function notifyHandler(job: Job, store: Store): Promise<void> {
  const ps = store.forProject(job.projectId);
  const rule = (await ps.listNotificationRules()).find(
    (r: NotificationRule) => r.id === job.payload.ruleId,
  );
  if (!rule || !rule.enabled) return;
  await channelFor(rule).send(job.payload.notification as Notification);
}

async function digestHandler(job: Job, store: Store): Promise<void> {
  const ps = store.forProject(job.projectId);
  const snap = await runAssessment({ record: false, projectId: job.projectId });
  const latest = (await ps.listRuns(1))[0];
  const dead = (await store.listJobs(job.projectId, 500)).filter((j) => j.status === 'dead').length;
  const coverage =
    latest && latest.counts.totalPairs > 0
      ? Math.round((latest.counts.coveredPairs / latest.counts.totalPairs) * 100)
      : 0;
  const incomplete = (['stripe', 'app'] as const).filter(
    (side) => !snap.sources[side].complete,
  );
  const body = [
    `coverage: ${coverage}% (${latest?.counts.coveredPairs ?? 0}/${latest?.counts.totalPairs ?? 0} pairs)`,
    `buckets: ${latest?.counts.buckets.join(' / ') ?? 'n/a'} · open incidents: ${latest?.counts.incidentsOpen ?? 0}`,
    incomplete.length ? `incomplete sources: ${incomplete.join(', ')}` : 'all sources complete',
    dead ? `${dead} dead job(s)` : 'no dead jobs',
  ].join('\n');
  const notification: Notification = {
    projectId: job.projectId,
    kind: 'digest',
    title: `[${job.projectId}] daily reconcile digest`,
    body,
    at: new Date().toISOString(),
  };
  for (const rule of await ps.listNotificationRules())
    if (rule.enabled) await channelFor(rule).send(notification);
}

async function repairHandler(job: Job, store: Store): Promise<void> {
  const ps = store.forProject(job.projectId);
  const actionId = job.payload.repairActionId as string;
  const action = await ps.getRepairAction(actionId);
  if (!action) throw new Error(`unknown repair action ${actionId}`);
  const done = await executeRepair(ps, actionId, {
    evaluateAccount: async (accountId, capability) => {
      const snap = await runAssessment({ record: false, projectId: job.projectId });
      const a = snap.assessments.find((x) => x.accountId === accountId);
      const f = a?.features.find((x) => x.feature === capability);
      return {
        observed:
          f?.kind === 'unknown' || !f
            ? undefined
            : f.kind === 'mismatch'
              ? f.observed
              : f.expected,
        fresh: !(f?.kind === 'unknown' && f.reasons.includes('stale_evidence')),
        matches: f?.kind === 'match',
      };
    },
  });
  if (done.state === 'failed')
    throw new Error(done.log.at(-1)?.detail ?? 'repair execution failed');
  if (done.state === 'executed')
    await store.enqueueJob(
      newJob('assess', job.projectId, `assess:${job.projectId}:repair:${actionId}`, new Date().toISOString()),
    );
}

export const jobHandlers: JobHandlers = {
  assess: (job) => assessHandler(job),
  stripe_sync: (job, store) => stripeSyncHandler(job, store),
  notify: (job, store) => notifyHandler(job, store),
  digest: (job, store) => digestHandler(job, store),
  repair: (job, store) => repairHandler(job, store),
};

/** Enqueue a manual "Run now" assessment for the project. */
export async function enqueueAssessNow(projectId: string): Promise<Job> {
  const store = createStore();
  try {
    await store.migrate();
    const now = new Date().toISOString();
    return await store.enqueueJob(
      newJob('assess', projectId, `assess:${projectId}:manual:${now}`, now),
    );
  } finally {
    await store.close();
  }
}
