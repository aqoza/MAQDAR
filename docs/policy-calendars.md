# Calendar-aware simulations (Step 21e)

Approved 2026-10-20 after PR #108 merged as `88cc17e`. From one successful MOQ/pack comparison, retain its calculated baseline and all saved alternatives, and replay each alternative with one explicitly selected active ordering work calendar and the source location's receiving calendar. These are recorded-sales what-if comparisons, not supplier promises or policy recommendations.

## Captured inputs

Open **Compare working calendars** on a completed MOQ/pack comparison. Select an ordering work calendar and refresh the preview. Inspect its settings, the receiving calendar, evaluated dates and references. Confirm that those current, unversioned settings apply to the historical replay before queueing.

The server captures the entire source comparison, its original simulation, demand, separate lost sales, unit, opening stock, empty initial pipeline/backlog, maximum/lead/review/MOQ/pack settings, active receiver identity, calendar definitions, country holiday coverage, holidays and overrides. The receiving location uses its assigned calendar or country default. No supplier terms are inferred. A new run requires an active location and active assigned calendars.

Calendar evaluation reuses the delivery-scenario contract: calendar overrides precede country overrides, then verified all-sector public holidays, weekends and the weekly pattern. Unknown coverage never establishes a working day. Explicit working overrides and calendars explicitly configured not to observe holidays keep their existing meanings. This feature does not change regional reference coverage.

Ordering facts cover the replay window. Receiving facts cover its first day through its last day plus 454 days (365 maximum fixed lead plus 89 possible search offsets). Evidence is bounded to 20 MB and outputs to 5 MB. Only dates actually required by a review or positive order determine availability; unrelated unknown future dates do not invalidate a comparison.

## Scheduling and calculation

1. Nominal reviews remain anchored to the first replay day and recur at each alternative's saved review interval.
2. Shift a closed-day review to the next known ordering working day. Stop at the first unknown date; never skip it. Reviews deferred to the same actual day combine into one review.
3. Do not create orders for reviews beyond the replay window. Stop ordering searches at the window boundary without requiring evidence beyond it. Ninety evaluated closed dates exhaust the search.
4. On each replay day, receive existing due orders and clear older backlog first. At an actual review, recompute `gap = max(maximum − (stock + outstanding simulated orders − backlog), 0)`.
5. A zero gap orders zero, regardless of MOQ, and needs no receiving-date search. Otherwise order `ceil(max(gap, MOQ) / pack) × pack` exactly once for that day's combined review.
6. Add the saved lead time in calendar days to the actual order date. Move receipt to the first known receiving working day on or after that nominal receipt. Evaluate at most 90 dates, including the start. Unknown required coverage or search exhaustion makes the whole adjusted comparison unavailable.
7. An adjusted receipt on the order day arrives before that day's demand and clears older backlog first. A later receipt joins the pipeline, including when it falls beyond the window.
8. Fulfill that day's recorded sold demand and carry shortages as backlog, including on closed days. Lost sales remain separate. Never extend the replay window.

Exact quantities use the same decimal limits as the source. Displayed averages and immediate-fill fractions retain six-decimal half-up rounding. SQL uses integer quotient rounding to avoid an intermediate rounded division near a half boundary. The unchanged source results retain their original method and numbers.

## Results and lifecycle

`periodic-calendars-v1` stores adjusted variants separately from the immutable source comparison. The table shows the saved calculated baseline, each original alternative and its corresponding calendar alternative. Select a daily ledger and inspect nominal/actual review and receipt dates. Combined nominal reviews are retained in the saved ledger. No winner is selected.

An unavailable result retains the failing alternative, ordering/receiving stage, nominal date and last evaluated date. It publishes no partial adjusted metrics. The saved baseline and alternatives remain inspectable. A completed run can therefore have an unavailable comparison; this is a diagnosed evidence limitation, not a worker failure.

Preview is member/location scoped; queueing requires a current editor, the applicability confirmation and the preview fingerprint. The queue operation rechecks authority after its organization advisory lock, refreshes the evidence and rejects changed fingerprints. Request UUID, source, ordering calendar, fingerprint and confirmation bind stable retries. Identical retries return the existing run after source or calendar changes/deletion while enforcing current access.

The existing private worker queue, leases, cancellation and cleanup remain. SQL independently recalculates the complete output before publication. The worker gains no new database privilege. Results use the existing tenant/location RLS and remain immutable after source changes/deletion. Their own run, location and organization retain existing deletion rules.

Shared typography, compact green surfaces, keyboard-scrollable tables, 375/768/1024/1440/1920px and Arabic RTL apply. Methodology and detailed calendar references stay expandable.

No live stock, order, reservation or policy is changed. Supplier selection, variable lead-time distributions, capacity constraints, warm-up periods and operational execution remain outside this increment.

## Acceptance

| ID     | Required observable behavior                                                                                               | Verification                                 |
| ------ | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| AC-001 | Only a successful MOQ/pack source, active calendars/location and confirmed current preview can queue                       | Schema/action, database and browser tests    |
| AC-002 | Deferred reviews combine; gap and MOQ/pack quantity are recalculated once on the actual day                                | Hand-calculated engine and SQL cases         |
| AC-003 | Receiving shifts, zero lead, missing coverage, zero gaps, search limits and ending pipeline follow the documented sequence | Engine/SQL parity and boundary cases         |
| AC-004 | Source results remain unchanged and unavailable comparisons expose no partial adjusted metrics                             | Real-worker publication and browser evidence |
| AC-005 | Changed previews fail; concurrent and historical retries produce one run                                                   | Real database tests                          |
| AC-006 | Tenant, location, role and lease boundaries prevent unauthorized or stale publication                                      | pgTAP privileges, database and browser tests |
| AC-007 | English and Arabic forms/results fit all five widths and tables remain keyboard accessible                                 | Production Playwright and screenshot review  |
| AC-008 | Earlier simulation versions and existing workflows remain compatible                                                       | Unit, database and full CI regression suites |

## Rollout and rollback

Development verification uses local Supabase only. Rollout order: stop workers, apply `20261020072201_policy_calendars.sql`, upgrade/restart workers, then deploy the web queue interface. Older workers cannot process this new method. Verify a small available comparison and an unknown-coverage diagnosis after upgrading.

For rollback, disable new calendar submissions and cancel pending calendar runs with the upgraded code before reverting web/worker together. Retain additive database functions and immutable results; removal requires a reviewed forward migration.
