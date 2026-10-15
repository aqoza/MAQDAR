# Demand preparation (Step 10)

Owner-approved scope and grouping rules: 2026-10-15. Method: `preparation-v1`.

## Scope and acceptance

Planners queue an inspectable preparation run for one location and a confirmed complete history window. Results show related-part groups, original and converted source contributions, combined daily sold demand, separate lost sales and daily calendar evidence. This is a saved preparation artifact; it does not modify demand, inventory, classifications or forecasts. Learned regional forecast adjustments, refreshed reference coverage, weather drivers and inventory policies remain later increments.

| Criterion | Observable result                                                                                                                                                                                                                   | Verification                                                         |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| AC-001    | An editor selects 1–25 codes, one active location and at most 1,096 inclusive days; confirmation applies to every related source. Invalid, stale-organization and unauthorized requests create no run.                              | Action tests and pgTAP                                               |
| AC-002    | The captured connected graph includes effective predecessors, successors and two-way equivalents. Each source contributes once, using exact chained factors; one-way substitutes remain separate.                                   | Hand-calculated, convergence, order-invariance and real-worker tests |
| AC-003    | Conflicting paths, unit mismatches and combined graph cycles produce blocked groups with source identities and no aggregate quantities. Other valid groups remain inspectable.                                                      | Numerical and browser tests                                          |
| AC-004    | Calendar evidence follows captured configuration and overrides. Unknown reference dates remain unknown; closures never remove recorded sales. Outside all source lifecycles, daily demand is unavailable rather than invented zero. | Calendar/lifecycle tests and browser workflow                        |
| AC-005    | Retries reuse captured demand, relationships and calendar data. Stale/canceled leases cannot publish, and publication is atomic. Results remain tenant/branch scoped and API read-only.                                             | Database integration, pgTAP and privilege snapshots                  |
| AC-006    | Users inspect group totals, conversion factors, original/converted contributions and daily calendar flags. The results page fetches summary or computed output without loading raw source history.                                  | Production build and Playwright                                      |

## Grouping and conversion

The snapshot expands each selected item through undirected connectivity of supersessions effective on or before the history cutoff and all current two-way interchange edges. Selecting either an old or new code therefore includes the connected planning group. Overlapping selections do not duplicate sources. Future supersessions and one-way substitutions do not connect groups. Interchanges have no effective-date fields: the current captured record is used, not an invented historical version.

Within each connected component, two-way interchanges form 1:1 equivalence classes and require identical recorded unit-of-measure strings. Effective supersession edges then form a directed graph between classes. A factor is successor units per predecessor unit; factors multiply along each path. All paths from a class must agree on both the terminal class and the exact conversion factor. Cycles, incompatible factors and divergent terminal classes block the component. A factor-one replacement within an equivalence class is an identity; a different factor conflicts. Interchange priority controls substitution elsewhere and has no pooling effect here.

A terminal equivalence class is represented by its smallest item code, with UUID as a tie-breaker. This representative does not imply a preferred stocking or procurement part. Blocked groups use a stable captured UUID solely as their result identity. Item records remain historical even after recoding or deletion.

The owner approved **cutoff mapping**: once a supersession is effective at the selected cutoff, all eligible predecessor history in the window is converted to terminal units, including observations before that relationship's effective date. This is an as-of-cutoff planning view, not a reconstruction of the catalog known on each historical day. Do not feed it into a backtest as if future relationship knowledge had been available at earlier origins; a later forecasting integration must define that separately.

## Observation windows and quantities

The complete-history attestation includes automatically included related sources at the selected location. Each source's window is clipped by its introduction and discontinuation dates, inclusively. Missing days are zero only inside that clipped window. Original rows outside it are retained in evidence but excluded from contributions. Recorded status alone does not infer lifecycle dates.

Daily totals sum converted sold quantities and converted lost sales separately. A day with no eligible source lifecycle has null totals and zero active sources. Summary totals sum eligible observations; they can be zero when the entire selected window has no eligible source days, which remains visible in the daily table. Calendar closure flags never erase quantities.

