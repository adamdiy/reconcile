import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import { collect, rowsToAccounts } from '../src/index.js';
import type { CollectorConfig } from '../src/index.js';

const columns = {
  accountId: 'id',
  stripeCustomerIds: 'stripe_customer_id',
  localBillingRecords: {
    localId: 'sub_row_id',
    stripeSubscriptionId: 'stripe_sub_id',
    status: 'sub_status',
  },
  access: { reports: 'can_reports', exports: 'can_exports' },
};

describe('rowsToAccounts', () => {
  it('groups multiple rows per account and maps columns', () => {
    const accounts = rowsToAccounts(
      [
        {
          id: 'acct_1',
          stripe_customer_id: 'cus_1',
          sub_row_id: 'l1',
          stripe_sub_id: 'sub_1',
          sub_status: 'active',
          can_reports: true,
          can_exports: false,
        },
        {
          id: 'acct_1',
          stripe_customer_id: 'cus_2',
          sub_row_id: 'l2',
          stripe_sub_id: 'sub_2',
          sub_status: 'active',
          can_reports: true,
          can_exports: true,
        },
        { id: 'acct_2', stripe_customer_id: null, can_reports: false, can_exports: true },
      ],
      columns,
      '2026-09-18T00:00:00.000Z',
    );
    expect(accounts).toHaveLength(2);
    const a1 = accounts.find((a) => a.accountId === 'acct_1')!;
    expect(a1.stripeCustomerIds).toEqual(['cus_1', 'cus_2']);
    expect(a1.localBillingRecords).toHaveLength(2);
    expect(a1.access).toEqual({ reports: true, exports: true });
    expect(a1.method).toBe('database_view');
    expect(accounts[1].localBillingRecords).toHaveLength(0);
  });
});

describe('collect', () => {
  it('passes through a body already in AppInventory shape', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'reconcile-collector-'));
    const file = path.join(dir, 'export.json');
    const inventory = {
      runId: 'arun_test',
      complete: true,
      observedAt: '2026-09-18T00:00:00.000Z',
      accounts: [
        {
          accountId: 'acct_x',
          stripeCustomerIds: ['cus_x'],
          localBillingRecords: [],
          observedAt: '2026-09-18T00:00:00.000Z',
          method: 'database_view',
          access: { reports: true },
        },
      ],
    };
    writeFileSync(file, JSON.stringify(inventory));
    const result = await collect({ source: 'json', path: file });
    expect(result.runId).toBe('arun_test');
    expect(result.accounts[0].accountId).toBe('acct_x');
  });

  it('maps flat rows from a json file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'reconcile-collector-'));
    const file = path.join(dir, 'rows.json');
    writeFileSync(
      file,
      JSON.stringify({
        rows: [
          { id: 'acct_1', stripe_customer_id: 'cus_1', can_reports: true, can_exports: false },
        ],
      }),
    );
    const result = await collect({ source: 'json', path: file, columns });
    expect(result.runId.startsWith('arun_')).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].access.reports).toBe(true);
  });
});

const pgUrl = process.env.DATABASE_URL;
describe.skipIf(!pgUrl)('sql source (postgres)', () => {
  it('collects rows into an AppInventory', async () => {
    const sql = postgres(pgUrl!);
    await sql`DROP TABLE IF EXISTS collector_test`;
    await sql`CREATE TABLE collector_test (id text, stripe_customer_id text, sub_row_id text, stripe_sub_id text, sub_status text, can_reports boolean, can_exports boolean)`;
    await sql`INSERT INTO collector_test VALUES
      ('acct_1', 'cus_1', 'l1', 'sub_1', 'active', true, false),
      ('acct_1', 'cus_2', 'l2', 'sub_2', 'active', true, true),
      ('acct_2', NULL, NULL, NULL, NULL, false, true)`;
    await sql.end();

    const config: CollectorConfig = {
      source: 'sql',
      connection: 'env:TEST_COLLECTOR_DB',
      query: 'select * from collector_test',
      columns,
    };
    const inventory = await collect(config, { ...process.env, TEST_COLLECTOR_DB: pgUrl! });
    expect(inventory.complete).toBe(true);
    expect(inventory.accounts).toHaveLength(2);
    expect(inventory.accounts[0].localBillingRecords).toHaveLength(2);
  });
});
