import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession, requireRole } from '../../../lib/auth';
import { withStore } from '../../../lib/state';
import { seedFromFixtures } from '@reconcile/store';
import { loadFixtures } from '@reconcile/fixtures';
import { defaultSchedule } from '@reconcile/jobs';
import { enqueueAssessNow } from '../../../lib/jobs';
import { revalidatePath } from 'next/cache';
import type { Job } from '@reconcile/domain';

async function runNow() {
  'use server';
  const session = await requireRole('reviewer');
  await enqueueAssessNow(session.projectId);
  revalidatePath('/jobs');
}

async function saveSchedule(formData: FormData) {
  'use server';
  const session = await requireRole('admin');
  await withStore(async (store) => {
    await seedFromFixtures(store, loadFixtures());
    await store.putSchedule({
      projectId: session.projectId,
      scanIntervalMinutes: Math.max(1, Number(formData.get('scanIntervalMinutes')) || 1440),
      digestHour: Math.min(23, Math.max(0, Number(formData.get('digestHour')) || 0)),
      enabled: formData.get('enabled') === 'on',
    });
  });
  revalidatePath('/jobs');
}

const STATUS_COLOR: Record<Job['status'], string> = {
  queued: 'text-blue-700',
  running: 'text-amber-700',
  succeeded: 'text-green-700',
  failed: 'text-orange-700',
  dead: 'text-red-700',
};

export default async function JobsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const canEdit = session.role === 'admin';
  const { jobs, schedule } = await withStore(async (store) => {
    await seedFromFixtures(store, loadFixtures());
    return {
      jobs: await store.listJobs(session.projectId, 100),
      schedule:
        (await store.getSchedule(session.projectId)) ?? defaultSchedule(session.projectId),
    };
  });

  return (
    <main className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Jobs</h1>
        <form action={runNow}>
          <button className="rounded bg-blue-600 px-3 py-1 text-sm text-white">
            Run assessment now
          </button>
        </form>
      </div>

      <section className="rounded border p-4">
        <h2 className="mb-2 font-medium">Schedule — {session.projectId}</h2>
        <form action={saveSchedule} className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            scan every
            <input
              name="scanIntervalMinutes"
              type="number"
              min={1}
              defaultValue={schedule.scanIntervalMinutes}
              className="w-20 rounded border px-1"
              disabled={!canEdit}
            />
            min
          </label>
          <label className="flex items-center gap-2">
            digest at
            <input
              name="digestHour"
              type="number"
              min={0}
              max={23}
              defaultValue={schedule.digestHour}
              className="w-16 rounded border px-1"
              disabled={!canEdit}
            />
            :00 UTC
          </label>
          <label className="flex items-center gap-2">
            <input name="enabled" type="checkbox" defaultChecked={schedule.enabled} disabled={!canEdit} />
            enabled
          </label>
          {canEdit && <button className="rounded border px-3 py-1">Save</button>}
        </form>
      </section>

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b text-xs uppercase text-gray-500">
            <th className="py-1">kind</th>
            <th>status</th>
            <th>attempts</th>
            <th>run after</th>
            <th>updated</th>
            <th>error</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id} className="border-b">
              <td className="py-1 font-mono">{j.kind}</td>
              <td className={STATUS_COLOR[j.status]}>{j.status}</td>
              <td>
                {j.attempts}/{j.maxAttempts}
              </td>
              <td className="font-mono text-xs">{j.runAfter}</td>
              <td className="font-mono text-xs">{j.updatedAt}</td>
              <td className="max-w-xs truncate text-xs text-red-700">{j.lastError}</td>
            </tr>
          ))}
          {jobs.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-center text-gray-500">
                No jobs yet — use "Run assessment now" or wait for the scheduler.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="text-xs text-gray-500">
        <Link href="/notifications" className="underline">Outbox</Link> ·{' '}
        <Link href="/metrics" className="underline">Metrics</Link>
      </p>
    </main>
  );
}


