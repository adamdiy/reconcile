import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadFixtures } from '@reconcile/fixtures';
import { seedFromFixtures } from '@reconcile/store';
import type { Store } from '@reconcile/store';
import { evaluateProject } from '@reconcile/core';
import type { Incident, StoredIncident } from '@reconcile/domain';

/** All tools are strictly read-only: sources, runs, incidents, policy — never mutations. */
export const TOOL_NAMES = [
  'list_incidents',
  'get_incident',
  'get_account',
  'get_coverage',
  'list_runs',
  'get_published_policy',
  'list_exceptions',
] as const;

function text(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function isSnoozed(w: StoredIncident['workflow'], now: string): boolean {
  return Boolean(w?.snoozedUntil && w.snoozedUntil > now);
}

function matchesFilter(inc: Incident, filter: string, now: string): boolean {
  const w = inc.workflow;
  if (filter === 'all') return true;
  if (filter === 'resolved') return inc.state === 'resolved';
  if (filter === 'snoozed') return isSnoozed(w, now);
  if (filter === 'accepted') return Boolean(w?.acceptedRisk);
  // open
  return inc.state !== 'resolved' && !isSnoozed(w, now) && !w?.acceptedRisk;
}

async function evaluate(store: Store, projectId: string) {
  const fixtures = loadFixtures();
  await seedFromFixtures(store, fixtures);
  return evaluateProject(store, projectId, {
    fallback: { stripe: fixtures.stripe, app: fixtures.app, policy: fixtures.policy },
    settlingMs: Number(process.env.SETTLING_MINUTES ?? '0') * 60_000,
  });
}

export function createReconcileServer(store: Store, projectId: string): McpServer {
  const server = new McpServer({ name: 'reconcile', version: '0.1.0' });

  server.registerTool(
    'list_incidents',
    {
      description: 'List reconciliation incidents for the project (read-only)',
      inputSchema: {
        filter: z.enum(['open', 'snoozed', 'accepted', 'resolved', 'all']).optional(),
        checkKind: z.string().optional(),
        severity: z.enum(['low', 'medium', 'high']).optional(),
      },
    },
    async ({ filter, checkKind, severity }) => {
      const ev = await evaluate(store, projectId);
      const now = ev.evaluatedAt;
      const list = ev.incidents.filter(
        (i) =>
          matchesFilter(i, filter ?? 'open', now) &&
          (!checkKind || i.check === checkKind) &&
          (!severity || i.severity === severity),
      );
      return text(list);
    },
  );

  server.registerTool(
    'get_incident',
    {
      description: 'Get one incident with its evidence ids (read-only)',
      inputSchema: { fingerprint: z.string() },
    },
    async ({ fingerprint }) => {
      const ev = await evaluate(store, projectId);
      const inc = ev.incidents.find((i) => i.id === fingerprint);
      if (!inc) return text({ error: 'not found', fingerprint });
      return text(inc);
    },
  );

  server.registerTool(
    'get_account',
    {
      description: 'Get the assessment for one account (read-only)',
      inputSchema: { accountId: z.string() },
    },
    async ({ accountId }) => {
      const ev = await evaluate(store, projectId);
      const a = ev.assessments.find((x) => x.accountId === accountId);
      if (!a) return text({ error: 'not found', accountId });
      return text(a);
    },
  );

  server.registerTool(
    'get_coverage',
    { description: 'Coverage and bucket counts for the project (read-only)' },
    async () => {
      const ev = await evaluate(store, projectId);
      return text({
        population: ev.assessments.length,
        buckets: ev.bucketCounts,
        coveredPairs: ev.coveredPairs,
        totalPairs: ev.totalPairs,
        coverageRatio: ev.totalPairs ? ev.coveredPairs / ev.totalPairs : null,
        unknownReasons: ev.unknownReasons,
        nextTransitionAt: ev.nextTransitionAt,
      });
    },
  );

  server.registerTool(
    'list_runs',
    {
      description: 'Recent recorded assessment runs (read-only)',
      inputSchema: { limit: z.number().int().min(1).max(200).optional() },
    },
    async ({ limit }) => {
      const runs = await store.forProject(projectId).listRuns(limit ?? 20);
      return text(runs);
    },
  );

  server.registerTool(
    'get_published_policy',
    { description: 'The currently published policy (read-only)' },
    async () => {
      const fixtures = loadFixtures();
      await seedFromFixtures(store, fixtures);
      const p = await store.forProject(projectId).getPublishedPolicy();
      return text(p ?? { error: 'no published policy' });
    },
  );

  server.registerTool(
    'list_exceptions',
    { description: 'Policy exceptions for the project (read-only)' },
    async () => {
      const fixtures = loadFixtures();
      await seedFromFixtures(store, fixtures);
      return text(await store.forProject(projectId).listExceptions());
    },
  );

  server.registerResource(
    'incident',
    new ResourceTemplate('reconcile://incident/{fingerprint}', { list: undefined }),
    { description: 'A single incident record' },
    async (uri, { fingerprint }) => {
      const ev = await evaluate(store, projectId);
      const inc = ev.incidents.find((i) => i.id === fingerprint);
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(inc ?? null) }],
      };
    },
  );

  server.registerResource(
    'account',
    new ResourceTemplate('reconcile://account/{accountId}', { list: undefined }),
    { description: 'A single account assessment' },
    async (uri, { accountId }) => {
      const ev = await evaluate(store, projectId);
      const a = ev.assessments.find((x) => x.accountId === accountId);
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(a ?? null) }],
      };
    },
  );

  return server;
}
