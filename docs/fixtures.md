# Fixture data intent

`packages/fixtures/data` holds a synthetic Stripe inventory, a synthetic application
inventory, reviewed identity links, a hand-written policy, exceptions and a price list.
Timestamps are absolute ISO instants in August–September 2026; the web app passes
`evaluatedAt = new Date()`, so these fixtures keep working for several weeks after
17 September 2026 (grace window is 720 h, freshness threshold is 2880 min).

| Subject | Intent |
|---|---|
| acct_001 / cus_001 | Clean paid match: active `price_pro`, all access granted |
| acct_002 / cus_002 | Trial match: `trialing` with `trialEnd` 2026-09-28 (scheduled transition) |
| acct_003 / cus_003 | `past_due` inside grace on `price_basic`; unexpired exception `ex_001` grants `exports` |
| acct_004 / cus_004 | `past_due` outside grace but access still on — true mismatch (unexpected feature enabled) |
| acct_005 / cus_005 | Active `price_pro` scheduled to cancel 2026-10-10; `exports` observed false — expected feature missing; `ex_002` is expired and does not apply |
| acct_006 / cus_006 | Active sub but app observation is stale (2026-08-25) — `stale_evidence` |
| acct_007 / cus_007 | Collector reports `cus_007` but no reviewed link — `unmapped_identity` coverage gap |
| acct_008 / cus_008 | Two `localBillingRecords` share `sub_008` — `duplicate_local_identity` integrity finding |
| acct_009 / cus_009 | Multi-item subscription — `unsupported_billing_model` |
| acct_010 / cus_010 | Billing-only: reviewed link + active sub, but account absent from the complete app inventory — expected/observed mismatch (expected missing) |
| acct_011 / cus_011 | Zero-value (`price_free`, 100% coupon) account — matches, `zero_value` flagged in evidence |

`price_addon` appears only inside the unsupported multi-item subscription and is
deliberately unmapped to exercise `unsupported_billing_model` before
`unsupported_policy`.
