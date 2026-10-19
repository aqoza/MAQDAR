# Saved policy sensitivity comparisons (Step 21b)

Approved 2026-10-19: compare a completed original policy simulation's calculated maximum with one to ten explicit alternatives, using its captured demand and starting assumptions. This extends the Phase 4 simulation center without applying a policy or creating operational orders.

## Workflow and interpretation

Open a completed individual-item simulation and choose **Compare policy maxima**. Enter one to ten distinct nonnegative maxima, separated by commas or new lines, and confirm that its saved inputs are intentionally reused. Inputs accept at most 15 integer digits and three decimal places. Decimal spellings and order are normalized exactly; repeated numeric values are rejected. A representable alternative equal to the baseline is allowed as a control.

The comparison copies the original policy, unit, dates, recorded sold quantities, separate lost sales, missing-day provenance, complete-history confirmation, opening stock, fixed lead time/review interval, empty initial pipeline and zero backlog. Only the maximum varies. Current demand, inventory, forecast and policy tables are not refreshed. The source must be an original `periodic-replay-v1` simulation, not another comparison, and its location must be active when creating a new run.

Every variant uses the exact [Step 21 daily sequence](policy-simulation.md): receive due orders, clear older backlog, review and order up to the fixed maximum, receive zero-lead orders immediately, fulfil that day's recorded sales and carry shortages as backlog. Unlimited calendar-day supply remains an assumption. The baseline must exactly reproduce its saved ledger and metrics; an alternative matching the source alternative must also reproduce it. Quantities use Decimal arithmetic and stay exact; averages and fill fractions retain the original six-decimal half-up rounding. Zero recorded demand has no immediate-fill fraction.

The comparison table shows maximum, average closing stock, recorded sales met immediately, backlog days, ending stock/backlog/on-order, quantity ordered and order count. Select a variant to inspect its daily ledger and additional totals. Recorded sold/lost quantities and starting assumptions are shared evidence. Compact green typography, local table scrolling, keyboard controls and English/Arabic layouts cover 375, 768, 1024, 1440 and 1920px.

Exploring several maxima on the same history is a sensitivity exercise, not independent validation of future performance. Historical recorded sales can be censored by stock-outs. No winner, achieved cycle-service target, cost optimum or new policy is inferred. Lost sales are never added to replay demand. Different lead/review times, live commitments, supplier constraints, calendars, variable supply, prepared groups and operational execution remain outside this increment.

## Persistence, access and retries

`simulation_sensitivity_enqueue` accepts only an editor in the active organization. It rechecks current authority after the organization request lock, including retries. Members inspect results through the existing organization/location RLS. API keys gain no permission. The same one-active-run and 20-new-runs-per-24-hours limits apply.

The request UUID identifies a comparison with its original source run, normalized sorted set of alternatives and explicit reuse confirmation. Identical requests return the original run; changed inputs conflict. Saved copies survive source-simulation/policy deletion and later history changes. Source links can become unavailable. Deletion of the comparison's own planning run, organization or location retains existing cascades. No new retention or deletion permission is added.

The versioned `periodic-sensitivity-v1` input/result uses existing private staging and `policy_simulations` storage. Original `periodic-replay-v1` rows remain readable. The worker retains exactly nine private RPC capabilities; existing `simulation_finish` validates the method and all variants, checks conservation and original-result equality, and atomically publishes under the current lease. Canceled, replaced and expired leases cannot publish. Terminal runs remove private staging.

## Acceptance and verification

| ID     | Observable outcome                                                                                                                      | Verification                                                   |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| AC-001 | Only a successful original source, 1–10 valid distinct maxima and explicit reuse confirmation can queue; malformed inputs create no run | Schema/action tests, pgTAP                                     |
| AC-002 | All alternatives match independent two-variant replay; original and equal maxima reproduce saved results without mutation               | Decimal unit tests, hand-calculated oracle, worker integration |
| AC-003 | Members inspect comparison metrics and a selected ledger, with shared demand/lost-sales evidence and unavailable zero-demand fractions  | Numerical tests, production browser                            |
| AC-004 | Canonical concurrent retries are stable; source deletion preserves evidence; stale work never publishes                                 | Multi-connection local database tests, pgTAP, browser          |
| AC-005 | Cross-tenant/unassigned-branch reads and unauthorized writes fail, including editor revocation during a request-lock wait               | RLS/privilege inventory, database concurrency, browser         |
| AC-006 | Both locales preserve shared fonts, controls and contained scrolling at all five widths                                                 | Browser assertions and screenshot review                       |
| AC-007 | Original simulations still run and display unchanged; no stock, inbound, reservation or policy update occurs                            | Original numerical/database/browser regressions and CI         |

## Rollout and rollback

Development and tests use the local Supabase stack only. Owner-run rollout: stop workers, review/apply `20261019194823_policy_sensitivity.sql`, upgrade/restart the locked engine environment, then deploy the web application. Older workers do not understand the sensitivity method; do not expose new submissions until upgraded workers are ready. Existing original simulations remain supported.

Rollback disables new comparison submissions, cancels pending comparisons with the upgraded code, and reverts web/worker together. Retain the additive database functions and saved evidence; removing schema/history requires a separately reviewed forward migration. No hosted migration or deployment is performed by this development step.
