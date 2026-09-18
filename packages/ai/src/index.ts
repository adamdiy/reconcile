import { z } from 'zod';
import {
  ExceptionDraftSchema,
  IncidentExplanationSchema,
  PolicyExceptionSchema,
} from '@reconcile/domain';
import type {
  AccountAssessment,
  Evidence,
  ExceptionDraft,
  Incident,
  IncidentExplanation,
  Policy,

} from '@reconcile/domain';

export interface MappingSuggestionContext {
  prices: Array<{ id: string; nickname?: string; unitAmount?: number; currency?: string }>;
  capabilities: string[];
}

export const MappingSuggestionSchema = z.object({
  priceId: z.string(),
  capabilities: z.array(z.string()),
  rationale: z.string(),
});
export type MappingSuggestion = z.infer<typeof MappingSuggestionSchema>;

export const SuggestionResultSchema = z.object({
  suggestions: z.array(MappingSuggestionSchema),
});
export type SuggestionResult = z.infer<typeof SuggestionResultSchema>;

export interface ExplainInput {
  incident: Incident;
  assessment: AccountAssessment;
  evidence: Evidence[];
  policy: Policy;
}

export interface DraftExceptionInput {
  text: string;
  accounts: { accountId: string; stripeCustomerId?: string }[];
  capabilities: string[];
  policy: Policy;
  now: string;
}

export class GroundingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GroundingError';
  }
}

export interface MappingSuggester {
  suggest(ctx: MappingSuggestionContext): Promise<{ suggestions: MappingSuggestion[]; provider: string }>;
  explainIncident(input: ExplainInput): Promise<IncidentExplanation>;
  draftException(input: DraftExceptionInput): Promise<ExceptionDraft>;
}

export function filterValidSuggestions(
  ctx: MappingSuggestionContext,
  raw: unknown,
): MappingSuggestion[] {
  const parsed = SuggestionResultSchema.safeParse(raw);
  if (!parsed.success) return [];
  const priceIds = new Set(ctx.prices.map((p) => p.id));
  const caps = new Set(ctx.capabilities);
  return parsed.data.suggestions
    .map((s) => ({
      ...s,
      capabilities: s.capabilities.filter((c) => caps.has(c)),
    }))
    .filter((s) => priceIds.has(s.priceId) && s.capabilities.length > 0);
}

export class StubSuggester implements MappingSuggester {
  async suggest(ctx: MappingSuggestionContext) {
    const suggestions = ctx.prices.map((p) => ({
      priceId: p.id,
      capabilities:
        (p.unitAmount ?? 0) === 0
          ? ctx.capabilities.slice(0, 1)
          : /basic/i.test(p.nickname ?? p.id)
            ? ctx.capabilities.slice(0, 1)
            : ctx.capabilities,
      rationale: `Heuristic: ${p.nickname ?? p.id} (${p.unitAmount ?? 0} ${p.currency ?? ''})`,
    }));
    return { suggestions: filterValidSuggestions(ctx, { suggestions }), provider: 'stub' };
  }
  async explainIncident(input: ExplainInput): Promise<IncidentExplanation> {
    return stubExplain(input);
  }
  async draftException(input: DraftExceptionInput): Promise<ExceptionDraft> {
    return stubDraft(input);
  }
}

const PROMPT = `You propose mappings from Stripe price ids to application capabilities.
Return only JSON matching the required schema. Only reference price ids and capabilities from the input.`;

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`suggester request failed: ${res.status}`);
  return res.json();
}

export class OpenAICompatibleSuggester implements MappingSuggester {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model = 'gpt-4o-mini',
  ) {}

  async suggest(ctx: MappingSuggestionContext) {
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: JSON.stringify(ctx) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'mapping_suggestions',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['suggestions'],
            properties: {
              suggestions: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['priceId', 'capabilities', 'rationale'],
                  properties: {
                    priceId: { type: 'string' },
                    capabilities: { type: 'array', items: { type: 'string' } },
                    rationale: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    };
    const data = (await fetchJson(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    })) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    return {
      suggestions: filterValidSuggestions(ctx, content ? JSON.parse(content) : {}),
      provider: 'openai-compatible',
    };
  }

  private async completeJson(system: string, user: string): Promise<unknown> {
    const data = (await fetchJson(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
      }),
    })) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    return content ? JSON.parse(content) : {};
  }

  async explainIncident(input: ExplainInput): Promise<IncidentExplanation> {
    const raw = await this.completeJson(
      'Explain a reconciliation incident. Return only JSON matching: {summary, hypotheses: [{text, evidenceIds, confidence}], suggestedNextStep, provider, model, generatedAt}. Only cite evidenceIds present in the input.',
      JSON.stringify(input),
    );
    return parseExplanation(
      input,
      { ...(raw as object), generatedAt: (raw as { generatedAt?: string }).generatedAt ?? new Date().toISOString() },
      { provider: 'openai-compatible', model: this.model },
    );
  }

  async draftException(input: DraftExceptionInput): Promise<ExceptionDraft> {
    const raw = await this.completeJson(
      'Draft a PolicyException JSON from the text. Return only JSON matching: {exception: {id, accountId, capability, expected, reason, owner, expiresAt}, rationale, quotedSource, provider, model, generatedAt}. Id must start with ex_draft_. Only use accountIds and capabilities from the input.',
      JSON.stringify(input),
    );
    return parseExceptionDraft(
      input,
      { ...(raw as object), generatedAt: (raw as { generatedAt?: string }).generatedAt ?? new Date().toISOString() },
      { provider: 'openai-compatible', model: this.model },
    );
  }
}

