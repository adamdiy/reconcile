# Reconcile — one-hour hackathon stage

Local demo of the Reconcile spec (`docs/spec.md`). No AWS, no database, no Vercel:
a Next.js dev server evaluates synthetic JSON fixtures with the same
`@reconcile/engine` / `@reconcile/domain` packages intended for production.

## Requirements

- Node 22 (`nvm use 22`, see `.nvmrc`)
- pnpm 10 (`corepack enable`)

## Run

```sh
pnpm install
pnpm build        # builds packages then the Next app
pnpm dev          # serves http://localhost:3000
pnpm test         # engine tests (vitest + fast-check)
pnpm typecheck && pnpm lint
```

## Layout

- `packages/domain` — Zod schemas and types (§4, §7)
- `packages/engine` — pure evaluation: population, canonicalisation, expected vs
  observed, severity, buckets, fingerprints. No I/O.
- `packages/fixtures` — synthetic inventories, links, policy, exceptions, prices
- `packages/ai` — mapping suggester (stub / OpenAI-compatible / Anthropic)
- `apps/web` — Next.js 15 demo UI (overview, incident inbox + detail, account
  view, mapping setup)

## Demo script

1. `pnpm dev`, open http://localhost:3000 — sign in as `admin@local` / `reconcile`
   (seeded admin; password override via `RECONCILE_ADMIN_PASSWORD`). The banner
   marks sources as simulated. Roles: `viewer` (read-only), `reviewer`
   (identity links, exceptions, incident workflow, recheck), `admin`
   (publish policy, manage users/projects).
2. Overview shows the four disjoint buckets, coverage counts, detection envelope.
3. `/incidents` lists mismatches (e.g. `acct_004` unexpected access, `acct_005`
   expected feature missing, `acct_008` duplicate local identity, `acct_010`
   billing-only expected-missing) plus derived low-severity coverage gaps.
4. Open an incident — expected/observed diff, evidence IDs, applicable rule,
   exceptions, confirmation explanation, hypothesis-labelled causes.
5. `/setup/mapping` — "Suggest mapping" uses `OPENAI_API_KEY`+`OPENAI_BASE_URL`
   or `ANTHROPIC_API_KEY` if present, else a deterministic stub (labelled as
   such). "Confirm" upserts the suggestion into the policy draft (`/setup/policy`),
   which only affects results once published.
6. Recheck demo: set `access` to `false` for `acct_004` in
   `packages/fixtures/data/app.json` (or to match expectation), click
   **Import fixtures** (the simulated collector) then **Recheck** — the incident
   resolves with reason `verified_remediated`. Restore the fixture, Import
   fixtures and Recheck again to reopen it as a candidate (confirmed after
   `SETTLING_MINUTES`, default 0 for the demo). Recheck re-evaluates the stored
   sources; only Import fixtures reloads fixture files.

## Optional: Postgres

By default state lives in `apps/web/.reconcile/*.json` via `JsonFileStore`. To run
against Postgres instead:

```sh
docker compose up -d
DATABASE_URL=postgres://reconcile:reconcile@localhost:5432/reconcile pnpm dev
```

`PostgresStore.migrate()` applies `packages/store/sql/001_init.sql` idempotently.
`seedFromFixtures` only seeds empty collections, so your published policies,
links, exceptions and imported sources survive restarts in either backend.

## Optional: real source connectors

Two CLIs can push real inventories into the store via `POST /api/ingest/*`
(see `docs/connectors.md`):

- `reconcile-stripe-sync` (`@reconcile/connectors`) — collects customers and
  subscriptions from the Stripe API when `STRIPE_SECRET_KEY` is set (use a
  test-mode key), or replays the fixtures otherwise.
- `reconcile-collect` (`@reconcile/collector`) — builds an `AppInventory` from
  a Postgres query, a JSON export, or an HTTP endpoint, per a `--config` file.

Ingested sources are marked `connector` on the overview; assessments then run
on live data instead of fixtures.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `SETTLING_MINUTES` | `0` | Minutes a candidate incident must persist before it confirms |
| `DATABASE_URL` | unset | When set, use PostgresStore instead of JSON files |
| `RECONCILE_STATE_DIR` | `apps/web/.reconcile` | JSON store directory |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` | unset | Enable the OpenAI-compatible mapping suggester |
| `ANTHROPIC_API_KEY` | unset | Enable the Anthropic mapping suggester |
| `RECONCILE_INGEST_TOKEN` | unset | Bearer token required on `/api/ingest/*`; when unset, only localhost is accepted (with a warning) |
| `STRIPE_SECRET_KEY` | unset | `reconcile-stripe-sync`: collect via the Stripe API instead of fixtures |
| `RECONCILE_URL` | `http://localhost:3000` | Base URL the CLIs post inventories to |
| `APP_DATABASE_URL` | unset | Referenced by collector configs as `env:APP_DATABASE_URL` |
| `RECONCILE_SESSION_SECRET` | dev default | HMAC key for session cookies — set in any shared deployment |
| `RECONCILE_ADMIN_PASSWORD` | `reconcile` | Password for the seeded `admin@local` user |
