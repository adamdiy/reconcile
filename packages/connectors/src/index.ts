import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { StripeCustomerFact, StripeInventory, StripeSubscriptionFact } from '@reconcile/domain';
import { loadFixtures, fixturesDir } from '@reconcile/fixtures';

export interface StripeConnector {
  collect(): Promise<StripeInventory>;
}

interface StripeListPage<T> {
  data: T[];
  has_more: boolean;
}

// Minimal structural views of Stripe objects — only the fields we read.
export interface RawStripeCustomer {
  id: string;
  deleted?: boolean;
  [key: string]: unknown;
}

export interface RawStripeSubscription {
  id: string;
  customer: string | { id: string };
  status: string;
  items: { data: Array<{ price: { id: string; unit_amount?: number | null }; quantity: number }> };
  schedule?: string | { id: string } | null;
  pause_collection?: unknown;
  trial_end?: number | null;
  current_period_end?: number | null;
  cancel_at_period_end?: boolean;
  cancel_at?: number | null;
  canceled_at?: number | null;
  latest_invoice?: {
    status?: string;
    due_date?: number | null;
    created?: number;
  } | null;
  discount?: { coupon?: { percent_off?: number | null } } | null;
  [key: string]: unknown;
}

export interface StripeLike {
  customers: {
    list(params?: Record<string, unknown>): Promise<StripeListPage<RawStripeCustomer>>;
  };
  subscriptions: {
    list(params?: Record<string, unknown>): Promise<StripeListPage<RawStripeSubscription>>;
  };
}

const iso = (epoch?: number | null): string | undefined =>
  epoch == null ? undefined : new Date(epoch * 1000).toISOString();

export function mapSubscription(sub: RawStripeSubscription, observedAt: string): StripeSubscriptionFact {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const scheduleId =
    sub.schedule == null ? undefined : typeof sub.schedule === 'string' ? sub.schedule : sub.schedule.id;
  const invoice = sub.latest_invoice ?? undefined;
  const firstFailedInvoiceDueAt =
    (sub.status === 'past_due' || sub.status === 'unpaid') && invoice?.status === 'open'
      ? iso(invoice.due_date ?? invoice.created)
      : undefined;
  const zeroValue =
    sub.discount?.coupon?.percent_off === 100 ||
    sub.items.data.every((i) => i.price.unit_amount === 0);
  return {
    id: sub.id,
    customerId,
    status: sub.status as StripeSubscriptionFact['status'],
    items: sub.items.data.map((i) => ({ priceId: i.price.id, quantity: i.quantity })),
    scheduleId,
    pauseCollection: sub.pause_collection ? true : undefined,
    trialEnd: iso(sub.trial_end),
    currentPeriodEnd: iso(sub.current_period_end),
    cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
    cancelAt: iso(sub.cancel_at),
    canceledAt: iso(sub.canceled_at),
    firstFailedInvoiceDueAt,
    zeroValue: zeroValue || undefined,
    observedAt,
  };
}

export function mapCustomer(c: RawStripeCustomer, observedAt: string): StripeCustomerFact {
  return { id: c.id, deleted: !!c.deleted, observedAt };
}

function isPermissionError(err: unknown): boolean {
  const e = err as { type?: string; rawType?: string; code?: string };
  return (
    e?.type === 'StripePermissionError' ||
    e?.rawType === 'StripePermissionError' ||
    e?.code === 'more_permissions_required'
  );
}

export interface StripeApiConnectorOptions {
  apiKey?: string;
  /** Injected stripe client (tests); when absent the official `stripe` SDK is constructed from apiKey. */
  client?: StripeLike;
  /** Directory to archive raw list pages under archive/<runId>/. */
  archiveDir?: string;
}


export class StripeApiConnector implements StripeConnector {
  constructor(private opts: StripeApiConnectorOptions) {}

  private async client(): Promise<StripeLike> {
    if (this.opts.client) return this.opts.client;
    if (!this.opts.apiKey) throw new Error('STRIPE_SECRET_KEY / apiKey is required');
    const { default: Stripe } = await import('stripe');
    return new Stripe(this.opts.apiKey) as unknown as StripeLike;
  }

  async collect(): Promise<StripeInventory> {
    const runId = `srun_${new Date().toISOString()}`;
    const observedAt = new Date().toISOString();
    const stripe = await this.client();
    const permissionsMissing: string[] = [];
    let complete = true;

    const collectResource = async <T extends { id: string }>(
      resource: 'customers' | 'subscriptions',
      params: Record<string, unknown>,
    ): Promise<T[]> => {
      const list = stripe[resource].list.bind(stripe[resource]) as (
        p?: Record<string, unknown>,
      ) => Promise<StripeListPage<T>>;
      try {
        const out: T[] = [];
        let startingAfter: string | undefined;
        let pageNum = 0;
        for (;;) {
          const page = await list(
            startingAfter ? { ...params, starting_after: startingAfter } : params,
          );
          if (this.opts.archiveDir) {
            const dir = path.join(this.opts.archiveDir, runId);
            mkdirSync(dir, { recursive: true });
            writeFileSync(
              path.join(dir, `${resource}-${pageNum}.json`),
              JSON.stringify(page, null, 2),
            );
          }
          out.push(...page.data);
          pageNum += 1;
          if (!page.has_more || page.data.length === 0) break;
          startingAfter = page.data[page.data.length - 1].id;
        }
        return out;
      } catch (err) {
        if (isPermissionError(err)) {
          permissionsMissing.push(resource);
          return [];
        }
        complete = false;
        return [];
      }
    };

    const customers = await collectResource<RawStripeCustomer>('customers', { limit: 100 });
    const subscriptions = await collectResource<RawStripeSubscription>('subscriptions', {
      limit: 100,
      status: 'all',
      expand: ['data.latest_invoice', 'data.discount'],
    });

    return {
      runId,
      complete,
      observedAt,
      permissionsMissing,
      customers: customers.map((c) => mapCustomer(c, observedAt)),
      subscriptions: subscriptions.map((s) => mapSubscription(s, observedAt)),
    };
  }
}

export class FixtureStripeConnector implements StripeConnector {
  constructor(private dir: string = fixturesDir) {}
  async collect(): Promise<StripeInventory> {
    return loadFixtures(this.dir).stripe;
  }
}

export function createStripeConnector(env: NodeJS.ProcessEnv = process.env): StripeConnector {
  if (env.STRIPE_SECRET_KEY) return new StripeApiConnector({ apiKey: env.STRIPE_SECRET_KEY });
  return new FixtureStripeConnector();
}
