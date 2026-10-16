# Delivery-date scenarios (Step 13c)

From a saved available supplier MOQ/pack scenario, choose **Create delivery-date scenario**, enter a requested order date, confirm that the current calendar settings apply, and refresh the preview. Inspect each evaluated date, the captured calendar references and any policy-recalculation flag before saving. The supplier scenario page lists its saved date scenarios with pagination.

## Approved calculation

1. Start on the requested date, which must be on or after the source draft cutoff. Find the first known supplier working date on or after it.
2. Add the saved fixed lead time in **calendar days** to obtain the nominal receipt date.
3. Find the first known receiving-location working date on or after the nominal receipt date.
4. If receipt is later than the draft cutoff plus the saved lead time, flag **policy recalculation required**. The saved maximum and quantity remain unchanged; this release does not recalculate them.

The source must be an available individual-item supplier scenario with a saved quantity and lead time. Zero quantity produces `no_order_needed`, without scheduling dates or requiring calendar confirmation. Positive quantities require an active supplier and receiving location and explicit confirmation of calendar applicability. Dates are indicative business dates; intraday ordering cutoffs, time-zone transit, capacity, transit calendars and supplier promises are not modeled. These scenarios do not execute orders, refresh stock, price purchases, or claim service sufficiency.

## Calendar evidence and bounds

An assigned work calendar supplies weekends, holiday observance and its configured country; otherwise the entity's country defaults apply. Calendar overrides take precedence over country overrides, then verified all-sector public holidays, then weekends and the weekly working pattern. Assigned inactive calendars are unavailable. An explicit working-day override can resolve a weekend or an uncovered date; a closure or known weekend can establish a closed date even outside holiday coverage. Ignoring public holidays is an explicit work-calendar setting, never an inference from absent holiday rows.

Search stops at the **first unknown date**, because skipping it cannot establish the earliest working date. Each stage evaluates at most 90 dates, including its start; 90 closed dates yield `search_exhausted`. Requested dates are bounded to 1900-01-01 through 2100-12-31; saved lead times retain their existing 0–3650-day bound. A supplier country outside the reference table has no inferred weekend or holiday coverage; an explicit calendar can supply working-day evidence.

This release does not extend reference coverage. Seeded SA, AE, QA, KW and OM holiday coverage ends on 2026-09-30; other countries may lack coverage. Current dates therefore commonly require applicable explicit calendar settings or exceptions. Do not disable holiday observance merely to obtain a result. Calendar confirmation attests applicability of the captured unversioned settings; it does not establish missing holiday coverage.

Each immutable report captures the source scenario and fingerprint, quantity, unit, lead time, cutoff, current supplier/receiver identities, calendar settings and timestamps, coverage, bounded holiday rows and overrides, every evaluated date and reason, calculated dates, and the recalculation flag. The supplier reference window spans requested date through +89 days; the receiving window spans requested date plus lead through +178 days to cover both possible shifts. Later supplier-term, stock, calendar or reference changes do not alter saved evidence. Refreshing creates a new scenario from the same saved source; it does not update the source terms.

## Persistence and access

`delivery_scenario_preview` explicitly checks live membership, the active organization claim and branch scope before reading the source. It uses definer rights to call three private calendar helpers, which are not callable by API roles or the worker. `delivery_scenario_save` requires a live owner, admin or planner, checks again after acquiring the organization advisory lock, recomputes the preview and rejects changed fingerprints with MQ409. Retry identity binds author, source, requested date, confirmation and fingerprint; identical retries return the original record even after calendar edits.

`delivery_scenarios` is select-only for authenticated members, with restrictive location RLS and an audit trigger. A narrow invoker view provides paginated history. Unavailable diagnoses may also be saved. Direct table mutations, cross-tenant reads/writes and restricted-branch previews are denied. REST API and worker capabilities are unchanged.

## Acceptance and verification

- Supplier and receiving closures independently shift dates while lead time stays in calendar days; late receipt flags recalculation.
- Overrides, weekends, verified holidays, missing coverage, external countries, inactivity, zero quantity and the 90-date boundary have explicit outcomes.
- Preview changes require refresh; saved dates retain their evidence and retries create one row and one audit event.
- Tenant, claim, branch and role checks apply to preview, save, detail and history, including authority changes while waiting for a lock.
- The browser flow previews, rejects stale saves, refreshes, saves, reads history and preserves evidence after edits; viewers can inspect without saving.
- Validation includes pgTAP 0040 and privilege invariants, independent Python concurrency tests, web input/action tests and the replenishment Playwright journey, plus the existing regression suites.

## Owner-run rollout and rollback

After review, the owner runs `pnpm exec supabase db push` for `20261016100543_delivery_scenarios.sql`, then deploys the web build. The migration adds objects without rewriting existing data; indexes are created on a new empty table. Existing supplier pages work during the database-first rollout. There is no import contract change, worker upgrade, scheduled job or credential change.

Rollback by restoring the previous web build and retaining the additive database objects and saved evidence. Do not drop saved scenarios to roll back the UI. No hosted migration or deployment is performed by this development task.
