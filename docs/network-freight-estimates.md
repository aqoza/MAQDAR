# Network freight estimates — Step 22c

Status: merged in PR #115. Revision 1.

The owner approved saved freight estimates from one saved network transfer-date scenario on 2026-10-20. Preserve all branch quantities, dates, stock/inbound evidence and timing warnings. This increment adds no approvals, shipment consolidation, taxes, FX, reservations or operational transfers.

## Calculation and evidence

For each positive branch allocation, multiply its saved quantity by the lane's supplied per-unit rate, or apply one per-shipment fee to that branch transfer. Sharing a dispatch date does not combine shipment fees. Calculate with exact SQL numeric, round each line once half-up to the currency's minor units, then sum rounded subtotals separately by currency. Keep products, subtotals and totals as decimal strings. Individual rounded amounts retain the existing `numeric(18,3)` bound; aggregate totals use exact numeric arithmetic without truncating their sum.

Zero allocations need no freight price, currency, effective date or confirmation; they contribute no subtotal. Explicit zero rates on positive allocations still need the normal evidence and confirmation. An unconfigured basis is unavailable, never inferred free. Partial line diagnostics remain inspectable, but totals are shown and a priced estimate can be saved only when every positive branch is priced. All-zero schedules save as no transfer needed.

Require active participating locations and original active directed lanes with matching saved p50/p90 lead times, including zero allocations. For each positive line, require a known finite freight-valid-from date no later than the saved dispatch date, matching known units for per-unit pricing, and explicit confirmation that the current unversioned rate applies to the saved quantity and dispatch date. Existing lane maintenance, import and API provenance fields are reused unchanged.

Recompute the current evidence fingerprint before first save; changed rates, entities or precision require refresh. Capture the complete original network date report, current lane/location evidence, confirmation, exact products and rounded totals. Current calendar or commitment edits do not recompute captured quantities or dates. Saved timing warnings remain visible and do not prevent planning cost estimates.

## Access and lifecycle

Members need access to the warehouse and every saved branch. Preview checks organization/claim and the complete required-location array before reading the report, even when called from the definer save RPC. Owners/admins/planners save. The table has membership RLS and restrictive set-based location RLS; its history view uses invoker rights. Direct writes, anonymous, API-key/service and worker access are denied.

Serialize saves by organization, recheck editor authority after advisory and parent lock waits, and recheck location authority through preview before first save. Bind each request UUID to author, scenario, confirmation and fingerprint. Identical retries return the original record under current authority; conflicting reuse fails. Later changes preserve the original saved evidence.

The estimate belongs to its saved date scenario. Parent date/allocation, organization and participating-location deletion follow existing cascades. Deleting underlying policies or changing calendars, prices or stock does not rewrite retained reports. No stock, receipt, reservation or order rows are created.

## Acceptance and verification

| ID     | Scenario and action                                                                             | Expected observable result                                                                                         | Verification                                |
| ------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| AC-001 | Price fractional quantities with mixed rate bases and currencies                                | Fixed quantities/dates, exact line products, individual shipment fees and currency-separated sums of rounded costs | Database examples and unit schemas          |
| AC-002 | Preview zero/unknown rates, unknown/mismatched units, missing/future dates or excessive amounts | Explicit diagnostics, zero distinguished from unavailable, no partial save                                         | Database boundaries and browser preview     |
| AC-003 | Change rates, active entities or lane identity/leads after preview                              | Stale first save fails; refresh needed                                                                             | Database and browser recovery               |
| AC-004 | Read/save with foreign tenant, forged claim, viewer or missing location                         | No hidden report, count or unauthorized write                                                                      | pgTAP, database and HTTP 404 checks         |
| AC-005 | Retry concurrently or lose authority while waiting                                              | One record/audit, conflicting retries rejected, authority rechecked                                                | Independent-session tests                   |
| AC-006 | Change original evidence after save or delete the parent                                        | Immutable history, established cascades and no operational changes                                                 | Database lifecycle and browser history      |
| AC-007 | Use preview/detail/history by keyboard at five widths and Arabic RTL                            | Shared type scale, visible confirmations/warnings, expandable evidence and contained tables                        | Production Playwright and screenshot review |

## Rollout

Local verification passed 24 freight database cases, 493 targeted pgTAP assertions (including the scoped simulation worker's denial), 1,791 web unit tests and six merged worker-controller tests. Formatting, lint, logical CSS, TypeScript and the production web build passed. The network-date and network-freight browser journeys passed, including all five widths, Arabic RTL, stale-preview recovery, immutable history and restricted-location HTTP 404s. Desktop/laptop and Arabic mobile screenshots were inspected. Full clean CI is the final review gate.

Apply additive migration `20261020170000_network_freight.sql` before deploying the web release. Hosted migration application remains owner-run (`pnpm exec supabase db push`). Local verification does not deploy production. Roll back the web release while retaining the additive schema and immutable evidence; no destructive rollback is needed.
