# Event purchase integration workbench (Step 19l)

Status: implemented and locally verified; review pending. The owner approved the workbench and reporting rules on 2026-10-18.

## Approved behavior

Members can search saved event purchase handoffs and batches by item/event context, package ID and latest system/reference, filter by supplier, receiving location, package type, current/historical planning selection, exact external-system label and reported status, inspect rejection reasons, and open the complete evidence and history. Access remains organization- and receiving-location-scoped. Ordinary purchase and transfer workbenches keep their own records.

The latest server-recorded report is selected independently for each exact package and system label before status/search filters. Case and surrounding spaces distinguish labels, including across reporting-key rotation. Equal timestamps use ascending recorded-event UUID for deterministic display, without implying external event order. System labels are caller assertions, not verified identities.

All-systems mode shows one result per package/system, or one No report result for a package without any reports. An exact-system filter includes packages without a report from that system as No report. Counts refer to package/system rows, not distinct packages or orders. Absence never implies failed delivery. Individual, batch and overlapping-batch histories remain separate.

Live planning selection is independent of reports. A batch is current only while all its handoffs remain selected. Reports concern the full adjusted purchase selection; baseline comparisons, event assumptions, quantities, dates and costs remain original evidence. Opening this workbench neither refreshes commitments nor transmits packages, creates orders, reserves stock, recalculates policies or updates inbound.

## Acceptance and verification

- AC-001: Authorized members find current and historical event handoffs/batches using saved context and latest references, and open the exact package's original evidence/history. Verify PostgreSQL and browser fixtures, including saved event names.
- AC-002: Latest-report selection precedes status/search filters per exact label and package. Verify superseded rejections, different label case/spaces, rotated keys and timestamp ties.
- AC-003: No report expresses absence in all-systems and exact-system searches; batch/member/overlap histories stay independent. Verify database and browser cases.
- AC-004: Active organization, membership and receiving-location permissions restrict both rows and totals. Verify cross-tenant, stale active-organization, viewer, branch, removed-access and anonymous/service/worker denials.
- AC-005: Bounded 25/50/100-row pagination and URL filters survive navigation; out-of-range pages resolve to the last page. Supplied text stays escaped and wraps inside scrollable tables. Verify unit tests, keyboard controls, loading header, RTL, shared typography and 375, 768, 1024, 1440 and 1920px layouts.
- AC-006: Reads preserve reports, approvals, selections, exports, stock, receipts, inbound and audit history. Verify database snapshots and original JSON/CSV; run the existing purchase and transfer workbench regressions.

## Implementation and rollout

`/replenishment/events/integrations` uses the stable, member-only SECURITY INVOKER `event_purchase_integration_workbench` RPC. It reads the existing event package views and acknowledgement table under their RLS policies. It introduces no new data table, integration-key scope or elevated client. The shared screen and URL helpers use explicit purchase/transfer/event families to keep queries and evidence links separate. The event loading boundary shares the same illustrated header and navigation as the completed page.

The RPC returns a bounded page and total from one statement snapshot. Sort order is package creation descending, kind/UUID and exact system label. Refreshing or paging can reflect later reports or selections; this is not a durable delivery ledger. Search uses saved item/event context and latest system/reference, not superseded report text.

After review, the owner applies `20261018195603_event_purchase_integration_workbench.sql` with `pnpm exec supabase db push` before the web deployment. Rollback restores the previous web build and can retain the additive read RPC. Verification uses synthetic loopback Supabase only; no hosted migrations or deployment are performed.

To try: open Replenishment → Event integrations. Select an exact system and No report to find packages with no evidence from that system, or Reported rejected to inspect its latest rejection reasons. Open evidence and history to inspect the full adjusted selection, baseline comparison and original event assumptions.

## Verification record

Verification completed on 2026-10-19 against synthetic local Supabase:

- Type checking, production build, lint/logical-utility checks, scoped Prettier and diff whitespace checks pass.
- All 1,543 web unit tests pass, including six shared workbench URL/path cases.
- The full 73-file pgTAP run executed 4,560 assertions. Four pre-existing acknowledgement lifecycle counts included unrelated local browser fixtures; after scoping those counts to their fixture organization, the affected suite passes all 79 assertions. All other suites passed, including the 63 new workbench assertions. RLS visibility assertions remain unscoped.
- Nine production-browser checks pass: the event workflow, existing purchase and transfer workflows, shared English/Arabic headers, and responsive planning at 375, 768, 1024, 1440 and 1920px. The event test initially used a 30-item default fixture; it now explicitly requests its intended three items and passes on rerun.
- Visually inspected the five event-width screenshots plus RTL at 375 and 1440px. Verified contained table scrolling, keyboard controls, typography, help and mobile targets. Original JSON/CSV remains unchanged after later selections; removed receiving-location access hides both rows and totals.

The manual code/security review found no blocking application issues. No independent agent or automated security scanner was used. Hosted rollout and the new PR's full CI remain separate from these local results.
