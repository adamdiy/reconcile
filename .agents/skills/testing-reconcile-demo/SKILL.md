---
name: testing-reconcile-demo
description: Run fixture-backed Reconcile demo browser checks, including incident remediation and mapping draft persistence.
---

# Runtime setup
- Use the repo blueprint for Node 22, pnpm 10, dependency installation and `pnpm dev`.
- Reuse a healthy localhost:3000 server when present; no authentication is required.
- Before asserting fixture scenarios, compare the current clock with inventory timestamps, policy freshness, grace windows and exception expiries. Absolute fixture dates can age out; do not silently claim stale data proves mismatch behavior.
- Determine the running Next process working directory before checking `.reconcile` files: persistence is currently relative to `process.cwd()`. Workspace startup can place files under `apps/web/.reconcile`, not repo root.

# Browser checks
- Overview → Recheck re-evaluates the stored sources; **Import fixtures** (simulated collector) reloads fixture files into the store. To pick up edited fixture JSON, click Import fixtures first, then Recheck. Navigating dynamic pages also reevaluates; default zero-minute settling can confirm candidates before they are visually captured.
- Incident inbox check/severity/state selects combine filters; account links and check links lead to different pages.
- Choose an account with exactly one feature mismatch for remediation so fixing one flag also changes account bucket totals. `acct_005` exports is an example in the original fixtures.
- Change only that fixture flag, click Import fixtures then Recheck, verify resolved `verified_remediated`, reload, and inspect account access. Incident detail retains the historical mismatch snapshot; current access is shown on the account page.
- Restore only your fixture changes, Import fixtures then Recheck, verify reopening and unchanged tracked files; leave the server running when requested.
- Mapping setup → Suggest mapping → Confirm into draft writes a draft, not the published fixture policy. Verify draft UI and file after reload.

## Devin Secrets Needed
- None for local fixture and deterministic stub tests.
- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` only if explicitly testing a real provider; absent keys intentionally select the stub.