Sources and conversion factors remain decimal strings. A local 2,048-digit Decimal context accommodates the bounded graph's at most 100 `numeric(18,3)` factors, multiplication by source quantities and summation without binary floating-point conversion. Converted quantities are not rounded before aggregation. The UI displays quantity totals to three decimal places; stored evidence preserves their exact decimal values and conversion factors.

## Calendar interpretation

An assigned work calendar supplies weekend days, holiday-observance preference and its holiday-source country. If its country is null, regional flags use the location country; a calendar with no country cannot observe public holidays under the existing schema. Locations without a work calendar use their country's defaults. An inactive assigned calendar produces unknown working-day status rather than silently changing to another calendar.

Working-day precedence follows the existing documented order: matching calendar override, matching country override for the calendar's country, applicable public holiday, then weekly pattern. `working_day` overrides can reopen holidays/weekends; `closure` overrides close any date. Public-holiday closure uses `sector=all`, matching the work-calendar contract. Regional flags remain independent of the resulting working-day decision.

Holiday and Ramadan/Eid/Arafat flags are known only inside the captured country's verified coverage bounds. Outside those bounds, flags are null. An explicit override, a known weekend closure, or a calendar that does not observe public holidays can still establish working-day status. The snapshot stores the reference rows, sources, coverage limits and overrides. The currently seeded coverage ends on 2026-09-30 for SA/AE/QA/KW/OM; BH/EG/JO have no verified coverage. This release does not extrapolate moon-sighting dates, infer a multi-day Hajj window or use synthetic heat multipliers.

## Persistence and limits

The new editor-only `preparation_enqueue` RPC reuses planning idempotency, one-active-run and 20-runs-per-day rules. Inputs are captured at first processing in one database statement: selected connected catalog, sparse observations, effective graph and calendar context. Up to 25 selected codes may expand to at most 100 sources; capture is capped at 8 MB. Oversized inputs fail visibly rather than truncating a group. A missing selected item also fails rather than shrinking the requested scope.

Private `planning.preparation_inputs` survives retries until terminal status. `preparation_finish` checks the lease, exact disjoint source membership, group identity, bounded shapes and a 10 MB output limit. It saves `demand_preparations`, completes the run and archives the queue message atomically. Raw group source items plus captured graph/calendar evidence remain in each result. A blocked group is a completed diagnostic, not a transient retry. Existing 120-second lease and 90-second statement timeout apply; raw table access remains denied to the worker, which gains only the guarded finish RPC.

`demand_preparations` uses tenant and restrictive location RLS, a composite organization/run/location foreign key, and SELECT-only API access. The results page reads group summaries and projects only computed output and small calendar metadata for the chosen group. It does not transfer raw source history into the browser.

## Owner-run rollout and rollback

1. Stop hosted workers. Review `20261015140000_demand_preparation.sql`, then apply it yourself with `pnpm exec supabase db push`.
2. Install the upgraded worker with `uv sync --locked` and restart it. Its existing capability role gains `app.preparation_finish`, bringing its guarded worker RPC count to seven.
3. Deploy the web build. Open **Forecasts → Prepare demand**, select a small related group and complete window, and inspect contributions and daily calendar evidence. Check readiness, classification and both forecast methods as regression smoke tests.
4. To roll back, stop preparation submissions and cancel queued preparation runs before reverting worker/web together. Preserve schema and historical results; older workers cannot process the new run kind. Retain the current results reader if historical preparation inspection is needed. Destructive rollback requires a separately reviewed migration.

This task applies migrations and runs workers only against the local stack. Hosted rollout remains owner-run.

## Verification evidence

A local maximum-size compute benchmark on 2026-10-15 processed 100 source items, 25 connected groups and 1,096 daily observations in 0.923 seconds. Serialized capture/output sizes were approximately 3.31/8.04 MB, below their 8/10 MB limits. This measures the deterministic fixture on the development machine, not production query latency or a throughput guarantee. Full regression results are recorded in the PR checks.
