# Operations

Reconcile runs a durable job queue, scheduled assessments, notifications, and
Stripe webhook ingestion — all local-first with no external dependencies.

## Jobs and the worker

Jobs live in the store (root level, spanning projects):

| Kind | What it does |
|---|---|
| `assess` | Runs `runAssessment({ record: true })` for the project |
| `stripe_sync` | Collects Stripe via `createStripeConnector()` and merges into sources |
| `notify` | Sends one notification via the rule's channel |
| `digest` | Builds the coverage/health digest and sends it to all enabled rules |

Leasing is atomic — `UPDATE … FOR UPDATE SKIP LOCKED` on Postgres, a directory
lock on the JSON store. Failed jobs retry with exponential backoff
(`1m · 2^attempts`, jittered) up to `maxAttempts` (5), then go `dead`.

- Dev: the worker runs inside the Next dev process (started lazily by the root
  layout; disable with `RECONCILE_EMBEDDED_WORKER=0`).
- Standalone: `pnpm --filter @reconcile/jobs exec reconcile-worker` (add `--once`
  for a single tick, useful in CI/tests).

## Schedules

Per-project schedule (`/jobs`, admin-editable): `scanIntervalMinutes` (default
1440 = daily), `digestHour` (UTC), `enabled`. Every worker tick calls
`planSchedules`, which enqueues:

- `assess` for the current interval bucket — key `assess:<project>:<bucket>`
- a targeted `assess` at the latest run's `nextTransitionAt` — key
  `assess:<project>:transition:<iso>`
- `digest` once per day after `digestHour` — key `digest:<project>:<date>`

Scheduled keys dedupe against any existing job (including completed), so a
finished job is never re-enqueued within the same bucket. "Run assessment now"
on `/jobs` enqueues a manual job with a unique key.

## Notification rules

Admin-managed at `/settings/notifications`, stored per project. A rule has a
channel (`slack`, `email`, `outbox`), a `target` (webhook URL / address /
`env:NAME` reference — secrets stay in env), `checkKinds`, `minSeverity`, and
`states` (matched against the new state, or `resolutionReason` for resolved
incidents — e.g. `verified_remediated`).

After each recorded assessment, incident state transitions matching a rule
enqueue a `notify` job (`notify:<rule>:<fingerprint>:<to>:<transitionAt>`).
Snoozed and accepted-risk incidents never notify.

Channels:

- `slack` — POSTs `{text, blocks}` to the target URL.
- `email` — sends via `SMTP_URL` (nodemailer); `target` is the recipient.
- `outbox` — writes one JSON file per notification to
  `<RECONCILE_STATE_DIR>/outbox/`. This is the default when nothing is
  configured; `/notifications` lists the outbox so the demo shows what would
  have been sent.

## Stripe webhooks

`POST /api/webhooks/stripe` verifies the signature with
`STRIPE_WEBHOOK_SECRET` — the route returns 503 when the secret is unset
(unsigned webhooks are never accepted). Events are deduped by `event.id`
(`webhook_events` collection, per `?project=`); replays return
`{ok: true, duplicate: true}` without a second job. For
`customer.subscription.*`, `invoice.payment_failed`, `invoice.paid`, and
`customer.deleted` a `stripe_sync` job is enqueued.

Local testing:

```sh
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# copy the printed whsec_… into STRIPE_WEBHOOK_SECRET and restart
```

## Metrics

`/metrics` renders coverage % and open-incidents sparklines (from `listRuns`),
source staleness (`observedAt` age per side), median detection latency (incident
`createdAt` − source `observedAt`, last 30 days), the unknown-reason breakdown,
and job health (queued/running/dead + last worker tick).
