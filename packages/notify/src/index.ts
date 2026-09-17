import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { IncidentState, NotificationRule, Severity } from '@reconcile/domain';

export interface Notification {
  projectId: string;
  kind: 'incident_transition' | 'digest';
  title: string;
  /** Markdown body. */
  body: string;
  incident?: {
    fingerprint: string;
    accountId: string;
    checkKind: string;
    feature: string;
    state: string;
    severity: Severity;
  };
  at: string;
}

export interface NotificationChannel {
  send(msg: Notification): Promise<void>;
}

export class SlackWebhookChannel implements NotificationChannel {
  constructor(
    private url: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}
  async send(msg: Notification): Promise<void> {
    const res = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: msg.title,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: msg.title } },
          { type: 'section', text: { type: 'mrkdwn', text: msg.body } },
        ],
      }),
    });
    if (!res.ok) throw new Error(`slack webhook returned ${res.status}`);
  }
}

export class EmailChannel implements NotificationChannel {
  constructor(
    private smtpUrl: string,
    private to: string,
  ) {}
  async send(msg: Notification): Promise<void> {
    // createRequire keeps nodemailer (node:https) invisible to bundlers.
    const req = createRequire(import.meta.url);
    const { createTransport } = req('nodemailer') as typeof import('nodemailer');
    const transport = createTransport(this.smtpUrl);
    await transport.sendMail({
      from: 'reconcile@local',
      to: this.to,
      subject: msg.title,
      text: msg.body,
    });
  }
}

/** Writes one JSON file per notification under <dir> — the local default. */
export class OutboxChannel implements NotificationChannel {
  constructor(private dir: string) {}
  async send(msg: Notification): Promise<void> {
    mkdirSync(this.dir, { recursive: true });
    const id = `${msg.at.replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
    writeFileSync(path.join(this.dir, `${id}.json`), JSON.stringify(msg, null, 2));
  }
}

/** Resolve `env:NAME` references so secrets stay out of stored rules. */
export function resolveTarget(target: string, env: NodeJS.ProcessEnv = process.env): string {
  if (target.startsWith('env:')) return env[target.slice(4)] ?? '';
  return target;
}

export function defaultOutboxDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.RECONCILE_STATE_DIR ?? path.resolve(process.cwd(), '.reconcile'), 'outbox');
}

export function channelFor(
  rule: NotificationRule,
  env: NodeJS.ProcessEnv = process.env,
): NotificationChannel {
  const target = resolveTarget(rule.target, env);
  if (rule.channel === 'slack') return new SlackWebhookChannel(target);
  if (rule.channel === 'email') return new EmailChannel(env.SMTP_URL || 'smtp://localhost:25', target);
  return new OutboxChannel(target || defaultOutboxDir(env));
}

const SEVERITY_ORDER: Severity[] = ['low', 'medium', 'high'];

export interface Transition {
  fingerprint: string;
  accountId: string;
  checkKind: string;
  feature: string;
  severity: Severity;
  /** New state, or resolutionReason when the incident resolved. */
  to: string;
  at: string;
}

/** A rule matches when kind, severity floor, and target state all line up. */
export function ruleMatches(rule: NotificationRule, t: Transition): boolean {
  if (!rule.enabled) return false;
  if (rule.checkKinds !== 'all' && !rule.checkKinds.includes(t.checkKind as never)) return false;
  if (SEVERITY_ORDER.indexOf(t.severity) < SEVERITY_ORDER.indexOf(rule.minSeverity)) return false;
  return rule.states.includes(t.to);
}

export function notificationFor(
  projectId: string,
  rule: NotificationRule,
  t: Transition,
): Notification {
  return {
    projectId,
    kind: 'incident_transition',
    title: `[${projectId}] incident ${t.fingerprint.slice(0, 12)} → ${t.to}`,
    body: [
      `*${t.checkKind}* on account \`${t.accountId}\` (feature \`${t.feature}\`)`,
      `severity: ${t.severity} · new state: ${t.to}`,
    ].join('\n'),
    incident: {
      fingerprint: t.fingerprint,
      accountId: t.accountId,
      checkKind: t.checkKind,
      feature: t.feature,
      state: t.to,
      severity: t.severity,
    },
    at: t.at,
  };
}

export function idempotencyKey(ruleId: string, t: Transition): string {
  return `notify:${ruleId}:${t.fingerprint}:${t.to}:${t.at}`;
}

export type { IncidentState };
