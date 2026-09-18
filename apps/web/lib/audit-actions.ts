'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { evaluateProject, diffAssessments } from '@reconcile/core';
import type { AssessmentDiff } from '@reconcile/core';
import { loadFixtures } from '@reconcile/fixtures';
import type { AuditBaseline, Policy } from '@reconcile/domain';
import { ENGINE_VERSION } from '@reconcile/engine';
import { requireRole, requireSession } from './auth';
import { runAssessment, settlingMinutes, withStore } from './state';

/** Preview a draft policy against the published one. Pure read — no writes. */
export async function previewImpact(draftPolicy: Policy): Promise<AssessmentDiff> {
  const session = await requireRole('reviewer');
  const fixtures = loadFixtures();
  return withStore(async (store) => {
    const base = {
      fallback: { stripe: fixtures.stripe, app: fixtures.app, policy: fixtures.policy },
      settlingMs: settlingMinutes() * 60_000,
    };
    const before = await evaluateProject(store, session.projectId, base);
    const after = await evaluateProject(store, session.projectId, {
      ...base,
      overrides: { policy: draftPolicy },
    });
    return diffAssessments(before.assessments, after.assessments);
  });
}

export async function captureBaseline(name: string, note: string): Promise<{ id: string }> {
  const session = await requireRole('reviewer');
  const snap = await runAssessment({ projectId: session.projectId });
  const id = `bl_${randomBytes(6).toString('hex')}`;
  const counts = [0, 0, 0, 0] as [number, number, number, number];
  for (const b of snap.buckets.values()) counts[b.bucket - 1] += 1;
  let covered = 0;
  let total = 0;
  const unknownReasons: Record<string, number> = {};
  for (const a of snap.assessments) {
    for (const f of a.features) {
      total += 1;
      if (f.kind !== 'unknown') covered += 1;
      else for (const r of f.reasons) unknownReasons[r] = (unknownReasons[r] ?? 0) + 1;
    }
    for (const q of a.quantityChecks) {
      total += 1;
      if (q.kind !== 'unknown') covered += 1;
      else for (const r of q.reasons) unknownReasons[r] = (unknownReasons[r] ?? 0) + 1;
    }
  }
  const baseline: AuditBaseline = {
    id,
    name,
    note: note || undefined,
    createdAt: snap.evaluatedAt,
    createdBy: session.email,
    policyVersion: snap.policy.version,
    engineVersion: ENGINE_VERSION,
    sourceObservedAt: {
      stripe: snap.sources.stripe.observedAt,
      app: snap.sources.app.observedAt,
    },
    assessments: snap.assessments,
    counts: {
      population: snap.assessments.length,
      buckets: counts,
      coveredPairs: covered,
      totalPairs: total,
      incidentsOpen: snap.incidents.filter((i) => i.state !== 'resolved').length,
      unknownReasons,
    },
  };
  await withStore(async (store) => {
    await store.forProject(session.projectId).putBaseline(baseline);
  });
  revalidatePath('/audit');
  return { id };
}

export async function deleteBaseline(id: string): Promise<void> {
  const session = await requireRole('reviewer');
  await withStore(async (store) => {
    await store.forProject(session.projectId).deleteBaseline(id);
  });
  revalidatePath('/audit');
}

export async function getBaselineWithDiff(id: string) {
  const session = await requireSession();
  const snap = await runAssessment({ projectId: session.projectId });
  const baseline = await withStore(async (store) =>
    store.forProject(session.projectId).getBaseline(id),
  );
  if (!baseline) return { baseline: null };
  const diff = diffAssessments(baseline.assessments, snap.assessments);
  return {
    baseline,
    diff,
    current: {
      policyVersion: snap.policy.version,
      engineVersion: ENGINE_VERSION,
      sourceObservedAt: {
        stripe: snap.sources.stripe.observedAt,
        app: snap.sources.app.observedAt,
      },
      population: snap.assessments.length,
    },
  };
}
