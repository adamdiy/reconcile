import { randomBytes } from 'node:crypto';
import type { AccountAssessment, RepairAction, RepairCommand } from '@reconcile/domain';
import type { ProjectStore, Store } from '@reconcile/store';
import { newJob } from '@reconcile/jobs';

/** Resolve env:-prefixed config values at execution time. */
export function resolveEnvRef(value: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!value.startsWith('env:')) return value;
  const name = value.slice(4);
  const resolved = env[name];
  if (!resolved) throw new Error(`environment variable ${name} is not set`);
  return resolved;
}

export function renderTemplate(
  template: string,
  vars: { accountId: string; capability: string; desired: boolean; idempotencyKey: string },
): string {
  return template
    .replaceAll('{{accountId}}', vars.accountId)
    .replaceAll('{{capability}}', vars.capability)
    .replaceAll('{{desired}}', String(vars.desired))
    .replaceAll('{{idempotencyKey}}', vars.idempotencyKey);
}

export function repairVerifyMs(env: NodeJS.ProcessEnv = process.env): number {
  return Number(env.RECONCILE_REPAIR_VERIFY_MINUTES ?? '30') * 60_000;
}

function featureFor(a: AccountAssessment, capability: string) {
  return a.features.find((f) => f.feature === capability);
}

export async function proposeRepair(
  ps: ProjectStore,
  input: {
    incidentId: string;
    commandId: string;
    assessment: AccountAssessment;
    proposer: string;
    desired?: boolean;
    expiresHours?: number;
    now?: string;
  },
): Promise<RepairAction> {
  const command = (await ps.listRepairCommands()).find((c) => c.id === input.commandId);
  if (!command) throw new Error(`unknown repair command ${input.commandId}`);
  const feature = featureFor(input.assessment, input.assessment.features.find((f) => f.kind === 'mismatch')?.feature ?? '');
  if (!feature || feature.kind !== 'mismatch')
    throw new Error('repairs can only be proposed on a feature mismatch');
  if (!command.capabilities.includes(feature.feature))
    throw new Error(`command ${command.id} does not cover capability ${feature.feature}`);
  const now = input.now ?? new Date().toISOString();
  const expiresAt = new Date(
    Date.parse(now) + (input.expiresHours ?? 24) * 3_600_000,
  ).toISOString();
  const action: RepairAction = {
    id: `ra_${randomBytes(6).toString('hex')}`,
    incidentId: input.incidentId,
    accountId: input.assessment.accountId,
    capability: feature.feature,
    desired: input.desired ?? Boolean(feature.expected),
    commandId: command.id,
    state: 'proposed',
    proposedBy: input.proposer,
    proposedAt: now,
    expiresAt,
    idempotencyKey: `repair:${input.assessment.accountId}:${feature.feature}:${input.incidentId}`,
    preconditions: { observed: Boolean(feature.observed), evidenceIds: feature.evidenceIds },
    log: [{ at: now, event: 'proposed', detail: `by ${input.proposer}` }],
  };
  await ps.putRepairAction(action);
  return action;
}

/** Four-eyes approval: the approver must differ from the proposer. Throws otherwise. */
export async function approveRepair(
  store: Store,
  ps: ProjectStore,
  input: { actionId: string; approver: string; now?: string },
): Promise<RepairAction> {
  const action = await ps.getRepairAction(input.actionId);
  if (!action) throw new Error(`unknown repair action ${input.actionId}`);
  if (action.state !== 'proposed') throw new Error(`action is ${action.state}, not proposed`);
  if (action.approvedBy === action.proposedBy || input.approver === action.proposedBy)
    throw new Error('four-eyes: the approver must differ from the proposer');
  const now = input.now ?? new Date().toISOString();
  const next: RepairAction = {
    ...action,
    state: 'approved',
    approvedBy: input.approver,
    approvedAt: now,
    log: [...action.log, { at: now, event: 'approved', detail: `by ${input.approver}` }],
  };
  await ps.putRepairAction(next);
  await store.enqueueJob(
    newJob('repair', 'default', `repair:exec:${next.id}:${next.idempotencyKey}`, now, {
      repairActionId: next.id,
    }),
  );
  return next;
}

export async function rejectRepair(
  ps: ProjectStore,
  input: { actionId: string; actor: string; now?: string },
): Promise<RepairAction> {
  const action = await ps.getRepairAction(input.actionId);
  if (!action) throw new Error(`unknown repair action ${input.actionId}`);
  if (action.state !== 'proposed' && action.state !== 'approved')
    throw new Error(`action is ${action.state}, cannot reject`);
  const now = input.now ?? new Date().toISOString();
  const next: RepairAction = {
    ...action,
    state: 'rejected',
    log: [...action.log, { at: now, event: 'rejected', detail: `by ${input.actor}` }],
  };
  await ps.putRepairAction(next);
  return next;
}

