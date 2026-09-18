import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { JsonFileStore } from '@reconcile/store';

import { createReconcileServer, TOOL_NAMES } from '../src/index.js';

async function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'reconcile-mcp-'));
  const store = new JsonFileStore(dir);
  await store.migrate();
  const server = createReconcileServer(store, 'default');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, store };
}

const textOf = (r: { content?: unknown }) =>
  JSON.parse((r.content as { text: string }[])[0].text);

describe('reconcile-mcp', () => {
  it('registers only read-only tools', async () => {
    const { client } = await setup();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...TOOL_NAMES].sort());
    // no write/mutation tools — only the whitelisted read-only names
    for (const t of tools)
      expect(t.name).not.toMatch(/^(delete|create|update|publish|mutate|enqueue|put|upsert|record)_/i);
  });

  it('list_incidents returns the acct_005 exports mismatch', async () => {
    const { client } = await setup();
    const res = await client.callTool({ name: 'list_incidents', arguments: { filter: 'all' } });
    const incidents = textOf(res);
    const target = incidents.find(
      (i: { accountId: string; feature: string }) =>
        i.accountId === 'acct_005' && i.feature === 'exports',
    );
    expect(target).toBeDefined();
    expect(target.check).toBe('expected_feature_missing');
  });

  it('get_incident and get_account return detail', async () => {
    const { client } = await setup();
    const all = textOf(await client.callTool({ name: 'list_incidents', arguments: { filter: 'all' } }));
    const inc = all[0];
    const detail = textOf(await client.callTool({ name: 'get_incident', arguments: { fingerprint: inc.id } }));
    expect(detail.accountId).toBe(inc.accountId);
    const acct = textOf(await client.callTool({ name: 'get_account', arguments: { accountId: 'acct_005' } }));
    expect(acct.accountId).toBe('acct_005');
  });

  it('get_coverage, list_runs, get_published_policy, list_exceptions respond', async () => {
    const { client } = await setup();
    const cov = textOf(await client.callTool({ name: 'get_coverage', arguments: {} }));
    expect(cov.population).toBe(12);
    expect(cov.totalPairs).toBe(36);
    const runs = textOf(await client.callTool({ name: 'list_runs', arguments: { limit: 5 } }));
    expect(Array.isArray(runs)).toBe(true);
    const pol = textOf(await client.callTool({ name: 'get_published_policy', arguments: {} }));
    expect(pol.version).toBe('v1-2026-09-16');
    const ex = textOf(await client.callTool({ name: 'list_exceptions', arguments: {} }));
    expect(Array.isArray(ex)).toBe(true);
  });

  it('resources read incident + account', async () => {
    const { client } = await setup();
    const all = textOf(await client.callTool({ name: 'list_incidents', arguments: { filter: 'all' } }));
    const res = await client.readResource({ uri: `reconcile://incident/${all[0].id}` });
    expect(JSON.parse(res.contents[0].text as string).id).toBe(all[0].id);
    const acct = await client.readResource({ uri: 'reconcile://account/acct_005' });
    expect(JSON.parse(acct.contents[0].text as string).accountId).toBe('acct_005');
  });
});
