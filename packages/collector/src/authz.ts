import { z } from 'zod';
import { AppInventorySchema, AccountObservationSchema } from '@reconcile/domain';
import type { AccountObservation, AppInventory } from '@reconcile/domain';

export interface AuthzCheckContext {
  subject: string;
  resource: string;
  action: string;
}

/** Returns a definite boolean, or 'unknown' when the adapter could not decide. */
export interface AuthzAdapter {
  name: string;
  checkAccess(ctx: AuthzCheckContext): Promise<boolean | 'unknown'>;
}

type FetchLike = typeof fetch;

function resolveEnvRef(value: string, env: NodeJS.ProcessEnv): string {
  if (!value.startsWith('env:')) return value;
  const name = value.slice(4);
  const resolved = env[name];
  if (!resolved) throw new Error(`environment variable ${name} is not set`);
  return resolved;
}

function resolveRecord(
  rec: Record<string, string> | undefined,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec ?? {})) out[k] = resolveEnvRef(v, env);
  return out;
}

export class HttpAuthzAdapter implements AuthzAdapter {
  readonly name = 'http';
  constructor(
    private opts: { url: string; headers?: Record<string, string>; timeoutMs?: number },
    private fetchImpl: FetchLike = fetch,
  ) {}
  async checkAccess(ctx: AuthzCheckContext): Promise<boolean | 'unknown'> {
    try {
      const res = await this.fetchImpl(this.opts.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.opts.headers ?? {}) },
        body: JSON.stringify(ctx),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
      });
      if (!res.ok) return 'unknown';
      const body = (await res.json()) as { allowed?: unknown };
      return typeof body.allowed === 'boolean' ? body.allowed : 'unknown';
    } catch {
      return 'unknown';
    }
  }
}

export class OpenFgaAdapter implements AuthzAdapter {
  readonly name = 'openfga';
  constructor(
    private opts: {
      url: string;
      storeId: string;
      modelId?: string;
      headers?: Record<string, string>;
      timeoutMs?: number;
    },
    private fetchImpl: FetchLike = fetch,
  ) {}
  async checkAccess(ctx: AuthzCheckContext): Promise<boolean | 'unknown'> {
    try {
      const res = await this.fetchImpl(
        `${this.opts.url.replace(/\/$/, '')}/stores/${this.opts.storeId}/check`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(this.opts.headers ?? {}) },
          body: JSON.stringify({
            tuple_key: { user: ctx.subject, relation: ctx.action, object: ctx.resource },
            ...(this.opts.modelId ? { authorization_model_id: this.opts.modelId } : {}),
          }),
          signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
        },
      );
      if (!res.ok) return 'unknown';
      const body = (await res.json()) as { allowed?: unknown };
      return typeof body.allowed === 'boolean' ? body.allowed : 'unknown';
    } catch {
      return 'unknown';
    }
  }
}

export interface LaunchDarklyLike {
  waitForInitialization(): Promise<unknown>;
  variation(
    flagKey: string,
    context: { kind: string; key: string },
    fallback: unknown,
  ): Promise<unknown>;
}

export class LaunchDarklyAdapter implements AuthzAdapter {
  readonly name = 'launchdarkly';
  private clientPromise: Promise<LaunchDarklyLike> | null = null;
  constructor(
    private opts: { sdkKey: string },
    private client?: LaunchDarklyLike,
  ) {}
  private async client_(): Promise<LaunchDarklyLike | null> {
    if (this.client) return this.client;
    try {
      this.clientPromise ??= (async () => {
        const { createRequire } = await import('node:module');
        const req = createRequire(import.meta.url);
        const sdk = req('@launchdarkly/node-server-sdk') as {
          init(key: string): LaunchDarklyLike;
        };
        const c = sdk.init(this.opts.sdkKey);
        await c.waitForInitialization();
        return c;
      })();
      return await this.clientPromise;
    } catch {
      return null;
    }
  }
  async checkAccess(ctx: AuthzCheckContext): Promise<boolean | 'unknown'> {
    const client = await this.client_();
    if (!client) return 'unknown';
    try {
      const v = await client.variation(
        `${ctx.resource}:${ctx.action}`,
        { kind: 'user', key: ctx.subject },
        'unknown',
      );
      return typeof v === 'boolean' ? v : 'unknown';
    } catch {
      return 'unknown';
    }
  }
}

export class Auth0Adapter implements AuthzAdapter {
  readonly name = 'auth0';
  constructor(
    private opts: { domain: string; token: string; timeoutMs?: number },
    private fetchImpl: FetchLike = fetch,
  ) {}
  private async permissions(subject: string): Promise<string[] | null> {
    const perms: string[] = [];
    try {
      for (let page = 0; ; page += 1) {
        const res = await this.fetchImpl(
          `https://${this.opts.domain}/api/v2/users/${encodeURIComponent(subject)}/permissions?per_page=100&page=${page}`,
          {
            headers: { authorization: `Bearer ${this.opts.token}` },
            signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
          },
        );
        if (!res.ok) return null;
        const rows = (await res.json()) as Array<{ permission_name?: string }>;
        if (!Array.isArray(rows)) return null;
        for (const r of rows) if (typeof r.permission_name === 'string') perms.push(r.permission_name);
        if (rows.length < 100) return perms;
      }
    } catch {
      return null;
    }
  }
  async checkAccess(ctx: AuthzCheckContext): Promise<boolean | 'unknown'> {
    const perms = await this.permissions(ctx.subject);
    if (perms === null) return 'unknown';
    return perms.includes(`${ctx.resource}:${ctx.action}`) || perms.includes(ctx.action);
  }
}

