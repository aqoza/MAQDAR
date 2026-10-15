# Forecast baselines (Step 9)

Owner approval: 2026-10-15. Method: `baseline-v1`.

## Acceptance and scope

Planners can compare daily sold-demand baselines and inspect a selected forecast at one location. Complete-history confirmation remains mandatory; missing dates become zero only inside the observed lifecycle window. Lost sales stay separate. The owner approved mean, naive, weekly seasonal-naive, simple exponential smoothing (SES), Croston, SBA and TSB, a default 28-day editable horizon, and three non-overlapping rolling backtests scored by RMSE with MAE and signed bias displayed. Automatic ETS/ARIMA and bootstrap uncertainty follow in a later forecasting increment; regional effects, relationship roll-up and inventory policies remain later steps.

| Criterion | Scenario and expected result                                                                                                                                             | Verification                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| AC-001    | An editor confirms history and queues a bounded item/location/window request; invalid, unauthorized or stale-organization requests create no run.                        | Action tests and local pgTAP                                             |
| AC-002    | An eligible series is evaluated on three successive withheld windows, training only on preceding observations. Lowest pooled RMSE wins; ties follow a fixed model order. | Hand-calculated Python examples, weekly-pattern oracle and leakage tests |
| AC-003    | Short histories are explicitly insufficient with no winner or invented accuracy; ended lifecycle windows are not forecast.                                               | Python boundary tests                                                    |
| AC-004    | Retries use the same captured inputs; expired/canceled tokens cannot publish and no partial result becomes visible. Existing readiness/classification still work.        | Local worker/database integration and pgTAP                              |
| AC-005    | Members inspect forecasts, fold dates and scores only within their tenant/branch scope.                                                                                  | RLS tests and production-build Playwright                                |

## Technical bounds and reproducibility

Each run selects 1–100 distinct item codes at one active location. This bounds dense-series work under the existing 120-second worker lease; the form states the limit. History remains capped at 1,096 inclusive calendar days; forecast horizons are 1–90 days. Initial training requires 56 days followed by three horizon-length test windows. A 28-day horizon therefore requires at least 140 observed days. Inputs are captured at first processing and retained with final results so results remain reproducible after imports or catalog edits.

Method `baseline-v1` uses fixed smoothing coefficients 0.1 (SES/Croston/SBA; TSB size and occurrence) and fixed initialization, without hyperparameter search. All seven models compete on the same folds; classification labels do not preselect a winner. Daily forecasts are nonnegative, rounded to three decimal places using half-up; scoring uses unrounded predictions. These are expected sold quantities, not order quantities or service-level recommendations.

History may end today or earlier in the organization's effective time zone; the form defaults to yesterday. The planner must attest that all selected history is complete. Introduction and discontinuation dates clip the observed interval, inclusively. An item introduced after the cutoff or discontinued on/before it receives `outside_lifecycle`. A known future discontinuation zeros forecast days after that date. Recorded status alone never implies obsolescence.

## Model and evaluation definitions

| Model                 | Definition                                                                                                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Historical mean       | Mean of all training days, including confirmed zeros                                                                                                                                                                         |
| Last observation      | Repeat the final training observation                                                                                                                                                                                        |
| Weekly seasonal naive | Repeat the last seven training days in order                                                                                                                                                                                 |
| SES                   | Initialize at the first training observation, then update level by `0.1 × (observation − level)` each day                                                                                                                    |
| Croston               | Initialize size at the first positive observation and interval at its one-based day position. On subsequent positive days, smooth size and elapsed interval with coefficient 0.1; predict size / interval                    |
| SBA                   | Croston multiplied by `1 − 0.1/2` = 0.95                                                                                                                                                                                     |
| TSB                   | Initialize size as Croston and occurrence probability as the reciprocal of that initial interval. Update probability toward 1/0 every subsequent observed day; smooth size only on positive days; predict size × probability |

All-zero training data returns zero for intermittent methods. Every candidate is fitted afresh on each training prefix. The last three horizon-length windows are withheld successively; each later training prefix includes the earlier test observations. The final selected model is refitted on all observed history. No future test values initialize or tune a model.

