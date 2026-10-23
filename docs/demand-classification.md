# Demand classification (Step 8)

From **Forecasts → Classify demand**, an owner, administrator or planner selects an active location and inclusive date window, reviews editable thresholds and confirms complete sales history. The queued worker publishes versioned per-item results. Members can inspect results; branch users see only assigned locations. Readiness checks remain available when completeness cannot be confirmed.

## Approved interpretation

The owner approved daily sold-demand classification on 2026-10-15. Missing dates count as zero only after explicit confirmation for the selected location/window. This is a planner attestation, not a completeness test. Lost sales are reported separately and never added to sold demand.

Each run includes all current catalog items, including discontinued items with historical demand. The observation interval is the intersection of the requested window with the item's recorded introduction and discontinuation dates (both inclusive). Unknown lifecycle dates use the window bounds. Demand outside that intersection is excluded. Results retain the recorded status, lifecycle dates, last positive sale **within the observed interval**, and days since that sale measured at the requested window end. An absent last sale means unknown; it does not establish obsolescence.

This release does not infer lifecycle stages, aggregate supersessions/interchanges, choose forecasts or change inventory policies.

## Method `daily-v1`

Let `n` be observed calendar days, `k` positive-sales days, `Q` sold quantity and `S2` the sum of squared daily sold quantities. Population variance is used. The unique daily demand key means one row per item/location/date. Sufficient statistics include implicit zeros without expanding the catalog into a dense item-by-day grid.

| Measure           | Definition / default                                      |
| ----------------- | --------------------------------------------------------- |
| ADI               | `n / k`; boundary 1.32                                    |
| Positive-size CV² | `(k × S2 − Q²) / Q²`; boundary 0.49                       |
| Daily CV          | `sqrt((n × S2 − Q²) / Q²)`; includes zero days            |
| ABC value         | `Q × current unit cost`, captured at input snapshot time  |
| ABC shares        | A: 80%, B cumulative: 95%; ranked separately per currency |
| XYZ               | X: daily CV ≤ 0.5; Y: daily CV ≤ 1.0; Z: above 1.0        |

For at least two positive days, ADI below its boundary and CV² below its boundary means **smooth**; low ADI/high CV² means **erratic**; high ADI/low CV² means **intermittent**; both high means **lumpy**. Equality belongs to the high category. These defaults follow the ADI/CV² categorization described by [Syntetos, Boylan and Croston (2005)](https://www.tandfonline.com/doi/abs/10.1057/palgrave.jors.2601841); they are editable policy settings, not universal optimal thresholds.

Zero exposure days produce **Outside recorded lifecycle**. Zero positive days produce **No sales**. One positive day produces **Insufficient positive days**, with ADI available but no CV² or XYZ label. XYZ is unknown in these three cases. No-sale items and zero-cost items have zero value and ABC **No value**.

ABC sorts descending value within currency. Classification uses cumulative value **before** the equal-value group: a group crossing a threshold stays in the higher category, and all equal-value items stay together. Thus a currency with only two equally valuable items assigns both A. Currency totals are never converted or combined. ABC applies even when there are too few positive days for a pattern classification.

Thresholds allow up to six decimal places; ADI must be at least 1, all thresholds must be positive and at most 1,000,000, `0 < A < B < 1`, and `0 < X < Y`. The RPC canonicalizes numerically equal strings for idempotency. Python uses 60-digit decimal arithmetic, with exact squared comparisons for XYZ boundaries. Stored metrics/value are decimal strings; the UI displays up to three fractional digits without converting those strings through binary floats.

## Reproducibility, access and limits

At first processing, one SQL statement captures catalog identity, cost, lifecycle and demand statistics in private `planning.classification_inputs`. Retries reuse it even if imports or catalog edits occur. The run stores the thresholds, confirmation, requester and method; results store captured item code/name/currency and the input statistics alongside computed metrics. Inputs are captured at processing time, not queue time. The snapshot timestamp is saved in the run result.

Publication validates that output IDs exactly match the captured items, then writes all rows, marks success and archives the message atomically. The existing token and expiry fence canceled/replaced workers. Terminal completion, cancellation or failure removes private staging. Historical results remain after item deletion or recoding; `item_id` is a snapshot identity rather than a live foreign key. The composite run/location/organization foreign key and tenant/branch RLS bind each result to its original scope. API roles cannot write results or access private snapshots; the worker has function capabilities only.

Limits: 50,000 catalog items, 1,096 inclusive days, one active run per organization, 20 new runs per rolling 24 hours. Results paginate at 50 rows with a demand-pattern filter. Existing 120-second leases, 90-second SQL statement timeout and three-attempt retry bound remain. Larger/slower jobs fail visibly; these limits are technical bounds rather than a production throughput guarantee.

A local rollback-only benchmark on 2026-10-15 captured 50,000 items and 100,000 demand rows in 9.7 seconds, calculated in 2.4 seconds and published in 34.5 seconds. This exercises the catalog limit with sparse history; production volumes and hardware still require measurement.

## Verification

- Python examples and a dense-series variance oracle cover all patterns, threshold equality, separate currency ranking, tied values and decimal precision.
- Database integration tests verify immutable retry inputs after source deletion, wrong output IDs, stale tokens and dispatch compatibility.
- pgTAP covers tenant/branch visibility, API write denial, worker privileges, threshold validation, confirmation, lifecycle clipping, idempotency and cancellation cleanup. The global privilege snapshot includes every new function/table.
- Action tests reject missing confirmation, invalid thresholds and unauthorized/stale forms. The production-browser test queues a confirmed run, executes the local worker, inspects value/lost-sales/lifecycle evidence and filters results.

## Owner-run rollout and rollback

1. Stop existing workers before upgrading. Review `20261015110000_demand_classification.sql` and apply it yourself with `pnpm exec supabase db push`. This task does not change the hosted database.
2. Upgrade the worker to this revision and run `uv sync --locked`. The existing dedicated login inherits two additional capabilities through `zeespare_worker`: `app.planning_task` and `app.classification_finish`. Start the upgraded worker before deploying the web form. No credentials or hosted workers are provisioned here.
3. Deploy the web build using the existing process. Queue a small confirmed-history run; verify its method, scope, evidence and attempt count. Also verify an ordinary readiness check.
4. For rollback, stop workers and cancel unwanted active classifications through the current web version. Revert the web application and worker together, preserving schema/history. The old worker can still execute readiness jobs, but classification jobs deliberately fail its dispatch guard. Do not leave old workers consuming classification jobs. Destructive schema rollback requires a separate reviewed migration.
