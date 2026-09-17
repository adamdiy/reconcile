-- Tenancy: project_id scoping on every per-project table + row-level security.

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text UNIQUE NOT NULL,
  payload jsonb NOT NULL
);

-- Application role: never bypasses RLS. Password is set by deploy tooling or
-- left unset for local dev (tests may ALTER ROLE to set one).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reconcile_app') THEN
    CREATE ROLE reconcile_app NOLOGIN NOBYPASSRLS;
  END IF;
  ALTER ROLE reconcile_app NOBYPASSRLS;
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO reconcile_app';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'skipping reconcile_app role setup (insufficient privilege)';
END $$;

ALTER TABLE sources ADD COLUMN IF NOT EXISTS project_id text NOT NULL DEFAULT 'default';
ALTER TABLE policy_versions ADD COLUMN IF NOT EXISTS project_id text NOT NULL DEFAULT 'default';
ALTER TABLE policy_draft ADD COLUMN IF NOT EXISTS project_id text NOT NULL DEFAULT 'default';
ALTER TABLE exceptions ADD COLUMN IF NOT EXISTS project_id text NOT NULL DEFAULT 'default';
ALTER TABLE identity_links ADD COLUMN IF NOT EXISTS project_id text NOT NULL DEFAULT 'default';
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS project_id text NOT NULL DEFAULT 'default';
ALTER TABLE runs ADD COLUMN IF NOT EXISTS project_id text NOT NULL DEFAULT 'default';

DO $$
DECLARE
  t text;
  pk text;
  pkeys jsonb := '{
    "sources": "id",
    "policy_versions": "version",
    "policy_draft": "id",
    "exceptions": "id",
    "identity_links": "account_id",
    "incidents": "fingerprint",
    "runs": "id"
  }';
BEGIN
  FOR t, pk IN SELECT * FROM jsonb_each_text(pkeys) LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_pkey');
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = t || '_project_pkey'
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I PRIMARY KEY (project_id, %I)', t, t || '_project_pkey', pk);
    END IF;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'project_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY project_isolation ON %I USING (project_id = current_setting(''app.project_id'', true))',
        t
      );
    END IF;
  END LOOP;
END $$;
