import { createStore } from '@reconcile/store';
import { runWorkerOnce, startWorker } from '../index.js';
import type { JobHandlers } from '../index.js';

// Standalone worker. Handlers live in the web app (apps/web/lib/jobs.ts); this
// bin runs the plan/lease loop and no-ops on kinds without registered handlers
// unless --app-handlers resolves a module exporting `jobHandlers`.
const once = process.argv.includes('--once');
const handlersMod = process.env.RECONCILE_JOB_HANDLERS
  ? ((await import(process.env.RECONCILE_JOB_HANDLERS)) as { jobHandlers: JobHandlers })
  : { jobHandlers: {} as JobHandlers };

const store = createStore();
await store.migrate();
if (once) {
  const ran = await runWorkerOnce(store, handlersMod.jobHandlers);
  console.log(ran ? 'ran one job' : 'no job available');
  await store.close();
} else {
  console.log('reconcile-worker: starting (interval 10s)');
  await startWorker(store, handlersMod.jobHandlers);
}
