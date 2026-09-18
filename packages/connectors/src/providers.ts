import type { StripeInventory, StripeSubscriptionFact, StripeCustomerFact } from '@reconcile/domain';
import type { StripeConnector } from './index.js';

type FetchLike = typeof fetch;

const iso = (ms?: number | null): string | undefined =>
  ms == null ? undefined : new Date(ms).toISOString();

function isPermStatus(status: number): boolean {
  return status === 401 || status === 403;
}

/**
 * Chargebee REST v2 connector.
 * https://apidocs.chargebee.com/docs/api/customers
 * https://apidocs.chargebee.com/docs/api/subscriptions
 */
interface CbSub {
  id: string;
  customer_id: string;
  status: string;
  subscription_items?: Array<{ item_price_id: string; quantity?: number }>;
  current_term_end?: number;
  trial_end?: number;
  pause_date?: number;
  cancelled_at?: number;
  due_invoices_count?: number;
  [key: string]: unknown;
}

export class ChargebeeConnector implements StripeConnector {
  constructor(
    private opts: { site: string; apiKey: string; baseUrl?: string },
    private fetchImpl: FetchLike = fetch,
  ) {}
  private url(path: string): string {
    const base = this.opts.baseUrl ?? `https://${this.opts.site}.chargebee.com`;
    return `${base}${path}`;
  }
  private headers(): Record<string, string> {
    return { authorization: `Basic ${Buffer.from(`${this.opts.apiKey}:`).toString('base64')}` };
  }
  private async listAll<T>(path: string, key: string): Promise<{ rows: T[]; perm: boolean }> {
    const rows: T[] = [];
    let offset: string | undefined;
    for (;;) {
      const sep = path.includes('?') ? '&' : '?';
      const res = await this.fetchImpl(
        this.url(`${path}${sep}limit=100${offset ? `&offset=${offset}` : ''}`),
        { headers: this.headers() },
      );
      if (isPermStatus(res.status)) return { rows, perm: true };
      if (!res.ok) throw new Error(`chargebee ${path} returned ${res.status}`);
      const body = (await res.json()) as { list?: Array<Record<string, unknown>>; next_offset?: string };
      for (const entry of body.list ?? []) rows.push(entry[key] as T);
      offset = body.next_offset;
      if (!offset) return { rows, perm: false };
    }
  }
  async collect(): Promise<StripeInventory> {
    const runId = `srun_${new Date().toISOString()}`;
    const observedAt = new Date().toISOString();
    const permissionsMissing: string[] = [];
    let complete = true;

    let customers: StripeCustomerFact[] = [];
    let subscriptions: StripeSubscriptionFact[] = [];
    try {
      const cust = await this.listAll<{ id: string; deleted?: string | boolean }>(
        '/api/v2/customers',
        'customer',
      );
      if (cust.perm) permissionsMissing.push('customers');
      customers = cust.rows.map((c) => ({
        id: c.id,
        deleted: c.deleted === true || c.deleted === 'true',
        observedAt,
      }));
    } catch {
      complete = false;
    }
    try {
      const subs = await this.listAll<CbSub>('/api/v2/subscriptions', 'subscription');
      if (subs.perm) permissionsMissing.push('subscriptions');
      subscriptions = subs.rows.map((s) => mapChargebeeSub(s, observedAt));
    } catch {
      complete = false;
    }

    return {
      runId,
      provider: 'chargebee',
      complete,
      observedAt,
      permissionsMissing,
      customers,
      subscriptions,
    };
  }
}

const CB_STATUS: Record<string, { status: StripeSubscriptionFact['status']; cancelAtPeriodEnd?: boolean }> = {
  in_trial: { status: 'trialing' },
  active: { status: 'active' },
  non_renewing: { status: 'active', cancelAtPeriodEnd: true },
  paused: { status: 'paused' },
  cancelled: { status: 'canceled' },
  future: { status: 'incomplete' },
};

