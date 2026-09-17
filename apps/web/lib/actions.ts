'use server';

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { revalidatePath } from 'next/cache';
import { createSuggester } from '@reconcile/ai';
import { loadFixtures } from '@reconcile/fixtures';
import { runAssessment } from './state';

export async function recheck(): Promise<void> {
  runAssessment();
  revalidatePath('/', 'layout');
}

export async function suggestMapping() {
  const fx = loadFixtures();
  const suggester = createSuggester();
  const result = await suggester.suggest({ prices: fx.prices, capabilities: fx.policy.capabilities });
  return result;
}

export async function confirmMapping(formData: FormData): Promise<void> {
  const priceId = String(formData.get('priceId'));
  const capabilities = String(formData.get('capabilities')).split(',').filter(Boolean);
  const dir = path.resolve(process.cwd(), '.reconcile');
  mkdirSync(dir, { recursive: true });
  let draft: { mappings: { ruleId: string; priceId: string; capabilities: string[] }[]; writtenAt: string };
  try {
    draft = JSON.parse(readFileSync(path.join(dir, 'policy-draft.json'), 'utf8'));
  } catch {
    draft = { mappings: [], writtenAt: new Date().toISOString() };
  }
  draft.mappings = draft.mappings.filter((m) => m.priceId !== priceId);
  draft.mappings.push({ ruleId: `suggested:${priceId}`, priceId, capabilities });
  draft.writtenAt = new Date().toISOString();
  writeFileSync(path.join(dir, 'policy-draft.json'), JSON.stringify(draft, null, 2));
  revalidatePath('/setup/mapping');
}