export class FixtureAuthzAdapter implements AuthzAdapter {
  readonly name = 'fixture';
  constructor(private map: Record<string, boolean>) {}
  async checkAccess(ctx: AuthzCheckContext): Promise<boolean | 'unknown'> {
    const key = `${ctx.subject}|${ctx.resource}|${ctx.action}`;
    return this.map[key] ?? 'unknown';
  }
}

export const AuthzCapabilitySchema = z.object({
  capability: z.string(),
  resource: z.string(),
  action: z.string(),
});

export const AuthzSourceConfigSchema = z.object({
  source: z.literal('authz'),
  adapter: z.enum(['http', 'openfga', 'launchdarkly', 'auth0', 'fixture']),
  config: z.record(z.string()).default({}),
  subjects: z.discriminatedUnion('source', [
    z.object({ source: z.literal('json'), path: z.string(), columns: z.object({ accountId: z.string(), subject: z.string() }) }),
    z.object({ source: z.literal('sql'), connection: z.string(), query: z.string(), columns: z.object({ accountId: z.string(), subject: z.string() }) }),
    z.object({ source: z.literal('http'), url: z.string(), headers: z.record(z.string()).optional(), columns: z.object({ accountId: z.string(), subject: z.string() }) }),
  ]),
  capabilities: z.array(AuthzCapabilitySchema),
});
export type AuthzSourceConfig = z.infer<typeof AuthzSourceConfigSchema>;

const CONCURRENCY = 8;

export function createAuthzAdapter(
  cfg: AuthzSourceConfig,
  env: NodeJS.ProcessEnv,
  deps: { fetchImpl?: FetchLike; launchDarklyClient?: LaunchDarklyLike } = {},
): AuthzAdapter {
  const c = cfg.config;
  switch (cfg.adapter) {
    case 'http':
      return new HttpAuthzAdapter(
        { url: resolveEnvRef(c.url ?? '', env), headers: resolveRecord(c.headers ? JSON.parse(c.headers) : c.headersJson ? JSON.parse(c.headersJson) : undefined, env) },
        deps.fetchImpl,
      );
    case 'openfga':
      return new OpenFgaAdapter(
        {
          url: resolveEnvRef(c.url ?? '', env),
          storeId: c.storeId ?? '',
          modelId: c.modelId,
          headers: resolveRecord(c.headers ? JSON.parse(c.headers) : undefined, env),
        },
        deps.fetchImpl,
      );
    case 'launchdarkly':
      return new LaunchDarklyAdapter({ sdkKey: resolveEnvRef(c.sdkKey ?? '', env) }, deps.launchDarklyClient);
    case 'auth0':
      return new Auth0Adapter(
        { domain: c.domain ?? '', token: resolveEnvRef(c.token ?? '', env) },
        deps.fetchImpl,
      );
    case 'fixture':
      return new FixtureAuthzAdapter(c.map ? JSON.parse(c.map) : {});
  }
}

interface SubjectRow {
  accountId: string;
  subject: string;
}

async function loadSubjects(
  cfg: AuthzSourceConfig['subjects'],
  env: NodeJS.ProcessEnv,
): Promise<SubjectRow[]> {
  let rows: Array<Record<string, unknown>>;
  if (cfg.source === 'json') {
    const { readFileSync } = await import('node:fs');
    rows = JSON.parse(readFileSync(cfg.path, 'utf8')) as Array<Record<string, unknown>>;
  } else if (cfg.source === 'sql') {
    const { default: postgres } = await import('postgres');
    const sql = postgres(resolveEnvRef(cfg.connection, env));
    try {
      rows = await sql.unsafe<Record<string, unknown>[]>(cfg.query);
    } finally {
      await sql.end();
    }
  } else {
    const res = await fetch(cfg.url, { headers: resolveRecord(cfg.headers, env) });
    if (!res.ok) throw new Error(`subjects source returned ${res.status}`);
    rows = (await res.json()) as Array<Record<string, unknown>>;
  }
  return rows
    .map((r) => ({
      accountId: typeof r[cfg.columns.accountId] === 'string' ? (r[cfg.columns.accountId] as string) : '',
      subject: typeof r[cfg.columns.subject] === 'string' ? (r[cfg.columns.subject] as string) : '',
    }))
    .filter((r) => r.accountId && r.subject);
}

export async function collectAuthz(
  cfg: AuthzSourceConfig,
  env: NodeJS.ProcessEnv = process.env,
  deps: { fetchImpl?: FetchLike; launchDarklyClient?: LaunchDarklyLike } = {},
): Promise<AppInventory> {
  const runId = `arun_${new Date().toISOString()}`;
  const observedAt = new Date().toISOString();
  const adapter = createAuthzAdapter(cfg, env, deps);
  const subjects = await loadSubjects(cfg.subjects, env);
  let allDefinite = true;

  const accounts: AccountObservation[] = await Promise.all(
    subjects.map(async ({ accountId, subject }) => {
      const access: Record<string, boolean> = {};
      const contextsChecked: NonNullable<AccountObservation['contextsChecked']> = [];
      const queue = [...cfg.capabilities];
      const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (;;) {
          const cap = queue.shift();
          if (!cap) return;
          contextsChecked.push({ subject, resource: cap.resource, action: cap.action });
          const result = await adapter.checkAccess({ subject, resource: cap.resource, action: cap.action });
          if (result === 'unknown') {
            allDefinite = false;
          } else {
            access[cap.capability] = result;
          }
        }
      });
      await Promise.all(workers);
      return AccountObservationSchema.parse({
        accountId,
        stripeCustomerIds: [],
        localBillingRecords: [],
        observedAt,
        method: 'authorization_adapter',
        access,
        contextsChecked,
      });
    }),
  );

  return AppInventorySchema.parse({
    runId,
    complete: allDefinite,
    observedAt,
    accounts,
  });
}
