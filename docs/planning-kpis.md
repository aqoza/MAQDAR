# Planning KPI foundation (Step 12b)

Owner-approved on 2026-10-16 after review and merge of PR #18 (`c16d915`): observed stock availability, currency-separated inventory value, snapshot freshness/coverage, and searchable saved forecast metrics. This increment is read-only.

## Acceptance

| Criterion | Behavior                                                                                                                                          | Verification                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| AC-001    | Reporting-date/location filters show observed availability with numerator and denominator, missing/stale coverage, and currency-separated values. | SQL and browser tests for positive, zero, overallocated, missing, stale and future snapshots. |
| AC-002    | Members search, filter and page saved forecast metrics, inspect model-selection windows, and follow source evidence links.                        | Unit filters, exact-decimal tests, SQL projections and production browser navigation.         |
| AC-003    | Coverage identifies its own evaluation model, window and denominator. Prepared groups retain their fixed-group interpretation.                    | Different selection/evaluation model fixtures, missing evidence and saved-unit checks.        |
| AC-004    | Tenant, active-organization and branch access protect every summary and result. KPIs create no business writes or jobs.                           | pgTAP tenant/role matrix, privilege snapshot and separate browser session.                    |
| AC-005    | Existing dashboard, forecasts and policy reviews remain compatible.                                                                               | Regression suites and bounded dashboard scale check.                                          |

## Stock metrics

The dashboard defaults to today's date in the organization's configured time zone. A date filter selects an earlier reporting day; malformed or future URL dates use today. Location accepts an exact visible active location code; blank means all visible locations. Unknown, inactive or inaccessible codes receive the same not-found response.

The stock cohort is the **current** non-discontinued item catalog crossed with active visible locations. Selecting an earlier date does not reconstruct a historical catalog. For each pair, use its latest snapshot on or before the reporting day. Availability is the number with `quantity - allocated_quantity > 0` divided by the observed pair count. Show both counts. Zero observations means unavailable; it never means 0% availability. Missing pairs remain unknown. This is snapshot availability, not order fill rate or achieved cycle service.

Snapshots strictly more than seven calendar days old are flagged and remain included; the oldest included date is visible. Stock-outs include observed zero and negative available quantities. Inventory value uses physical quantity times the supplied snapshot unit cost, separately by currency, without FX conversion. Decimal strings remain exact until display rounding to three places. All pair counts and valuation obey the selected location and branch scope.

The accompanying 30-day demand trend follows the date and location filters while preserving the existing demand contract: recorded sold and lost sales remain separate, and inactive historical items/locations remain included when readable. Data coverage does not imply every item should be stocked everywhere.

## Saved forecast quality

**Dashboard → Saved forecast quality** and **Forecasts → Saved forecast quality** open `/forecasts/quality`. Search uses normalized saved item code/name tokens. Filters cover location code, result status, selected model and forecast method. Pages have 25/50/100 rows, ordered by run completion time and a stable result UUID; paging from the nearer end preserves the same order. Each item code links to its saved forecast evidence.

The displayed RMSE, MAE and signed bias are the selected model's saved rolling comparison scores. Positive bias is forecast minus sold actuals and means overforecast. The scores helped select the model, so they are not an independent evaluation or realized future performance. Raw error metrics are not averaged across items or groups. Missing metrics display a dash, not zero. The history range, forecast horizon and individual training/test windows remain inspectable.

Prepared groups keep their saved unit label and `fixed-group-v1` interpretation: relationships and conversions remain fixed across comparisons, while each demand fit uses its training prefix. New individual forecasts show a unit only when every captured demand row supplies the same label; older or partly unlabeled forecasts remain unknown. No label is inferred from the live catalog. Saved identities remain readable after item changes/deletion. See [stock-comparison.md](stock-comparison.md) for the source-unit contract.

Held-out interval coverage is a separate historical exercise. It selected/calibrated its own model before its held-out window; its model may differ from the final model. The view shows that evaluation model, training cutoff, test dates, day count and observed coverage of the 80%/95% daily bands. Missing/insufficient evidence stays explicit. Sparse demand and short windows limit interpretation; coverage does not establish a future service guarantee.

## Persistence, limits and rollout

`dashboard_kpis` is a security-invoker RPC; `forecast_quality` is a security-invoker view over existing saved results, successful forecast runs and locations. The original `dashboard_summary` interface is unchanged. The compact quality projection omits daily forecasts, demand arrays and bootstrap bands. Session clients always filter the active organization, and underlying RLS also applies to direct calls. No worker or service-role privilege, scheduled job, mutable metric table or new dependency is added.

The forecast list uses bounded page payloads and exact counts, with normalized search computed from saved identities. This is not a scale claim for unbounded forecast archives; larger archives may need an indexed projection in a later migration. The existing 50,000-item/40-location stock benchmark is a bounded local check, not a production latency guarantee.

After review, the owner applies `20261015211931_planning_kpis.sql` with `pnpm exec supabase db push`, then deploys the web build. Workers need no update. Rollback reverts the web build first and retains the additive RPC/view; removal uses a reviewed forward migration. This task applies migrations only to the local stack.

Excess/obsolete quantities, realized forecast monitoring, fill-rate metrics and automatic policy activation remain outside this release. Excess comparison needs trustworthy stock/forecast unit provenance and explicit policy/date selection; no previous policy is silently applied to today's stock. Full verification results are recorded in the pull request.
