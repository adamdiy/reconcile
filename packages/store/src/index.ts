import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import type {
  AppInventory,
  IdentityLink,
  Job,
  NotificationRule,
  Policy,
  PolicyException,
  Schedule,
  StoredIncident,
  StripeInventory,
  User,
} from '@reconcile/domain';
import { UserSchema } from '@reconcile/domain';
import { scryptSync, randomBytes } from 'node:crypto';

export interface PolicyVersion {
  version: string;
  policy: Policy;
  publishedAt: string;
  publishedBy: string;
  note?: string;
}
export interface PolicyDraft {
  policy: Policy;
  updatedAt: string;
}
export type SourceOrigin = 'fixtures' | 'connector';
export interface SourceSnapshot {
  stripe: StripeInventory;
  app: AppInventory;
  importedAt: string;
  origin: SourceOrigin;
  /** Per-side origin; falls back to `origin` for both when absent. */
  origins?: { stripe: SourceOrigin; app: SourceOrigin };
}
export interface AssessmentRun {
  id: string;
  evaluatedAt: string;
  policyVersion: string;
  engineVersion: string;
  counts: {
    population: number;
    buckets: [number, number, number, number];
    coveredPairs: number;
    totalPairs: number;
    incidentsOpen: number;
    unknownReasons?: Record<string, number>;
  };
  nextTransitionAt?: string;
}
export interface Project {
  id: string;
  name: string;
}

/** Per-project data plane — today's collections, scoped by projectId. */
export interface ProjectStore {
  getSources(): Promise<SourceSnapshot | null>;
  putSources(s: SourceSnapshot): Promise<void>;
  listPolicyVersions(): Promise<PolicyVersion[]>;
  getPublishedPolicy(): Promise<PolicyVersion | null>;
  publishPolicy(v: PolicyVersion): Promise<void>;
  getPolicyDraft(): Promise<PolicyDraft | null>;
  savePolicyDraft(d: PolicyDraft): Promise<void>;
  clearPolicyDraft(): Promise<void>;
  listExceptions(): Promise<PolicyException[]>;
  upsertException(e: PolicyException): Promise<void>;
  deleteException(id: string): Promise<void>;
  listLinks(): Promise<IdentityLink[]>;
  upsertLink(l: IdentityLink): Promise<void>;
  deleteLink(accountId: string): Promise<void>;
  getIncidents(): Promise<Record<string, StoredIncident>>;
  putIncidents(s: Record<string, StoredIncident>): Promise<void>;
  recordRun(r: AssessmentRun): Promise<void>;
  listRuns(limit?: number): Promise<AssessmentRun[]>;
  listNotificationRules(): Promise<NotificationRule[]>;
  upsertNotificationRule(r: NotificationRule): Promise<void>;
  deleteNotificationRule(id: string): Promise<void>;
}

export interface Store {
  migrate(): Promise<void>;
  close(): Promise<void>;
  forProject(projectId: string): ProjectStore;
  listProjects(): Promise<Project[]>;
  createProject(p: Project): Promise<void>;
  listUsers(): Promise<User[]>;
  getUserByEmail(email: string): Promise<User | null>;
  upsertUser(u: User): Promise<void>;
  /** Returns the existing unfinished job when idempotencyKey matches. */
  enqueueJob(j: Job): Promise<Job>;
  /** Lookup by idempotency key across all statuses (scheduler dedupe). */
  getJobByIdempotencyKey(key: string): Promise<Job | null>;
  leaseNextJob(now: string, leaseMs: number): Promise<Job | null>;
  completeJob(id: string, at: string): Promise<void>;
  failJob(id: string, error: string, retryAt: string | null, at: string): Promise<void>;
  listJobs(projectId?: string, limit?: number): Promise<Job[]>;
  getSchedule(projectId: string): Promise<Schedule | null>;
  putSchedule(s: Schedule): Promise<void>;
  putWebhookEvent(projectId: string, eventId: string, payload: unknown, receivedAt: string): Promise<'new' | 'duplicate'>;
  listWebhookEvents(projectId: string, limit?: number): Promise<StoredWebhookEvent[]>;
  touchWorkerHeartbeat(at: string): Promise<void>;
  getWorkerHeartbeat(): Promise<string | null>;
}

