import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { z } from 'zod';
import { AccountObservationSchema, AppInventorySchema } from '@reconcile/domain';
import type { AccountObservation, AppInventory } from '@reconcile/domain';
import { AuthzSourceConfigSchema, collectAuthz } from './authz.js';
export * from './authz.js';

export const ColumnMapSchema = z.object({
  accountId: z.string(),
  stripeCustomerIds: z.string().optional(),
  localBillingRecords: z
    .object({
      localId: z.string(),
      stripeSubscriptionId: z.string().optional(),
      stripeCustomerId: z.string().optional(),
      status: z.string().optional(),
    })
    .optional(),
  access: z.record(z.string()).optional(),
});
export type ColumnMap = z.infer<typeof ColumnMapSchema>;

export const CollectorConfigSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('sql'),
    connection: z.string(),
    query: z.string(),
    columns: ColumnMapSchema,
  }),
  z.object({
    source: z.literal('json'),
    path: z.string(),
    columns: ColumnMapSchema.optional(),
  }),
  z.object({
    source: z.literal('http'),
    url: z.string(),
    headers: z.record(z.string()).optional(),
    columns: ColumnMapSchema.optional(),
  }),
  AuthzSourceConfigSchema,
]);
export type CollectorConfig = z.infer<typeof CollectorConfigSchema>;

type Row = Record<string, unknown>;

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function asCustomerIds(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string' && v.length > 0) return v.split(',').map((s) => s.trim());
  return [];
}

export function rowsToAccounts(rows: Row[], columns: ColumnMap, observedAt: string): AccountObservation[] {
  const grouped = new Map<string, AccountObservation>();
  for (const row of rows) {
    const accountId = asString(row[columns.accountId]);
    if (!accountId) continue;
    let acc = grouped.get(accountId);
    if (!acc) {
      acc = {
        accountId,
        stripeCustomerIds: [],
        localBillingRecords: [],
        observedAt,
        method: 'database_view',
        access: {},
      };
      grouped.set(accountId, acc);
    }
    if (columns.stripeCustomerIds) {
      for (const id of asCustomerIds(row[columns.stripeCustomerIds]))
        if (!acc.stripeCustomerIds.includes(id)) acc.stripeCustomerIds.push(id);
    }
    const lbr = columns.localBillingRecords;
    if (lbr) {
      const localId = asString(row[lbr.localId]);
      if (localId)
        acc.localBillingRecords.push({
          localId,
          stripeSubscriptionId: lbr.stripeSubscriptionId ? asString(row[lbr.stripeSubscriptionId]) : undefined,
          stripeCustomerId: lbr.stripeCustomerId ? asString(row[lbr.stripeCustomerId]) : undefined,
          status: lbr.status ? asString(row[lbr.status]) : undefined,
        });
    }
    if (columns.access)
      for (const [feature, col] of Object.entries(columns.access)) acc.access[feature] = row[col] === true;
    const method = asString(row.method);
    if (method === 'database_view' || method === 'authorization_adapter') acc.method = method;
  }
  return [...grouped.values()].map((a) => AccountObservationSchema.parse(a));
}

function resolveConnection(conn: string, env: NodeJS.ProcessEnv): string {
  if (conn.startsWith('env:')) {
    const name = conn.slice(4);
    const value = env[name];
    if (!value) throw new Error(`environment variable ${name} is not set`);
    return value;
  }
  return conn;
}

async function loadRows(
  config: CollectorConfig,
  env: NodeJS.ProcessEnv,
): Promise<{ rows?: Row[]; inventory?: AppInventory; complete: boolean }> {
  if (config.source === 'sql') {
    const sql = postgres(resolveConnection(config.connection, env));
    try {
      const rows = await sql.unsafe<Row[]>(config.query);
      return { rows, complete: true };
    } finally {
      await sql.end();
    }
  }
  let body: unknown;
  if (config.source === 'json') {
    body = JSON.parse(readFileSync(config.path, 'utf8'));
  } else if (config.source === 'http') {
    const res = await fetch(config.url, { headers: config.headers });
    if (!res.ok) throw new Error(`http source returned ${res.status}`);
    body = await res.json();
  } else {
    throw new Error(`unsupported source for loadRows: ${config.source}`);
  }
  // A body already in AppInventory shape is used directly; otherwise {rows:[...]} or a bare
  // array of flat rows is mapped through the columns block.
  const direct = AppInventorySchema.safeParse(body);
  if (direct.success) return { inventory: direct.data, complete: true };
  const rows = Array.isArray(body) ? body : (body as { rows?: Row[] }).rows;
  if (!Array.isArray(rows)) throw new Error('source body is not an AppInventory and has no rows array');
  return { rows, complete: true };
}

export async function collect(
  config: CollectorConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AppInventory> {
  if (config.source === 'authz') return collectAuthz(config, env);
  const runId = `arun_${new Date().toISOString()}`;
  const observedAt = new Date().toISOString();
  let result: { rows?: Row[]; inventory?: AppInventory; complete: boolean };
  try {
    result = await loadRows(config, env);
  } catch (err) {
    if (config.source === 'sql') {
      return AppInventorySchema.parse({ runId, complete: false, observedAt, accounts: [] });
    }
    throw err;
  }
  if (result.inventory) return result.inventory;
  const columns = 'columns' in config ? config.columns : undefined;
  if (!columns) throw new Error('columns mapping is required for flat row sources');
  return AppInventorySchema.parse({
    runId,
    complete: result.complete,
    observedAt,
    accounts: rowsToAccounts(result.rows ?? [], columns, observedAt),
  });
}
