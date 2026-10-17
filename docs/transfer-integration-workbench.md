# Transfer integration workbench (Step 16i)

Status: merged in PR #55 as `5ade8b2` on 2026-10-17 after review without blocking findings and all three CI jobs passing. PR #53 was reviewed without blocking findings and merged as `b26d099` on 2026-10-17 after all three CI jobs passed.

## Approved scope and semantics

Members can search saved transfer handoffs and batches, filter by source/destination code, package type, current/historical planning selection, exact external-system label and reported status, inspect rejection reasons, and open original evidence/history. Both endpoint access is required. Reuse the shared compact green design, typography, illustrated section header and navigation at 375, 768, 1024, 1440 and 1920px.

The latest server-recorded event is selected independently for each exact system label and package, before applying status or search filters. Case and surrounding spaces distinguish caller-supplied labels, even across key rotation. Equal timestamps use ascending event UUID as a stable display tiebreaker; this does not establish external event order. Labels are not verified system identities.

All-systems mode shows one row per package/system, or one No report row for a package without reports. An exact-system filter shows every matching package, including No report when that system has supplied no evidence. Counts refer to package/system results, not distinct packages, transfers or arrivals. Absence never implies failed delivery. Batch reports remain independent of member handoffs and overlapping batches. Live selection is separate from reported status; a batch is current only while all its saved handoffs remain selected.

This is a read-only workbench. It does not transmit packages, issue alerts, reserve stock, create transfer orders, update inbound or infer arrival. Existing exports and reports remain unchanged.

## Acceptance and verification

- AC-001: An authorized member can find current and historical handoffs/batches using saved item and endpoint context, package IDs and latest system/reference text. Exact source and destination filters preserve direction. Verify database and browser workflows.
- AC-002: The latest event per exact label is selected before status/search filtering. Superseded rejections cannot appear as current; ties and rotated keys retain deterministic selection. Verify multiple labels, case/space differences, timestamp ties and replacement reports in PostgreSQL.
- AC-003: No report expresses absent evidence for all-systems or exact-system searches. Batch/member/overlap histories remain independent. Verify database and browser fixtures.
- AC-004: Organization membership, active-organization claim and access to both source and destination constrain rows and totals. Anonymous, worker and integration service roles cannot execute the member RPC. Verify cross-tenant and source-only/destination-only denials.
- AC-005: Bounded 25/50/100-row paging and filters persist in the URL, with out-of-range pages resolving to the last page. Long supplied text wraps within scrollable tables, keyboard controls work, and shared title sizes remain unchanged at all five widths. Verify unit tests and authenticated browser screenshots.
- AC-006: Reading leaves events, approvals, selection, exports, audits, orders, receipts and stock unchanged. Verify database snapshots and original browser downloads; run existing purchasing and transfer regressions.

## Implementation and rollout

`/replenishment/redistribution/integrations` uses the member-only, stable SECURITY INVOKER `transfer_integration_workbench` RPC. It queries existing package views and the acknowledgement table under their tenant and both-endpoint policies. No new table, external API scope or elevated service client is introduced. The purchase and transfer pages share their presentation, keeping their queries, URL filters and evidence links distinct.

Search uses normalized saved context and latest system/reference, not superseded event text. The RPC returns a page and count from one statement snapshot, sorted by package creation descending, kind/UUID and exact system label. Refreshing or paging can reflect later reports or selection changes; this is not a durable export or an external delivery ledger.

Owner-run rollout after review: apply `20261017175212_transfer_integration_workbench.sql` with `pnpm exec supabase db push`, then deploy the web build. Rollback restores the previous web build and can retain the additive read RPC. Development and verification use synthetic loopback Supabase only; no hosted migration or deployment is performed.

To try: open Replenishment → Redistribution → Transfer integration workbench. Choose an exact system and No report to find packages without evidence from that system. Open evidence and history to inspect the original package and all reports.

## Verification record

- PostgreSQL: all 3,358 assertions across 57 files passed, including 57 new workbench assertions covering latest-report selection, exact labels, paging, immutability and both-location authorization.
- Web: all 1,317 unit tests across 107 files passed. Repository formatting, lint, TypeScript and logical CSS checks passed. The production build passed, including a rebuild after the final toolbar spacing adjustment.
- Browser: the purchase workbench, transfer workbench and shared English/Arabic section-header checks passed, along with the five existing application responsive checks. Both workbench workflows passed again after the final toolbar adjustment; the transfer check also verifies keyboard horizontal scrolling and changing location access.
- Final screenshots at 375, 768, 1024, 1440 and 1920px were inspected. Controls align, shared type sizes remain consistent, and wide tables scroll within their containers without page overflow.
- Full engine, database integration, browser and Cloudflare packaging regressions run in PR CI. No hosted migration or deployment has been performed.
