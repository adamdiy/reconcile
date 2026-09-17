-- Audit baselines: frozen assessment snapshots for migration comparison.

CREATE TABLE IF NOT EXISTS audit_baselines (
  project_id text NOT NULL,
  id text NOT NULL,
  name text NOT NULL,
  note text,
  created_at timestamptz NOT NULL,
  created_by text NOT NULL,
  policy_version text NOT NULL,
  engine_version text NOT NULL,
  source_observed_at jsonb NOT NULL,
  counts jsonb NOT NULL,
  assessments jsonb NOT NULL,
  CONSTRAINT audit_baselines_project_pkey PRIMARY KEY (project_id, id)
);
ALTER TABLE audit_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_baselines FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'audit_baselines' AND policyname = 'project_isolation'
  ) THEN
    CREATE POLICY project_isolation ON audit_baselines
      USING (project_id = current_setting('app.project_id', true));
  END IF;
END $$;
