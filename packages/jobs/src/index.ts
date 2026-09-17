import type { Job, JobKind, Schedule } from '@reconcile/domain';
import type { Store } from '@reconcile/store';
import { randomUUID } from 'node:crypto';

export const LEASE_MS = 60_000;
export const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 60_000;

export type JobHandler = (job: Job, store: Store) => Promise<void>;
export type JobHandlers = Partial<Record<JobKind, JobHandler>>;

export function newJob(
  kind: JobKind,
  projectId: string,
  idempotencyKey: string,
  runAfter: string,
  payload: Record<string, unknown> = {},
  now = new Date().toISOString(),
): Job {
  return {
    id: `job_${randomUUID()}`,
    projectId,
    kind,
    payload,
    idempotencyKey,
    status: 'queued',
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    runAfter,
    createdAt: now,
    updatedAt: now,
  };
}

/** Exponential backoff 1m·2^(attempts-1) with ±25% jitter; null when exhausted. */
export function retryAtFor(job: Job, nowMs: number): string | null {
  if (job.attempts >= job.maxAttempts) return null;
  const base = BASE_BACKOFF_MS * 2 ** (job.attempts - 1);
  const jittered = base * (0.75 + Math.random() * 0.5);
  return new Date(nowMs + Math.round(jittered)).toISOString();
}

export function defaultSchedule(projectId: string): Schedule {
  return { projectId, scanIntervalMinutes: 1440, digestHour: 9, enabled: true };
}

/**
 * Enqueue scheduled jobs per enabled project: a periodic `assess` bucketed by
 * the scan interval, a targeted `assess` at the latest run's nextTransitionAt,
 * and a daily `digest` at digestHour.
 */
export async function planSchedules(store: Store, now: Date): Promise<number> {
  const nowIso = now.toISOString();
  let enqueued = 0;
  const ensure = async (
    projectId: string,
    kind: JobKind,
    key: string,
    runAfter: string,
  ): Promise<void> => {
    // Scheduler keys dedupe on any existing job, including completed ones —
    // otherwise a finished job would be re-enqueued on every tick.
    if (await store.getJobByIdempotencyKey(key)) return;
    await store.enqueueJob(newJob(kind, projectId, key, runAfter));
    enqueued += 1;
  };
  for (const project of await store.listProjects()) {
    const schedule = (await store.getSchedule(project.id)) ?? defaultSchedule(project.id);
    if (!schedule.enabled) continue;

    const bucket = Math.floor(now.getTime() / (schedule.scanIntervalMinutes * 60_000));
    await ensure(project.id, 'assess', `assess:${project.id}:${bucket}`, nowIso);

    const latest = await store.forProject(project.id).listRuns(1);
    const transitionAt = latest[0]?.nextTransitionAt;
    if (transitionAt && transitionAt > nowIso)
      await ensure(project.id, 'assess', `assess:${project.id}:transition:${transitionAt}`, transitionAt);

    const digestAt = new Date(now);
    digestAt.setUTCHours(schedule.digestHour, 0, 0, 0);
    if (digestAt.getTime() <= now.getTime()) {
      const day = nowIso.slice(0, 10);
      await ensure(project.id, 'digest', `digest:${project.id}:${day}`, nowIso);
    }
  }
  return enqueued;
}

/** One worker tick: plan schedules, record heartbeat, lease and run one job. */
export async function runWorkerOnce(
  store: Store,
  handlers: JobHandlers,
  now = new Date(),
): Promise<boolean> {
  await planSchedules(store, now);
  await store.touchWorkerHeartbeat(now.toISOString());
  const job = await store.leaseNextJob(now.toISOString(), LEASE_MS);
  if (!job) return false;
  const handler = handlers[job.kind];
  try {
    if (!handler) throw new Error(`no handler registered for kind ${job.kind}`);
    await handler(job, store);
    await store.completeJob(job.id, new Date().toISOString());
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await store.failJob(job.id, error, retryAtFor(job, now.getTime()), new Date().toISOString());
  }
  return true;
}

export interface WorkerOptions {
  /** Idle sleep between ticks. Default 10s. */
  intervalMs?: number;
  signal?: { stop: boolean };
}

/** Long-running loop: drains queued jobs, then idles at intervalMs. */
export async function startWorker(
  store: Store,
  handlers: JobHandlers,
  opts: WorkerOptions = {},
): Promise<void> {
  const intervalMs = opts.intervalMs ?? 10_000;
  const signal = opts.signal ?? { stop: false };
  while (!signal.stop) {
    let ran = false;
    try {
      ran = await runWorkerOnce(store, handlers);
    } catch (e) {
      console.error('[worker] tick failed:', e instanceof Error ? e.message : e);
    }
    if (!ran) await new Promise((r) => setTimeout(r, intervalMs));
  }
}
