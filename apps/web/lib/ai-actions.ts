'use server';

import { createSuggester, describeProvider } from '@reconcile/ai';
import type { ExceptionDraft, IncidentExplanation } from '@reconcile/domain';
import { loadFixtures } from '@reconcile/fixtures';
import { requireRole, requireSession } from './auth';
import { explanationKey } from './ai';
import { runAssessment, withProject } from './state';

export async function explainIncident(fingerprint: string): Promise<IncidentExplanation> {
  const session = await requireRole('reviewer');
  const snap = await runAssessment({ projectId: session.projectId });
  const inc = snap.incidents.find((i) => i.id === fingerprint);
  if (!inc) throw new Error(`unknown incident ${fingerprint}`);
  const assessment = snap.assessments.find((a) => a.accountId === inc.accountId);
  if (!assessment) throw new Error(`no assessment for ${inc.accountId}`);
  const key = explanationKey(fingerprint, inc.evidenceIds);
  const cached = await withProject(session.projectId, (_s, ps) => ps.getExplanation(key));
  if (cached) {
    console.log(`[ai] explanation cache hit: ${key}`);
    return cached as IncidentExplanation;
  }
  const suggester = createSuggester();
  const explanation = await suggester.explainIncident({
    incident: inc,
    assessment,
    evidence: inc.evidenceIds.map((id) => ({ id })),
    policy: snap.policy,
  });
  await withProject(session.projectId, (_s, ps) => ps.putExplanation(key, explanation));
  return explanation;
}

export async function draftException(text: string): Promise<ExceptionDraft> {
  const session = await requireRole('reviewer');
  const snap = await runAssessment({ projectId: session.projectId });
  const accounts = snap.assessments.map((a) => ({ accountId: a.accountId }));
  const capabilities = snap.policy.capabilities;
  return createSuggester().draftException({
    text,
    accounts,
    capabilities,
    policy: snap.policy,
    now: new Date().toISOString(),
  });
}

export interface ProviderStatus {
  name: string;
  model: string;
  configured: boolean;
}

export async function providerStatus(): Promise<ProviderStatus> {
  await requireSession();
  return describeProvider();
}

export async function testProvider(): Promise<{ ok: boolean; detail: string }> {
  await requireRole('admin');
  const info = describeProvider();
  try {
    const suggester = createSuggester();
    const draft = await suggester.draftException({
      text: 'test ping — verify provider responds',
      accounts: [{ accountId: 'acct_test' }],
      capabilities: ['test'],
      policy: loadFixtures().policy,
      now: new Date().toISOString(),
    }).catch((e) => {
      throw e;
    });
    return { ok: true, detail: `${info.name}/${info.model} responded (${draft.provider})` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: `${info.name}/${info.model}: ${msg}` };
  }
}
