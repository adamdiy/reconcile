import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mapSubscription,
  FixtureStripeConnector,
  StripeApiConnector,
} from '../src/index.js';
import type { RawStripeSubscription, StripeLike } from '../src/index.js';

const rawDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'raw');
const raw = (name: string) => JSON.parse(readFileSync(path.join(rawDir, name), 'utf8'));

const sub = (name: string): RawStripeSubscription => raw(`sub-${name}.json`);

describe('mapSubscription', () => {
  const observedAt = '2026-09-18T00:00:00.000Z';

  it('maps a basic active subscription', () => {
    const f = mapSubscription(sub('active'), observedAt);
    expect(f.status).toBe('active');
    expect(f.customerId).toBe('cus_001');
    expect(f.items).toEqual([{ priceId: 'price_basic', quantity: 1 }]);
    expect(f.currentPeriodEnd).toBe('2026-10-01T00:00:00.000Z');
    expect(f.cancelAtPeriodEnd).toBe(false);
    expect(f.firstFailedInvoiceDueAt).toBeUndefined();
  });

  it('sets firstFailedInvoiceDueAt for past_due with open invoice', () => {
    const f = mapSubscription(sub('past-due-open-invoice'), observedAt);
    expect(f.status).toBe('past_due');
    expect(f.firstFailedInvoiceDueAt).toBe('2026-09-10T00:00:00.000Z');
  });

  it('marks 100%-off coupon subscriptions zeroValue', () => {
    const f = mapSubscription(sub('coupon-100'), observedAt);
    expect(f.zeroValue).toBe(true);
  });

  it('maps scheduleId and pauseCollection', () => {
    const f = mapSubscription(sub('scheduled-paused'), observedAt);
    expect(f.scheduleId).toBe('sub_sched_1');
    expect(f.pauseCollection).toBe(true);
  });
});

function mockClient(pages: {
  customers?: Array<Record<string, unknown>>;
  subscriptions?: Array<Record<string, unknown>>;
  customersError?: unknown;
}): StripeLike {
  let custCalls = 0;
  return {
    customers: {
      list: async () => {
        custCalls += 1;
        if (pages.customersError && custCalls === 1) throw pages.customersError;
        const data = (pages.customers ?? []) as never[];
        return { data, has_more: false };
      },
    },
    subscriptions: {
      list: async () => ({ data: (pages.subscriptions ?? []) as never[], has_more: false }),
    },
  };
}

describe('StripeApiConnector', () => {
  it('collects a complete inventory', async () => {
    const c = new StripeApiConnector({
      client: mockClient({
        customers: [raw('customer-active.json'), raw('customer-deleted.json')],
        subscriptions: [sub('active')],
      }),
    });
    const inv = await c.collect();
    expect(inv.runId.startsWith('srun_')).toBe(true);
    expect(inv.complete).toBe(true);
    expect(inv.permissionsMissing).toEqual([]);
    expect(inv.customers).toHaveLength(2);
    expect(inv.customers[1].deleted).toBe(true);
    expect(inv.subscriptions).toHaveLength(1);
  });

  it('records permissionsMissing and stays complete on permission errors', async () => {
    const c = new StripeApiConnector({
      client: mockClient({
        customersError: { type: 'StripePermissionError' },
        subscriptions: [sub('active')],
      }),
    });
    const inv = await c.collect();
    expect(inv.permissionsMissing).toEqual(['customers']);
    expect(inv.complete).toBe(true);
  });

  it('marks inventory incomplete on non-permission page failure', async () => {
    const c = new StripeApiConnector({
      client: mockClient({
        customersError: new Error('boom'),
        subscriptions: [sub('active')],
      }),
    });
    const inv = await c.collect();
    expect(inv.complete).toBe(false);
  });
});

describe('FixtureStripeConnector', () => {
  it('returns the fixture inventory', async () => {
    const inv = await new FixtureStripeConnector().collect();
    expect(inv.subscriptions.length).toBeGreaterThan(0);
  });
});
