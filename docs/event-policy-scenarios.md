# Event-adjusted policy scenarios (Step 19b)

Owner-approved on 2026-10-18. A planner selects one saved planned-event scenario and one available calculated policy from the same individual-item forecast. The comparison retains both sources, reasons, dated contributions and immutable history. It does not activate a policy or feed replenishment.

## Acceptance

| Criterion | Observable result                                                                                                                                                                                                                                                                        | Verification                                          |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| AC-001    | Members inspect only their tenant and permitted locations. Editors save; viewers, approvers and branch users cannot save. Both inputs are independently scoped.                                                                                                                          | pgTAP, action tests, browser                          |
| AC-002    | Forecast, item, location, unit, cutoff and copied forecast evidence match. The calculated policy is available from a successful policy run, with valid periods and known units. Missing or incompatible evidence produces no thresholds or saved scenario.                               | pgTAP                                                 |
| AC-003    | Dated additions increase demand, quantile and threshold in the corresponding periods using exact decimal arithmetic. Lead time, review interval, service probability and safety stock remain fixed. No other scenario or approved override is included.                                  | Independent pgTAP numerical oracles                   |
| AC-004    | Positive additions before introduction or after discontinuation make the whole comparison unavailable, even beyond the protection period. Boundary dates are inclusive; explicit null dates retain the baseline engine's unbounded interpretation. Missing lifecycle fields fail closed. | pgTAP, browser                                        |
| AC-005    | Changed preview inputs require refresh. Identical retries return the original author’s saved record; conflicting reuse fails. New saves recheck authority and both saved sources after waiting.                                                                                          | pgTAP, concurrent database tests, browser             |
| AC-006    | Users choose a policy, inspect the comparison and save/read paginated history at 375, 768, 1024, 1440 and 1920px, including keyboard disclosure and Arabic RTL.                                                                                                                          | Production-build Playwright and screenshot inspection |

## Calculation and evidence

Use the selected calculated policy's **published** period demand, empirical quantile, threshold and safety stock. For lead time L, sum event additions dated cutoff + 1 through cutoff + L. For protection L + R, sum through cutoff + L + R. Add that exact sum to the period's demand, quantile and threshold, preserving its safety stock verbatim. No new rounding, refitting or sampling occurs. A zero-day lead period remains zero. Additions after protection remain visible as excluded contributions; they are never shifted earlier or dropped from saved evidence.

These additions are fixed planner assumptions. Shifting a baseline demand distribution by a fixed amount also shifts its quantile by that amount, leaving safety stock unchanged. The service probability therefore remains **conditional on the entered additions**. It does not quantify event occurrence, tender probability or event quantity uncertainty, and preserves the baseline policy's existing calibration limitations. Original forecast intervals and model scores remain baseline evidence; no adjusted uncertainty bands are calculated.

The saved baseline source must match exactly between the event and policy, including the history and published daily forecast. This intentionally rejects sources that changed between those original captures. Current catalog values do not replace either saved source. Lifecycle checks use saved introduction/discontinuation dates. A positive event on an eligible date with zero baseline demand is allowed. A zero addition outside the lifecycle is harmless; a positive addition anywhere outside it blocks the result.

Each comparison is independent. It does not stack other events, inherit an approved override, modify the baseline policy or create a new worker policy result. Applying a comparison to replenishment, prepared groups, variable event uncertainty, activation, reservations and execution remain separate increments.

## Persistence and access

`event_policy_scenarios` is an additive tenant/location-scoped table with authenticated SELECT only. Its composite tenant foreign keys reference the saved event, baseline policy and location. Audit records record new saves. Existing authorized retries retain their original evidence; later source edits do not recompute saved reports. As with the source planning records, administrative deletion of a parent cascades to dependent scenarios.

`event_policy_preview` checks membership and both source locations explicitly before using the private pure calculator. `event_policy_save` requires an editor, a reason, request UUID and preview SHA-256 fingerprint. A per-organization/request advisory lock serializes retries; authority and source evidence are rechecked afterward. No source quantities or calculated thresholds are accepted from the browser. Missing or inaccessible source identifiers return the same unavailable error.

## Rollout and rollback

Owner-run rollout: review and apply `20261018030246_event_policy_scenarios.sql` with `pnpm exec supabase db push`, then deploy the web build. No worker changes are required. This development step applies migrations only to the local test stack.

Rollback restores the previous web build while retaining the additive table/RPCs and saved comparisons. Destructive schema rollback requires a separately reviewed migration. No existing policy or transaction data is backfilled or rewritten.

## Verification

Local verification: the full pgTAP suite passed 3,788 assertions across 63 files; after final validation and storage-contract refinements, all 68 assertions in the new file passed. All 1,378 web unit tests passed, including 15 new schema/action tests. Seven database integration tests passed, covering six retry/authority races and a forecast → calculated policy → event comparison through the real worker. Lint, TypeScript, logical CSS, formatting and the production build passed. Production-build Playwright passed without retries; screenshots cover 375, 768, 1024, 1440 and 1920px plus Arabic RTL, with keyboard disclosure, stale-input invalidation, immutable history, lifecycle rejection and scoped read-only access.
