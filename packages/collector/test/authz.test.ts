// Adapter shapes mocked from public API docs:
// OpenFGA: https://openfga.dev/api/service (POST /stores/{id}/check)
// Auth0:   https://auth0.com/docs/api/management/v2/users/get-user-permissions
// LaunchDarkly SDK mocked via injected client (variation()).
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  Auth0Adapter,
  HttpAuthzAdapter,
  OpenFgaAdapter,
  LaunchDarklyAdapter,
  collectAuthz,
} from '../src/authz.js';
import type { LaunchDarklyLike } from '../src/authz.js';

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('HttpAuthzAdapter', () => {
  it('maps allowed booleans and returns unknown on non-2xx', async () => {
    const seen: unknown[] = [];
    const adapter = new HttpAuthzAdapter({ url: 'https://authz.example/check' }, async (url, init) => {
      seen.push(JSON.parse(String(init?.body)));
      return okJson({ allowed: true });
    });
    expect(await adapter.checkAccess({ subject: 'u1', resource: 'r', action: 'a' })).toBe(true);
    expect(seen[0]).toEqual({ subject: 'u1', resource: 'r', action: 'a' });
    const failing = new HttpAuthzAdapter({ url: 'x' }, async () => new Response('err', { status: 500 }));
    expect(await failing.checkAccess({ subject: 'u', resource: 'r', action: 'a' })).toBe('unknown');
    const throwing = new HttpAuthzAdapter({ url: 'x' }, async () => {
      throw new Error('timeout');
    });
    expect(await throwing.checkAccess({ subject: 'u', resource: 'r', action: 'a' })).toBe('unknown');
  });
});

describe('OpenFgaAdapter', () => {
  it('posts tuple_key and maps allowed', async () => {
    const seen: unknown[] = [];
    const adapter = new OpenFgaAdapter({ url: 'https://fga.example', storeId: 'st_1' }, async (url, init) => {
      seen.push({ url, body: JSON.parse(String(init?.body)) });
      return okJson({ allowed: false });
    });
    expect(await adapter.checkAccess({ subject: 'user:u1', resource: 'doc:r1', action: 'viewer' })).toBe(false);
    const call = seen[0] as { url: string; body: { tuple_key: { user: string } } };
    expect(call.url).toBe('https://fga.example/stores/st_1/check');
    expect(call.body.tuple_key.user).toBe('user:u1');
  });
});

describe('LaunchDarklyAdapter', () => {
  it('uses injected client variation', async () => {
    const client: LaunchDarklyLike = {
      waitForInitialization: async () => ({}),
      variation: async (key: string) => key === 'res:act',
    };
    const adapter = new LaunchDarklyAdapter({ sdkKey: 'x' }, client);
    expect(await adapter.checkAccess({ subject: 'u', resource: 'res', action: 'act' })).toBe(true);
    expect(await adapter.checkAccess({ subject: 'u', resource: 'x', action: 'y' })).toBe(false);
  });
});

describe('Auth0Adapter', () => {
  it('paginates permissions and matches resource:action', async () => {
    const pages = [
      Array.from({ length: 100 }, (_, i) => ({ permission_name: `p${i}` })),
      [{ permission_name: 'reports:read' }],
    ];
    let n = 0;
    const adapter = new Auth0Adapter({ domain: 'tenant.auth0.com', token: 't' }, async () =>
      okJson(pages[n++ % 2]),
    );
    expect(await adapter.checkAccess({ subject: 'u1', resource: 'reports', action: 'read' })).toBe(true);
    expect(await adapter.checkAccess({ subject: 'u1', resource: 'x', action: 'y' })).toBe(false);
    expect(n).toBe(4); // two pages per call
  });
  it('returns unknown on 401', async () => {
    const adapter = new Auth0Adapter({ domain: 'd', token: 't' }, async () => new Response('x', { status: 401 }));
    expect(await adapter.checkAccess({ subject: 'u', resource: 'r', action: 'a' })).toBe('unknown');
  });
});

describe('collectAuthz (fixture adapter end-to-end)', () => {
  it('emits access only for definite booleans; complete=false on unknown', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'authz-'));
    const subjectsPath = path.join(dir, 'subjects.json');
    writeFileSync(subjectsPath, JSON.stringify([{ acct: 'a1', subj: 'u1' }, { acct: 'a2', subj: 'u2' }]));
    const inv = await collectAuthz(
      {
        source: 'authz',
        adapter: 'fixture',
        config: { map: JSON.stringify({ 'u1|reports|read': true, 'u2|reports|read': false }) },
        subjects: { source: 'json', path: subjectsPath, columns: { accountId: 'acct', subject: 'subj' } },
        capabilities: [{ capability: 'reports', resource: 'reports', action: 'read' }],
      },
      {},
    );
    expect(inv.accounts).toHaveLength(2);
    expect(inv.accounts[0].access).toEqual({ reports: true });
    expect(inv.accounts[0].method).toBe('authorization_adapter');
    expect(inv.accounts[0].contextsChecked).toHaveLength(1);
    expect(inv.accounts[1].access).toEqual({ reports: false });
    expect(inv.complete).toBe(true);
  });
  it('complete=true when every check is definite', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'authz2-'));
    const subjectsPath = path.join(dir, 'subjects.json');
    writeFileSync(subjectsPath, JSON.stringify([{ acct: 'a1', subj: 'u1' }]));
    const inv = await collectAuthz(
      {
        source: 'authz',
        adapter: 'fixture',
        config: { map: JSON.stringify({ 'u1|r|a': true }) },
        subjects: { source: 'json', path: subjectsPath, columns: { accountId: 'acct', subject: 'subj' } },
        capabilities: [{ capability: 'r', resource: 'r', action: 'a' }],
      },
      {},
    );
    expect(inv.complete).toBe(true);
  });
  it('omits access key for unknown results', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'authz3-'));
    const subjectsPath = path.join(dir, 'subjects.json');
    writeFileSync(subjectsPath, JSON.stringify([{ acct: 'a1', subj: 'u1' }]));
    const inv = await collectAuthz(
      {
        source: 'authz',
        adapter: 'fixture',
        config: { map: JSON.stringify({}) },
        subjects: { source: 'json', path: subjectsPath, columns: { accountId: 'acct', subject: 'subj' } },
        capabilities: [{ capability: 'r', resource: 'r', action: 'a' }],
      },
      {},
    );
    expect(inv.complete).toBe(false);
    expect(inv.accounts[0].access).toEqual({});
  });
});