export class AnthropicSuggester implements MappingSuggester {
  constructor(
    private apiKey: string,
    private model = 'claude-haiku-4-5',
  ) {}

  async suggest(ctx: MappingSuggestionContext) {
    const data = (await fetchJson('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        system: PROMPT,
        messages: [{ role: 'user', content: JSON.stringify(ctx) }],
      }),
    })) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((c) => c.type === 'text')?.text ?? '{}';
    const jsonStart = text.indexOf('{');
    const parsed = jsonStart >= 0 ? JSON.parse(text.slice(jsonStart)) : {};
    return { suggestions: filterValidSuggestions(ctx, parsed), provider: 'anthropic' };
  }

  private async completeJson(system: string, user: string): Promise<unknown> {
    const data = (await fetchJson('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    })) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((c) => c.type === 'text')?.text ?? '{}';
    const jsonStart = text.indexOf('{');
    return jsonStart >= 0 ? JSON.parse(text.slice(jsonStart)) : {};
  }

  async explainIncident(input: ExplainInput): Promise<IncidentExplanation> {
    const raw = await this.completeJson(
      'Explain a reconciliation incident. Return only JSON matching: {summary, hypotheses: [{text, evidenceIds, confidence}], suggestedNextStep, provider, model, generatedAt}. Only cite evidenceIds present in the input.',
      JSON.stringify(input),
    );
    return parseExplanation(
      input,
      { ...(raw as object), generatedAt: (raw as { generatedAt?: string }).generatedAt ?? new Date().toISOString() },
      { provider: 'anthropic', model: this.model },
    );
  }

  async draftException(input: DraftExceptionInput): Promise<ExceptionDraft> {
    const raw = await this.completeJson(
      'Draft a PolicyException JSON from the text. Return only JSON matching: {exception: {id, accountId, capability, expected, reason, owner, expiresAt}, rationale, quotedSource, provider, model, generatedAt}. Id must start with ex_draft_. Only use accountIds and capabilities from the input.',
      JSON.stringify(input),
    );
    return parseExceptionDraft(
      input,
      { ...(raw as object), generatedAt: (raw as { generatedAt?: string }).generatedAt ?? new Date().toISOString() },
      { provider: 'anthropic', model: this.model },
    );
  }
}

export function describeProvider(env: NodeJS.ProcessEnv = process.env): {
  name: string;
  model: string;
  configured: boolean;
} {
  if (env.RECONCILE_AI_PROVIDER === 'stub')
    return { name: 'stub', model: 'deterministic', configured: false };
  if (env.OPENAI_API_KEY && env.OPENAI_BASE_URL)
    return { name: 'openai-compatible', model: env.OPENAI_MODEL ?? 'gpt-4o-mini', configured: true };
  if (env.ANTHROPIC_API_KEY)
    return { name: 'anthropic', model: env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5', configured: true };
  return { name: 'stub', model: 'deterministic', configured: false };
}

export function createSuggester(env: NodeJS.ProcessEnv = process.env): MappingSuggester {
  if (env.RECONCILE_AI_PROVIDER === 'stub') return new StubSuggester();
  if (env.OPENAI_API_KEY && env.OPENAI_BASE_URL)
    return new OpenAICompatibleSuggester(
      env.OPENAI_BASE_URL,
      env.OPENAI_API_KEY,
      env.OPENAI_MODEL ?? 'gpt-4o-mini',
    );
  if (env.ANTHROPIC_API_KEY)
    return new AnthropicSuggester(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5');
  return new StubSuggester();
}

// --- Advisory outputs (explain / draft) -------------------------------------

export interface ProviderIdentity {
  provider: string;
  model: string;
}

/** Parse + ground an explanation: drop hypotheses citing unknown evidence. */
export function parseExplanation(
  input: ExplainInput,
  raw: unknown,
  id: ProviderIdentity,
): IncidentExplanation {
  const parsed = IncidentExplanationSchema.safeParse(raw);
  if (!parsed.success)
    throw new GroundingError(`explanation failed schema validation: ${parsed.error.message}`);
  const valid = new Set(input.evidence.map((e) => e.id));
  const grounded = {
    ...parsed.data,
    provider: id.provider,
    model: id.model,
    hypotheses: parsed.data.hypotheses
      .map((h) => ({ ...h, evidenceIds: h.evidenceIds.filter((e) => valid.has(e)) }))
      .filter((h) => h.evidenceIds.length > 0),
  };
  if (grounded.hypotheses.length === 0)
    throw new GroundingError('explanation contained no grounded hypotheses');
  return grounded;
}

/** Parse + ground an exception draft against the allowed accounts/capabilities. */
export function parseExceptionDraft(
  input: DraftExceptionInput,
  raw: unknown,
  id: ProviderIdentity,
): ExceptionDraft {
  const parsed = ExceptionDraftSchema.safeParse(raw);
  if (!parsed.success)
    throw new GroundingError(`exception draft failed schema validation: ${parsed.error.message}`);
  const draft = parsed.data;
  const accounts = new Set(input.accounts.map((a) => a.accountId));
  const caps = new Set(input.capabilities);
  if (!accounts.has(draft.exception.accountId))
    throw new GroundingError(`draft cites unknown account ${draft.exception.accountId}`);
  if (!caps.has(draft.exception.capability))
    throw new GroundingError(`draft cites unknown capability ${draft.exception.capability}`);
  return { ...draft, provider: id.provider, model: id.model };
}

const STUB_TEXT: Record<string, { summary: string; hypothesis: string; next: string }> = {
  unexpected_feature_enabled: {
    summary: 'Observed access is broader than billing entitles.',
    hypothesis: 'access grant outlived subscription; check manual overrides or a stale entitlement sync',
    next: 'Review the account access table and recent admin actions, then disable the grant or link an exception.',
  },
  expected_feature_missing: {
    summary: 'The account is entitled to a capability it does not have.',
    hypothesis: 'entitlement not provisioned — the app-side grant job may have failed or not run',
    next: 'Re-run provisioning for the account and verify the capability flags in the access table.',
  },
  duplicate_local_identity: {
    summary: 'Two local billing records point at the same Stripe subscription.',
    hypothesis: 'duplicate row in the local billing table mapping to one Stripe subscription',
    next: 'Merge or delete the duplicate local billing record, keeping the canonical account mapping.',
  },
  coverage_gap: {
    summary: 'This account could not be assessed against billing.',
    hypothesis: 'identity link missing or evidence incomplete; check the reasons on the assessment',
    next: 'Confirm an identity link for the account, or review the coverage gap reasons.',
  },
};

const CAP_WORDS: Record<string, string[]> = {
  reports: ['report', 'reports'],
  exports: ['export', 'exports'],
  priority_support: ['priority support', 'priority_support', 'support'],
};

export function stubExplain(input: ExplainInput): IncidentExplanation {
  const kind = STUB_TEXT[input.incident.check] ?? STUB_TEXT.coverage_gap;
  const ev = input.incident.evidenceIds;
  return {
    summary: `${kind.summary} (${input.incident.check} on ${input.incident.accountId}/${input.incident.feature})`,
    hypotheses: [
      { text: kind.hypothesis, evidenceIds: ev.slice(0, Math.max(1, Math.min(3, ev.length))), confidence: 'medium' },
      { text: `evidence recorded at ${input.incident.lastConfirmedAt}; ${ev.length} evidence id(s) attached`, evidenceIds: ev.slice(0, 1), confidence: 'low' },
    ],
    suggestedNextStep: kind.next,
    provider: 'stub',
    model: 'deterministic',
    generatedAt: new Date().toISOString(),
  };
}

export function stubDraft(input: DraftExceptionInput): ExceptionDraft {
  const quoted = input.text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 5);
  const acct = input.accounts.find((a) => input.text.includes(a.accountId));
  if (!acct) throw new GroundingError('stub could not find an account id in the text');
  const lower = input.text.toLowerCase();
  const cap = input.capabilities.find((c) => {
    const words = CAP_WORDS[c] ?? [c.toLowerCase(), c.replace(/_/g, ' ')];
    return words.some((w) => lower.includes(w));
  });
  if (!cap) throw new GroundingError('stub could not find a capability in the text');
  const dateMatch = input.text.match(/(\d{4}-\d{2}-\d{2})/);
  if (!dateMatch) throw new GroundingError('stub could not find an expiry date in the text');
  const expected = /free|grant|enable|allow|expected=true|give/i.test(input.text);
  const exception = PolicyExceptionSchema.parse({
    id: `ex_draft_${Date.now()}`,
    accountId: acct.accountId,
    capability: cap,
    expected,
    reason: input.text.slice(0, 200),
    owner: 'ai-draft',
    expiresAt: new Date(`${dateMatch[1]}T00:00:00Z`).toISOString(),
  });
  return {
    exception,
    rationale: `Parsed from text: account ${acct.accountId}, capability ${cap}, expected=${expected}, expires ${dateMatch[1]}.`,
    quotedSource: quoted,
    provider: 'stub',
    model: 'deterministic',
    generatedAt: new Date().toISOString(),
  };
}
