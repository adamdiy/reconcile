import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { loadFixtures } from '@reconcile/fixtures';
import { newJob } from '@reconcile/jobs';
import { seedFromFixtures } from '@reconcile/store';
import { createStore } from '../../../../lib/state';
import { projectFromRequest } from '../../../../lib/ingest';

const SYNC_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
  'invoice.paid',
  'customer.deleted',
]);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret)
    return NextResponse.json(
      { error: 'STRIPE_WEBHOOK_SECRET is not configured; unsigned webhooks are never accepted' },
      { status: 503 },
    );

  const rawBody = await req.text();
  const signature = req.headers.get('stripe-signature') ?? '';
  let event: Stripe.Event;
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_unused');
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  const projectId = projectFromRequest(req);
  const receivedAt = new Date().toISOString();
  const store = createStore();
  try {
    await store.migrate();
    await seedFromFixtures(store, loadFixtures());
    const result = await store.putWebhookEvent(projectId, event.id, event, receivedAt);
    if (result === 'duplicate')
      return NextResponse.json({ ok: true, duplicate: true });
    if (SYNC_EVENTS.has(event.type))
      await store.enqueueJob(
        newJob('stripe_sync', projectId, `stripe_sync:${projectId}:${event.id}`, receivedAt, {
          eventId: event.id,
          eventType: event.type,
        }),
      );
    return NextResponse.json({ ok: true, eventType: event.type });
  } finally {
    await store.close();
  }
}
