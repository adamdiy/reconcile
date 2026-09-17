import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import Stripe from 'stripe';

const SECRET = 'whsec_test_secret';
const stateDir = mkdtempSync(path.join(tmpdir(), 'reconcile-webhook-'));

let POST: (req: NextRequest) => Promise<Response>;

const payload = JSON.stringify({
  id: `evt_test_${Date.now()}`,
  object: 'event',
  type: 'customer.subscription.updated',
  data: { object: { id: 'sub_001' } },
  created: Math.floor(Date.now() / 1000),
});

function signedReq(body = payload): NextRequest {
  const stripe = new Stripe('sk_test_unused');
  const header = stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET });
  return new NextRequest('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': header, 'content-type': 'application/json' },
    body,
  });
}

beforeAll(async () => {
  process.env.RECONCILE_STATE_DIR = stateDir;
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  const mod = await import('../app/api/webhooks/stripe/route.js');
  POST = mod.POST;
});

afterAll(() => {
  delete process.env.RECONCILE_STATE_DIR;
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

describe('POST /api/webhooks/stripe', () => {
  it('accepts a signed event, archives it, and enqueues stripe_sync', async () => {
    const res = await POST(signedReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const { createStore } = await import('@reconcile/store');
    const store = createStore();
    const events = await store.listWebhookEvents('default');
    expect(events).toHaveLength(1);
    const jobs = await store.listJobs('default');
    expect(jobs.some((j) => j.kind === 'stripe_sync' && j.idempotencyKey.includes('evt_test_'))).toBe(true);
    await store.close();
  });

  it('replays return duplicate without a second job', async () => {
    const res = await POST(signedReq());
    expect(res.status).toBe(200);
    expect((await res.json()).duplicate).toBe(true);
    const { createStore } = await import('@reconcile/store');
    const store = createStore();
    const jobs = (await store.listJobs('default')).filter((j) => j.kind === 'stripe_sync');
    expect(jobs).toHaveLength(1);
    await store.close();
  });

  it('rejects a bad signature', async () => {
    const req = new NextRequest('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 't=1,v1=bogus' },
      body: payload,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('503s when the secret is unset', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = await POST(signedReq());
    expect(res.status).toBe(503);
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  });
});
