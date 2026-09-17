'use server';

import { revalidatePath } from 'next/cache';
import { createSuggester } from '@reconcile/ai';
import { loadFixtures } from '@reconcile/fixtures';
import { PolicySchema, PolicyExceptionSchema } from '@reconcile/domain';
import type { Policy, PolicyException } from '@reconcile/domain';
import { seedFromFixtures } from '@reconcile/store';
import type { PolicyDraft } from '@reconcile/store';
import { runAssessment, withStore } from './state';

async function refresh(): Promise<void> {
  await runAssessment();
  revalidatePath('/', 'layout');
}

export async function recheck(): Promise<void> {
  await runAssessment({ reimportSources: true });
  revalidatePath('/', 'layout');
}

export async function suggestMapping() {
  const fx = loadFixtures();
  const suggester = createSuggester();
  return suggester.suggest({ prices: fx.prices, capabilities: fx.policy.capabilities });
}

export async function getPolicyDraft(): Promise<PolicyDraft | null> {
  return withStore(async (store) => {
    await seedFromFixtures(store, loadFixtures());
    return store.getPolicyDraft();
  });
}

export async function confirmMapping(formData: FormData): Promise<void> {
  const priceId = String(formData.get('priceId'));
  const capabilities = String(formData.get('capabilities')).split(',').filter(Boolean);
  await withStore(async (store) => {
    const fx = loadFixtures();
    await seedFromFixtures(store, fx);
    const published = (await store.getPublishedPolicy())?.policy;
    const existing = await store.getPolicyDraft();
    const base: Policy =
      existing?.policy ??
      ({
        ...published,
        version: `draft-${Date.now()}`,
      } as Policy);
    const mappings = base.priceMappings.filter((m) => m.priceId !== priceId);
    mappings.push({ ruleId: `suggested:${priceId}`, priceId, capabilities });
    await store.savePolicyDraft({
      policy: { ...base, priceMappings: mappings },
      updatedAt: new Date().toISOString(),
    });
  });
  revalidatePath('/setup/mapping');
  revalidatePath('/setup/policy');
}

export async function savePolicyDraft(policy: Policy): Promise<void> {
  PolicySchema.parse(policy);
  await withStore(async (store) => {
    await store.savePolicyDraft({ policy, updatedAt: new Date().toISOString() });
  });
  revalidatePath('/setup/policy');
}

export async function discardPolicyDraft(): Promise<void> {
  await withStore(async (store) => store.clearPolicyDraft());
  revalidatePath('/setup/policy');
}

export async function publishPolicy(note: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return withStore(async (store) => {
    const fx = loadFixtures();
    await seedFromFixtures(store, fx);
    const draft = await store.getPolicyDraft();
    if (!draft) return { ok: false, error: 'no draft to publish' };
    const parsed = PolicySchema.safeParse(draft.policy);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const published = await store.getPublishedPolicy();
    if (published && JSON.stringify(published.policy) === JSON.stringify(parsed.data))
      return { ok: false, error: 'draft is identical to the published policy' };
    if (await store.listPolicyVersions().then((vs) => vs.some((v) => v.version === parsed.data.version)))
      return { ok: false, error: `version ${parsed.data.version} already exists` };
    await store.publishPolicy({
      version: parsed.data.version,
      policy: parsed.data,
      publishedAt: new Date().toISOString(),
      publishedBy: 'local-user',
      note: note || undefined,
    });
    await store.clearPolicyDraft();
    return { ok: true as const };
  }).then(async (res) => {
    if (res.ok) await refresh();
    revalidatePath('/setup/policy');
    return res;
  });
}

export async function upsertExceptionAction(input: unknown): Promise<void> {
  const e = PolicyExceptionSchema.parse(input) as PolicyException;
  await withStore(async (store) => {
    await seedFromFixtures(store, loadFixtures());
    await store.upsertException(e);
  });
  await refresh();
}

export async function deleteException(id: string): Promise<void> {
  await withStore(async (store) => store.deleteException(id));
  await refresh();
}

export async function upsertLinkAction(accountId: string, stripeCustomerId: string): Promise<void> {
  await withStore(async (store) => {
    await seedFromFixtures(store, loadFixtures());
    await store.upsertLink({ accountId, stripeCustomerId, reviewed: true });
  });
  await refresh();
}

export async function deleteLink(accountId: string): Promise<void> {
  await withStore(async (store) => store.deleteLink(accountId));
  await refresh();
}
