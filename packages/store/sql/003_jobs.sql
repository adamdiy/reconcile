-- Durable jobs, schedules, notification rules, webhook event dedupe.

CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  run_after timestamptz NOT NULL,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_lease_idx ON jobs (status, run_after);
CREATE INDEX IF NOT EXISTS jobs_idem_idx ON jobs (idempotency_key);

CREATE TABLE IF NOT EXISTS schedules (
  project_id text PRIMARY KEY,
  payload jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_rules (
  project_id text NOT NULL,
  id text NOT NULL,
  payload jsonb NOT NULL,
  CONSTRAINT notification_rules_project_pkey PRIMARY KEY (project_id, id)
);
ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_rules FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notification_rules' AND policyname = 'project_isolation'
  ) THEN
    CREATE POLICY project_isolation ON notification_rules
      USING (project_id = current_setting('app.project_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS webhook_events (
  project_id text NOT NULL,
  event_id text NOT NULL,
  received_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  CONSTRAINT webhook_events_project_pkey PRIMARY KEY (project_id, event_id)
);

CREATE TABLE IF NOT EXISTS worker_state (
  id text PRIMARY KEY,
  payload jsonb NOT NULL
);
