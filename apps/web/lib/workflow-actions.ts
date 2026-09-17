'use server';

import { revalidatePath } from 'next/cache';
import { requireRole, requireSession } from './auth';
import { withProject } from './state';
import type { StoredIncident } from './incidents';

async function mutateWorkflow(
  fingerprint: string,
  fn: (w: NonNullable<StoredIncident['workflow']>, email: string) => void,
): Promise<void> {
  const session = await requireSession();
  await withProject(session.projectId, async (_store, ps) => {
    const all = await ps.getIncidents();
    const inc = all[fingerprint];
    if (!inc) throw new Error(`unknown incident ${fingerprint}`);
    const w = inc.workflow ?? { comments: [] };
    fn(w, session.email);
    inc.workflow = w;
    await ps.putIncidents(all);
  });
  revalidatePath('/incidents');
  revalidatePath(`/incidents/${fingerprint}`);
}

export async function assignIncident(fingerprint: string, assignee: string): Promise<void> {
  await requireRole('reviewer');
  await mutateWorkflow(fingerprint, (w) => {
    w.assignee = assignee || undefined;
  });
}

export async function snoozeIncident(fingerprint: string, until: string): Promise<void> {
  await requireRole('reviewer');
  if (!until) throw new Error('snooze requires a datetime');
  await mutateWorkflow(fingerprint, (w) => {
    w.snoozedUntil = new Date(until).toISOString();
  });
}

export async function unsnoozeIncident(fingerprint: string): Promise<void> {
  await requireRole('reviewer');
  await mutateWorkflow(fingerprint, (w) => {
    w.snoozedUntil = undefined;
  });
}

export async function acceptRisk(fingerprint: string, reason: string): Promise<void> {
  await requireRole('reviewer');
  await mutateWorkflow(fingerprint, (w, email) => {
    w.acceptedRisk = { reason, by: email, at: new Date().toISOString() };
  });
}

export async function clearAcceptedRisk(fingerprint: string): Promise<void> {
  await requireRole('admin');
  await mutateWorkflow(fingerprint, (w) => {
    w.acceptedRisk = undefined;
  });
}

export async function commentIncident(fingerprint: string, text: string): Promise<void> {
  await requireRole('reviewer');
  await mutateWorkflow(fingerprint, (w, email) => {
    w.comments = [...w.comments, { by: email, at: new Date().toISOString(), text }];
  });
}
