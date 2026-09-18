'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from './auth';
import { runAssessment, withProject } from './state';
import { approveRepair, proposeRepair, rejectRepair } from './repairs';
import { RepairCommandSchema } from '@reconcile/domain';
import type { RepairAction } from '@reconcile/domain';

export async function proposeRepairAction(
  incidentId: string,
  commandId: string,
  expiresHours: number,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const session = await requireRole('reviewer');
  try {
    const snap = await runAssessment({ projectId: session.projectId });
    const inc = snap.incidents.find((i) => i.id === incidentId);
    if (!inc || inc.kind !== 'mismatch') return { ok: false, error: 'not a mismatch incident' };
    const assessment = snap.assessments.find((a) => a.accountId === inc.accountId);
    if (!assessment) return { ok: false, error: 'account missing' };
    const action = await withProject(session.projectId, async (_store, ps) =>
      proposeRepair(ps, {
        incidentId,
        commandId,
        assessment,
        capability: inc.feature,
        proposer: session.email,
        desired: inc.expected,
        expiresHours: expiresHours || 24,
      }),
    );
    revalidatePath(`/incidents/${incidentId}`);
    return { ok: true, id: action.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function approveRepairAction(
  actionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole('admin');
  try {
    await withProject(session.projectId, async (store, ps) =>
      approveRepair(store, ps, { actionId, approver: session.email }),
    );
    revalidatePath('/repairs');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function rejectRepairAction(
  actionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole('reviewer');
  try {
    await withProject(session.projectId, async (_store, ps) =>
      rejectRepair(ps, { actionId, actor: session.email }),
    );
    revalidatePath('/repairs');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Void-returning wrappers for plain <form action={}> usage (errors → error boundary). */
export async function approveRepairForm(actionId: string): Promise<void> {
  const r = await approveRepairAction(actionId);
  if (!r.ok) throw new Error(r.error);
}

export async function rejectRepairForm(actionId: string): Promise<void> {
  const r = await rejectRepairAction(actionId);
  if (!r.ok) throw new Error(r.error);
}

export async function listRepairState(): Promise<{
  commands: { id: string; name: string; kind: string; capabilities: string[]; description?: string }[];
  actions: RepairAction[];
}> {
  const session = await requireRole('reviewer');
  return withProject(session.projectId, async (_store, ps) => ({
    commands: (await ps.listRepairCommands()).map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      capabilities: c.capabilities,
      description: c.description,
    })),
    actions: await ps.listRepairActions(),
  }));
}

export async function upsertRepairCommand(input: {
  id: string;
  name: string;
  kind: 'http' | 'local_outbox';
  method?: string;
  urlTemplate?: string;
  capabilities: string;
  description?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole('admin');
  try {
    const command = RepairCommandSchema.parse({
      id: input.id || `rc_${Math.random().toString(16).slice(2, 8)}`,
      name: input.name,
      kind: input.kind,
      http:
        input.kind === 'http'
          ? { method: input.method || 'POST', urlTemplate: input.urlTemplate ?? '' }
          : undefined,
      capabilities: input.capabilities
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      description: input.description,
    });
    await withProject(session.projectId, async (_store, ps) => ps.upsertRepairCommand(command));
    revalidatePath('/settings/repairs');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteRepairCommand(id: string): Promise<void> {
  const session = await requireRole('admin');
  await withProject(session.projectId, async (_store, ps) => ps.deleteRepairCommand(id));
  revalidatePath('/settings/repairs');
}
