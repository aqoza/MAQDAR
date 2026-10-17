# Item stock locator (Step 17)

Status: approved on 2026-10-17; implemented and locally verified, ready for PR review and CI. PR #55 was reviewed without blocking findings and merged as `5ade8b2` after all three CI jobs passed.

## Approved behavior

Members choose one exact item code, an active receiving location, an explicit requested unit and an as-of date. The locator searches other permitted active locations. It requires access to the receiving location and every source, keeping existing tenant, active-organization and branch restrictions. Viewer and branch roles can read; no editor permission or API key is needed.

Choose the latest snapshot dated on or before the selected day before checking quantities or units. Matching stock is strictly positive `on-hand − allocations`, in the explicitly requested source-supplied unit, no more than seven days old at the selected day. Zero and negative net stock, stale snapshots, missing snapshots and unknown/different units remain other observations. A newer incompatible or zero observation never falls back to an older favorable one. Current catalog units are never used to label an observation. No inbound, extra commitments, policy protection or other drafts are deducted or added; this is observed stock, not transferable surplus. Quantities retain exact decimal strings, including negative net quantities.

Rank matching sources by spherical straight-line distance from current coordinates (mean Earth radius 6371.0088 km), with unknown distances last, then exact code and ID for deterministic ties. Display distance to 0.1 km; sort by its unrounded value. Coincident, antipodal, polar and antimeridian points are supported. A coordinate pair requires both latitude and longitude. No map, routing API or inferred coordinate is used.

Show current active directed source-to-receiver lane p50/p90 calendar-day lead times separately. A reverse or inactive lane is not eligible. Missing lanes do not remove observed stock; neither distance nor a lane promises an arrival date. Current metadata and observations recorded now are used: this is not a reconstruction of information available on a historical planning date. The selected date controls snapshot eligibility and age only.

## Acceptance and verification

- AC-001: An authorized member can find the exact item across other active permitted sources, with current receiving/source context and source search. Database and browser tests verify directed access, active flags, exact codes and search.
- AC-002: The latest eligible dated observation wins before unit/freshness checks. Database tests cover age seven/eight days, future-only records, missing and zero stock, negative net values, conflicting/unknown units, exact large decimals and older favorable records.
- AC-003: Distance ranking handles missing coordinate pairs, zero and global boundaries, with stable paging. Database tests verify numerical examples, ordering, 25/50/100-row bounds and page clamping.
- AC-004: Member-only invoker rights preserve tenant, active-claim and both-location visibility for rows, totals and suggestions. Database/browser tests cover viewer, branch source-only, receiver-only, both, revoked membership, cross-tenant and nonmember roles. Anonymous, API service and worker execution are denied.
- AC-005: Reading leaves stock, orders, receipts, audits and transfer planning records unchanged. Database snapshots verify this; no mutating UI or public integration API is added.
- AC-006: The shared compact green header, typography and navigation work at 375, 768, 1024, 1440 and 1920px, including local table scrolling, keyboard evidence disclosure, URL filters, validation and Arabic RTL. Browser checks and screenshot inspection verify the result.

## Implementation and rollout

`/replenishment/stock-locator` uses the authenticated-only stable SECURITY INVOKER `stock_locator` RPC. Existing snapshot indexes support one latest-row lookup per permitted active source. The result and counts use the same statement snapshot; filters and paging return at most 100 rows. Receiving-location suggestions are capped at 200, while the field accepts any exact permitted code. No tables, external services, dependencies, API scopes, reservations or orders are added.

After review, the owner applies `20261017183944_stock_locator.sql` before deploying the web build. Roll back the web build if necessary; the additive read-only RPC can remain. All implementation and verification use synthetic loopback data. No hosted migration or deployment is performed.

## Verification record

- All 3,434 pgTAP assertions across 58 files passed, including 76 stock-locator assertions for latest evidence, supplied units, seven-day freshness, exact decimals, global distance boundaries, paging, read-only behavior and tenant/location access.
- All 1,320 web unit tests across 108 files passed. Repository formatting, lint, TypeScript, logical CSS and the production build passed.
- The stock-locator browser workflow passed against a local production build with synthetic data: form submission, evidence disclosure, filters, paging, invalid inputs, viewer reads and receiver-only/source-only/both-location branch access. The five existing responsive-planning regression cases also passed.
- Screenshots and layout checks cover 375, 768, 1024, 1440 and 1920px, plus Arabic RTL at 375 and 1440px. Page title/row typography, keyboard disclosure, local table scrolling and page overflow were checked. New copy uses the repository's English fallback in Arabic.
- After syncing with the merged Settings workspace, both the locator and transfer integration-workbench browser scenarios passed without retries. Language selection follows the Settings section navigation; consecutive source-filter submissions wait for the previous rendered filter response.
- No hosted migration or deployment was run. Full CI results are recorded on the PR.
