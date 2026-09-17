'use server';

import { revalidatePath } from 'next/cache';
import { createSuggester } from '@reconcile/ai';
import { loadFixtures } from '@reconcile/fixtures';
import { PolicySchema, PolicyExceptionSchema } from '@reconcile/domain';
import type { Policy, PolicyException } from '@reconcile/domain';
import type { PolicyDraft } from '@reconcile/store';
import { requireRole, requireSession } from './auth';
import { runAssessment, withProject } from './state';

async function refresh(): Promise<void> {
  await runAssessment({ record: true });
  revalidatePath('/', 'layout');
}

// Recheck re-evaluates the stored sources (connector or fixture) as they are.
export async function recheck(): Promise<void> {
  await requireRole('reviewer');
  await runAssessment({ record: true });
  revalidatePath('/', 'layout');
}

// Simulated collector: re-import fixture data as fresh sources.
export async function importFixtures(): Promise<void> {
  await requireRole('reviewer');
  await runAssessment({ reimportSources: true, record: true });
  revalidatePath('/', 'layout');
}

export async function suggestMapping() {
  const fx = loadFixtures();
  const suggester = createSuggester();
  return suggester.suggest({ prices: fx.prices, capabilities: fx.policy.capabilities });
}

export async function getPolicyDraft(): Promise<PolicyDraft | null> {
  const session = await requireSession();
  return withProject(session.projectId, async (_store, ps) => ps.getPolicyDraft());
}

export async function confirmMapping(formData: FormData): Promise<void> {
  const session = await requireRole('reviewer');
  const priceId = String(formData.get('priceId'));
  const capabilities = String(formData.get('capabilities')).split(',').filter(Boolean);
  await withProject(session.projectId, async (_store, ps) => {
    const published = (await ps.getPublishedPolicy())?.policy;
    const existing = await ps.getPolicyDraft();
    const base: Policy =
      existing?.policy ??
      ({
        ...published,
        version: `draft-${Date.now()}`,
      } as Policy);
    const mappings = base.priceMappings.filter((m) => m.priceId !== priceId);
    mappings.push({ ruleId: `suggested:${priceId}`, priceId, capabilities });
    await ps.savePolicyDraft({
      policy: { ...base, priceMappings: mappings },
      updatedAt: new Date().toISOString(),
    });
  });
  revalidatePath('/setup/mapping');
  revalidatePath('/setup/policy');
}

export async function savePolicyDraft(policy: Policy): Promise<void> {
  const session = await requireRole('reviewer');
  PolicySchema.parse(policy);
  await withProject(session.projectId, async (_store, ps) =>
    ps.savePolicyDraft({ policy, updatedAt: new Date().toISOString() }),
  );
  revalidatePath('/setup/policy');
}

export async function discardPolicyDraft(): Promise<void> {
  const session = await requireRole('reviewer');
  await withProject(session.projectId, async (_store, ps) => ps.clearPolicyDraft());
  revalidatePath('/setup/policy');
}

export async function publishPolicy(note: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireRole('admin');
  const res = await withProject(session.projectId, async (_store, ps) => {
    const draft = await ps.getPolicyDraft();
    if (!draft) return { ok: false as const, error: 'no draft to publish' };
    const parsed = PolicySchema.safeParse(draft.policy);
    if (!parsed.success) return { ok: false as const, error: parsed.error.message };
    const published = await ps.getPublishedPolicy();
    if (published && JSON.stringify(published.policy) === JSON.stringify(parsed.data))
      return { ok: false as const, error: 'draft is identical to the published policy' };
    if (await ps.listPolicyVersions().then((vs) => vs.some((v) => v.version === parsed.data.version)))
      return { ok: false as const, error: `version ${parsed.data.version} already exists` };
    await ps.publishPolicy({
      version: parsed.data.version,
      policy: parsed.data,
      publishedAt: new Date().toISOString(),
      publishedBy: session.email,
      note: note || undefined,
    });
    await ps.clearPolicyDraft();
    return { ok: true as const };
  });
  if (res.ok) await refresh();
  revalidatePath('/setup/policy');
  return res;
}

export async function upsertExceptionAction(input: unknown): Promise<void> {
  const session = await requireRole('reviewer');
  const e = PolicyExceptionSchema.parse(input) as PolicyException;
  await withProject(session.projectId, async (_store, ps) => ps.upsertException(e));
  await refresh();
}

export async function deleteException(id: string): Promise<void> {
  const session = await requireRole('reviewer');
  await withProject(session.projectId, async (_store, ps) => ps.deleteException(id));
  await refresh();
}

export async function upsertLinkAction(accountId: string, stripeCustomerId: string): Promise<void> {
  const session = await requireRole('reviewer');
  await withProject(session.projectId, async (_store, ps) =>
    ps.upsertLink({ accountId, stripeCustomerId, reviewed: true }),
  );
  await refresh();
}

export async function deleteLink(accountId: string): Promise<void> {
  const session = await requireRole('reviewer');
  await withProject(session.projectId, async (_store, ps) => ps.deleteLink(accountId));
  await refresh();
}

export async function createProjectAction(id: string, name: string): Promise<void> {
  await requireRole('admin');
  await withProject('default', async (store) => {
    await store.createProject({ id, name: name || id });
  });
  revalidatePath('/settings/projects');
}

export async function createUserAction(input: {
  email: string;
  password: string;
  role: 'viewer' | 'reviewer' | 'admin';
  projectIds: string[];
}): Promise<void> {
  await requireRole('admin');
  const { hashPassword } = await import('@reconcile/store');
  await withProject('default', async (store) => {
    await store.upsertUser({
      id: `user_${Date.now()}`,
      email: input.email,
      passwordHash: hashPassword(input.password),
      role: input.role,
      projectIds: input.projectIds,
    });
  });
  revalidatePath('/settings/users');
}
