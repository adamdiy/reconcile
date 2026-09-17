import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  OutboxChannel,
  ruleMatches,
  notificationFor,
  idempotencyKey,
  resolveTarget,
} from '../src/index.js';
import type { NotificationRule } from '@reconcile/domain';

const rule = (over: Partial<NotificationRule> = {}): NotificationRule => ({
  id: 'r1',
  channel: 'outbox',
  target: '',
  checkKinds: 'all',
  minSeverity: 'low',
  states: ['confirmed', 'verified_remediated'],
  enabled: true,
  ...over,
});

const transition = {
  fingerprint: 'fp_abc',
  accountId: 'acct_001',
  checkKind: 'expected_feature_missing',
  feature: 'reports',
  severity: 'high' as const,
  to: 'confirmed',
  at: '2026-09-17T10:00:00Z',
};

describe('ruleMatches', () => {
  it('matches on state, severity floor, and check kinds', () => {
    expect(ruleMatches(rule(), transition)).toBe(true);
    expect(ruleMatches(rule({ enabled: false }), transition)).toBe(false);
    expect(ruleMatches(rule({ states: ['resolved'] }), transition)).toBe(false);
    expect(ruleMatches(rule({ checkKinds: ['coverage_gap'] }), transition)).toBe(false);
    expect(ruleMatches(rule({ minSeverity: 'high' }), transition)).toBe(true);
    expect(ruleMatches(rule({ minSeverity: 'medium' }), { ...transition, severity: 'low' })).toBe(false);
    expect(ruleMatches(rule(), { ...transition, to: 'verified_remediated' })).toBe(true);
  });
});

describe('OutboxChannel', () => {
  it('writes one JSON file per notification', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'reconcile-outbox-'));
    const ch = new OutboxChannel(dir);
    const msg = notificationFor('default', rule(), transition);
    await ch.send(msg);
    await ch.send(msg);
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(2);
    const saved = JSON.parse(readFileSync(path.join(dir, files[0]), 'utf8'));
    expect(saved.kind).toBe('incident_transition');
    expect(saved.incident.accountId).toBe('acct_001');
  });
});

describe('resolveTarget', () => {
  it('resolves env: references', () => {
    expect(resolveTarget('env:MY_HOOK', { MY_HOOK: 'https://x' } as never)).toBe('https://x');
    expect(resolveTarget('env:MISSING', {} as never)).toBe('');
    expect(resolveTarget('literal')).toBe('literal');
  });
});

describe('idempotencyKey', () => {
  it('is stable and distinct per transition', () => {
    expect(idempotencyKey('r1', transition)).toBe(
      'notify:r1:fp_abc:confirmed:2026-09-17T10:00:00Z',
    );
  });
});
