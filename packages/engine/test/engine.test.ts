import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { EvaluationInput } from '@reconcile/domain';
import { evaluate, fingerprint } from '../src/index.js';

const NOW = '2026-09-17T12:00:00Z';

const policy = {
  version: 'v1-test',
  ruleIdPrefix: 'plan',
  capabilities: ['reports', 'exports'],
  priceMappings: [
    { ruleId: 'plan:pro', priceId: 'price_pro', capabilities: ['reports', 'exports'] },
    { ruleId: 'plan:free', priceId: 'price_free', capabilities: ['reports'] },
  ],
  lifecycle: { pastDueGraceHours: 72, trialGrantsAccess: true },
  freshness: { maxEvidenceAgeMinutes: 2880 },
};

function baseInput(overrides: Partial<EvaluationInput> = {}): EvaluationInput {
  return {
    stripe: {
      runId: 'sr_1',
      complete: true,
      observedAt: NOW,
      permissionsMissing: [],
      customers: [{ id: 'cus_1', deleted: false, observedAt: NOW }],
      subscriptions: [],
    },
    app: { runId: 'ar_1', complete: true, observedAt: NOW, accounts: [] },
    links: [{ accountId: 'acct_1', stripeCustomerId: 'cus_1', reviewed: true }],
    policy,
    exceptions: [],
    evaluatedAt: NOW,
    ...overrides,
  };
}

function withSub(
  sub: Partial<EvaluationInput['stripe']['subscriptions'][number]> & { id: string },
  access: Record<string, boolean> = { reports: true, exports: true },
): EvaluationInput {
  return baseInput({
    stripe: {
      runId: 'sr_1',
      complete: true,
      observedAt: NOW,
      permissionsMissing: [],
      customers: [{ id: 'cus_1', deleted: false, observedAt: NOW }],
      subscriptions: [
        {
          customerId: 'cus_1',
          status: 'active',
          items: [{ priceId: 'price_pro', quantity: 1 }],
          cancelAtPeriodEnd: false,
          observedAt: NOW,
          ...sub,
        },
      ],
    },
    app: {
      runId: 'ar_1',
      complete: true,
      observedAt: NOW,
      accounts: [
        {
          accountId: 'acct_1',
          stripeCustomerIds: ['cus_1'],
          localBillingRecords: [],
          observedAt: NOW,
          method: 'database_view',
          access,
        },
      ],
    },
  });
}

