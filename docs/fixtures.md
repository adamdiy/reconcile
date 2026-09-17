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
| acct_008 / cus_008 | Team plan: seat price `price_team_seat` qty 5, `seatsUsed` 7 — `seats_over_cap` (plus a `duplicate_local_identity` integrity finding on `sub_008`) |
| acct_009 / cus_009 | Multi-item (`price_pro` + unmapped `price_addon` + metered `price_api_calls`); app usage 12,000 vs Stripe records 9,000 (tolerance 5%) — `usage_not_billed` |
| acct_010 / cus_010 | Billing-only: reviewed link + active `price_pro` sub, but account absent from the complete app inventory — expected/observed mismatch (expected missing) |
| acct_011 / cus_011 | Zero-value (`price_free`, 100% coupon) account — matches, `zero_value` flagged in evidence |
| acct_012 / cus_012 | `paused` subscription grants no access but access is still enabled — `unexpected_feature_enabled` mismatch |
| acct_013 / cus_013 | Metered `price_api_calls` only; app usage present but Stripe has no usage records — usage check unknown `not_observed`; capabilities unknown `unsupported_policy` |

`price_addon` appears only inside acct_009's multi-item subscription and is
deliberately unmapped: an unmapped item yields `unsupported_policy` unknown only
for capabilities not already granted by a mapped item, and Pro grants all of
them — so acct_009 fully matches.
