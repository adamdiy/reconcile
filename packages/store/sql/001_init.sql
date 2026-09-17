CREATE TABLE IF NOT EXISTS sources (
  id integer PRIMARY KEY,
  payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS policy_versions (
  version text PRIMARY KEY,
  published_at timestamptz NOT NULL,
  published_by text NOT NULL,
  note text,
  payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS policy_draft (
  id integer PRIMARY KEY,
  payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS exceptions (
  id text PRIMARY KEY,
  payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS identity_links (
  account_id text PRIMARY KEY,
  stripe_customer_id text NOT NULL,
  reviewed boolean NOT NULL
);
CREATE TABLE IF NOT EXISTS incidents (
  fingerprint text PRIMARY KEY,
  payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id text PRIMARY KEY,
  evaluated_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);
