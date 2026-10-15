# Forecast expansion (Step 9b)

Owner approval: 2026-10-15. Method: `expanded-v1`. Baseline runs and their existing evidence remain `baseline-v1`.

## Scope and acceptance

Planners can compare automatic ETS and ARIMA with the seven approved baselines, inspect daily bootstrap bands at 80% and 95%, and inspect a separate historical coverage check. Confirmed complete sales history, daily sold demand, separate lost sales, lifecycle boundaries, three rolling selection windows, RMSE ranking, MAE and signed bias retain their Step 9 definitions. Regional effects, part relationships and inventory policies follow in later steps.

| Criterion | Observable result                                                                                                                                                                                                                         | Verification                                 |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| AC-001    | An editor chooses baseline or expanded forecasting; expanded runs accept 1–10 selected tenant items, with mandatory history confirmation. Invalid or unauthorized submissions create no run.                                              | Action tests, pgTAP                          |
| AC-002    | Eligible automatic candidates compete on the same three withheld windows as the baselines, with fitting restricted to each training prefix. Failed candidates are visibly excluded, with no borrowed scores or silent model substitution. | Numerical oracles, failure and leakage tests |
| AC-003    | Daily 80%/95% bootstrap bounds are reproducible, nonnegative and nested. Fewer than 20 calibration errors produces an explicit unavailable state. Known future discontinuation zeros point forecasts and bands after its inclusive end.   | Numerical tests                              |
| AC-004    | Historical coverage uses a final held-out window whose values do not select its model or construct its bands. Insufficient history is explicit; historical model identity, windows, sample counts and coverage are persisted and shown.   | Holdout mutation test, browser test          |
| AC-005    | Both methods preserve captured inputs across retries, reject expired/canceled claims, publish atomically, and retain tenant/branch isolation. A stalled expanded computation is terminated before its lease expires.                      | Worker/database tests, timeout test, pgTAP   |
| AC-006    | Existing baseline results remain readable, and planners can inspect automatic comparisons, daily bands and historical coverage in the production web build.                                                                               | Both methods in Playwright, full CI          |

## Automatic models and numerical contract

