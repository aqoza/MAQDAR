# Integration workbench (Step 15e)

Status: merged in PR #37 as `a16f232` on 2026-10-17 with all three CI jobs passing, including full database/browser tests and Cloudflare packaging.

## Approved scope

Members can find saved handoffs and batches by supplier, location, current/historical selection and reported status, inspect rejection reasons and open saved evidence/history. Keep the compact green interface and keyboard/overflow checks at 375, 768, 1024, 1440 and 1920px. ERP transmission, alerts and order creation remain later work.

The latest server-recorded event is selected independently for each exact external-system label and package. Labels are caller assertions, not verified system identities. Case and surrounding spaces remain significant, including across key rotation. Equal recording timestamps use event UUID ascending as a stable display tiebreaker; this does not infer external event order. Status/search filters apply after selecting the latest event so a superseded rejection cannot reappear as current.

All-systems mode shows one result per package/system, or one No report result if the package has no reports. Selecting an exact system label shows one result per package, including No report for packages without evidence from that system. Absence never implies failed delivery. Batch reports do not propagate to members or overlaps. Result counts count package/system rows, not distinct packages or orders. Live selection remains separate from reports.

## Acceptance and verification

- AC-001: Current and historical handoffs/batches appear with saved supplier/location context and links to their original evidence. Verify through PostgreSQL and browser fixtures.
- AC-002: Latest reports are independent per exact system label; selection precedes status/search filtering and ties are stable. Verify received-after-rejected, multiple labels, case/space differences and key rotation.
- AC-003: Missing reports and system-specific absence show No report, including overlapping batches and members with independent histories. Verify no propagation and no inferred delivery status.
- AC-004: Member organization, active-organization claim and location RLS constrain rows and totals. Anonymous, worker and integration service roles cannot execute the member RPC. Verify roles, branches and cross-tenant denial in pgTAP.
- AC-005: Filters/search and bounded 25/50/100-row pagination remain in the URL; out-of-range pages resolve to the last page. Verify unit, PostgreSQL and browser pagination with long and escaped labels/reasons, keyboard access and all five widths.
- AC-006: Reading the workbench does not mutate events, exports, selection, orders, receipts, stock or audit history. Verify immutable evidence and counts in database/browser tests; run the existing regression suites.

## Implementation and rollout

An additive, stable SECURITY INVOKER member RPC reads the existing RLS-protected package views and event table. It validates organization and filter bounds, selects latest reports before filtering, and returns a bounded page plus total from one statement snapshot. Sorting uses package creation descending, package kind/UUID, then exact system label. Search matches normalized saved item/supplier/location codes, package UUID and the latest system/reference. Refreshing or traversing pages can reflect newly recorded reports; this is not a durable export or delivery ledger.

Apply the migration before the web build. Hosted rollout remains pending review. Roll back the web build while retaining the additive read RPC; no source data or API-key scopes change. Tests use only synthetic loopback data.

To try it, open Replenishment → Integration workbench in an organization with saved handoffs or batches. Apply an exact system label and choose No report to find packages lacking evidence from that system. Open evidence and history to inspect the original package and every recorded report. Historical selection and reported status remain independent filters.

## Verification record (2026-10-17)

- Web: all 1,197 unit tests across 92 files passed with two workers. Unbounded local runs hit disk-scan timeouts in existing isolation tests; no assertions or time limits were changed. Lint, TypeScript, logical CSS, formatting and the production build passed.
- Database: all 2,718 assertions across 48 pgTAP suites passed, including 52 new workbench assertions. The existing acknowledgement fixture now scopes its two event/audit counts and timestamp setup to its synthetic organization, so earlier local browser data cannot affect the expectations. Generated database types match the applied local migration.
- Python: 293 unit tests and 106 database tests passed, including the existing approval, export and acknowledgement concurrency checks.
- Browser: the focused workbench workflow passed against the production build. It covers filters, system-specific absence, escaped supplied text, pagination, out-of-range navigation, immutable exports, viewer/branch access and keyboard disclosures/table regions. Layout checks passed at 375, 768, 1024, 1440 and 1920px; desktop/mobile screenshots were inspected and the mobile filters compacted.
- Full browser regression: 53 passed, three opt-in scale tests skipped, and one existing invitation locator matched both the heading and Next.js route announcer. After targeting the heading by role, all four invitation tests passed. All five application-wide responsive checks passed, including the new workbench; the standard 50,000-item list and 100,000-row import tests also passed.
- Three import-retention script tests passed. Hosted migrations and deployment were not performed; Linux CI supplies the Cloudflare packaging check.