describe('evaluate', () => {
  it('current paid access: matches on all features', () => {
    const [a] = evaluate(withSub({ id: 'sub_1' }));
    expect(a.accountReasons).toEqual([]);
    expect(a.features.every((f) => f.kind === 'match')).toBe(true);
  });

  it('permitted trial: trialing sub entitles while trialGrantsAccess', () => {
    const [a] = evaluate(
      withSub({ id: 'sub_1', status: 'trialing', trialEnd: '2026-09-25T00:00:00Z' }),
    );
    expect(a.features.every((f) => f.kind === 'match' && f.expected)).toBe(true);
    expect(a.nextTransitionAt).toBe('2026-09-25T00:00:00.000Z');
  });

  it('trialing does not entitle when trialGrantsAccess is false', () => {
    const input = withSub({ id: 'sub_1', status: 'trialing' });
    input.policy = { ...policy, lifecycle: { ...policy.lifecycle, trialGrantsAccess: false } };
    const [a] = evaluate(input);
    expect(a.features.every((f) => f.kind === 'mismatch' && f.expected === false)).toBe(true);
  });

  it('trialing without access still schedules the trialEnd transition', () => {
    const input = withSub({
      id: 'sub_1',
      status: 'trialing',
      trialEnd: '2026-09-25T00:00:00Z',
    });
    input.policy = { ...policy, lifecycle: { ...policy.lifecycle, trialGrantsAccess: false } };
    const [a] = evaluate(input);
    expect(a.features.every((f) => f.kind === 'mismatch' && f.expected === false)).toBe(true);
    expect(a.nextTransitionAt).toBe('2026-09-25T00:00:00.000Z');
  });

  it('past_due inside grace entitles', () => {
    const [a] = evaluate(
      withSub({ id: 'sub_1', status: 'past_due', firstFailedInvoiceDueAt: '2026-09-16T00:00:00Z' }),
    );
    expect(a.features.every((f) => f.kind === 'match' && f.expected)).toBe(true);
    expect(a.nextTransitionAt).toBe('2026-09-19T00:00:00.000Z');
  });

  it('past_due outside grace does not entitle -> unexpected access mismatch', () => {
    const [a] = evaluate(
      withSub({ id: 'sub_1', status: 'past_due', firstFailedInvoiceDueAt: '2026-09-10T00:00:00Z' }),
    );
    for (const f of a.features) {
      expect(f).toMatchObject({ kind: 'mismatch', expected: false, observed: true });
    }
  });

  it('scheduled cancel before effective time still entitles', () => {
    const [a] = evaluate(
      withSub({
        id: 'sub_1',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: '2026-10-01T00:00:00Z',
      }),
    );
    expect(a.features.every((f) => f.kind === 'match' && f.expected)).toBe(true);
    expect(a.nextTransitionAt).toBe('2026-10-01T00:00:00.000Z');
  });

  it('scheduled cancel after effective time does not entitle', () => {
    const input = withSub({
      id: 'sub_1',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: '2026-09-01T00:00:00Z',
    });
    const [a] = evaluate(input);
    expect(a.features.every((f) => f.kind === 'mismatch' && f.expected === false)).toBe(true);
  });

  it('cancel_at beats cancel_at_period_end', () => {
    const [a] = evaluate(
      withSub({
        id: 'sub_1',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: '2026-10-01T00:00:00Z',
        cancelAt: '2026-09-10T00:00:00Z',
      }),
    );
    expect(a.features.every((f) => f.kind === 'mismatch' && f.expected === false)).toBe(true);
  });

  it('immediate cancel (canceled) does not entitle', () => {
    const [a] = evaluate(
      withSub({ id: 'sub_1', status: 'canceled', canceledAt: '2026-09-01T00:00:00Z' }),
    );
    expect(a.features.every((f) => f.kind === 'mismatch' && f.expected === false)).toBe(true);
  });

  it('zero-value plan entitles and flags zero_value evidence', () => {
    const input = withSub(
      { id: 'sub_1', items: [{ priceId: 'price_free', quantity: 1 }], zeroValue: true },
      { reports: true, exports: false },
    );
    const [a] = evaluate(input);
    const reports = a.features.find((f) => f.feature === 'reports');
    expect(reports).toMatchObject({ kind: 'match', expected: true });
    expect(reports!.evidenceIds.join(' ')).toContain('zero_value');
    expect(a.features.find((f) => f.feature === 'exports')).toMatchObject({
      kind: 'match',
      expected: false,
    });
  });

  it('unknown price -> unsupported_policy unknown per capability', () => {
    const [a] = evaluate(
      withSub({ id: 'sub_1', items: [{ priceId: 'price_mystery', quantity: 1 }] }),
    );
    expect(a.features.every((f) => f.kind === 'unknown')).toBe(true);
    expect(
      a.features.every((f) => f.kind === 'unknown' && f.reasons.includes('unsupported_policy')),
    ).toBe(true);
  });

  it('expired exception does not override', () => {
    const input = withSub({ id: 'sub_1' }, { reports: true, exports: true });
    input.exceptions = [
      {
        id: 'ex_1',
        accountId: 'acct_1',
        capability: 'exports',
        expected: false,
        reason: 'comp revoked',
        owner: 'ops',
        expiresAt: '2026-08-01T00:00:00Z',
      },
    ];
    const [a] = evaluate(input);
    expect(a.features.find((f) => f.feature === 'exports')).toMatchObject({ kind: 'match' });
  });

  it('unexpired exception overrides expected', () => {
    const input = withSub({ id: 'sub_1' }, { reports: true, exports: true });
    input.exceptions = [
      {
        id: 'ex_1',
        accountId: 'acct_1',
        capability: 'exports',
        expected: false,
        reason: 'comp revoked',
        owner: 'ops',
        expiresAt: '2026-12-01T00:00:00Z',
      },
    ];
    const [a] = evaluate(input);
    expect(a.features.find((f) => f.feature === 'exports')).toMatchObject({
      kind: 'mismatch',
      expected: false,
      observed: true,
    });
    expect(a.nextTransitionAt).toBe('2026-12-01T00:00:00.000Z');
  });

  it('conflicting exceptions -> feature unknown conflicting_exceptions', () => {
    const input = withSub({ id: 'sub_1' });
    input.exceptions = [
      {
        id: 'ex_1',
        accountId: 'acct_1',
        capability: 'exports',
        expected: true,
        reason: 'a',
        owner: 'ops',
        expiresAt: '2026-12-01T00:00:00Z',
      },
      {
        id: 'ex_2',
        accountId: 'acct_1',
        capability: 'exports',
        expected: false,
        reason: 'b',
        owner: 'ops',
        expiresAt: '2026-12-15T00:00:00Z',
      },
    ];
    const [a] = evaluate(input);
    expect(a.features.find((f) => f.feature === 'exports')).toMatchObject({
      kind: 'unknown',
      reasons: ['conflicting_exceptions'],
    });
  });

  it('multiple entitling subscriptions union capabilities', () => {
    const input = withSub({ id: 'sub_1', items: [{ priceId: 'price_free', quantity: 1 }] });
    input.stripe.subscriptions.push({
      id: 'sub_2',
      customerId: 'cus_1',
      status: 'active',
      items: [{ priceId: 'price_pro', quantity: 1 }],
      cancelAtPeriodEnd: false,
      observedAt: NOW,
    });
    const [a] = evaluate(input);
    expect(a.accountReasons).toEqual([]);
    expect(a.features.every((f) => f.kind === 'match' && f.expected === true)).toBe(true);
  });

  it('multi-item subscription unions mapped capabilities; unmapped item adds no unknown when covered', () => {
    const [a] = evaluate(
      withSub({
        id: 'sub_1',
        items: [
          { priceId: 'price_pro', quantity: 1 },
          { priceId: 'price_addon', quantity: 1 },
        ],
      }),
    );
    expect(a.accountReasons).toEqual([]);
    expect(a.features.every((f) => f.kind === 'match')).toBe(true);
  });

  it('unmapped item yields unsupported_policy only for ungranted capabilities', () => {
    const [a] = evaluate(
      withSub(
        {
          id: 'sub_1',
          items: [
            { priceId: 'price_free', quantity: 1 },
            { priceId: 'price_addon', quantity: 1 },
          ],
        },
        { reports: true, exports: true },
      ),
    );
    expect(a.features.find((f) => f.feature === 'reports')).toMatchObject({
      kind: 'match',
      expected: true,
    });
    const exports = a.features.find((f) => f.feature === 'exports');
    expect(exports).toMatchObject({ kind: 'unknown', reasons: ['unsupported_policy'] });
  });

  it('quantity > 1 is supported and contributes nothing extra', () => {
    const [a] = evaluate(
      withSub({ id: 'sub_1', items: [{ priceId: 'price_pro', quantity: 5 }] }),
    );
    expect(a.accountReasons).toEqual([]);
    expect(a.features.every((f) => f.kind === 'match')).toBe(true);
  });

  it('scheduleId is supported (items reflect the active phase)', () => {
    const [a] = evaluate(
      withSub({ id: 'sub_1', scheduleId: 'sub_sched_1' }),
    );
    expect(a.accountReasons).toEqual([]);
    expect(a.features.every((f) => f.kind === 'match')).toBe(true);
  });

  it('paused status grants no access', () => {
    const [a] = evaluate(
      withSub({ id: 'sub_1', status: 'paused' }),
    );
    expect(a.features.every((f) => f.kind === 'mismatch' && f.expected === false)).toBe(true);
  });

  it('pauseCollection grants no access', () => {
    const [a] = evaluate(
      withSub({ id: 'sub_1', pauseCollection: true }),
    );
    expect(a.features.every((f) => f.kind === 'mismatch' && f.expected === false)).toBe(true);
  });

  it('zero-item subscription -> unsupported_billing_model', () => {
    const [a] = evaluate(
      withSub({ id: 'sub_1', items: [] }),
    );
    expect(a.accountReasons).toContain('unsupported_billing_model');
  });

  it('billing-only subject (linked account absent from complete app inventory) -> expected missing', () => {
    const input = baseInput();
    input.app.accounts = [];
    input.stripe.subscriptions = [
      {
        id: 'sub_1',
        customerId: 'cus_1',
        status: 'active',
        items: [{ priceId: 'price_pro', quantity: 1 }],
        cancelAtPeriodEnd: false,
        observedAt: NOW,
      },
    ];
    const [a] = evaluate(input);
    expect(a.accountId).toBe('acct_1');
    expect(a.accountReasons).toEqual([]);
    for (const f of a.features) {
      expect(f).toMatchObject({ kind: 'mismatch', expected: true, observed: false });
      expect(f.evidenceIds.join(' ')).toContain('absent');
    }
  });

  it('duplicate local billing records -> integrity finding', () => {
    const input = withSub({ id: 'sub_1' });
    input.app.accounts[0].localBillingRecords = [
      { localId: 'lr_1', stripeSubscriptionId: 'sub_1' },
      { localId: 'lr_2', stripeSubscriptionId: 'sub_1' },
    ];
    const [a] = evaluate(input);
    expect(a.integrity).toHaveLength(1);
    expect(a.integrity[0]).toMatchObject({
      kind: 'duplicate_local_identity',
      localRecordIds: ['lr_1', 'lr_2'],
      stripeSubscriptionId: 'sub_1',
    });
  });

  it('unmapped identity: collector customer without reviewed link', () => {
    const input = withSub({ id: 'sub_1' });
    input.links = [];
    const [a] = evaluate(input);
    expect(a.accountReasons).toContain('unmapped_identity');
    expect(a.features.every((f) => f.kind === 'unknown')).toBe(true);
  });

  it('link/collector disagreement -> unmapped_identity', () => {
    const input = withSub({ id: 'sub_1' });
    input.app.accounts[0].stripeCustomerIds = ['cus_other'];
    input.stripe.customers.push({ id: 'cus_other', deleted: false, observedAt: NOW });
    const [a] = evaluate(input);
    expect(a.accountReasons).toContain('unmapped_identity');
  });

  it('stripe customer with no link and no reference -> synthetic subject, unmapped', () => {
    const input = withSub({ id: 'sub_1' });
    input.stripe.customers.push({ id: 'cus_orphan', deleted: false, observedAt: NOW });
    const out = evaluate(input);
    const orphan = out.find((a) => a.accountId === 'stripe:cus_orphan');
    expect(orphan).toBeDefined();
    expect(orphan!.accountReasons).toContain('unmapped_identity');
  });

  it('stale evidence when observation older than freshness', () => {
    const input = withSub({ id: 'sub_1' });
    input.app.accounts[0].observedAt = '2026-09-01T00:00:00Z';
    const [a] = evaluate(input);
    expect(a.accountReasons).toContain('stale_evidence');
  });

  it('incomplete inventory -> every feature unknown', () => {
    const input = withSub({ id: 'sub_1' });
    input.stripe.complete = false;
    const [a] = evaluate(input);
    expect(a.accountReasons).toContain('incomplete_inventory');
    expect(a.features.every((f) => f.kind === 'unknown')).toBe(true);
  });

  it('missing permissions -> missing_permission', () => {
    const input = withSub({ id: 'sub_1' });
    input.stripe.permissionsMissing = ['invoices'];
    const [a] = evaluate(input);
    expect(a.accountReasons).toContain('missing_permission');
  });

  it('deleted customer removes entitlement', () => {
    const input = withSub({ id: 'sub_1' });
    input.stripe.customers[0].deleted = true;
    const [a] = evaluate(input);
    expect(a.features.every((f) => f.kind === 'mismatch' && f.expected === false)).toBe(true);
  });

  it('unobserved feature is unknown, not false', () => {
    const input = withSub({ id: 'sub_1' }, { reports: true });
    const [a] = evaluate(input);
    expect(a.features.find((f) => f.feature === 'exports')).toMatchObject({
      kind: 'unknown',
      reasons: ['unobserved_feature'],
    });
  });
});

