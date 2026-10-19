# Individual-item policy simulation (Step 21)

Approved 2026-10-19: begin Phase 4 with a recorded-sales replay of one saved individual-item policy and one planner-entered alternative maximum. Both use the same explicit opening available stock, fixed calendar-day lead time and review interval, initially empty incoming-order pipeline and zero backlog. This begins the simulation center; deferred Phase 3 operational features remain on the roadmap.

## Evidence and scope

From the policy workbench, choose **Simulate policy**. Select an available individual-item policy with consistent saved demand-unit evidence. Prepared groups, event-adjusted maxima and approved overrides are excluded. Keep the calculated periodic maximum, lead time and review interval fixed, and enter a separate nonnegative alternative maximum and opening quantity. These two inputs accept up to 15 integer digits and three decimal places; saved calculated maxima are bounded at 10^30.

The window starts the day after the forecast cutoff and ends within its saved horizon (at most 90 days), before the organization's current business date. Every recorded history row must have the same supplied unit as the saved policy. Explicitly confirm complete sold-demand history before missing dates become zero. A second confirmation covers the controlled opening state. Starting stock is a planner assumption, not live available stock.

Capture the policy, daily sold quantities, separate lost sales, which days were recorded, and assumptions when the run is queued. Subsequent history imports, catalog changes and source-policy deletion do not rewrite that evidence. Source links can become unavailable while the copied simulation remains readable. A new run is needed for new evidence. Neither variant refits a forecast or updates its maximum during the replay.

Recorded sales can be censored by historical stock-outs. Lost sales are shown separately and never added to replay demand. Results are conditional comparisons against the captured recorded sales, not achieved cycle service, unconstrained demand, future performance or an optimized choice. Initial conditions and a short horizon can substantially influence results; there is no warm-up exclusion or automatic winner.

## Numerical contract: `periodic-replay-v1`

Use exact decimal quantities throughout the daily ledger. Day zero is the first post-cutoff day. For each day:

1. Receive previously simulated orders due that morning.
2. Satisfy older backlog before new demand.
3. Review on day zero and every `R` days thereafter. Order `max(S - (on_hand + outstanding_simulated_orders - backlog), 0)` where `S` is the variant's fixed maximum. Non-review days place no order.
4. An order with zero lead time arrives immediately during this review; use it to clear remaining older backlog. A positive-lead order arrives at the start of `order_date + L` calendar days.
5. Fulfil as much of that day's recorded sold quantity as possible from stock. Carry the remainder as backlog. Record closing stock, backlog and outstanding simulated orders; preserve orders due beyond the replay window.

Assume unlimited supply and calendar-day availability. Exclude live inbound, allocations, MOQ/pack rounding, supplier calendars, costs, variable lead times, reservations and actual order creation. The reorder-point reference is not used as a trigger for this periodic policy. The periodic-review and inventory-position definitions follow [MIT inventory-policy notes, slides 5–7](https://ocw.mit.edu/courses/esd-260j-logistics-systems-fall-2006/8b53c45fd26ffff706d815131e8d177e_lect11.pdf); the daily sequence and controlled starting state are explicit owner-approved simulation assumptions.

Each result contains two independent ledgers, with demand, separate lost sales, opening stock, receipts, older backlog fulfilled, review flag, order quantity/due date, immediate fulfilment, new backlog and closing quantities. Conservation checks require stock and backlog never to coexist at close, and reconcile each quantity with the previous day's state.

Metrics include total recorded sold/lost quantities, immediate fulfilment, simulated quantities ordered/received, order count, average closing stock, days with closing backlog, ending stock/backlog and outstanding simulated orders. Immediate-fill fraction is immediate fulfilment divided by total recorded sold quantity; it is unavailable when that denominator is zero. No delayed backlog fulfilment is counted as immediate. Save exact totals, including the closing-stock sum and day count. Round the average and fraction once half-up to six decimal places; display percentages to two decimal places. Those metric rounding steps never alter the ledger or order quantities.

## Queue, access and lifecycle

An additive `simulation` planning kind reuses the existing organization throttle (one active run, 20 new runs per rolling 24 hours), request identity, cancellation, retries and 120-second lease. The bounded calculation runs in the Python worker without a new dependency. Database publication validates the captured dates/demand, ledger conservation and reported metric totals before atomically storing the result and acknowledging the queue message. A replaced, expired or canceled lease cannot publish.

Editors (owner/admin/planner) queue or cancel; members read under organization and existing restrictive location RLS. The enqueue RPC checks current editor authority and active organization before stable retries, so changing roles does not bypass access. New submissions require an active location. Inputs are private; the worker receives a ninth publication capability, `app.simulation_finish`, and no direct table privilege. Existing integration API keys gain no simulation access.

The request UUID is unique within the organization's planning runs. Identical normalized inputs return the same run, even after source deletion or terminal completion; conflicting reuse fails. Successful results retain copied inputs. Terminal status removes private staging as with other planning runs. Deleting the simulation's own planning run/organization follows existing cascades. No retention job or additional deletion privilege is introduced.

## Acceptance and verification

| Criterion | Observable outcome                                                                                                                                        | Verification                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| AC-001    | An editor queues only a known-unit individual policy, completed window, bounded quantities and both confirmations; invalid submissions create no run      | Schema/action tests, pgTAP and worker integration                                       |
| AC-002    | Two variants replay identical captured demand with the documented daily sequence; equal maxima produce identical ledgers                                  | Hand-calculated examples, zero-lead and end-of-window cases, decimal/conservation tests |
| AC-003    | Results show both ledgers, assumptions, lost-sales distinction and precise metric meanings; zero-demand fraction is unavailable                           | Numerical tests, database publication and production browser                            |
| AC-004    | Retries preserve inputs; source edits/deletion, cancellation, expired and replaced leases cannot change or double-publish results                         | Concurrent database integration and browser lifecycle                                   |
| AC-005    | Foreign tenants, stale claims, unassigned branches and non-editors are denied their respective operations without direct input/result write privileges    | pgTAP privilege/RLS inventory, worker and browser access tests                          |
| AC-006    | Forms/results preserve shared compact green typography, keyboard scrolling and responsive layout in English/Arabic RTL at 375, 768, 1024, 1440 and 1920px | Production browser assertions and screenshots                                           |
| AC-007    | Existing planning workflows still function and no operational inventory/order record changes                                                              | Full unit, focused pgTAP, planning browser regressions and full CI                      |

## Rollout and rollback

No hosted migration or deployment is performed during development. Owner-run rollout: stop existing workers, review/apply `20261019180044_policy_simulations.sql` with `pnpm exec supabase db push`, install the locked engine environment, restart upgraded workers, then deploy the matching web build. Older workers do not understand the new run kind, so do not allow new submissions before the worker upgrade. Queue a small simulation and inspect its completed result.

Rollback: stop submissions and workers, cancel outstanding simulation runs while the updated code is available, then revert web/worker together. Preserve the additive migration and saved history. Schema removal or data purging requires a separate reviewed forward migration. Test and migration verification use only the local Supabase stack; no production settings or credentials change.
