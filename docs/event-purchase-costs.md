# Step 19f: event purchase-cost comparisons

Status: implemented and locally verified; review pending. Approved revision 1, 2026-10-18.

PR #68 was reviewed at `6226df048c4e997d0c3fb5368cdd6028c9d6ddd7` with no blocking findings, all three CI jobs passed, and it merged as `4e57e959f805023d1841d97e6e3a09c91a795267`. Local main is current. This increment extends the saved event workflow by one PR.

## Goal and scope

Let planners inspect and save the baseline and event-adjusted purchase subtotals, and their difference, from one saved event delivery scenario. Preserve its quantities, dates, original assumptions and warnings. Keep the shared compact green UI at 375, 768, 1024, 1440 and 1920px.

Out of scope: quantity/date/policy recalculation, price tiers or discounts, taxes, freight, duty, FX, event stacking, purchasing approvals, exports, reservations and order creation. No changes to ordinary purchase-cost semantics, API/import contracts or the worker.

## Verified technical context

- The saved event delivery report contains both rounded quantities, the original supplier-item identity, known unit, adjusted order/receipt dates and the complete event evidence chain.
- Ordinary purchase-cost estimates already define exact numeric multiplication, half-up rounding using reference currency precision, current price applicability and identity checks.
- Supplier prices are current, unversioned records. Their valid-from date alone cannot establish historical applicability or volume-price eligibility; explicit confirmation remains necessary.
- Existing event scenarios use immutable reports, editor-only saves, current member/location access, request locks, fingerprints and stable retries.

## Approved calculation and evidence rules

- Apply one supplied unit price independently to each positive saved quantity, with explicit confirmation that it applies to both quantities at the saved adjusted order date. Retain exact products; round each subtotal once half-up to currency minor units. The displayed increase is adjusted rounded subtotal minus baseline rounded subtotal.
- Zero quantity needs no order. With one positive side, show the zero subtotal in that price's currency; when both are zero, save a no-order outcome without inventing a price or currency or requiring price confirmation.
- Require an active supplier and receiving location for a positive estimate, the original supplier-item identity and matching known unit, a finite nonnegative price, a supported currency and a known valid-from date no later than the saved adjusted order date. Explicit zero prices are allowed. Missing, incompatible or out-of-range evidence is inspectable but cannot save a priced result.
- Saved quantities, dates, supplier terms, stock/inbound, event assumptions and policy thresholds remain fixed. Preserve all saved timing warnings without interpreting them as shortages or blocking a cost comparison. Re-read current pricing and active entities for each new save, reject stale fingerprints and preserve original evidence on identical retries.

## Acceptance and verification

1. AC-001 — Given one saved available or no-order event delivery, preview shows the two original quantities and dates. Altering current stock, MOQ, lead time or calendars never recalculates them. Verify SQL fixtures and a browser master-data-change journey; no ordinary purchasing row or order is created.
2. AC-002 — Given a matching confirmed price, calculate both exact products, separately rounded subtotals and their difference. Verify independent Decimal expectations for fractional quantities, zero quantities/prices, two-/three-decimal currencies, half-way rounding and monetary overflow. Preserve decimal strings through display.
3. AC-003 — Missing price/date/unit, a recreated supplier-item row, future valid-from date, inactive supplier/receiver or unconfirmed applicability prevents priced saving. Verify database and action tests; unavailable remains distinct from free or no order.
4. AC-004 — A new save rejects changed price/entity/currency evidence after preview; identical author/source/confirmation/fingerprint retries return one original record and audit entry. Concurrent tests cover retry collisions and evidence/authority changes during lock waits. History stays immutable after later edits.
5. AC-005 — Current editors save; current members may inspect only their tenant and receiving-location scope. Verify tenant/claim/branch isolation, direct-write denial, explicit grants and after-lock authority. Retention follows the parent cascade convention.
6. AC-006 — Creation, detail and paginated history link from the saved event delivery. Preserve actionable timing warnings; collapse detailed pricing/source evidence. Verify production browser behavior, keyboard access, stale-preview feedback, scoped roles, all five widths and RTL, with screenshot inspection.