export interface StoredWebhookEvent {
  projectId: string;
  eventId: string;
  payload: unknown;
  receivedAt: string;
}

const MAX_RUNS = 500;
const MAX_JOBS = 2000;

export function hashPassword(password: string, salt?: string): string {
  const s = salt ?? randomBytes(16).toString('hex');
  const h = scryptSync(password, s, 32).toString('hex');
  return `${s}:${h}`;
}

function atomicWrite(file: string, data: unknown): void {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file);
}

class JsonProjectStore implements ProjectStore {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private file(name: string): string {
    return path.join(this.dir, `${name}.json`);
  }

  private read<T>(name: string, fallback: T): T {
    try {
      return JSON.parse(readFileSync(this.file(name), 'utf8')) as T;
    } catch {
      return fallback;
    }
  }

  private write(name: string, data: unknown): void {
    atomicWrite(this.file(name), data);
  }

  async getSources() {
    return this.read<SourceSnapshot | null>('sources', null);
  }
  async putSources(s: SourceSnapshot) {
    this.write('sources', s);
  }

  async listPolicyVersions() {
    return this.read<PolicyVersion[]>('policy-versions', []);
  }
  async getPublishedPolicy() {
    return (await this.listPolicyVersions())[0] ?? null;
  }
  async publishPolicy(v: PolicyVersion) {
    const versions = await this.listPolicyVersions();
    if (versions.some((x) => x.version === v.version))
      throw new Error(`policy version ${v.version} already exists`);
    this.write('policy-versions', [v, ...versions]);
  }
  async getPolicyDraft() {
    return this.read<PolicyDraft | null>('policy-draft', null);
  }
  async savePolicyDraft(d: PolicyDraft) {
    this.write('policy-draft', d);
  }
  async clearPolicyDraft() {
    this.write('policy-draft', null);
  }

  async listExceptions() {
    return this.read<PolicyException[]>('exceptions', []);
  }
  async upsertException(e: PolicyException) {
    const list = (await this.listExceptions()).filter((x) => x.id !== e.id);
    list.push(e);
    list.sort((a, b) => a.id.localeCompare(b.id));
    this.write('exceptions', list);
  }
  async deleteException(id: string) {
    this.write(
      'exceptions',
      (await this.listExceptions()).filter((x) => x.id !== id),
    );
  }

  async listLinks() {
    return this.read<IdentityLink[]>('links', []);
  }
  async upsertLink(l: IdentityLink) {
    const list = (await this.listLinks()).filter((x) => x.accountId !== l.accountId);
    list.push(l);
    list.sort((a, b) => a.accountId.localeCompare(b.accountId));
    this.write('links', list);
  }
  async deleteLink(accountId: string) {
    this.write(
      'links',
      (await this.listLinks()).filter((x) => x.accountId !== accountId),
    );
  }

  async getIncidents() {
    return this.read<Record<string, StoredIncident>>('incidents', {});
  }
  async putIncidents(s: Record<string, StoredIncident>) {
    this.write('incidents', s);
  }

  async recordRun(r: AssessmentRun) {
    const runs = await this.listRuns();
    this.write('runs', [r, ...runs].slice(0, MAX_RUNS));
  }
  async listRuns(limit = 50) {
    return this.read<AssessmentRun[]>('runs', []).slice(0, limit);
  }

  async listNotificationRules() {
    return this.read<NotificationRule[]>('notification-rules', []);
  }
  async upsertNotificationRule(r: NotificationRule) {
    const list = (await this.listNotificationRules()).filter((x) => x.id !== r.id);
    list.push(r);
    list.sort((a, b) => a.id.localeCompare(b.id));
    this.write('notification-rules', list);
  }
  async deleteNotificationRule(id: string) {
    this.write(
      'notification-rules',
      (await this.listNotificationRules()).filter((x) => x.id !== id),
    );
  }
}

