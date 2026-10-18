# Container-capacity scenarios (Step 18)

Owner-approved on 2026-10-18. PR #60 was reviewed without blocking findings and merged as `6a88cd5` after all three CI jobs passed.

Open **Replenishment → Purchase handoffs → Purchase handoff batches**, choose a saved batch, then **Container capacity**. Enter usable cubic metres and payload kilograms, inspect measurement evidence and confirm applicability to the saved quantities and adjusted order date. Save the scenario and return to the batch for paginated history.

## Calculation and evidence

Each saved quantity is multiplied by its supplier-supplied shipping weight and volume **per purchase unit**, including apportioned packaging. Units must match exactly; catalog units, pack sizes, density and conversion factors are never inferred. Mixed-unit lines are calculated separately before adding physical weights and volumes. Approved quantities, dates, prices and batch downloads remain unchanged.

Both limits and supplied measurements are positive, with up to nine integer and six fractional digits. Products, sums and excess amounts use exact PostgreSQL numerics and travel as decimal strings. Percentages round to two decimals for display only. The within-limits decision compares unrounded totals; a tiny excess can therefore display 100.00% utilization while still correctly exceeding the limit. Exact equality is within limits.

Every line needs current supplier-item measurement evidence: known matching supplied unit, weight, volume and a separate effective-from date no later than the saved adjusted order date. The planner must confirm applicability, including packaging. Missing or incompatible evidence makes the whole batch result unavailable; the interface explains each line and does not present a partial sum as a complete capacity result. Over-capacity results can be saved for inspection; unavailable results cannot.

These are aggregate estimates. Container dimensions, stacking, dangerous-goods restrictions, loading geometry, automatic quantity filling, splitting and shipment execution are outside this step. The result does not guarantee physical fit or book/reserve a shipment.

## Maintenance, imports and API

Supplier-item maintenance, `supplier_items.csv` and the existing scoped master-data API gain optional `shipping_weight_kg`, `shipping_volume_m3` and `shipping_valid_from`. Existing records remain unknown; nothing is backfilled. The existing supplied `unit_of_measure` also applies to these measurements. A separate measurement date avoids borrowing price validity.

Legacy import headers remain accepted. Omitted fields preserve existing evidence except when the effective supplied unit changes: measurements omitted from that update clear to unknown. Updating either measurement without its effective date clears the date, requiring explicit evidence before capacity planning. Unrelated patches preserve measurements. Explicit empty/null values clear fields. The API returns measurements as exact decimal strings; the generated contract and OpenAPI document include them. The import path retains set-based updates, no-op counts, conflict handling and tenant validation.

## Access, saves and history

Members with access to the receiving location inspect previews and saved history; owners, admins and planners save. The RPC checks active-organization membership and location scope even when invoked from the definer save function. The table has tenant and location RLS, SELECT-only member grants, no direct mutation grants and an audit for each new scenario.

New saves require every original batch proposal to remain selected. Saving shares the purchase-review organization lock, rechecks authority after waiting and recomputes the preview against a fresh statement snapshot. A changed fingerprint requires refreshing the preview. Current prices are not re-priced or re-approved by this capacity check; the original handoff remains as-of evidence.

A client request UUID provides stable retries. Identical requests by the original author return their saved scenario with live authorization checks; conflicting reuse fails. Historical retries preserve the original measurements and approval context. New requests require current selection and compatible measurements. Later changes never rewrite saved reports, and live batch-selection status is displayed independently. Organization, source-batch and receiving-location deletion retain the existing cascade behavior.

## Acceptance and verification

- AC-001: Separate line products and aggregate weight/volume totals are exact, including mixed units, six-decimal measurements and small overages. Missing evidence prevents a complete result.
- AC-002: Positive limits, unit/date/applicability checks and per-line reasons are enforced in SQL and the UI.
- AC-003: Maintenance, imports and API accept optional measurement evidence with legacy compatibility, exact readback and explicit invalidation rules.
- AC-004: Only editors save; tenant, active-organization, viewer and branch restrictions hold for previews, history and retries. Direct writes are refused.
- AC-005: Concurrent retries create one record and audit. Measurements, units, approval selection, authority and source deletion are rechecked after lock waits. Saved evidence and stock/order data remain unchanged.
- AC-006: Shared compact green typography, forms, local table scrolling and keyboard evidence inspection work at 375, 768, 1024, 1440 and 1920px, with Arabic RTL checks.

Local verification covers 75 capacity pgTAP assertions, seven concurrent-save and lock-wait tests, 1,341 web unit tests, 294 engine unit tests, generated-type parity, production build, lint and logical CSS checks. The capacity browser workflow and existing purchase-batch regression pass without retries. Screenshots were inspected at 375, 768, 1024, 1440 and 1920px, plus Arabic RTL at 375 and 1440px; keyboard evidence controls and local table scrolling are exercised.

Database suites run sequentially on the loopback stack. The PR runs the complete database, browser and Cloudflare packaging checks in CI. No hosted migration or deployment is performed by this step.

## Rollout and rollback

Apply `20261017220438_container_capacity_scenarios.sql` before the new web build. It adds nullable measurement columns, private import/API updates and an empty RPC-only scenario table. No stored business data is rewritten. Rollback restores the previous web build and retains the additive database objects and saved evidence; destructive schema rollback is unnecessary. No worker update is required.
