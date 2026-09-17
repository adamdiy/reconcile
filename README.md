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

1. `pnpm dev`, open http://localhost:3000 — banner marks sources as simulated.
2. Overview shows the four disjoint buckets, coverage counts, detection envelope.
3. `/incidents` lists mismatches (e.g. `acct_004` unexpected access, `acct_005`
   expected feature missing, `acct_008` duplicate local identity, `acct_010`
   billing-only expected-missing) plus derived low-severity coverage gaps.
4. Open an incident — expected/observed diff, evidence IDs, applicable rule,
   exceptions, confirmation explanation, hypothesis-labelled causes.
5. `/setup/mapping` — "Suggest mapping" uses `OPENAI_API_KEY`+`OPENAI_BASE_URL`
   or `ANTHROPIC_API_KEY` if present, else a deterministic stub (labelled as
   such). "Confirm" writes `apps/web/.reconcile/policy-draft.json` and diffs it against
   the published fixture policy.
6. Recheck demo: set `access` to `false` for `acct_004` in
   `packages/fixtures/data/app.json` (or to match expectation), click Recheck on
   the overview or the incident detail — the incident resolves with reason
   `verified_remediated`. Restore the fixture and Recheck again to reopen it as
   a candidate (confirmed after `SETTLING_MINUTES`, default 0 for the demo).