/** Root-level job/schedule/webhook collections shared by both adapters. */
class JsonRootCollections {
  constructor(private dir: string) {}
  file(name: string): string {
    return path.join(this.dir, `${name}.json`);
  }
  read<T>(name: string, fallback: T): T {
    try {
      return JSON.parse(readFileSync(this.file(name), 'utf8')) as T;
    } catch {
      return fallback;
    }
  }
  write(name: string, data: unknown): void {
    atomicWrite(this.file(name), data);
  }
}

export class JsonFileStore implements Store {
  private collections: JsonRootCollections;
  constructor(private dir: string) {
    mkdirSync(path.join(dir, 'projects'), { recursive: true });
    this.collections = new JsonRootCollections(dir);
  }

  async migrate(): Promise<void> {}
  async close(): Promise<void> {}

  forProject(projectId: string): ProjectStore {
    if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) throw new Error(`invalid project id ${projectId}`);
    return new JsonProjectStore(path.join(this.dir, 'projects', projectId));
  }

  private file(name: string): string {
    return path.join(this.dir, `${name}.json`);
  }
  private read<T>(name: string, fallback: T): T {
    try {
      return JSON.parse(readFileSync(this.file(name), 'utf8')) as T;
    } catch {
      return fallback;
    }
  }
  private write(name: string, data: unknown): void {
    atomicWrite(this.file(name), data);
  }

  async listProjects(): Promise<Project[]> {
    return this.read<Project[]>('projects', []);
  }
  async createProject(p: Project): Promise<void> {
    const list = await this.listProjects();
    if (list.some((x) => x.id === p.id)) throw new Error(`project ${p.id} already exists`);
    this.write('projects', [...list, p]);
  }

  async listUsers(): Promise<User[]> {
    return this.read<User[]>('users', []);
  }
  async getUserByEmail(email: string): Promise<User | null> {
    return (await this.listUsers()).find((u) => u.email === email) ?? null;
  }
  async upsertUser(u: User): Promise<void> {
    UserSchema.parse(u);
    const list = (await this.listUsers()).filter((x) => x.id !== u.id);
    list.push(u);
    list.sort((a, b) => a.email.localeCompare(b.email));
    this.write('users', list);
  }

  async enqueueJob(j: Job): Promise<Job> {
    const jobs = this.collections.read<Job[]>('jobs', []);
    const existing = jobs.find(
      (x) => x.idempotencyKey === j.idempotencyKey && ['queued', 'running', 'failed'].includes(x.status),
    );
    if (existing) return existing;
    jobs.push(j);
    jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    this.collections.write('jobs', jobs.slice(-MAX_JOBS));
    return j;
  }

  async getJobByIdempotencyKey(key: string): Promise<Job | null> {
    return this.collections.read<Job[]>('jobs', []).find((x) => x.idempotencyKey === key) ?? null;
  }

  /** Single-process lease guarded by an atomic mkdir lock. */
  async leaseNextJob(now: string, leaseMs: number): Promise<Job | null> {
    const lock = path.join(this.dir, 'jobs.lock');
    try {
      mkdirSync(lock);
    } catch {
      return null;
    }
    try {
      const jobs = this.collections.read<Job[]>('jobs', []);
      const candidates = jobs
        .filter(
          (j) =>
            (j.status === 'queued' || j.status === 'failed') &&
            j.runAfter <= now &&
            (!j.leaseUntil || j.leaseUntil < now),
        )
        .sort((a, b) => a.runAfter.localeCompare(b.runAfter));
      const job = candidates[0];
      if (!job) return null;
      job.status = 'running';
      job.attempts += 1;
      job.leaseUntil = new Date(Date.parse(now) + leaseMs).toISOString();
      job.updatedAt = now;
      this.collections.write('jobs', jobs);
      return { ...job };
    } finally {
      rmSync(lock, { recursive: true, force: true });
    }
  }

  async completeJob(id: string, at: string): Promise<void> {
    const jobs = this.collections.read<Job[]>('jobs', []);
    const job = jobs.find((j) => j.id === id);
    if (job) {
      job.status = 'succeeded';
      job.leaseUntil = undefined;
      job.updatedAt = at;
      this.collections.write('jobs', jobs);
    }
  }

  async failJob(id: string, error: string, retryAt: string | null, at: string): Promise<void> {
    const jobs = this.collections.read<Job[]>('jobs', []);
    const job = jobs.find((j) => j.id === id);
    if (job) {
      job.status = job.attempts >= job.maxAttempts || retryAt === null ? 'dead' : 'failed';
      job.lastError = error;
      job.leaseUntil = undefined;
      if (retryAt) job.runAfter = retryAt;
      job.updatedAt = at;
      this.collections.write('jobs', jobs);
    }
  }

  async listJobs(projectId?: string, limit = 100): Promise<Job[]> {
    const jobs = this.collections.read<Job[]>('jobs', []);
    return jobs
      .filter((j) => !projectId || j.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async getSchedule(projectId: string): Promise<Schedule | null> {
    const map = this.collections.read<Record<string, Schedule>>('schedules', {});
    return map[projectId] ?? null;
  }
  async putSchedule(s: Schedule): Promise<void> {
    const map = this.collections.read<Record<string, Schedule>>('schedules', {});
    map[s.projectId] = s;
    this.collections.write('schedules', map);
  }

  async putWebhookEvent(
    projectId: string,
    eventId: string,
    payload: unknown,
    receivedAt: string,
  ): Promise<'new' | 'duplicate'> {
    const events = this.collections.read<StoredWebhookEvent[]>('webhook-events', []);
    if (events.some((e) => e.projectId === projectId && e.eventId === eventId)) return 'duplicate';
    events.push({ projectId, eventId, payload, receivedAt });
    this.collections.write('webhook-events', events);
    return 'new';
  }
  async listWebhookEvents(projectId: string, limit = 50): Promise<StoredWebhookEvent[]> {
    return this.collections
      .read<StoredWebhookEvent[]>('webhook-events', [])
      .filter((e) => e.projectId === projectId)
      .slice(-limit)
      .reverse();
  }

  async touchWorkerHeartbeat(at: string): Promise<void> {
    this.collections.write('worker', { lastTickAt: at });
  }
  async getWorkerHeartbeat(): Promise<string | null> {
    return this.collections.read<{ lastTickAt?: string }>('worker', {}).lastTickAt ?? null;
  }
}

type Tx = postgres.Sql;

class PostgresProjectStore implements ProjectStore {
  constructor(
    private sql: postgres.Sql,
    private projectId: string,
  ) {}

  private j(v: unknown) {
    return this.sql.json(v as postgres.JSONValue);
  }

  /** Every project query runs inside a transaction with app.project_id set for RLS. */
  private async scoped<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.sql.begin(async (tx) => {
      await tx`select set_config('app.project_id', ${this.projectId}, true)`;
      return fn(tx as Tx);
    }) as unknown as Promise<T>;
  }

  async getSources() {
    return this.scoped(async (tx) => {
      const rows = await tx`SELECT payload FROM sources WHERE project_id = ${this.projectId} AND id = 1`;
      return (rows[0]?.payload as SourceSnapshot) ?? null;
    });
  }
  async putSources(s: SourceSnapshot) {
    await this.scoped(async (tx) => {
      await tx`INSERT INTO sources (project_id, id, payload) VALUES (${this.projectId}, 1, ${this.j(s)})
        ON CONFLICT (project_id, id) DO UPDATE SET payload = EXCLUDED.payload`;
    });
  }

  async listPolicyVersions() {
    return this.scoped(async (tx) => {
      const rows = await tx`SELECT version, published_at, published_by, note, payload
        FROM policy_versions WHERE project_id = ${this.projectId} ORDER BY published_at DESC`;
      return rows.map(
        (r) =>
          ({
            version: r.version,
            policy: (r.payload as { policy: Policy }).policy,
            publishedAt: new Date(r.published_at).toISOString(),
            publishedBy: r.published_by,
            note: r.note ?? undefined,
          }) as PolicyVersion,
      );
    });
  }
  async getPublishedPolicy() {
    return (await this.listPolicyVersions())[0] ?? null;
  }
  async publishPolicy(v: PolicyVersion) {
    await this.scoped(async (tx) => {
      const res = await tx`INSERT INTO policy_versions (project_id, version, published_at, published_by, note, payload)
        VALUES (${this.projectId}, ${v.version}, ${v.publishedAt}, ${v.publishedBy}, ${v.note ?? null},
          ${this.j({ policy: v.policy })})
        ON CONFLICT (project_id, version) DO NOTHING`;
      if (res.count === 0) throw new Error(`policy version ${v.version} already exists`);
    });
  }
  async getPolicyDraft() {
    return this.scoped(async (tx) => {
      const rows = await tx`SELECT payload FROM policy_draft WHERE project_id = ${this.projectId} AND id = 1`;
      return (rows[0]?.payload as PolicyDraft) ?? null;
    });
  }
  async savePolicyDraft(d: PolicyDraft) {
    await this.scoped(async (tx) => {
      await tx`INSERT INTO policy_draft (project_id, id, payload) VALUES (${this.projectId}, 1, ${this.j(d)})
        ON CONFLICT (project_id, id) DO UPDATE SET payload = EXCLUDED.payload`;
    });
  }
  async clearPolicyDraft() {
    await this.scoped(async (tx) => {
      await tx`DELETE FROM policy_draft WHERE project_id = ${this.projectId} AND id = 1`;
    });
  }

  async listExceptions() {
    return this.scoped(async (tx) => {
      const rows = await tx`SELECT payload FROM exceptions WHERE project_id = ${this.projectId} ORDER BY id`;
      return rows.map((r) => r.payload as PolicyException);
    });
  }
  async upsertException(e: PolicyException) {
    await this.scoped(async (tx) => {
      await tx`INSERT INTO exceptions (project_id, id, payload) VALUES (${this.projectId}, ${e.id}, ${this.j(e)})
        ON CONFLICT (project_id, id) DO UPDATE SET payload = EXCLUDED.payload`;
    });
  }
  async deleteException(id: string) {
    await this.scoped(async (tx) => {
      await tx`DELETE FROM exceptions WHERE project_id = ${this.projectId} AND id = ${id}`;
    });
  }

  async listLinks() {
    return this.scoped(async (tx) => {
      const rows = await tx`SELECT account_id, stripe_customer_id, reviewed FROM identity_links WHERE project_id = ${this.projectId} ORDER BY account_id`;
      return rows.map((r) => ({
        accountId: r.account_id,
        stripeCustomerId: r.stripe_customer_id,
        reviewed: r.reviewed,
      })) as IdentityLink[];
    });
  }
  async upsertLink(l: IdentityLink) {
    await this.scoped(async (tx) => {
      await tx`INSERT INTO identity_links (project_id, account_id, stripe_customer_id, reviewed)
        VALUES (${this.projectId}, ${l.accountId}, ${l.stripeCustomerId}, ${l.reviewed})
        ON CONFLICT (project_id, account_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id, reviewed = EXCLUDED.reviewed`;
    });
  }
  async deleteLink(accountId: string) {
    await this.scoped(async (tx) => {
      await tx`DELETE FROM identity_links WHERE project_id = ${this.projectId} AND account_id = ${accountId}`;
    });
  }

  async getIncidents() {
    return this.scoped(async (tx) => {
      const rows = await tx`SELECT fingerprint, payload FROM incidents WHERE project_id = ${this.projectId}`;
      const out: Record<string, StoredIncident> = {};
      for (const r of rows) out[r.fingerprint] = r.payload as StoredIncident;
      return out;
    });
  }
  async putIncidents(s: Record<string, StoredIncident>) {
    const rows = Object.entries(s).map(([fingerprint, inc]) => ({
      project_id: this.projectId,
      fingerprint,
      payload: inc,
    }));
    await this.scoped(async (tx) => {
      await tx`DELETE FROM incidents WHERE project_id = ${this.projectId}`;
      if (rows.length > 0) {
        await tx`INSERT INTO incidents (project_id, fingerprint, payload)
          SELECT * FROM jsonb_to_recordset(${tx.json(rows)}::jsonb)
            AS x(project_id text, fingerprint text, payload jsonb)`;
      }
    });
  }
  async recordRun(r: AssessmentRun) {
    await this.scoped(async (tx) => {
      await tx`INSERT INTO runs (project_id, id, evaluated_at, payload) VALUES (${this.projectId}, ${r.id}, ${r.evaluatedAt}, ${this.j(r)})
        ON CONFLICT (project_id, id) DO UPDATE SET evaluated_at = EXCLUDED.evaluated_at, payload = EXCLUDED.payload`;
      await tx`DELETE FROM runs WHERE project_id = ${this.projectId} AND id NOT IN (
        SELECT id FROM runs WHERE project_id = ${this.projectId} ORDER BY evaluated_at DESC LIMIT ${MAX_RUNS})`;
    });
  }
  async listRuns(limit = 50) {
    return this.scoped(async (tx) => {
      const rows = await tx`SELECT payload FROM runs WHERE project_id = ${this.projectId} ORDER BY evaluated_at DESC LIMIT ${limit}`;
      return rows.map((r) => r.payload as AssessmentRun);
    });
  }

  async listNotificationRules() {
    return this.scoped(async (tx) => {
      const rows = await tx`SELECT payload FROM notification_rules WHERE project_id = ${this.projectId} ORDER BY id`;
      return rows.map((r) => r.payload as NotificationRule);
    });
  }
  async upsertNotificationRule(r: NotificationRule) {
    await this.scoped(async (tx) => {
      await tx`INSERT INTO notification_rules (project_id, id, payload) VALUES (${this.projectId}, ${r.id}, ${this.j(r)})
        ON CONFLICT (project_id, id) DO UPDATE SET payload = EXCLUDED.payload`;
    });
  }
  async deleteNotificationRule(id: string) {
    await this.scoped(async (tx) => {
      await tx`DELETE FROM notification_rules WHERE project_id = ${this.projectId} AND id = ${id}`;
    });
  }
}

