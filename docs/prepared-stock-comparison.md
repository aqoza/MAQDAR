# Prepared-group stock comparison (Step 12d)

Owner-approved on 2026-10-16. Extends the policy workbench comparison to saved prepared groups with two-way, 1:1 interchangeability and captured demand-unit evidence.

## Eligibility and calculation

Every saved member must be reachable from every other member through saved two-way interchange edges. All members must have the same saved unit, and every saved contribution factor must equal one. Transitive two-way connections are valid. A single-member preparation is also valid. Directed supersession conversion alone never establishes stock interchangeability, even when its factor is one. Relationships and item identities come from the saved preparation; current catalog changes do not redefine the pool.

New preparation captures include `source-units-v1` statistics per source over recorded, lifecycle-eligible demand rows: total rows, rows without units and distinct supplied units. Lost-sale-only observations count. The aggregate must contain at least one recorded observation, with every recorded eligible row explicitly labeled in the common group unit. A member with no recorded rows adds no observations; missing days remain zero only under the original complete-history confirmation. Conflicting or unknown aggregate units prevent stock comparison. Existing preparation conflict diagnostics remain unchanged.

The guarded prepared-forecast task derives `two-way-stock-v1` evidence from the saved preparation and copies member identities, per-member unit statistics, combined provenance and eligibility into its immutable input. Publication retains that source evidence, and policies copy it. Captured retries cannot infer units or relationships from later live edits. Legacy preparations, previously captured forecasts and older policies remain non-comparable; create a new preparation, forecast and policy after labeling source history. Numerical forecasting and policy methods are unchanged.

The user selects the calculated maximum or an exact approved override, and the comparison date must equal the saved forecast cutoff. At the policy location, choose each member's latest snapshot on or before that date. Every member requires an explicit matching unit and a snapshot at most seven days old. Future snapshots are excluded. Missing, stale, unlabeled or incompatible members invalidate the whole comparison, with individual diagnostics; members are never silently removed from the pool.

`pooled available stock = sum(member on-hand − member allocations)`

`quantity above maximum = max(pooled available stock − selected periodic maximum, 0)`

Member deficits reduce the pool before the final clamp. Each saved member is counted once. For example, `(12 − 2) + (5 − 1) − 7 = 7` units above maximum. SQL numeric arithmetic and decimal-string transport preserve precision; display rounds to three decimals. Valid zero differs from unavailable.

The report shows member identities, source-unit statistics, snapshot identities/dates/update times, quantities, costs and currencies. Each eligible snapshot's physical inventory value is its on-hand quantity times unit cost. Currency-separated totals appear only when the full comparison is available. These contextual values are **not the value of pooled excess**. Pooled-excess valuation is deferred until an explicit cost-allocation rule is approved; `value_above` remains null for groups. There is no currency conversion, cross-location pooling or order execution.

As with [individual comparisons](stock-comparison.md), this is a scenario using currently recorded stock and explicitly chosen thresholds, not a reconstruction of information known on the cutoff date. Corrected stock observations can change the report. The periodic maximum targets inventory position; this comparison excludes inbound orders and backorders and does not recommend purchasing, transfers or disposal.

## Acceptance and verification

| Criterion                                                                                                                                         | Verification                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Saved two-way connectivity, identity conversions and matching units determine eligibility; supersession-only and legacy groups remain unavailable | pgTAP graph and provenance cases            |
| Lifecycle-eligible source units survive retries and live graph/catalog/history edits through preparation, forecast and policy                     | Real-worker database integration            |
| Hand-calculated pooling, member deficits, valid zero, seven-day boundary, future exclusion and complete membership                                | pgTAP numerical and boundary oracles        |
| Exact approved revision is selected; tenant, branch and active-organization restrictions remain enforced                                          | pgTAP authorization and privilege snapshots |
| Physical stock value stays separate by currency; pooled-excess value is absent; decimal strings stay exact                                        | SQL and web schema checks                   |
| A real preparation/forecast/policy appears in the workbench, shows member evidence, and becomes unavailable when a member snapshot is missing     | Production-build Playwright                 |

## Owner-run rollout and rollback

Stop workers, review/apply `20261016052037_prepared_stock_comparison.sql` with `pnpm exec supabase db push`, deploy the web build, and restart workers. This migration changes functions only; it does not rewrite tables, backfill historical evidence, add dependencies or grant a new worker capability. Current worker code carries the additive captured source fields without numerical changes. Only the local test stack is migrated during development.

The comparison remains a session-only SECURITY INVOKER RPC with explicit organization/location filters and underlying RLS. The evidence helper is private to the guarded task; users, the API service role and workers have no direct execution grant. Group size remains bounded by preparation's 100-source limit.

For rollback, retain the compatible current reader, or first use a separately reviewed forward migration to restore the prior comparison RPC so that prepared groups return unavailable, then revert the web build. An older reader assumes every available comparison has one snapshot and cannot render an available pool. Preserve additive captured evidence, existing results and individual comparisons; do not rewrite or delete historical artifacts.
