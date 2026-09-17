-- Cached AI advisory explanations, per project, keyed by
-- <fingerprint>:<engineVersion>:<sha256(sorted evidenceIds)>.

CREATE TABLE IF NOT EXISTS explanations (
  project_id text NOT NULL,
  key text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT explanations_project_pkey PRIMARY KEY (project_id, key)
);
ALTER TABLE explanations ENABLE ROW LEVEL SECURITY;
ALTER TABLE explanations FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'explanations' AND policyname = 'project_isolation'
  ) THEN
    CREATE POLICY project_isolation ON explanations
      USING (project_id = current_setting('app.project_id', true));
  END IF;
END $$;
