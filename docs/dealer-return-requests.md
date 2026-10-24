# Internal dealer-return requests (Step 27)

**Replenishment → Dealer returns** captures a declaration for one catalog item, one source branch and one receiving hub or central warehouse in the same organization. This increment has no external dealer identity or portal. Editors save; current members with access to both endpoints inspect searchable history and individual records.

## Declared evidence

The request contains a positive quantity in the item's explicitly selected, matching catalog unit, a requested calendar date, a required reason, declared condition (unused, used, damaged or unknown), an optional original sale/invoice reference and an accuracy confirmation. Conditions are declarations, not inspections. Discontinued parts may be requested; unknown condition remains unknown. Dates do not promise shipment or receipt.

Quantities use exact decimal strings with up to 15 integer and three fractional digits, matching `numeric(18,3)` capacity. The browser normalizes Arabic digits but does not round, convert units or infer quantities. The database independently validates the canonical input. Both endpoints must be distinct, active and of the permitted kinds when first saving. Current catalog unit and location evidence are checked under row locks, with authority checked again after waits.

The server copies item/location identities, codes and names, item unit/status, author evidence and the declared inputs. A request does not establish available stock, return eligibility, supplier approval, credit, obsolescence or physical receipt. No stock, inbound, reservation, accounting or operational order writes occur. Separate requests remain independent and can describe overlapping quantities.

## Lifecycle and authority

Saved details are immutable. Corrections create a new request. The original author, while still a member with both-location access, may withdraw with a reason even after losing editor privileges. Withdrawal preserves the original details and records a server timestamp; it is irreversible in this increment. Other editors and administrators cannot withdraw another author's request.

An organization/request UUID serializes saves. Identical canonical input from the same author returns the original record, including after catalog changes or withdrawal. Conflicting reuse fails. Every save retry requires current editor authority and both-location access. Withdrawal retries require current membership, both locations and the same original reason; neither retry path reactivates a request. Supplier grants confer no internal access.

The additive `dealer_return_requests` table has authenticated SELECT only, tenant membership RLS and separate restrictive predicates for source and receiver. Two security-definer RPCs validate and serialize saves/withdrawals; their helper is private and every function pins an empty search path. The existing audit trigger records inserts, withdrawal updates and deletion. Item or author deletion preserves copied request evidence. Organization or either location deletion cascades. No existing table grants, supplier scopes or inventory functions change.

## Screens and rollout

The history supports normalized item/name/location/reason/reference search, requested/withdrawn filters and bounded pagination under the same RLS for counts and rows. Empty history and no matching results have distinct messages. Create screens use existing scoped item and location suggestions; location suggestions do not establish valid source/receiver kinds, which are checked on save. Detail pages retain original labels and a creation/withdrawal history.

All routes use the shared illustrated header and compact green components, 16px page/section headings, 14px values and logical-direction layouts. Method detail stays in expandable help; the declaration confirmation remains visible. Inputs retain their submitted values and field errors on invalid save. Hidden records and non-editor create routes return HTTP 404 without a new streaming boundary.

Apply the additive migration through the repository's reviewed migration workflow before deploying these routes. A web rollback may leave the table and functions installed so saved evidence is retained. No hosted migration or deployment is part of this increment. External dealer access, eligibility review, credits, physical receiving and execution remain separate development steps.

## Verification

Database coverage includes exact quantity bounds, current catalog checks, tenant/both-location isolation, role changes, immutable retries, withdrawal, deletion and operational non-effects. Independent concurrent sessions test duplicate/conflicting saves, post-wait authority/catalog checks and withdrawal serialization.

Local verification on 2026-10-24 passed:

- Full pgTAP suite: 123 files and 7,455 assertions; ten new concurrent database integration tests also passed.
- Full web unit suite: 211 files and 2,260 tests; the final targeted helper/action/header run passed all 12 tests. A temporary distinct-endpoint validation mutation was caught and restored before verification.
- Engine unit suite: 498 tests passed, with 1,131 database tests deselected; the complete database integration suite remains a CI check. Simulation worker tests: 13 passed.
- Lint, typecheck, logical-direction checks and production build passed. The final build includes the corrected field-error and history-table layout behavior.
- The new dealer-return browser flow and the existing event supplier response workbench flow passed. Dealer-return coverage includes actual saves, field validation and correction, retained input, withdrawal, search/reset, pagination, viewer and both-location permissions, copied evidence after catalog deletion, and unchanged stock/inbound tables.
- Final dealer-return browser coverage passed at 375, 768, 1024, 1440 and 1920 pixels in English and Arabic RTL. All 30 form/detail/history screenshots were visually reviewed; document overflow, keyboard table scrolling and shared font sizes were checked. Invalid field messages clear after editing, and long codes stay intact within the table's own scroll container.

These local checks used an isolated Supabase stack. Hosted migrations and deployment were not performed. The PR's full CI suite provides the remaining cross-feature database/browser and deployment-packaging checks.