Errors are `forecast − actual`. Pooled RMSE is the square root of mean squared error over all three equal-length test windows; MAE is mean absolute error; signed bias is mean error. The smallest unrounded RMSE wins. Exact ties use the table order above. Scores and fold dates are persisted, with per-fold scores also visible. These scores support model selection; they are not an independent holdout estimate of the selected model's future accuracy. Each item is scored independently; quantities with different units are not pooled across items.

Implementation uses a local 60-digit Decimal context. Source quantities remain decimal strings, calculations never pass through binary floats, and persisted output uses plain decimal strings. Rounding happens only for displayed daily forecasts, using half-up to three decimals; horizon total sums those rounded daily quantities. Backtests use unrounded model predictions.

Method references: [rolling-origin evaluation and RMSE](https://otexts.com/fpp3/toolbox.html#time-series-cross-validation) and [Croston/SBA/TSB definitions](https://nixtlaverse.nixtla.io/statsforecast/src/core/models.html). This release implements the explicitly documented fixed-parameter variants above without a new model-library dependency.

## Persistence and access

`forecast_enqueue` validates role, location, confirmation, date bounds, horizon and selected tenant item codes. Sorted item selections and horizon are part of request idempotency. Existing one-active-run and 20-new-runs-per-24-hours bounds remain.

The worker captures selected catalog identities and sparse daily sold/lost observations in one statement through `planning_task`. Snapshot size is bounded to 20 MB. Retries reuse that snapshot after catalog changes or demand re-imports. A missing selected item at first processing fails the attempt rather than silently reducing scope. `forecast_finish` checks the lease, exact item membership, required output shapes and a 5 MB output cap, then publishes all rows, marks the run complete and archives the queue message in one transaction. Numerical computation is trusted worker code; clients cannot supply results.

`forecast_results` has tenant and restrictive location RLS, composite organization/run/location identity, and SELECT-only access for members. Worker access remains function-only. Item identities and source metadata are historical and intentionally survive item recoding/deletion. Final evidence retains the sparse input and output; terminal success/failure/cancellation removes private staging. Existing readiness and classification entry points remain compatible.

## Owner-run rollout and rollback

1. Stop hosted workers. Review `20261015123000_forecast_baselines.sql`, then apply it yourself with `pnpm exec supabase db push`.
2. Upgrade the worker and run `uv sync --locked`. Its existing capability role gains `app.forecast_finish`; task dispatch routes forecasts without exposing raw tables or private helper functions. Start the upgraded worker before deploying the form.
3. Deploy the web build. From **Forecasts → Create forecast**, select a small item set and complete window, confirm history and queue. Verify method, scores, fold dates and daily output; also verify readiness and classification.
4. To roll back, stop workers and cancel unwanted forecasts from the current web version. Revert web and worker together while retaining schema and historical results. Older workers cannot execute forecast tasks and will fail them; do not leave them consuming a queue containing forecasts. Destructive rollback needs a separate reviewed migration.

This development task applies migrations and runs workers only against the local stack. Hosted rollout remains owner-run.

## Verification evidence

The numerical suite includes hand-calculated method examples, all-zero and sparse histories, weekly-pattern selection, held-out leakage checks, horizon/history boundaries, lifecycle boundaries and decimal values beyond binary-float precision. The 29 focused tests achieved 100% statement coverage of `forecasting.py`. Database tests cover tenant/branch isolation, privilege denial, immutable retry inputs, stale tokens, cancellation and atomic publication. Browser coverage queues a run and inspects the selected weekly model, daily output, comparison scores, fold dates and a short-history item.

A local compute-only benchmark on 2026-10-15 processed 100 items × 1,096 fully observed days with a 90-day horizon in 5.12 seconds; serialized input was approximately 3.7 MB and output 1.0 MB. This validates the compute bound on the development machine, not a production throughput guarantee. Full database and browser regression results are recorded in the PR checks.
