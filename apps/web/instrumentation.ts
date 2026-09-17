export async function register(): Promise<void> {
  // The embedded worker starts lazily from the root layout (lib/worker.ts);
  // this file stays edge-safe since instrumentation is bundled for every runtime.
}