function mapChargebeeSub(s: CbSub, observedAt: string): StripeSubscriptionFact {
  const mapped = CB_STATUS[s.status] ?? { status: 'incomplete' as const };
  return {
    id: s.id,
    customerId: s.customer_id,
    status: mapped.status,
    items: (s.subscription_items ?? []).map((i) => ({
      priceId: i.item_price_id,
      quantity: i.quantity ?? 1,
    })),
    currentPeriodEnd: iso(s.current_term_end ? s.current_term_end * 1000 : null),
    trialEnd: iso(s.trial_end ? s.trial_end * 1000 : null),
    pauseCollection: s.pause_date ? true : undefined,
    cancelAtPeriodEnd: mapped.cancelAtPeriodEnd ?? false,
    canceledAt: iso(s.cancelled_at ? s.cancelled_at * 1000 : null),
    // Chargebee exposes due_invoices_count, not a per-invoice due timestamp in the
    // subscription payload; a precise firstFailedInvoiceDueAt would need an
    // invoices list call (permissionsMissing-equivalent when absent).
    firstFailedInvoiceDueAt: undefined,
    observedAt,
  };
}

/**
 * Paddle Billing API connector.
 * https://developer.paddle.com/api-reference/customers/list-customers
 * https://developer.paddle.com/api-reference/subscriptions/list-subscriptions
 */
interface PaddleSub {
  id: string;
  customer_id: string;
  status: string;
  items?: Array<{ price?: { id?: string }; quantity?: number }>;
  current_billing_period?: { ends_at?: string } | null;
  scheduled_change?: { action?: string; effective_at?: string } | null;
  canceled_at?: string | null;
  paused_at?: string | null;
  started_at?: string | null;
  [key: string]: unknown;
}

export class PaddleConnector implements StripeConnector {
  constructor(
    private opts: { apiKey: string; env?: 'sandbox' | 'production'; baseUrl?: string },
    private fetchImpl: FetchLike = fetch,
  ) {}
  private url(path: string): string {
    const base =
      this.opts.baseUrl ??
      (this.opts.env === 'sandbox'
        ? 'https://sandbox-api.paddle.com'
        : 'https://api.paddle.com');
    return `${base}${path}`;
  }
  private async listAll<T>(path: string): Promise<{ rows: T[]; perm: boolean }> {
    const rows: T[] = [];
    let next: string | undefined = this.url(`${path}?per_page=200`);
    for (;;) {
      if (!next) break;
      const res = await this.fetchImpl(next, {
        headers: { authorization: `Bearer ${this.opts.apiKey}` },
      });
      if (isPermStatus(res.status)) return { rows, perm: true };
      if (!res.ok) throw new Error(`paddle ${path} returned ${res.status}`);
      const body = (await res.json()) as {
        data?: T[];
        meta?: { pagination?: { next?: string } };
      };
      rows.push(...(body.data ?? []));
      next = body.meta?.pagination?.next;
      if (!next) break;
    }
    return { rows, perm: false };
  }
  async collect(): Promise<StripeInventory> {
    const runId = `srun_${new Date().toISOString()}`;
    const observedAt = new Date().toISOString();
    const permissionsMissing: string[] = [];
    let complete = true;

    let customers: StripeCustomerFact[] = [];
    let subscriptions: StripeSubscriptionFact[] = [];
    try {
      const cust = await this.listAll<{ id: string }>('/customers');
      if (cust.perm) permissionsMissing.push('customers');
      customers = cust.rows.map((c) => ({ id: c.id, deleted: false, observedAt }));
    } catch {
      complete = false;
    }
    try {
      const subs = await this.listAll<PaddleSub>('/subscriptions');
      if (subs.perm) permissionsMissing.push('subscriptions');
      subscriptions = subs.rows.map((s) => mapPaddleSub(s, observedAt));
    } catch {
      complete = false;
    }

    return {
      runId,
      provider: 'paddle',
      complete,
      observedAt,
      permissionsMissing,
      customers,
      subscriptions,
    };
  }
}

const PADDLE_STATUS: Record<string, StripeSubscriptionFact['status']> = {
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  paused: 'paused',
  canceled: 'canceled',
};

function mapPaddleSub(s: PaddleSub, observedAt: string): StripeSubscriptionFact {
  const change = s.scheduled_change;
  return {
    id: s.id,
    customerId: s.customer_id,
    status: PADDLE_STATUS[s.status] ?? 'incomplete',
    items: (s.items ?? []).map((i) => ({
      priceId: i.price?.id ?? 'unknown',
      quantity: i.quantity ?? 1,
    })),
    currentPeriodEnd: s.current_billing_period?.ends_at,
    trialEnd: undefined,
    cancelAtPeriodEnd: change?.action === 'cancel',
    cancelAt: change?.action === 'cancel' ? change.effective_at : undefined,
    pauseCollection: change?.action === 'pause' || s.status === 'paused' || undefined,
    canceledAt: s.canceled_at ?? undefined,
    observedAt,
  };
}