export class PostgresStore implements Store {
  private sql: postgres.Sql;
  constructor(connectionString: string) {
    this.sql = postgres(connectionString);
  }

  async migrate(): Promise<void> {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../sql');
    for (const f of ['001_init.sql', '002_tenancy.sql', '003_jobs.sql'])
      await this.sql.unsafe(readFileSync(path.join(dir, f), 'utf8'));
  }
  async close(): Promise<void> {
    await this.sql.end();
  }

  forProject(projectId: string): ProjectStore {
    return new PostgresProjectStore(this.sql, projectId);
  }

  async listProjects(): Promise<Project[]> {
    const rows = await this.sql`SELECT id, name FROM projects ORDER BY id`;
    return rows.map((r) => ({ id: r.id, name: r.name }));
  }
  async createProject(p: Project): Promise<void> {
    await this.sql`INSERT INTO projects (id, name) VALUES (${p.id}, ${p.name})`;
  }

  async listUsers(): Promise<User[]> {
    const rows = await this.sql`SELECT payload FROM users ORDER BY email`;
    return rows.map((r) => r.payload as User);
  }
  async getUserByEmail(email: string): Promise<User | null> {
    const rows = await this.sql`SELECT payload FROM users WHERE email = ${email}`;
    return (rows[0]?.payload as User) ?? null;
  }
  async upsertUser(u: User): Promise<void> {
    UserSchema.parse(u);
    await this.sql`INSERT INTO users (id, email, payload) VALUES (${u.id}, ${u.email}, ${this.sql.json(u as unknown as postgres.JSONValue)})
      ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, payload = EXCLUDED.payload`;
  }

