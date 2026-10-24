# Forecast explainer (Step 28b)

Editors can ask about one selected saved individual-item forecast from its results detail. Supported methods are baseline-v1, expanded-v1, driver-v1 and multi-driver-v1, with consistent captured demand units. Prepared groups, nonselected results and unknown units remain unavailable. No model fitting, forecasts, policies, approvals or operational data change.

## Captured evidence

The preview and provider use the same explicit, bounded projection: saved method, history window, horizon, selected model, aggregate model-comparison RMSE/MAE/bias, excluded-candidate reasons, three backtest windows, residual-uncertainty status/count and separate held-out coverage status/model/window/count/calibration/80%/95% fractions. Decimal scores remain strings. Missing uncertainty is explicitly not recorded, never zero.

Raw demand, daily forecast arrays, interval arrays, driver datasets/names/values, prices, item/account descriptions and identifiers are excluded from the provider summary. Source identifiers remain internal for authorized navigation. The confirmed question and chosen language are sent with the summary; users must not put secrets or personal details in the question.

Historical model-selection scores are distinct from the held-out interval check and realized future performance. Bias means forecast minus recorded sold demand. The held-out model can differ from the final selected model. Driver interpretations remain conditional on source-declared availability, exclude driver-value uncertainty and make no causal claim. Residual-bootstrap assumptions do not guarantee accuracy or supply.

## Shared authority and lifecycle

Policy and forecast explanations share the existing owner/admin opt-in, server credentials, service-only dispatch/completion, organization serialization, quotas and organization/request UUID identity. Existing enabled settings apply to both; Settings explicitly describes both uses. The ledger now distinguishes policy/forecast subjects, with source-specific prompt versions and reference vocabularies. A forecast cannot reuse a policy request identity or cite policy-only sections. The dedicated service adapter still has only two guarded RPC capabilities and no direct tenant-table grants.

Editors reserve with current evidence/confirmation. Dispatch and publication each recheck current membership and enablement; retries never resend a claimed request. The same one/minute/editor, twenty/day/editor, hundred/day/organization and two active/organization limits apply across both kinds. Organization-day limits use UTC. Failures count. Revocation after a request has been sent cannot retract provider data, but blocks subsequent publication when observed.

Answers use escaped text and validated links to captured evidence sections. Valid citations do not prove an answer is correct. Saved questions, evidence, answers, models and API/prompt versions remain immutable after source deletion or opt-out, under current location access. Organization/location deletion cascades remain unchanged. No hosted migration, credentials or deployment are configured by this PR.

## Verification

- Forecast and policy unit suites test strict projections, cross-kind references, prompt versions, bounded provider behavior and revoked publication.
- pgTAP covers tenant/branch isolation, shared quota/retry identity, confirmation, changed previews, unsupported sources, references, missing coverage and retained source evidence. The privilege inventory includes both forecast RPCs.
- Database concurrency tests exercise quota races, duplicate dispatch, role changes and opt-out during lock waits for both subjects.
- The isolated provider browser configuration runs both explainer flows. It verifies entry navigation, opt-in, exact scores, independent coverage, scope, retries, escaped answers, Arabic generation and responsive/keyboard behavior at 375, 768, 1024, 1440 and 1920px. The provider is mocked only on a loopback test server; no live Claude call is made.

Local verification passed: 2,353 web unit tests, 7,846 pgTAP assertions, 498 engine tests, 18 explainer database concurrency tests and 13 simulation-worker tests. Both mocked explainer browser flows and five existing Settings/policy-workbench checks passed. Screenshots were inspected in English and Arabic at all five widths. Removing the prompt-version guard caused the expected test failure; exact restoration passed the focused suites. Formatting, lint, typecheck, logical-utility checks, production build and generated-type consistency passed. The live Claude service and hosted deployment were not exercised.

Deployment follows the reviewed policy-explainer rollout: apply migrations and deploy through the normal owner-reviewed process, then verify a configured model in staging before enabling a hosted organization. Disabling the existing setting stops new use of both explainers while retaining history.
