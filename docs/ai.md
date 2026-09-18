# AI assistance (advisory only)

Reconcile uses AI in two places — incident explanations and exception drafts —
plus price→capability mapping suggestions. Everything AI produces is advisory:

- AI output never changes reconciliation results.
- AI output never authorizes access.
- Nothing persists from an AI step by itself: a human must click Save/Confirm.
- Incident explanations are cached, not recomputed, and are labelled with the
  provider, model and generation time. Every explanation UI carries the banner
  "Advisory: AI output does not change results or authorize access."

## Providers

`RECONCILE_AI_PROVIDER` selects the provider; absent a key the app falls back to
the deterministic stub (canned suggestions — every surface that uses AI shows a
stub banner).

| Provider | Env vars |
| --- | --- |
| `stub` (default) | none — deterministic, offline |
| `openai` | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` (default `gpt-4o-mini`) |
| `anthropic` | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (default `claude-haiku-4-5`) |

`/settings/ai` shows the resolved provider, model and whether credentials are
configured; admins can hit "Test provider" for a one-line round trip.

## Grounding guard

Provider-agnostic, enforced in `@reconcile/ai` for every provider:

- Model output is Zod-validated (`IncidentExplanation`, `ExceptionDraft`).
- Any hypothesis citing an `evidenceId` that was not in the input is dropped;
  if none remain, the output is rejected with a `GroundingError`.
- Exception drafts that cite an `accountId` or capability not in the input are
  rejected with a `GroundingError`.
- Malformed JSON from a provider surfaces as a typed error, never a crash.

## Explanation cache

`explainIncident` results are stored per project, keyed
`<fingerprint>:<engineVersion>:<sha256(sorted evidenceIds)>`, so a second click
is free and a stale engine never serves old prose. JSON adapter:
`explanations.json`; Postgres: `004_ai.sql` `explanations` table (RLS-scoped).

## MCP: read-only evidence access

`@reconcile/mcp` exposes a stdio MCP server for AI clients to inspect a project.
All tools are strictly read-only — no mutations exist:

```
reconcile-mcp --project default
```

Tools: `list_incidents`, `get_incident`, `get_account`, `get_coverage`,
`list_runs`, `get_published_policy`, `list_exceptions`. Resources:
`reconcile://incident/<fingerprint>`, `reconcile://account/<accountId>`.

Client config (Claude Desktop / Cursor):

```json
{
  "mcpServers": {
    "reconcile": {
      "command": "node",
      "args": ["/path/to/reconcile/packages/mcp/bin/reconcile-mcp.js", "--project", "default"],
      "env": { "RECONCILE_STATE_DIR": "/path/to/.reconcile" }
    }
  }
}
```

Use `DATABASE_URL` instead of `RECONCILE_STATE_DIR` when the project lives in
Postgres — the server reads through the same store adapter as the web app.
