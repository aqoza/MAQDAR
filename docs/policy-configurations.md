# Policy configuration comparisons (Step 21c)

Approved 2026-10-20: compare one completed original simulation's calculated policy against one to ten explicit combinations of periodic maximum, fixed lead time and review interval. This is a recorded-sales what-if exercise using captured evidence; it does not calculate or activate a service-level policy.

## Workflow and calculation

Open a successful original simulation and choose **Compare policy configurations**. Enter distinct configurations and confirm reuse of the saved evidence. Maxima accept nonnegative decimal strings with at most 15 integer digits and three decimal places. Lead times are whole calendar days from 0–365; review intervals are whole calendar days from 1–365. The same maximum with different timing is allowed. A representable configuration equal to the calculated baseline is allowed as a control.

Normalize decimal spellings exactly and sort by numeric maximum, lead time and review interval. Duplicate tuples are rejected. The baseline retains its original maximum, lead and review settings and reproduces the saved result. Alternative settings are separate evidence and never replace the saved policy fields.

Reuse the source's recorded sold demand, separate lost sales, missing-day provenance, known unit, dates, opening stock, complete-history confirmation and empty starting pipeline/backlog. Only successful original `periodic-replay-v1` sources are eligible; sensitivity/configuration comparisons cannot become sources. New runs require an active location. No current demand, stock or policy is refreshed.

Each configuration uses the [original daily sequence](policy-simulation.md): receive due orders, clear older backlog, review before daily demand, order up to the entered maximum using stock plus pipeline minus backlog, receive zero-lead orders immediately, fulfil today's recorded sales, and carry shortages as backlog. Review on the first replay day and every configured interval thereafter. Keep the original completed window, within its saved forecast horizon. Do not extend history to fit long settings; orders due later remain in ending on-order quantities. A 365-day review interval therefore reviews only once within the maximum 90-day replay window.

Quantities use exact Decimal arithmetic. Averages and fill fractions retain six-decimal half-up rounding; zero sold demand has no fill fraction. Lost sales are not added to replay demand. Unlimited calendar-day supply, fixed timing and backlog carry-forward are assumptions; supplier constraints, working calendars, variable supply and execution remain excluded.

The metrics table shows every maximum, lead and review setting beside average stock, immediate recorded-sales fulfilment, backlog days, ending stock/backlog/pipeline, quantity ordered and order count. Select a configuration for its daily ledger. The shared compact green interface uses current typography, keyboard-accessible local table scrolling, all five widths (375, 768, 1024, 1440, 1920px) and Arabic RTL. No winner, forecast accuracy improvement, future service guarantee or optimum is inferred.

## Persistence, access and retries

`simulation_configurations_enqueue` requires an editor in the active organization and rechecks authority after the organization request lock, including retries. Members inspect results through existing tenant/location RLS. No API-key capability or worker privilege is added. Existing queue limits and lease fencing remain unchanged.

The request UUID identifies the source run, canonical tuple set and reuse confirmation. Identical retries return the original run regardless of row order or decimal spelling; conflicting reuse fails. Copies remain readable after source deletion or later history changes; a source link may become unavailable. Deleting the comparison's own run, organization or location keeps existing cascades. Results are immutable and terminal runs remove private staging.

The new method is `periodic-configurations-v1`. Existing original and maximum-only methods remain supported. The worker reproduces the full original output before replaying alternatives. Publication validates the unchanged baseline, configured timing, every daily ledger's conservation and aggregate metrics under the current lease. Both the copied policy and source evidence remain unchanged. No policy, stock, inbound, reservation or operational order is written.

## Acceptance and verification

| ID     | Observable outcome                                                                                                                | Verification                                                         |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| AC-001 | Only original successful sources and 1–10 distinct bounded confirmed tuples queue                                                 | Schema/action tests, pgTAP                                           |
| AC-002 | Same settings reproduce saved results; zero/long leads and long reviews preserve exact pipeline/backlog without extending history | Hand-calculated unit tests, original replay equivalence, real worker |
| AC-003 | Canonical concurrent retries and copied results survive source changes/deletion                                                   | Multi-connection database tests, browser                             |
| AC-004 | Current editor and tenant/location access remain enforced, including authority changes during lock waits                          | pgTAP, privilege inventory, database concurrency, browser            |
| AC-005 | Invalid or stale worker output cannot publish; existing methods remain compatible                                                 | Publication/fencing tests and original/sensitivity regressions       |
| AC-006 | Inspectable settings, metrics and ledgers fit all five widths and both locales                                                    | Production browser assertions and screenshots                        |

## Rollout and rollback

Development applies migrations only to the local stack. Owner-run rollout: stop workers, review/apply `20261019210852_policy_configurations.sql`, upgrade/restart the engine, then deploy the web application. Older workers cannot process the new method; enable submissions only once upgraded workers are ready.

Rollback disables new submissions and cancels queued configurations using upgraded code before reverting web/worker together. Keep additive functions and immutable history. Any schema removal requires a reviewed forward migration. This increment performs no hosted migration or deployment.