describe('properties', () => {
  const subArb = fc.array(
    fc.record({
      id: fc.string({ minLength: 1 }),
      customerId: fc.constant('cus_1'),
      status: fc.constantFrom(
        'trialing',
        'active',
        'past_due',
        'unpaid',
        'canceled',
        'incomplete',
        'incomplete_expired',
        'paused',
      ) as fc.Arbitrary<
        | 'trialing'
        | 'active'
        | 'past_due'
        | 'unpaid'
        | 'canceled'
        | 'incomplete'
        | 'incomplete_expired'
        | 'paused'
      >,
      items: fc.array(
        fc.record({ priceId: fc.constantFrom('price_pro', 'price_free', 'price_x'), quantity: fc.integer({ min: 1, max: 3 }) }),
        { minLength: 0, maxLength: 3 },
      ),
      cancelAtPeriodEnd: fc.boolean(),
      observedAt: fc.constant(NOW),
      sourceRevision: fc.option(fc.integer({ min: 1, max: 5 }).map(String), { nil: undefined }),
    }),
    { maxLength: 4 },
  );

  it('permuting input arrays does not change output', () => {
    fc.assert(
      fc.property(subArb, (subs) => {
        const input = withSub({ id: 'sub_keep' });
        input.stripe.subscriptions = subs as EvaluationInput['stripe']['subscriptions'];
        const a = evaluate(input);
        input.stripe.subscriptions = [...input.stripe.subscriptions].reverse();
        input.stripe.customers = [...input.stripe.customers].reverse();
        input.app.accounts = [...input.app.accounts].reverse();
        input.links = [...input.links].reverse();
        const b = evaluate(input);
        expect(b).toEqual(a);
      }),
    );
  });

  it('non-empty accountReasons implies every feature unknown', () => {
    fc.assert(
      fc.property(subArb, fc.boolean(), fc.boolean(), (subs, stripeComplete, appComplete) => {
        const input = withSub({ id: 'sub_keep' });
        input.stripe.subscriptions = subs as EvaluationInput['stripe']['subscriptions'];
        input.stripe.complete = stripeComplete;
        input.app.complete = appComplete;
        for (const a of evaluate(input)) {
          if (a.accountReasons.length > 0) {
            expect(a.features.every((f) => f.kind === 'unknown')).toBe(true);
            for (const f of a.features)
              if (f.kind === 'unknown') expect(f.reasons).toEqual(a.accountReasons);
          }
        }
      }),
    );
  });

  it('incomplete inventory never yields expected=false/observed=true mismatch', () => {
    fc.assert(
      fc.property(subArb, (subs) => {
        const input = withSub({ id: 'sub_keep' });
        input.stripe.subscriptions = subs as EvaluationInput['stripe']['subscriptions'];
        input.stripe.complete = false;
        for (const a of evaluate(input)) {
          expect(
            a.features.some(
              (f) => f.kind === 'mismatch' && f.expected === false && f.observed === true,
            ),
          ).toBe(false);
        }
      }),
    );
  });
});