The implementation pins StatsForecast 2.1.1 and its resolved dependency graph in `engine/uv.lock`. AutoETS uses weekly season length 7, additive errors (`AZZ`), and automatic trend/seasonality selection. AutoARIMA uses weekly season length 7, AICc stepwise search capped at 20 models, nonseasonal AR/MA orders at most 2, seasonal AR/MA orders at most 1, and ordinary/seasonal differencing at most 1. Approximate fitting is disabled. These bounds define this method version; this is not an unrestricted search across all possible models. See the [library's model documentation](https://nixtlaverse.nixtla.io/statsforecast/src/core/models.html).

Automatic fitting scales each training series by its maximum (at least one), converts to float64, then rescales finite predictions into Decimal. Negative predictions are clipped to zero before scoring and publication. This introduces floating-point approximation for automatic candidates; original quantities remain exact decimal strings, and the seven baseline computations retain their 60-digit Decimal arithmetic. Daily output is rounded half-up to three places; selection uses unrounded predictions. Determinism assumes the pinned runtime and numerical platform; cross-platform floating-point results can differ near ties.

Each candidate is fitted on three successive training prefixes and then, if selected, on the full history. Ties retain the seven baseline order followed by ETS and ARIMA. An automatic candidate that fails any fold is omitted from selection and listed as `fit_failed`. A selected candidate that cannot refit is removed with `refit_failed`, and the next valid candidate is selected with its own scores. Numerical failures in a baseline fail the attempt rather than masquerading as automatic-model exclusions.

## Empirical uncertainty

For the selected model, calibration residuals are actual minus unrounded prediction across its three selection windows. The first release pools these daily residuals across forecast leads. At least 20 are required; therefore horizons shorter than seven days still produce point forecasts but no bands under the three-window design.

For each future day, 2,000 residuals are sampled with replacement and added to that day's prediction. The 2.5%, 10%, 90% and 97.5% empirical order statistics form the 95% and 80% bounds, clipped at zero and rounded to three places. The seed is a SHA-256 digest of method, captured item identity, observation window and horizon; an evaluation suffix separates the historical exercise. Seed, sample count, residual count, method and daily bands are persisted. Forecast totals remain sums of point forecasts; daily bounds must not be added to claim a total-demand interval.

This is an IID empirical residual bootstrap, not a recursive simulation of model innovations or a calibrated service target. It assumes exchangeable errors across calendar days and forecast leads. Model selection can make its calibration errors optimistic. Sparse demand, changing regimes and serial dependence can invalidate these assumptions; all-zero history cannot establish the risk of unseen demand. The UI states these limitations. See [prediction intervals and bootstrapping](https://otexts.com/fpp3/toolbox.html).

## Independent historical coverage

When at least `56 + 4 × horizon` days exist, a separate historical exercise removes the final horizon-length window. It selects a model using the preceding three rolling windows, calibrates bands using only those earlier errors, and predicts the withheld final window. None of its actual values enters model selection, refitting, calibration or seeding for that exercise. Coverage is the observed proportion inside each rounded daily interval, inclusive of endpoints. This exercise's model can differ from the final production model, which uses all available history.

The stored evidence includes the historical model, training cutoff, held-out dates, day count, calibration count, point predictions, bands and coverage proportions. One window gives a diagnostic with substantial sampling uncertainty; it does not establish nominal calibration. Coverage never tunes or widens the final bands automatically. For fewer than four windows, the final forecast and bands can still be available while coverage explicitly reports insufficient history.

## Persistence and operational bounds

`forecast_expanded_enqueue` is a separate editor-only RPC, leaving the baseline RPC compatible. The method is part of idempotency. The shared task and finish functions dispatch by the captured method; publication still requires exact selected item membership, bounded result shapes, the active lease and the 5 MB output cap. Existing table RLS and grants are unchanged. Original snapshots remain bounded to 20 MB and are removed on terminal status after evidence is retained in results.

Expanded runs keep the 1–90-day horizon and 1,096-day history bounds but select at most 10 items. Queue visibility and the lease are 900 seconds for these runs. Computation runs in a spawned process with numerical thread pools limited to one; a 720-second timeout terminates it and records the existing generic retry. The remaining time allows input capture and publication. A crashed worker becomes recoverable after queue visibility expires, with the existing three-attempt cap. Baseline, classification and readiness leases remain 120 seconds.

## Owner-run rollout and rollback

1. Stop hosted workers. Review and apply `20261015130000_forecast_expansion.sql` yourself with `pnpm exec supabase db push`.
2. Install the upgraded worker using `uv sync --locked`, then restart it. It requires permission to spawn a child process and sufficient memory for the pinned numerical libraries; its database capability role still has only the existing six worker RPCs.
3. Deploy the web build. Choose automatic models for a small, confirmed item/window selection and inspect scores, bands and coverage. Also verify an existing baseline result.
4. To roll back, stop expanded submissions/workers and cancel queued expanded runs before reverting web and worker together. Preserve additive schema and historical evidence. Older workers cannot execute expanded jobs, and older web builds cannot render automatic model results; retaining the current results reader is preferable to reverting it. Destructive schema rollback requires a separately reviewed migration.

Only the local stack is migrated or used for worker tests by this task. Hosted rollout remains owner-run.

## Verification evidence

The 17 focused numerical/process tests pass with 100% statement coverage of `expanded_forecasting.py` and `forecast_process.py`. Local pgTAP passes 1,812 assertions across 31 files, including both enqueue methods, extended lease, access isolation and privilege snapshots. Worker integration tests exercise both methods through publication, immutable retries and cancellation.

A local maximum-size compute benchmark on 2026-10-15 completed 10 items × 1,096 daily observations with a 90-day horizon in 340.63 seconds, including process startup, automatic selection, bootstrap bands and the historical coverage exercise. The deterministic dataset mixes zeros and varying positive quantities; nine items selected ARIMA and one selected ETS. Input/output JSON were approximately 293/292 KB. This is below the 720-second compute budget on the development machine; other data and slower hosts can still hit the explicit timeout. It is not a production throughput guarantee.
