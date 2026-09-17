import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountAssessment, Incident } from '@reconcile/domain';
import {
  GroundingError,
  OpenAICompatibleSuggester,
  StubSuggester,
  createSuggester,
  describeProvider,
  parseExceptionDraft,
  parseExplanation,
  stubDraft,

} from '../src/index.js';
import type { DraftExceptionInput, ExplainInput } from '../src/index.js';

const incident: Incident = {
  id: 'fp1',
  accountId: 'acct_005',
  check: 'expected_feature_missing',
  feature: 'exports',
  expected: true,
  observed: false,
  ruleId: 'r1',
  severity: 'high',
  state: 'confirmed',
  occurrences: 3,
  firstSeenAt: '2026-09-01T00:00:00Z',
  lastConfirmedAt: '2026-09-02T00:00:00Z',
  evidenceIds: ['ev1', 'ev2', 'ev3'],
};

const assessment = { accountId: 'acct_005' } as unknown as AccountAssessment;
const policy = {
  version: 'v1',
  capabilities: ['reports', 'exports'],
  lifecycle: { pastDueGraceHours: 24 },
  priceMappings: [],
} as unknown as import('@reconcile/domain').Policy;

const explainInput: ExplainInput = {
  incident,
  assessment,
  evidence: [{ id: 'ev1' }, { id: 'ev2' }, { id: 'ev3' }],
  policy,
};

const draftInput: DraftExceptionInput = {
  text: 'Give acct_003 free exports until 2026-12-31 per contract',
  accounts: [{ accountId: 'acct_003' }, { accountId: 'acct_005' }],
  capabilities: ['reports', 'exports'],
  policy,
  now: '2026-09-17T00:00:00Z',
};

const id = { provider: 'test', model: 'm1' };

describe('grounding guard', () => {
  it('drops hypotheses citing unknown evidence ids', () => {
    const raw = {
      summary: 's',
      hypotheses: [
        { text: 'grounded', evidenceIds: ['ev1'], confidence: 'high' },
        { text: 'hallucinated', evidenceIds: ['evX'], confidence: 'low' },
      ],
      suggestedNextStep: 'n',
      provider: 'x',
      model: 'y',
      generatedAt: '2026-09-17T00:00:00Z',
    };
    const out = parseExplanation(explainInput, raw, id);
    expect(out.hypotheses).toHaveLength(1);
    expect(out.hypotheses[0].evidenceIds).toEqual(['ev1']);
    expect(out.provider).toBe('test');
    expect(out.model).toBe('m1');
  });

  it('rejects an explanation with no grounded hypotheses', () => {
    const raw = {
      summary: 's',
      hypotheses: [{ text: 'h', evidenceIds: ['nope'], confidence: 'low' }],
      suggestedNextStep: 'n',
      provider: 'x',
      model: 'y',
      generatedAt: '2026-09-17T00:00:00Z',
    };
    expect(() => parseExplanation(explainInput, raw, id)).toThrow(GroundingError);
  });

  it('rejects drafts citing unknown accounts or capabilities', () => {
    const base = {
      rationale: 'r',
      quotedSource: [],
      provider: 'x',
      model: 'y',
      generatedAt: '2026-09-17T00:00:00Z',
    };
    for (const [accountId, capability] of [
      ['acct_999', 'exports'],
      ['acct_003', 'teleport'],
    ]) {
      const raw = {
        ...base,
        exception: {
          id: 'ex_draft_1',
          accountId,
          capability,
          expected: true,
          reason: 'r',
          owner: 'o',
          expiresAt: '2027-01-01T00:00:00Z',
        },
      };
      expect(() => parseExceptionDraft(draftInput, raw, id)).toThrow(GroundingError);
    }
  });
});

describe('stub provider', () => {
  it('explains deterministically citing the incident evidence', async () => {
    const s = new StubSuggester();
    const a = await s.explainIncident(explainInput);
    const b = await s.explainIncident(explainInput);
    expect(a.provider).toBe('stub');
    expect(a.hypotheses.length).toBeGreaterThan(0);
    expect(a.hypotheses.every((h) => h.evidenceIds.every((e) => incident.evidenceIds.includes(e)))).toBe(true);
    expect(a.summary).toBe(b.summary);
    expect(a.hypotheses).toEqual(b.hypotheses);
  });

  it('drafts an exception from free text', async () => {
    const d = await new StubSuggester().draftException(draftInput);
    expect(d.exception.accountId).toBe('acct_003');
    expect(d.exception.capability).toBe('exports');
    expect(d.exception.expected).toBe(true);
    expect(d.exception.id.startsWith('ex_draft_')).toBe(true);
    expect(d.exception.expiresAt).toContain('2026-12-31');
  });

  it('fails clearly when the text cannot be parsed', () => {
    expect(() =>
      stubDraft({ ...draftInput, text: 'no account and no date here' }),
    ).toThrow(GroundingError);
  });

  it('is the default when no provider env is set', () => {
    const info = describeProvider({});
    expect(info).toEqual({ name: 'stub', model: 'deterministic', configured: false });
    expect(createSuggester({})).toBeInstanceOf(StubSuggester);
  });
});

describe('malformed provider output', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('surfaces a typed error, never a crash', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"summary": 5, "hypotheses": "broken"}' } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const s = new OpenAICompatibleSuggester('http://example.test/v1', 'sk-x', 'm');
    await expect(s.explainIncident(explainInput)).rejects.toThrow(GroundingError);
  });
});