  private jobOf(r: postgres.Row): Job {
    return {
      id: r.id,
      projectId: r.project_id,
      kind: r.kind,
      payload: r.payload,
      idempotencyKey: r.idempotency_key,
      status: r.status,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      runAfter: new Date(r.run_after).toISOString(),
      leaseUntil: r.lease_until ? new Date(r.lease_until).toISOString() : undefined,
      lastError: r.last_error ?? undefined,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  }

  async enqueueJob(j: Job): Promise<Job> {
    return this.sql.begin(async (tx) => {
      const existing = await tx`SELECT * FROM jobs
        WHERE idempotency_key = ${j.idempotencyKey} AND status IN ('queued','running','failed')
        ORDER BY created_at LIMIT 1`;
      if (existing[0]) return this.jobOf(existing[0]);
      const rows = await tx`INSERT INTO jobs
        (id, project_id, kind, payload, idempotency_key, status, attempts, max_attempts, run_after, lease_until, last_error, created_at, updated_at)
        VALUES (${j.id}, ${j.projectId}, ${j.kind}, ${this.sql.json(j.payload as postgres.JSONValue)}, ${j.idempotencyKey},
          ${j.status}, ${j.attempts}, ${j.maxAttempts}, ${j.runAfter}, ${j.leaseUntil ?? null}, ${j.lastError ?? null},
          ${j.createdAt}, ${j.updatedAt})
        RETURNING *`;
      return this.jobOf(rows[0]);
    }) as unknown as Promise<Job>;
  }

  async getJobByIdempotencyKey(key: string): Promise<Job | null> {
    const rows = await this.sql`SELECT * FROM jobs WHERE idempotency_key = ${key} ORDER BY created_at DESC LIMIT 1`;
    return rows[0] ? this.jobOf(rows[0]) : null;
  }

  async leaseNextJob(now: string, leaseMs: number): Promise<Job | null> {
    return this.sql.begin(async (tx) => {
      const leaseUntil = new Date(Date.parse(now) + leaseMs).toISOString();
      const rows = await tx`UPDATE jobs
        SET status = 'running', attempts = attempts + 1, lease_until = ${leaseUntil}, updated_at = ${now}
        WHERE id = (
          SELECT id FROM jobs
          WHERE status IN ('queued','failed') AND run_after <= ${now}
            AND (lease_until IS NULL OR lease_until < ${now})
          ORDER BY run_after LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING *`;
      return rows[0] ? this.jobOf(rows[0]) : null;
    }) as unknown as Promise<Job | null>;
  }

  async completeJob(id: string, at: string): Promise<void> {
    await this.sql`UPDATE jobs SET status = 'succeeded', lease_until = NULL, updated_at = ${at} WHERE id = ${id}`;
  }

  async failJob(id: string, error: string, retryAt: string | null, at: string): Promise<void> {
    await this.sql`UPDATE jobs SET
      status = CASE WHEN attempts >= max_attempts OR ${retryAt}::timestamptz IS NULL THEN 'dead' ELSE 'failed' END,
      last_error = ${error}, lease_until = NULL,
      run_after = COALESCE(${retryAt}::timestamptz, run_after), updated_at = ${at}
      WHERE id = ${id}`;
  }

  async listJobs(projectId?: string, limit = 100): Promise<Job[]> {
    const rows = projectId
      ? await this.sql`SELECT * FROM jobs WHERE project_id = ${projectId} ORDER BY created_at DESC LIMIT ${limit}`
      : await this.sql`SELECT * FROM jobs ORDER BY created_at DESC LIMIT ${limit}`;
    return rows.map((r) => this.jobOf(r));
  }

  async getSchedule(projectId: string): Promise<Schedule | null> {
    const rows = await this.sql`SELECT payload FROM schedules WHERE project_id = ${projectId}`;
    return (rows[0]?.payload as Schedule) ?? null;
  }
  async putSchedule(s: Schedule): Promise<void> {
    await this.sql`INSERT INTO schedules (project_id, payload) VALUES (${s.projectId}, ${this.sql.json(s as unknown as postgres.JSONValue)})
      ON CONFLICT (project_id) DO UPDATE SET payload = EXCLUDED.payload`;
  }

  async putWebhookEvent(
    projectId: string,
    eventId: string,
    payload: unknown,
    receivedAt: string,
  ): Promise<'new' | 'duplicate'> {
    const res = await this.sql`INSERT INTO webhook_events (project_id, event_id, received_at, payload)
      VALUES (${projectId}, ${eventId}, ${receivedAt}, ${this.sql.json(payload as postgres.JSONValue)})
      ON CONFLICT (project_id, event_id) DO NOTHING`;
    return res.count === 0 ? 'duplicate' : 'new';
  }
  async listWebhookEvents(projectId: string, limit = 50): Promise<StoredWebhookEvent[]> {
    const rows = await this.sql`SELECT * FROM webhook_events WHERE project_id = ${projectId} ORDER BY received_at DESC LIMIT ${limit}`;
    return rows.map((r) => ({
      projectId: r.project_id,
      eventId: r.event_id,
      payload: r.payload,
      receivedAt: new Date(r.received_at).toISOString(),
    }));
  }

  async touchWorkerHeartbeat(at: string): Promise<void> {
    await this.sql`INSERT INTO worker_state (id, payload) VALUES ('heartbeat', ${this.sql.json({ lastTickAt: at })})
      ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload`;
  }
  async getWorkerHeartbeat(): Promise<string | null> {
    const rows = await this.sql`SELECT payload->>'lastTickAt' AS tick FROM worker_state WHERE id = 'heartbeat'`;
    return (rows[0]?.tick as string) ?? null;
  }
}

export function createStore(env: NodeJS.ProcessEnv = process.env): Store {
  if (env.DATABASE_URL) return new PostgresStore(env.DATABASE_URL);
  return new JsonFileStore(env.RECONCILE_STATE_DIR ?? path.resolve(process.cwd(), '.reconcile'));
}

export interface FixtureSeed {
  stripe: StripeInventory;
  app: AppInventory;
  links: IdentityLink[];
  policy: Policy;
  exceptions: PolicyException[];
}

/** Seed project `default` (per-project collections) plus the initial admin user. */
export async function seedFromFixtures(
  store: Store,
  fixtures: FixtureSeed,
  projectId = 'default',
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!(await store.listProjects()).some((p) => p.id === projectId)) {
    // Concurrent seeds race on insert; the loser sees 'already exists'.
    try {
      await store.createProject({ id: projectId, name: projectId === 'default' ? 'Default' : projectId });
    } catch (e) {
      if (!(e instanceof Error && e.message.includes('already exists'))) throw e;
    }
  }
  if (!(await store.getUserByEmail('admin@local')))
    await store.upsertUser({
      id: 'user_admin',
      email: 'admin@local',
      passwordHash: hashPassword(env.RECONCILE_ADMIN_PASSWORD ?? 'reconcile'),
      role: 'admin',
      projectIds: [projectId],
    });
  const ps = store.forProject(projectId);
  if (!(await ps.getPublishedPolicy())) {
    // Concurrent seeds race on insert; the loser sees 'already exists'.
    try {
      await ps.publishPolicy({
      version: fixtures.policy.version,
      policy: fixtures.policy,
      publishedAt: new Date().toISOString(),
      publishedBy: 'fixtures',
      note: 'seeded from fixture policy',
      });
    } catch (e) {
      if (!(e instanceof Error && e.message.includes('already exists'))) throw e;
    }
  }
  if ((await ps.listLinks()).length === 0)
    for (const l of fixtures.links) await ps.upsertLink(l);
  if ((await ps.listExceptions()).length === 0)
    for (const e of fixtures.exceptions) await ps.upsertException(e);
  if (!(await ps.getSources()))
    await ps.putSources({
      stripe: fixtures.stripe,
      app: fixtures.app,
      importedAt: new Date().toISOString(),
      origin: 'fixtures',
      origins: { stripe: 'fixtures', app: 'fixtures' },
    });
}