interface ExecuteDeps {
  fetchImpl?: typeof fetch;
  outboxDir?: string;
  env?: NodeJS.ProcessEnv;
  now?: string;
  /** Re-evaluate the account; injected for testability. */
  evaluateAccount?: (
    accountId: string,
    capability: string,
  ) => Promise<{ observed?: boolean; fresh: boolean; matches: boolean }>;
}

/**
 * Execute an approved repair action (worker handler body). Mutates only through the
 * customer's own command endpoint; writes to the local outbox for the demo.
 */
export async function executeRepair(
  ps: ProjectStore,
  actionId: string,
  deps: ExecuteDeps = {},
): Promise<RepairAction> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? new Date().toISOString();
  const action = await ps.getRepairAction(actionId);
  if (!action) throw new Error(`unknown repair action ${actionId}`);
  if (action.state !== 'approved') return action;

  if (now > action.expiresAt)
    return finish(ps, action, 'expired', now, 'approval expired before execution');

  const command = (await ps.listRepairCommands()).find((c) => c.id === action.commandId);
  if (!command) return finish(ps, action, 'failed', now, `command ${action.commandId} missing`);

  if (deps.evaluateAccount) {
    const check = await deps.evaluateAccount(action.accountId, action.capability);
    if (check.observed !== action.preconditions.observed || !check.fresh)
      return finish(ps, action, 'failed', now, 'precondition changed');
  }

  const vars = {
    accountId: action.accountId,
    capability: action.capability,
    desired: action.desired,
    idempotencyKey: action.idempotencyKey,
  };

  try {
    if (command.kind === 'local_outbox') {
      const { appendFileSync, mkdirSync } = await import('node:fs');
      const { join } = await import('node:path');
      const dir = deps.outboxDir ?? env.RECONCILE_STATE_DIR ?? '.reconcile';
      mkdirSync(dir, { recursive: true });
      appendFileSync(
        join(dir, 'repairs-outbox.jsonl'),
        JSON.stringify({ at: now, repairActionId: action.id, ...vars }) + '\n',
      );
    } else {
      const url = renderTemplate(resolveEnvRef(command.http!.urlTemplate, env), vars);
      const headers: Record<string, string> = { 'Idempotency-Key': action.idempotencyKey };
      for (const [k, v] of Object.entries(command.http!.headers ?? {}))
        headers[k] = renderTemplate(resolveEnvRef(v, env), vars);
      const res = await (deps.fetchImpl ?? fetch)(url, {
        method: command.http!.method,
        headers,
        body: command.http!.bodyTemplate
          ? renderTemplate(command.http!.bodyTemplate, vars)
          : undefined,
      });
      if (!res.ok) return finish(ps, action, 'failed', now, `endpoint returned ${res.status}`);
    }
  } catch (e) {
    return finish(ps, action, 'failed', now, e instanceof Error ? e.message : String(e));
  }
  return finish(ps, action, 'executed', now, `via ${command.name}`);
}

async function finish(
  ps: ProjectStore,
  action: RepairAction,
  state: RepairAction['state'],
  at: string,
  detail?: string,
): Promise<RepairAction> {
  const next: RepairAction = {
    ...action,
    state,
    log: [...action.log, { at, event: state, detail }],
  };
  await ps.putRepairAction(next);
  return next;
}

/**
 * Post-assessment pass: mark executed actions verified once the feature matches,
 * or failed once the verify window elapses with a fresh (non-stale) observation.
 */
export async function verifyRepairs(
  ps: ProjectStore,
  assessments: AccountAssessment[],
  env: NodeJS.ProcessEnv = process.env,
  now = new Date().toISOString(),
): Promise<RepairAction[]> {
  const changed: RepairAction[] = [];
  for (const action of await ps.listRepairActions()) {
    if (action.state !== 'executed') continue;
    const a = assessments.find((x) => x.accountId === action.accountId);
    const feature = a ? featureFor(a, action.capability) : undefined;
    if (!feature) continue;
    if (feature.kind === 'match') {
      changed.push(await finish(ps, action, 'verified', now, 'evidence now matches expectation'));
      continue;
    }
    const stale = feature.kind === 'unknown' && feature.reasons.includes('stale_evidence');
    const deadline = new Date(
      Date.parse(action.log.filter((l) => l.event === 'executed').at(-1)?.at ?? action.approvedAt ?? action.proposedAt) +
        repairVerifyMs(env),
    ).toISOString();
    if (!stale && now > deadline)
      changed.push(await finish(ps, action, 'failed', now, 'mismatch persists after verify window'));
  }
  return changed;
}

export type { RepairAction, RepairCommand };
