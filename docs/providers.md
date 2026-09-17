# Providers

Reconcile reads billing state through a provider connector and, optionally,
access state through an authorization adapter. Everything runs on fixtures with
no credentials; the external adapters are implemented against the public REST
APIs and are **untested against live APIs** — treat them as reference
implementations to validate against a sandbox before production use.

## Billing providers

Select with `RECONCILE_BILLING_PROVIDER` (`stripe` default, `chargebee`, `paddle`).
All providers emit the same `BillingInventory` shape (`StripeInventory`, provider
field tagged); the engine never sees which provider produced it.

| Provider | Env | Notes |
|---|---|---|
| stripe | `STRIPE_SECRET_KEY` | Official SDK; paginates customers/subscriptions, fetches metered usage-record summaries. |
| chargebee | `CHARGEBEE_SITE`, `CHARGEBEE_API_KEY` | REST v2 offset pagination. Status map: `in_trial→trialing`, `active→active`, `non_renewing→active+cancelAtPeriodEnd`, `paused→paused`, `cancelled→canceled`, `future→incomplete`. `firstFailedInvoiceDueAt` is unset (the subscription payload exposes `due_invoices_count`, not a due timestamp). |
| paddle | `PADDLE_API_KEY`, `PADDLE_ENV` (`sandbox`/`production`) | Billing API cursor pagination. Status map: `trialing`, `active`, `past_due`, `paused`, `canceled`; `scheduled_change` maps cancel→`cancelAt`, pause→`pauseCollection`. |

Permission errors (401/403, or Stripe `more_permissions_required`) degrade to
`permissionsMissing`; other failures mark the inventory `complete=false`.

CLI: `reconcile-sync` honours `RECONCILE_BILLING_PROVIDER` the same way the web
`stripe_sync` job does.

## Authorization adapters (app-side access)

A collector source with `source: 'authz'` builds `AccountObservation`s by asking
an adapter `{subject, resource, action}` per configured capability. Config shape:

```jsonc
{
  "source": "authz",
  "adapter": "http",            // http | openfga | launchdarkly | auth0 | fixture
  "config": { "url": "env:AUTHZ_URL", "headers": "{...}" },
  "subjects": {                 // any existing source kind, yielding accountId+subject
    "source": "json", "path": "subjects.json",
    "columns": { "accountId": "acct", "subject": "subj" }
  },
  "capabilities": [{ "capability": "reports", "resource": "reports", "action": "read" }]
}
```

- `http`: POST `{subject,resource,action}` → `{allowed: boolean}`; non-2xx/timeouts → `unknown`.
- `openfga`: POST `/stores/{id}/check` with `tuple_key {user: subject, relation: action, object: resource}`.
- `launchdarkly`: `variation(`${resource}:${action}`, {kind:'user',key:subject})`; requires `@launchdarkly/node-server-sdk`.
- `auth0`: Management API `GET /api/v2/users/{id}/permissions` (paginated); a capability is granted iff `resource:action` (or `action`) is in the permission set.
- `fixture`: in-process map for demos/tests.

`config` values may be `env:NAME` references resolved at collection time.
Unknown results omit the access key (engine reads missing keys as
`not_observed`); the inventory is `complete` only when every check was definite.
Checks run with concurrency 8.

## Reviewed repairs

See `/repairs` and `/settings/repairs` in the app. A repair command is the
customer's own endpoint — Reconcile never mutates the app directly. Templates
interpolate `{{accountId}} {{capability}} {{desired}} {{idempotencyKey}}`; HTTP
commands get an `Idempotency-Key` header. The seeded `rc_demo_grant` command is
`local_outbox` (writes `repairs-outbox.jsonl`); pointing `http` commands at a
real endpoint is the customer's choice. Verification window:
`RECONCILE_REPAIR_VERIFY_MINUTES` (default 30).
