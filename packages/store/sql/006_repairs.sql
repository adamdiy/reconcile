-- Reviewed repairs: admin-configured commands and four-eyes repair actions.

CREATE TABLE IF NOT EXISTS repair_commands (
  project_id text NOT NULL,
  id text NOT NULL,
  payload jsonb NOT NULL,
  CONSTRAINT repair_commands_project_pkey PRIMARY KEY (project_id, id)
);
ALTER TABLE repair_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_commands FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'repair_commands' AND policyname = 'project_isolation'
  ) THEN
    CREATE POLICY project_isolation ON repair_commands
      USING (project_id = current_setting('app.project_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS repair_actions (
  project_id text NOT NULL,
  id text NOT NULL,
  state text NOT NULL,
  payload jsonb NOT NULL,
  CONSTRAINT repair_actions_project_pkey PRIMARY KEY (project_id, id)
);
CREATE INDEX IF NOT EXISTS repair_actions_project_state_idx ON repair_actions (project_id, state);
ALTER TABLE repair_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_actions FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'repair_actions' AND policyname = 'project_isolation'
  ) THEN
    CREATE POLICY project_isolation ON repair_actions
      USING (project_id = current_setting('app.project_id', true));
  END IF;
END $$;
