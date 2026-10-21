# Multi-driver forecasts — Step 23c

Approved 2026-10-21. `multi-driver-v1` copies one completed individual
`baseline-v1` or `expanded-v1` forecast and 2–5 saved driver datasets. Require the
same item, location, history window, cutoff and forecast horizon, captured complete
sold history and consistent known demand units. Dataset units describe their own
predictors; they need not match demand units or each other. Confirm that these are
distinct applicable drivers; duplicate dataset IDs fail. Semantic distinctness is
a planner assertion, not an inference from names or correlations.

## Joint calculation

Retain the existing nine candidates and add `multi_driver_weekday` last in the
stable tie order. Each of the three rolling horizon-length training prefixes and
the final fit checks **every selected driver's training and prediction values**
against that fit's cutoff. Missing, late, constant, or weekday-only inputs exclude
the whole joint candidate with the first offending dataset/date/phase. No input
is filled, dropped or replaced. The existing models can still win. Source-declared
availability is not independently verified historical availability; server import
time and observed/planned kinds remain separate copied evidence.

For each driver, center on that training prefix's mean and scale by its maximum
absolute deviation. Subtract weekday means from centered/scaled predictors and
sold demand. Solve `(XᵀX + n × 0.01 I) β = Xᵀy` for all 2–5 slopes simultaneously,
using deterministic Decimal partial-pivot elimination at precision 60. The fixed
ridge penalty applies to scaled slopes; weekday intercepts are unpenalized.
Correlated drivers remain in the model; there is no feature selection or tuning
against validation outcomes. Store original-unit slopes, training centers/scales,
ranges, extrapolated future dates and Monday–Sunday intercepts. Coefficients are
conditional predictive evidence, not causal effects. Clip predictions at zero;
values above 1e30 exclude the candidate. Recorded discontinuation retains the
existing zeroing of final points and bands.

Use the same pooled rolling RMSE selection, MAE, signed bias, minimum 56 training
days, 1–90 day horizon and independent final withheld evaluation as `driver-v1`.
Reuse reproducible 2,000-draw 80%/95% residual bootstrap bands, with at least 20
calibration errors. Held-out outcomes affect coverage only. Driver-value uncertainty
is excluded; daily bands are not additive total intervals. Sparse demand, dependent
errors, extrapolation and regime shifts can invalidate coverage assumptions.

Method references: [ridge regression](https://scikit-learn.org/stable/modules/linear_model.html#ridge-regression-and-classification)
and [regression forecasting](https://otexts.com/fpp3/regression.html).

## Evidence, access and lifecycle

`forecast_multi_driver_enqueue` requires an editor and explicit applicability/reuse
confirmation, locks the organization's planning queue, then rechecks current
membership and location access. Canonically sort the distinct dataset UUIDs before
capturing inputs and building retry identity. Identical same-author requests with
a reordered set return the original run; conflicting request reuse fails. Retries
still require current authority but may return saved runs after source deletion.
Existing one-active-run and daily quota rules apply. Dataset/source metadata and
all values are copied at enqueue, within the 20 MB input limit.

The existing global forecasting worker executes the new method in its isolated,
720-second child process with a 900-second lease. Task reads and publication are
lease fenced. SQL validates identity, numerical envelope and every driver's
availability independently by projecting each predictor through the unchanged
single-driver validator; the joint tag is translated structurally only inside
validation. All source identities must occur once in canonical coefficient order.
Publication copies all dataset reports/import times and source forecast evidence.
No table grants or new authorization scopes are introduced. Terminal private-input
cleanup and existing organization/location cascades remain.

Completed results and quality history recognize the joint model. Source selection
shows the latest 100 matching datasets and source forecasts. Results keep actionable
exclusions visible, with coefficients, copied datasets and methodology expandable.
Shared compact green typography and keyboard-scrollable evidence tables apply at
375/768/1024/1440/1920px and Arabic RTL. `driver-v1` keeps its method, calculations
and reader behavior. Frozen policy/export schemas are not widened; new results
cannot create inventory policies or planned-event scenarios. No operational writes.

## Acceptance checks

- AC-001: Two and five inputs fit jointly; independent NumPy oracle, matrix residuals,
  collinearity, training-only scaling and selection-order invariance pass.
- AC-002: Missing/late/constant inputs exclude the entire candidate. Each dataset's
  SQL availability gate independently rejects forged inclusion, including holdout.
  Changing withheld demand does not change its predictions or bands.
- AC-003: Concurrent reordered retries create one run; revoked waiters/retries fail.
  Copied inputs survive source deletion. Malformed, duplicate, hidden or mismatched
  datasets create no run. Expired/wrong leases cannot publish.
- AC-004: A real browser run queues and executes the bounded numerical process,
  publishes all evidence, supports quality filtering and retains viewer/branch
  HTTP 404 behavior. Inspect five-width English/Arabic screenshots and keyboard use.
- AC-005: Single-driver numerical/DB/browser suites, privilege inventory, frozen
  OpenAPI/schema contracts, web/engine tests and the complete CI stay green.

Run `0098_multi_driver_forecasts.test.sql`, `test_multi_driver_forecasting.py`,
`test_multi_driver_forecasts_db.py`, `multi-forecast-actions.test.ts` and
`multi-driver-forecasts.spec.ts`, alongside their single-driver counterparts.
Shared local database/browser suites run sequentially; never reset a shared stack.

## Rollout

After review, apply `20261021130000_multi_driver_forecasts.sql`, update the global
forecasting worker, then deploy the web build. The simulation-only worker does not
claim these jobs. This PR changes no hosted database or deployment. To suspend the
feature, stop new submissions and cancel queued joint runs; keep the result reader
and additive stored evidence when reverting the worker.