## Implementation and rollout

Add one migration for `event_purchase_cost_estimates` with guarded preview/save RPCs, tenant/location RLS, composite keys, audit and explicit grants. Add event cost schemas/actions/form/report/history, reuse exact currency formatting and nested delivery evidence, and regenerate DB types. Record approved rules in the roadmap and feature document.

Validation: sequential local pgTAP, independent-session database tests and production Playwright; web lint/type/unit/logical/format checks, engine tests, production build and manual code/security review. Fixtures target loopback only. Open one PR and stop; do not deploy or apply hosted migrations as part of this increment. The reviewed additive migration must precede the web deployment; rollback retains schema and evidence.

## Implementation notes

The new table is RPC-only for writes, with explicit grants, tenant and receiving-location RLS, composite parent/location foreign keys and a business-audit trigger. The preview reads the saved delivery report plus current original supplier-item pricing and supplier/receiver state. It never consults current stock, inbound, MOQ, pack size or calendars to recalculate the saved comparison. The report includes original source evidence and price row identity/timestamp, unit price, currency precision and effective date.

New saves serialize by organization/request, recheck live editor authority after the wait, recompute evidence and reject stale fingerprints. Retry identity includes the author, delivery, confirmation and fingerprint; identical retries retain the original report after later changes. Missing/incompatible inputs are inspectable but only complete priced comparisons or both-zero no-order outcomes can save. A nonnegative zero quote requires the same date/unit/applicability evidence. Monetary overflow leaves both rounded subtotals and the difference unavailable.

Shared event delivery warnings keep required policy recalculation, original overdue/late inbound and positive additions before receipt visible. Detailed event dates, price evidence and the complete nested source are expandable. Timing concerns do not block a cost comparison or imply calculated shortages. English-first messages use the existing Arabic fallback.

## Rollout and rollback

After review, apply additive migration `20261018092207_event_purchase_cost_estimates.sql` before deploying the web build. It adds a new empty table, indexes, guarded RPCs, RLS and audit under a five-second DDL lock timeout. No data backfill, worker credential or public API/import change is required. Development applies this migration only to the local stack.

Roll back by restoring the previous web build while retaining the additive schema and saved reports. Destructive removal requires a separate reviewed migration.

## Verification

- All 4,110 pgTAP assertions across 67 files passed, including the new pricing cases, tenant/branch invariants and privilege snapshots.
- All 1,462 web unit tests, full ESLint, typecheck, logical CSS and scoped Prettier checks passed. The production build passed after retrying the existing Google Fonts download with network access; no font or application dependency was changed.
- All 294 non-database engine tests passed, including statistical checks. The first invocation could not access pytest's existing Windows temporary folder; rerunning with a new workspace temporary folder passed. Unrelated untracked Acme tests were excluded.
- All 13 event-cost database cases passed: concurrent identical retries; changed role, membership, price, unit, effective date, currency, supplier/receiver state and source during lock waits; and the real worker-to-cost chain with independent Decimal arithmetic in two- and three-decimal currencies.
- Manual code/security review covered exact numeric products, independent rounding and difference, original identity/unit/date checks, tenant/location predicates, post-lock authority, immutable retry evidence and unchanged purchasing/API/worker behavior. No blocking finding.
- Production Playwright passed both the event-cost workflow and the existing event-delivery regression with retries disabled. The event-cost test passed again after explicitly waiting for preview completion before screenshots. Checks cover missing-price diagnosis, confirmation, stale-price recovery, immutable quantities/dates despite feed edits, saved history and scoped member/editor/branch access.
- Visually inspected 375/768/1024/1440/1920px and RTL at 375/1440px, including the refreshed settled mobile screenshot. Tables remain within local scroll containers; required warnings remain visible and price/source details stay collapsed. Keyboard disclosure and no-page-overflow checks passed. New Arabic messages use the existing English fallback.
- Full pull-request CI remains responsible for the broader workflow matrix and Cloudflare packaging. No hosted migration or deployment was performed.
