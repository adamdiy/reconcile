import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import type {
  AppInventory,
  IdentityLink,
  Policy,
  PolicyException,
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
  };
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
}

const MAX_RUNS = 500;

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
}

export class JsonFileStore implements Store {
  constructor(private dir: string) {
    mkdirSync(path.join(dir, 'projects'), { recursive: true });
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
}

export class PostgresStore implements Store {
  private sql: postgres.Sql;
  constructor(connectionString: string) {
    this.sql = postgres(connectionString);
  }

  async migrate(): Promise<void> {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../sql');
    for (const f of ['001_init.sql', '002_tenancy.sql'])
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
  if (!(await store.listProjects()).some((p) => p.id === projectId))
    await store.createProject({ id: projectId, name: projectId === 'default' ? 'Default' : projectId });
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
    await ps.publishPolicy({
      version: fixtures.policy.version,
      policy: fixtures.policy,
      publishedAt: new Date().toISOString(),
      publishedBy: 'fixtures',
      note: 'seeded from fixture policy',
    });
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
