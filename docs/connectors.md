# Connectors and collector

Sources land in the store as a `SourceSnapshot` (`origin: 'fixtures' | 'connector'`,
tracked per side). All pages evaluate whatever is stored — Recheck re-evaluates
stored sources; only "Import fixtures" re-reads `packages/fixtures/data`.

## Ingest API

```
POST /api/ingest/stripe   body: StripeInventory
POST /api/ingest/app      body: AppInventory
Authorization: Bearer $RECONCILE_INGEST_TOKEN
```

- When `RECONCILE_INGEST_TOKEN` is set, the bearer token is required.
- When unset, requests are only accepted from localhost (host header), with a
  warning logged — convenient for local development, do not expose the app
  publicly without the token.
- Bodies are Zod-validated. A snapshot whose `observedAt` is older than the
  stored one for that side is rejected with `409 stale snapshot`.
- A successful ingest runs a recorded assessment and returns
  `{ ok, runId, counts }`.

## reconcile-stripe-sync (`@reconcile/connectors`)

Paginates `customers.list` and `subscriptions.list({status: 'all'})` and maps
them to a `StripeInventory`. Permission errors are recorded in
`permissionsMissing` (inventory stays `complete`); any other page failure marks
`complete: false`.

```sh
pnpm -r --filter './packages/*' build
STRIPE_SECRET_KEY=sk_test_... \
  pnpm --filter @reconcile/connectors exec reconcile-stripe-sync
# or write the raw inventory instead of pushing:
... reconcile-stripe-sync --out stripe-inventory.json
```

Without `STRIPE_SECRET_KEY` it replays the fixture inventory — useful for
smoke-testing the ingest path with no Stripe account. Pass `archiveDir` to
`StripeApiConnector` to archive each raw list page under
`archive/<runId>/<resource>-<page>.json` as immutable evidence.

## reconcile-collect (`@reconcile/collector`)

Runs on the customer's side against their own database/export — read-only.
Config file (`--config collector.json`), validated by `CollectorConfigSchema`:

```jsonc
// Postgres view/query — one row per (account, billing record)
{
  "source": "sql",
  "connection": "env:APP_DATABASE_URL",
  "query": "select * from billing_access_view",
  "columns": {
    "accountId": "id",
    "stripeCustomerIds": "stripe_customer_id",
    "localBillingRecords": {
      "localId": "sub_row_id",
      "stripeSubscriptionId": "stripe_sub_id",
      "status": "sub_status"
    },
    "access": { "reports": "can_reports", "exports": "can_exports" }
  }
}

// JSON file — either an AppInventory document, or {"rows": [...]} mapped with
// the same columns block
{ "source": "json", "path": "export.json", "columns": { "...": "..." } }

// HTTP endpoint returning the same flat rows JSON
{ "source": "http", "url": "https://internal.example.com/access-export",
  "headers": { "authorization": "Bearer ..." }, "columns": { "...": "..." } }
```

Multiple rows per `accountId` fold into one `AccountObservation`. Output:

```sh
reconcile-collect --config collector.json --out app-inventory.json   # write
reconcile-collect --config collector.json --push                     # POST ingest
reconcile-collect --config collector.json                            # stdout
```

## Security note

Both CLIs only read source systems (Stripe read scopes; a read-only DB role is
recommended for the SQL collector) and push to the app. The customer runs
`reconcile-collect` inside their own environment, so credentials and the flat
row export never leave their infrastructure except as a Zod-validated
`AppInventory` over the ingest endpoint — protect it with
`RECONCILE_INGEST_TOKEN` in any shared deployment.
