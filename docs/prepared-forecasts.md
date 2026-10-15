# Prepared-group forecasts (Step 10b)

Owner-approved scope and comparison interpretation: 2026-10-15. Method: `regional-v1`.

## Acceptance

| Criterion | Required outcome                                                                                                                                                                                         | Verification                                        |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| AC-001    | An editor queues one saved ready preparation group, a 1–90-day horizon (default 28), and explicit fixed-group confirmation. Foreign, blocked, stale-organization and unconfirmed requests create no run. | Action tests, pgTAP, browser                        |
| AC-002    | Saved group quantities, units, relationships and historical calendar flags remain fixed. Each model fits only the training prefix of each rolling comparison; lost sales remain separate.                | Numerical oracle and held-out mutation tests        |
| AC-003    | A bounded weekday/holiday/Ramadan candidate competes with the existing nine models. Unknown calendar dates receive no event adjustment. Support counts and learned adjustments are inspectable.          | Numerical tests and browser                         |
| AC-004    | Results retain the three rolling RMSE comparisons, MAE/bias, reproducible daily 80%/95% bands and a separate held-out coverage exercise. Insufficient history and unsupported quantities are explicit.   | Numerical tests, regression suite                   |
| AC-005    | Retries reuse captured inputs and future calendar data; expired/canceled tokens cannot publish. Existing tenant/location RLS and worker capabilities remain enforced.                                    | Database integration, pgTAP and privilege snapshots |
| AC-006    | A planner starts from a preparation group and inspects its forecast, comparison basis, source link, calendar evidence and uncertainty. Existing individual forecasts remain readable.                    | Production-build browser workflows                  |

## Comparison basis and observation window

These are **fixed-group model comparisons**, conditional on the saved preparation's group membership, conversions and calendar information. They do not reconstruct the part catalog or calendar announcements known at historical planning dates. Interchanges do not have historical versions. Frozen relationships can include facts learned after an older comparison origin; the UI states this limitation. Demand fitting and error calibration still exclude all demand after each training cutoff. This distinction follows the separation between predictor assumptions and held-out outcomes in [forecasting with regression](https://otexts.com/fpp3/regression.html#ex-ante-versus-ex-post-forecasts).

The forecast uses the latest continuous eligible history ending at the preparation cutoff. Days where all source lifecycles were inactive are unavailable, not zero; any such gap trims the start to the following day. A gap on the cutoff produces `outside_lifecycle`. Missing observations inside the original confirmed source windows are already zero in the preparation. The source's original window, used window, contributors, units and member lifecycle dates remain in evidence. Recorded lost sales are displayed separately and never added to fitted sold demand.

The group is not recomputed against the live catalog. Future days with no captured member inside its recorded lifecycle have point forecasts and bands set to zero; partial membership changes are not used to infer a proportional demand adjustment. Future supersessions, inferred obsolescence, weather/heat effects, causal effects and historical relationship versioning remain outside this release.

## Calendar candidate

`weekday-event-shrinkage-v1` is a deliberately small additive model, computed with Decimal arithmetic:

1. Fit seven weekday means to the training prefix. Calculate each observation's residual from its weekday mean.
2. Assign verified days to mutually exclusive categories: public holiday first, otherwise Ramadan, otherwise ordinary. Unverified days belong to unknown. Unknown days contribute to weekday means but never to event or ordinary residual samples.
3. For each event, calculate its mean residual minus the ordinary mean residual. Require at least two event days and 28 ordinary days. Bound the difference to plus/minus the largest training observation, then multiply by `event_days / (event_days + 14)`. Otherwise its adjustment is zero with an insufficient-support status.
4. Predict the weekday mean plus the matching event adjustment, clipped at zero. Ordinary and unknown dates receive no event adjustment. The model does not force public-holiday demand to zero.

The 14-day shrinkage and support thresholds are fixed technical regularization choices, not fitted on comparison or coverage outcomes. Counts measure days, not independent annual events; two days do not establish a recurring causal effect. Holiday priority prevents double counting Ramadan holidays. Eid/Arafat are visible calendar evidence; this version does not fit separate effects for each. Final weekday means, event support, adjustment amounts and unknown-day counts are saved even when another model wins. Each fold refits the same recipe using only its own prefix.

The nine existing candidates retain their versioned definitions. Ties preserve their order, with calendar last. Failed optional candidates are excluded explicitly. The lowest pooled RMSE wins; MAE and signed prediction-minus-actual bias remain visible. See [rolling-origin evaluation](https://otexts.com/fpp3/toolbox.html#time-series-cross-validation) and the existing [forecast expansion contract](forecast-expansion.md).

## Calendar capture and uncertainty

Historical daily flags and weekly settings come from the saved preparation. At first forecast processing, future holidays, Ramadan windows, coverage bounds and matching overrides are captured from the reference country associated with that preparation. They are stored once and reused on retry. Calendar code/identity and weekly settings stay as captured by the preparation, even if the live location changes later. Future reference coverage can differ from the older saved history coverage; both remain inspectable in stored evidence.

Current seed coverage ends on 2026-09-30 for SA/AE/QA/KW/OM; BH/EG/JO have no verified coverage. This release does not refresh or extrapolate those dates. Weekday forecasts remain available; unknown holiday/Ramadan flags receive no learned event adjustment.

The existing seeded IID daily residual bootstrap supplies 80%/95% bands when at least 20 calibration errors exist. A fourth held-out window measures coverage using its own earlier model selection and calibration. Its outcomes never fit, select or calibrate that historical forecast. Bands are conditional on the fixed group and calendar assumptions, omit uncertainty about future relationships/event dates, and retain the sparse-demand, exchangeability and selection limitations in [forecast-expansion.md](forecast-expansion.md). Daily bounds are not aggregate-demand intervals.

## Persistence, bounds and rollout

`forecast_prepared_enqueue` reuses planning throttles/idempotency and the existing forecast tables with tenant/location RLS. One saved group is accepted per run, up to 100 captured members and 1,096 history days. The 900-second lease and isolated 720-second computation timeout are shared with expanded forecasts. Input/output caps remain 20/5 MB. Converted daily sold quantities above `10^30` are reported as `unsupported_scale` rather than overflowing numerical models; original preparation evidence stays exact.

No new dependency or worker capability is introduced. Private individual-method helpers preserve baseline/expanded contracts while the guarded task and finish functions dispatch by method. Inputs are deleted on terminal status after successful evidence is retained. All migrations and integration checks in this task target the local stack.

A local Windows numerical benchmark on 2026-10-15 used 1,096 history days, 100 saved member lifecycles and a 90-day horizon. All ten candidates completed in 43.91 seconds through the isolated worker process; the numerical result was 51,171 bytes. This is a bounded fixture check, not a production latency guarantee.

Owner-run upgrade: stop workers, review/apply `20261015160000_prepared_forecasts.sql` with `pnpm exec supabase db push`, install the worker using `uv sync --locked`, restart it, then deploy the web build. Open a ready preparation group and choose **Forecast this prepared group**. For rollback, stop new submissions and cancel queued regional runs before reverting worker/web together; preserve schema/results and the current reader where needed. Destructive schema rollback requires a separately reviewed migration.
