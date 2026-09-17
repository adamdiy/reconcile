import { z } from 'zod';

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

export interface MappingSuggester {
  suggest(ctx: MappingSuggestionContext): Promise<{ suggestions: MappingSuggestion[]; provider: string }>;
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
}

export function createSuggester(env: NodeJS.ProcessEnv = process.env): MappingSuggester {
  if (env.OPENAI_API_KEY && env.OPENAI_BASE_URL)
    return new OpenAICompatibleSuggester(env.OPENAI_BASE_URL, env.OPENAI_API_KEY);
  if (env.ANTHROPIC_API_KEY) return new AnthropicSuggester(env.ANTHROPIC_API_KEY);
  return new StubSuggester();
}
