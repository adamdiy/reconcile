// Mock payloads shaped after the public docs:
// Chargebee: https://apidocs.chargebee.com/docs/api/subscriptions#list_subscriptions
//            https://apidocs.chargebee.com/docs/api/customers#list_customers
// Paddle:    https://developer.paddle.com/api-reference/subscriptions/list-subscriptions
//            https://developer.paddle.com/api-reference/customers/list-customers
// (untested against live APIs — see docs/providers.md)
import { describe, expect, it } from 'vitest';
import { ChargebeeConnector, PaddleConnector } from '../src/providers.js';
import { createBillingConnector } from '../src/index.js';

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('ChargebeeConnector', () => {
  it('maps subscriptions, statuses, quantities; paginates by offset', async () => {
    const seen: string[] = [];
    const connector = new ChargebeeConnector(
      { site: 'acme', apiKey: 'k', baseUrl: 'https://cb.test' },
      async (url) => {
        seen.push(String(url));
        if (String(url).includes('/customers'))
          return okJson({ list: [{ customer: { id: 'cus_cb1' } }] });
        if (String(url).includes('offset=page2'))
          return okJson({
            list: [
              {
                subscription: {
                  id: 'sub_cb2',
                  customer_id: 'cus_cb2',
                  status: 'non_renewing',
                  subscription_items: [{ item_price_id: 'p_team', quantity: 3 }],
                },
              },
            ],
          });
        return okJson({
          list: [
            {
              subscription: {
                id: 'sub_cb1',
                customer_id: 'cus_cb1',
                status: 'in_trial',
                subscription_items: [{ item_price_id: 'p_pro', quantity: 1 }],
                current_term_end: 1780000000,
                trial_end: 1790000000,
              },
            },
          ],
          next_offset: 'page2',
        });
      },
    );
    const inv = await connector.collect();
    expect(inv.provider).toBe('chargebee');
    expect(inv.complete).toBe(true);
    expect(inv.customers).toEqual([{ id: 'cus_cb1', deleted: false, observedAt: inv.observedAt }]);
    const [s1, s2] = inv.subscriptions;
    expect(s1.status).toBe('trialing');
    expect(s1.trialEnd).toBeDefined();
    expect(s1.items[0]).toMatchObject({ priceId: 'p_pro', quantity: 1 });
    expect(s2.status).toBe('active');
    expect(s2.cancelAtPeriodEnd).toBe(true);
    expect(s2.items[0].quantity).toBe(3);
    expect(seen.filter((u) => u.includes('offset='))).toHaveLength(1);
  });

  it('401 → permissionsMissing', async () => {
    const connector = new ChargebeeConnector({ site: 's', apiKey: 'k', baseUrl: 'https://x' }, async () => new Response('no', { status: 401 }));
    const inv = await connector.collect();
    expect(inv.permissionsMissing.sort()).toEqual(['customers', 'subscriptions']);
  });
});

describe('PaddleConnector', () => {
  it('maps subscriptions via cursor pagination and scheduled_change', async () => {
    const connector = new PaddleConnector(
      { apiKey: 'k', baseUrl: 'https://pd.test' },
      async (url) => {
        if (String(url).includes('/customers'))
          return okJson({ data: [{ id: 'ctm_1' }], meta: { pagination: {} } });
        if (String(url).includes('next=cursor1'))
          return okJson({
            data: [
              {
                id: 'sub_2',
                customer_id: 'ctm_2',
                status: 'active',
                items: [{ price: { id: 'pri_metered' }, quantity: 1 }],
                scheduled_change: { action: 'cancel', effective_at: '2026-10-01T00:00:00Z' },
              },
            ],
            meta: { pagination: {} },
          });
        return okJson({
          data: [
            {
              id: 'sub_1',
              customer_id: 'ctm_1',
              status: 'paused',
              items: [{ price: { id: 'pri_pro' }, quantity: 2 }],
              current_billing_period: { ends_at: '2026-11-01T00:00:00Z' },
            },
          ],
          meta: { pagination: { next: 'https://pd.test/subscriptions?next=cursor1' } },
        });
      },
    );
    const inv = await connector.collect();
    expect(inv.provider).toBe('paddle');
    const [s1, s2] = inv.subscriptions;
    expect(s1.status).toBe('paused');
    expect(s1.pauseCollection).toBe(true);
    expect(s1.items[0]).toMatchObject({ priceId: 'pri_pro', quantity: 2 });
    expect(s2.cancelAtPeriodEnd).toBe(true);
    expect(s2.cancelAt).toBe('2026-10-01T00:00:00Z');
  });

  it('403 → permissionsMissing', async () => {
    const connector = new PaddleConnector({ apiKey: 'k', baseUrl: 'https://x' }, async () => new Response('no', { status: 403 }));
    const inv = await connector.collect();
    expect(inv.permissionsMissing.sort()).toEqual(['customers', 'subscriptions']);
  });
});

describe('createBillingConnector', () => {
  it('defaults to fixtures when no env', async () => {
    const c = await createBillingConnector({});
    const inv = await c.collect();
    expect(inv.provider).toBe('stripe');
  });
});
