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
} from '@reconcile/domain';

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
export interface SourceSnapshot {
  stripe: StripeInventory;
  app: AppInventory;
  importedAt: string;
  origin: 'fixtures' | 'connector';
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

export interface Store {
  migrate(): Promise<void>;
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
  close(): Promise<void>;
}

const MAX_RUNS = 500;

function atomicWrite(file: string, data: unknown): void {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file);
}

export class JsonFileStore implements Store {
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

  async migrate(): Promise<void> {}
  async close(): Promise<void> {}

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
    const versions = await this.listPolicyVersions();
    return versions[0] ?? null;
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

export class PostgresStore implements Store {
  private sql: postgres.Sql;
  private j(v: unknown) {
    return this.sql.json(v as postgres.JSONValue);
  }
  constructor(connectionString: string) {
    this.sql = postgres(connectionString);
  }

  async migrate(): Promise<void> {
    const ddl = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../sql/001_init.sql'),
      'utf8',
    );
    await this.sql.unsafe(ddl);
  }
  async close(): Promise<void> {
    await this.sql.end();
  }

  async getSources() {
    const rows = await this.sql`SELECT payload FROM sources WHERE id = 1`;
    return (rows[0]?.payload as SourceSnapshot) ?? null;
  }
  async putSources(s: SourceSnapshot) {
    await this.sql`INSERT INTO sources (id, payload) VALUES (1, ${this.j(s)})
      ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload`;
  }

  async listPolicyVersions() {
    const rows = await this.sql`SELECT version, published_at, published_by, note, payload
      FROM policy_versions ORDER BY published_at DESC`;
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
  }
  async getPublishedPolicy() {
    return (await this.listPolicyVersions())[0] ?? null;
  }
  async publishPolicy(v: PolicyVersion) {
    const res = await this.sql`INSERT INTO policy_versions (version, published_at, published_by, note, payload)
      VALUES (${v.version}, ${v.publishedAt}, ${v.publishedBy}, ${v.note ?? null},
        ${this.j({ policy: v.policy })})
      ON CONFLICT (version) DO NOTHING`;
    if (res.count === 0) throw new Error(`policy version ${v.version} already exists`);
  }
  async getPolicyDraft() {
    const rows = await this.sql`SELECT payload FROM policy_draft WHERE id = 1`;
    return (rows[0]?.payload as PolicyDraft) ?? null;
  }
  async savePolicyDraft(d: PolicyDraft) {
    await this.sql`INSERT INTO policy_draft (id, payload) VALUES (1, ${this.j(d)})
      ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload`;
  }
  async clearPolicyDraft() {
    await this.sql`DELETE FROM policy_draft WHERE id = 1`;
  }

  async listExceptions() {
    const rows = await this.sql`SELECT payload FROM exceptions ORDER BY id`;
    return rows.map((r) => r.payload as PolicyException);
  }
  async upsertException(e: PolicyException) {
    await this.sql`INSERT INTO exceptions (id, payload) VALUES (${e.id}, ${this.j(e)})
      ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload`;
  }
  async deleteException(id: string) {
    await this.sql`DELETE FROM exceptions WHERE id = ${id}`;
  }

  async listLinks() {
    const rows = await this.sql`SELECT account_id, stripe_customer_id, reviewed FROM identity_links ORDER BY account_id`;
    return rows.map((r) => ({
      accountId: r.account_id,
      stripeCustomerId: r.stripe_customer_id,
      reviewed: r.reviewed,
    })) as IdentityLink[];
  }
  async upsertLink(l: IdentityLink) {
    await this.sql`INSERT INTO identity_links (account_id, stripe_customer_id, reviewed)
      VALUES (${l.accountId}, ${l.stripeCustomerId}, ${l.reviewed})
      ON CONFLICT (account_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id, reviewed = EXCLUDED.reviewed`;
  }
  async deleteLink(accountId: string) {
    await this.sql`DELETE FROM identity_links WHERE account_id = ${accountId}`;
  }

  async getIncidents() {
    const rows = await this.sql`SELECT fingerprint, payload FROM incidents`;
    const out: Record<string, StoredIncident> = {};
    for (const r of rows) out[r.fingerprint] = r.payload as StoredIncident;
    return out;
  }
  async putIncidents(s: Record<string, StoredIncident>) {
    const rows = Object.entries(s).map(([fingerprint, inc]) => ({ fingerprint, payload: inc }));
    await this.sql.begin(async (tx) => {
      await tx`DELETE FROM incidents`;
      if (rows.length > 0) {
        await tx`INSERT INTO incidents (fingerprint, payload)
          SELECT * FROM jsonb_to_recordset(${tx.json(rows)}::jsonb)
            AS x(fingerprint text, payload jsonb)`;
      }
    });
  }
  async recordRun(r: AssessmentRun) {
    await this.sql`INSERT INTO runs (id, evaluated_at, payload) VALUES (${r.id}, ${r.evaluatedAt}, ${this.j(r)})
      ON CONFLICT (id) DO UPDATE SET evaluated_at = EXCLUDED.evaluated_at, payload = EXCLUDED.payload`;
    await this.sql`DELETE FROM runs WHERE id NOT IN (
      SELECT id FROM runs ORDER BY evaluated_at DESC LIMIT ${MAX_RUNS})`;
  }
  async listRuns(limit = 50) {
    const rows = await this.sql`SELECT payload FROM runs ORDER BY evaluated_at DESC LIMIT ${limit}`;
    return rows.map((r) => r.payload as AssessmentRun);
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

export async function seedFromFixtures(store: Store, fixtures: FixtureSeed): Promise<void> {
  if (!(await store.getPublishedPolicy())) {
    await store.publishPolicy({
      version: fixtures.policy.version,
      policy: fixtures.policy,
      publishedAt: new Date().toISOString(),
      publishedBy: 'fixtures',
      note: 'seeded from fixture policy',
    });
  }
  if ((await store.listLinks()).length === 0)
    for (const l of fixtures.links) await store.upsertLink(l);
  if ((await store.listExceptions()).length === 0)
    for (const e of fixtures.exceptions) await store.upsertException(e);
  if (!(await store.getSources()))
    await store.putSources({
      stripe: fixtures.stripe,
      app: fixtures.app,
      importedAt: new Date().toISOString(),
      origin: 'fixtures',
    });
}
