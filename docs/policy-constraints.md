# MOQ/pack simulations (Step 21d)

Approved 2026-10-20: compare a completed original simulation's calculated baseline with 1–10 explicit maximum, fixed lead-time, review-interval, MOQ and pack combinations. These are confirmed planner what-if assumptions in the source's known unit, not verified supplier terms or purchasing recommendations.

## Inputs and calculation

Open an original completed simulation and choose **Compare MOQ/pack settings**. Each maximum and MOQ is nonnegative; each pack is positive. Quantity inputs accept at most 15 integer digits and three decimal places. Lead times are whole calendar days from 0–365, reviews from 1–365. Decimal spellings are normalized exactly and configurations sorted by maximum, lead, review, MOQ and pack; duplicate complete tuples are rejected. Defaults of MOQ zero and pack one are visible editable assumptions, not inferred unit granularity.

The calculated baseline is reproduced unchanged, with null MOQ/pack metadata identifying its unconstrained method. Alternatives reuse the original captured daily sales, separate lost sales, missing-day provenance, unit, dates, opening stock, empty initial pipeline and zero backlog. Only successful original `periodic-replay-v1` simulations can be sources. No current stock, demand, policy or supplier terms are refreshed.

On the first replay day and every configured review interval thereafter, after receiving due orders and clearing older backlog:

1. Calculate `gap = max(maximum − (on-hand + outstanding simulated orders − backlog), 0)`.
2. If the gap is zero, order zero even when MOQ is positive.
3. Otherwise order `ceil(max(gap, MOQ) / pack) × pack` using exact quantities.
4. Follow the original daily sequence: zero-lead receipts arrive during review, older backlog is cleared first, then today's recorded sold demand is fulfilled and remaining demand becomes backlog.

Non-review days have zero order gap, order and rounding extra. Each review's rounding extra is its rounded order minus its gap. Sum those extras exactly for inspection; this sum is not the net difference from baseline orders because rounding changes later inventory positions. The baseline has no rounding fields and displays a dash in those columns, not an assumed pack of one.

Keep the original window (at most 90 days) without warm-up or extension. Orders due later stay in the ending pipeline. Preserve fixed calendar-day timing, unlimited supply and backlog carry-forward. Lost sales are never added to replay demand. MOQ is a quantity minimum per simulated order, not a supplier-wide spend threshold. There is no cost calculation, working calendar, variable supply, automatic winner, policy update or operational order.

## Results and lifecycle

The versioned method is `periodic-constraints-v1`. Exact Decimal arithmetic governs ledgers and order rounding; original averages and fill fractions retain six-decimal half-up rounding. The compact comparison shows settings, original simulation metrics and total rounding extra, with a selected daily ledger exposing gaps and rounding. Method guidance is expandable. Preserve shared typography, local keyboard table scrolling, 375/768/1024/1440/1920px and Arabic RTL.

`simulation_constraints_enqueue` checks current editor authority, active organization and location scope, rechecking authority after the organization request lock. The source must be complete and its location active for a new run. A request UUID plus the source, canonical full tuple set and reuse confirmation identifies retries. Reordered equivalent inputs return the same run; conflicting reuse fails. Existing run limits, cancellation, staging cleanup and lease fencing remain.

Copies remain immutable and readable under tenant/location RLS after source changes/deletion. Retries still enforce current access. The comparison's own run, organization and location follow existing deletion rules. No API-key scope or worker privilege is added. Publication verifies the copied baseline, each alternative's full receipt/review/rounding sequence, ledger conservation and metrics under the current worker lease. Original replay, sensitivity and configuration methods remain compatible.

## Acceptance and verification

| ID     | Observable outcome                                                                               | Evidence                                                    |
| ------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| AC-001 | Only confirmed, distinct, bounded tuples from eligible original sources queue                    | Schema/action tests, pgTAP                                  |
| AC-002 | Zero gaps never order; fractional packs, MOQ and large exact values obey the documented sequence | Hand-calculated engine tests, SQL publication, real worker  |
| AC-003 | Baseline and captured evidence remain fixed; retries survive source changes/deletion             | Unit, concurrent database and browser tests                 |
| AC-004 | Current editor/location access and worker leases prevent unauthorized or stale publication       | pgTAP privilege inventory, database concurrency and browser |
| AC-005 | Results distinguish assumptions, baseline and rounding while fitting five widths and RTL         | Production browser assertions and screenshots               |
| AC-006 | Existing simulation methods and unrelated workflows remain compatible                            | Regression suites and full CI                               |

## Rollout and rollback

Development applies migrations only to local Supabase. Owner-run rollout: stop workers, review/apply `20261019222934_policy_constraints.sql`, upgrade/restart workers, then deploy web submissions. Older workers cannot process the new method. Queue a small comparison and inspect its result after upgrading.

Rollback disables new submissions and cancels pending constraint runs using upgraded code before reverting web/worker together. Keep additive functions and immutable history; schema removal requires a reviewed forward migration. This development increment performs no hosted deployment or migration.
