import { startWorker } from '@reconcile/jobs';
import { createStore } from './state';
import { jobHandlers } from './jobs';

/**
 * Dev-mode embedded worker, started once per process. Called from the root
 * server-component layout so it runs inside the Next node process (the
 * instrumentation bundle is compiled for edge and cannot host node-only deps).
 */
export async function ensureWorkerStarted(): Promise<void> {
  if (process.env.RECONCILE_EMBEDDED_WORKER === '0') return;
  const g = globalThis as { __reconcileWorker?: boolean };
  if (g.__reconcileWorker) return;
  g.__reconcileWorker = true;
  const store = createStore();
  await store.migrate();
  void startWorker(store, jobHandlers, { intervalMs: 10_000 });
  console.log('[worker] embedded reconcile worker started');
}