describe('fingerprint', () => {
  it('is deterministic and distinct', () => {
    expect(fingerprint('a', 'r', 'f')).toBe(fingerprint('a', 'r', 'f'));
    expect(fingerprint('a', 'r', 'f')).not.toBe(fingerprint('a', 'r', 'g'));
  });
});

describe('quantity checks', () => {
  const qtyPolicy = {
    ...policy,
    seats: { priceIds: ['price_seat'] },
    usage: [{ metric: 'api_calls', priceId: 'price_api', tolerancePct: 5 }],
  };

  function seatInput(seatsUsed: number | undefined): EvaluationInput {
    return {
      ...withSub(
        { id: 'sub_1', items: [{ priceId: 'price_seat', quantity: 5, usageType: 'licensed' }] },
        { reports: true, exports: true },
      ),
      app: {
        runId: 'ar_1',
        complete: true,
        observedAt: NOW,
        accounts: [
          {
            accountId: 'acct_1',
            stripeCustomerIds: ['cus_1'],
            localBillingRecords: [],
            observedAt: NOW,
            method: 'database_view',
            access: { reports: true, exports: true },
            seatsUsed,
          },
        ],
      },
      policy: qtyPolicy,
    };
  }

  function usageInput(appUsage: number | undefined, records?: { quantity: number }[]): EvaluationInput {
    const input = {
      ...withSub(
        {
          id: 'sub_1',
          items: [{ priceId: 'price_api', quantity: 1, usageType: 'metered' }],
          usageRecords: records?.map((r) => ({
            priceId: 'price_api',
            quantity: r.quantity,
            periodStart: '2026-09-01T00:00:00Z',
            periodEnd: '2026-10-01T00:00:00Z',
          })),
        },
        { reports: true, exports: true },
      ),
      policy: qtyPolicy,
    };
    if (appUsage !== undefined) input.app.accounts[0].usage = { api_calls: appUsage };
    return input;
  }

  it('seats over licensed quantity → seats mismatch', () => {
    const [a] = evaluate(seatInput(7));
    const q = a.quantityChecks.find((x) => x.check === 'seats')!;
    expect(q).toMatchObject({ kind: 'mismatch', expected: 5, observed: 7 });
  });

  it('seats at cap → match; under cap → match', () => {
    for (const n of [5, 3]) {
      const [a] = evaluate(seatInput(n));
      expect(a.quantityChecks.find((x) => x.check === 'seats')!.kind).toBe('match');
    }
  });

  it('missing seatsUsed → unknown not_observed', () => {
    const [a] = evaluate(seatInput(undefined));
    const q = a.quantityChecks.find((x) => x.check === 'seats')!;
    expect(q).toMatchObject({ kind: 'unknown', reasons: ['not_observed'] });
  });

  it('no seat price in subscription → no seats check emitted', () => {
    const input = { ...seatInput(10), policy: qtyPolicy };
    input.stripe.subscriptions[0].items = [{ priceId: 'price_pro', quantity: 2 }];
    const [a] = evaluate(input);
    expect(a.quantityChecks.find((x) => x.check === 'seats')).toBeUndefined();
  });

  it('app usage above Stripe records beyond tolerance → usage mismatch', () => {
    const [a] = evaluate(usageInput(12000, [{ quantity: 9000 }]));
    const q = a.quantityChecks.find((x) => x.check === 'usage')!;
    expect(q).toMatchObject({ kind: 'mismatch', metric: 'api_calls', expected: 12000, observed: 9000 });
  });

  it('usage within tolerance → match', () => {
    const [a] = evaluate(usageInput(10000, [{ quantity: 9700 }]));
    expect(a.quantityChecks.find((x) => x.check === 'usage')!.kind).toBe('match');
  });

  it('no usageRecords → unknown not_observed pointing at the sub', () => {
    const [a] = evaluate(usageInput(5000, undefined));
    const q = a.quantityChecks.find((x) => x.check === 'usage')!;
    expect(q).toMatchObject({ kind: 'unknown', reasons: ['not_observed'] });
    expect(q.evidenceIds.some((e) => e.includes('usage_records_missing'))).toBe(true);
  });

  it('missing app-side metric → unknown not_observed', () => {
    const [a] = evaluate(usageInput(undefined, [{ quantity: 9000 }]));
    const q = a.quantityChecks.find((x) => x.check === 'usage')!;
    expect(q.kind).toBe('unknown');
  });
});
