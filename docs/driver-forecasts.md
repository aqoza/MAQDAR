# External-driver forecasts — Step 23b

Approved 2026-10-21. `driver-v1` copies one successful individual `baseline-v1` or
`expanded-v1` forecast and one saved driver dataset for the same item identity,
location, history window, cutoff and horizon. The original confirmed sales history
and consistent known demand unit are required. Prepared groups and previous driver
comparisons are not inputs. Dataset units label the predictor, independently of
the demand unit. No conversion, filling, refreshed demand or live-feed lookup occurs.

## Calculation and availability

Nine existing candidates retain their versioned behavior. One `driver_weekday`
candidate adds an intercept per weekday and one common driver slope. Within each
training prefix, center the predictor at its mean and scale by its largest absolute
deviation (constant predictors are unavailable). Subtract weekday means from both
predictor and sold demand; slope equals covariance divided by predictor squared
deviations plus `training_count × 0.01`. Weekday intercepts are unpenalized. This
fixed ridge penalty is not tuned against test outcomes. Coefficients, scaling,
training range and extrapolated forecast dates are retained. Decimal arithmetic
uses precision 60; existing ETS/ARIMA retain their floating-point implementation.
Negative predictions are clipped to zero; values above 1e30 are unavailable.

Every required training **and prediction** driver value must exist and be declared
available on or before that fit's cutoff. Observed and planned kinds remain as
supplied; planned values may be predictors during training as well as prediction.
An observed value dated after the cutoff cannot pass the dataset's availability
rules. Missing/late values exclude the driver candidate, with the first affected
date and input period; the nine existing candidates remain eligible. A constant
driver or no variation beyond weekday effects also excludes the driver candidate.

Use the existing three non-overlapping horizon-length rolling windows, at least
56 initial training days, pooled RMSE selection, MAE and signed forecast-minus-actual
bias. Ties retain existing model order, then driver. Final refitting must also pass
availability. No post-cutoff demand is fitted or used to scale predictors. Source
availability claims are **not independently verified**; server import time is
shown separately. These are conditional model comparisons, not demonstrated
historical information availability or a causal-effect estimate.

Reproducible 80%/95% IID residual-bootstrap bands use the existing 2,000-draw method
and require 20 errors. Driver-value uncertainty is excluded. With `56 + 4h` days,
a separate final withheld window repeats selection/calibration using earlier
data and its own availability cutoffs; its realized outcomes affect coverage only.
Daily bands are not additive total-demand intervals. Sparse demand, correlated
errors, changing regimes and extrapolation can invalidate coverage assumptions.
Recorded discontinuation still zeros final points and bands after its date.

Method references: [regression forecasting and predictor uncertainty](https://otexts.com/fpp3/regression.html#forecasting-with-regression)
and [rolling-origin evaluation](https://otexts.com/fpp3/toolbox.html#time-series-cross-validation).

## Persistence, access and UI

Editors confirm source applicability and reuse before queueing from a saved dataset.
The guarded RPC takes the existing organization planning lock, rechecks authority
after waiting, enforces location access, and copies both immutable source records
at enqueue. One active run and the existing daily submission cap remain. Identical
same-author request retries return the original run even after source deletion;
conflicting reuse fails and current role/location access always applies.

Use existing planning/forecast tables and RLS. Driver jobs receive a 900-second lease
and the existing isolated 720-second numerical child-process bound. Workers receive
no new table privileges. Task access and publication require the current unexpired
lease; SQL independently checks identity, output bounds, dates/totals and driver
availability for scored models. Original driver report/import time and source
forecast references are copied into result evidence. Terminal cleanup removes
private job inputs. Later source deletion does not rewrite completed results;
organization/location deletion follows existing parent cascades and audit rules.

Forecast results and saved-quality history recognize the new method. Details expose
selection/evaluation availability checks and copied driver data. Methodology lives
in expandable help; actionable exclusions remain visible. Shared green headers,
typography, keyboard scrolling and English/Arabic layouts apply at
375/768/1024/1440/1920px. This increment does not enable policies or planned-event
scenarios from driver results, combine datasets or change existing policies/orders.

## Acceptance checks

- AC-001: Matching captured sources enqueue only with editor/location access and
  confirmation. Missing units, mismatched windows/identities and hidden sources
  create no run. Verify pgTAP, action tests and browser selection.
- AC-002: Missing/late values exclude only the driver; every fit uses its own cutoff
  and training-only scaling. Verify numerical fixtures and independent SQL gates.
- AC-003: Scores, coefficients, daily points and reproducible bands are inspectable;
  changing held-out demand cannot change its predictions/bands. Verify numerical
  oracles, holdout mutation tests and the production browser workflow.
- AC-004: Concurrent identical requests make one run, revoked waiters/retries fail,
  copied evidence survives source changes, and expired claims cannot publish.
  Verify real-connection tests, pgTAP and worker integration.
- AC-005: Existing methods/results remain compatible. Verify full CI, saved-quality
  tests, tenant isolation and five-width English/Arabic screenshots.

## Rollout

Owner reviews/applies `20261021100000_driver_forecasts.sql`, upgrades the existing
global forecasting worker, then deploys the web build. The scoped simulation worker
does not execute forecasts. No hosted migration, credentials or deployment is part
of this change. To roll back submissions, retain the new result reader and cancel
queued driver jobs before reverting the worker; preserve additive stored evidence.
