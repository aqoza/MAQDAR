# Inventory policies (Step 11)

Owner-approved on 2026-10-15: saved recommendations from selected individual or prepared-group forecasts, an editable 95% cycle-service target, a planner-entered fixed calendar-day lead time, and a seven-day default review interval. Method: `policy-v1`.

## Acceptance

| Criterion | Observable outcome                                                                                                                                                                                                                  | Verification                             |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| AC-001    | An editor selects a successful forecast result and supplies lead time, review interval and service target. Invalid, foreign, stale-organization and unauthorized requests create no run.                                            | Action tests, pgTAP, browser             |
| AC-002    | The forecast covers lead time plus review interval. Saved forecast/history, group membership and units remain fixed across retries and live catalog edits.                                                                          | Database integration                     |
| AC-003    | Results show lead-time demand, safety stock and reorder-point reference, plus protection-period demand, safety stock and periodic order-up-to maximum. Higher service targets cannot reduce thresholds for the same saved forecast. | Numerical oracles and monotonicity tests |
| AC-004    | Calibration uses saved history and the saved selected model's original training prefixes. Too few residuals, all-zero history, unsupported scale and calibration failure are explicit, with no invented policy values.              | Numerical boundary/failure tests         |
| AC-005    | Results and evidence retain tenant/branch isolation. Expired, replaced and canceled leases cannot publish; retries reuse immutable inputs.                                                                                          | pgTAP, worker integration                |
| AC-006    | A planner queues from a forecast, follows run progress and inspects the policy, source link, assumptions and calibration errors. Existing forecasts remain readable.                                                                | Production-build Playwright              |

## Numerical contract

One forecast result per run. Accept `baseline-v1`, `expanded-v1` and `regional-v1` results with status `selected`. Lead time L is an integer 0–89 calendar days; review interval R is 1–90 days; L+R must fit within the saved forecast horizon (at most 90). Service probability is 0.5–0.999, default 0.95. These are conditional demand-coverage targets, not promises of achieved fill rate or service.

Recreate actual-minus-predicted errors for the saved selected model on its three original rolling windows. Each fit sees only its training prefix. Calendar candidates use only the saved daily flags. Keep the chosen model fixed; do not select a replacement on calibration failure. Require at least 20 errors and some positive history. Selection used these same windows, so calibration may be optimistic. This release does not claim independent policy coverage validation.

Generate 5,000 reproducible daily paths by adding independently sampled errors to the **saved published daily point forecasts**, clipping at zero. The seed depends on method and saved forecast identity, not policy parameters. Generate the full saved horizon, then sum each path over L and L+R. Known lifecycle-ineligible days remain zero. The empirical quantile is order statistic `ceil(probability × 5000)`, counting from one. For each period the target is the greater of its point-forecast sum and empirical quantile, rounded upward to 0.001. Safety stock is target minus the point-forecast sum. A zero-day lead time has zero demand and threshold. Daily converted quantities above 10^30 are unsupported.

This is an IID empirical error approximation, not recursive model simulation. It assumes exchangeability across days and forecast leads and omits serial dependence, parameter uncertainty, unseen demand, supply variability and censoring of sold demand by stock-outs. Sparse or changing demand can invalidate it. Lost sales remain separate. Daily interval endpoints are never summed. See [bootstrap prediction distributions](https://otexts.com/fpp3/prediction-intervals.html).

The reorder-point reference covers L; the periodic-review order-up-to maximum covers L+R. They describe different review rules and are not an optimized hybrid min/max policy. Cycle service and fill rate differ; see [MIT's inventory-policy notes](https://ocw.mit.edu/courses/esd-260j-logistics-systems-fall-2006/8b53c45fd26ffff706d815131e8d177e_lect11.pdf). Results are as of the saved forecast cutoff, not today's date. Prepared groups retain their saved unit and fixed-group interpretation; older individual forecasts lack a saved unit label and display “item units.” No live catalog unit is inferred.

## Persistence and release boundaries

An additive `policy` planning kind reuses throttling, idempotency, cancellation and retries. Inputs capture the saved forecast at enqueue and are removed on terminal status; successful results retain full evidence. One new worker publication capability is added, with no raw-table access. Numerical computation uses the existing isolated 720-second process and 900-second lease.

This step creates recommendations only. Purchase quantities, stock/order netting, MOQ/pack rounding, sourcing, variable lead times, fill-rate targets, activation/overrides and order execution remain later work. No hosted data or settings are changed.

Owner-run rollout: stop workers, review/apply `20261015170809_inventory_policies.sql` with `pnpm exec supabase db push`, install using `uv sync --locked`, restart workers and deploy the web build. Rollback preserves additive schema and saved results: disable submissions and cancel queued policy runs before reverting workers/web together. Destructive schema rollback requires a separately reviewed forward migration.

## Verification evidence

The new numerical module has 100% statement coverage across 24 numerical/process tests. The full Python suite passes 343 tests (292 without the database and 51 database integration tests). Web lint, typecheck, logical utilities, 1,048 unit tests and production build pass. The full local pgTAP suite passed 1,928 assertions; after adding four terminal-retry assertions, the updated policy file passed all 41 assertions. Tenant invariants and privilege snapshots include the new table and exactly eight callable worker capabilities.

Production-build Playwright verified all 39 enabled scenarios; three optional scale scenarios were skipped. All five planning scenarios passed on rerun after narrowing the policy test's validation wait to its form, excluding the page-announcement alert. Both individual-item and prepared-group flows cover rejected horizons, queue/worker completion, saved thresholds, calibration evidence and the source link.

A local Windows benchmark used 1,096 history days, a 90-day horizon, automatic ARIMA calibration and 5,000 sampled paths. The isolated process completed in 25.70 seconds, producing 270 calibration errors and 41,662 bytes of output, within the 720-second compute limit. This is a bounded fixture result, not a production latency guarantee. Reproducibility assumes the pinned runtime and numerical platform; automatic fits can differ slightly across platforms.
