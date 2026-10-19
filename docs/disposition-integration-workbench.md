# Disposition integration workbench (Step 20g)

Status: implemented and locally verified; review pending. The owner approved the scope and reporting/lifecycle rules on 2026-10-19.

## Behavior

Replenishment → Excess stock → Disposition integrations opens `/replenishment/excess/integrations`. Members can search saved item/package context and latest system/reference, filter by location code, supplier-return/scrap intent, handoff/batch kind, current/historical/unavailable live context, exact external-system label and reported status. Each result links to the actual package's original evidence and complete report history. Quantities, units and exact reference inventory values remain in that evidence without conversion, rounding or pooling.

The latest server-recorded report is selected separately for each package and exact system label before status/search filtering. Case and surrounding spaces distinguish labels; key rotation does not split one label. Equal recording timestamps use ascending event UUID as a deterministic display tie-break, not a claim about external event order. System labels are caller assertions.

All-systems mode shows one result per package/system, or one No report result when no system has reported. An exact-system filter includes packages without a report from that system as No report, even when another system reported. Counts represent package/system results. Absence never implies failed delivery. Reports on a batch do not propagate to its members or overlapping batches.

Live context stays independent of reported status. Current means the original proposals remain selected; a batch requires every member to remain selected. Historical means later selections exist. Unavailable means the live source context cannot be resolved, including copied batches whose source records were deleted. Such batches remain searchable using their saved context, with original downloads and their own report history. Deleted individual handoffs disappear under the existing cascade rules.

Organization membership, active organization and location restrictions apply to rows and counts. The workbench is read-only and introduces no API-key scope or elevated browser client. It neither refreshes commitments nor transmits packages, confirms supplier eligibility, calculates recovery proceeds, creates returns, writes off inventory, reserves stock or moves stock.

## Acceptance criteria

- AC-001: Authorized members find packages by saved item/context, location, intent and latest reference, and open the correct evidence/history.
- AC-002: Latest-report selection precedes status/search filters; exact labels, key rotation and timestamp ties retain deterministic results.
- AC-003: No report and current/historical/unavailable context remain distinct. Copied batches retain search/evidence/reports after source deletion; batch/member/overlap histories stay separate.
- AC-004: Active organization, membership and location permissions restrict rows, counts and drill-down. Anonymous, service and worker roles cannot invoke the member workbench.
- AC-005: Pages are bounded to 25/50/100 results, filters survive navigation, totals and rows use one statement snapshot, and out-of-range pages resolve to the last page.
- AC-006: Shared compact typography, keyboard controls, expandable help, escaped/wrapping report text and contained table scrolling work at 375, 768, 1024, 1440 and 1920px in English and Arabic RTL.
- AC-007: Reads preserve approvals, selection, reports, original JSON/CSV, stock, receipts, inbound and audit history. Ordinary purchase, transfer and event workbenches retain their contracts.

## Implementation and rollout

`excess_disposition_integration_workbench(uuid,jsonb,integer,integer)` is stable SECURITY INVOKER with an empty search path and authenticated-only execution. It reuses the existing disposition package views and acknowledgement table under RLS. No new business table, integration permission or direct table grant is added.

The query returns count, clamped page and bounded rows from one statement snapshot. Ordering is package creation descending, package kind/UUID and exact system label. Paging or refreshing can reflect subsequent reports or source changes; it is not a frozen integration snapshot. Search uses normalized tokens from saved package context and latest system/reference, rather than superseded reports.

The shared integration screen, URL helpers and family mapping now include disposition intent and three-state live context. The route's loading header matches the completed page. No ancestor loading boundary or detail-route 404 behavior changes. Methodology remains in expandable help; report and live-context labels stay visible.

After review, apply `20261019153205_disposition_integration_workbench.sql` before the web build. Rollback can restore the previous web build and retain the additive read function; a later forward migration may revoke it if required. There is no data backfill or business-row rewrite. Verification uses loopback synthetic data; this step performs no hosted migration or deployment.

## Verification mapping

- `supabase/tests/0079_disposition_integration_workbench.test.sql`: AC-001–005 and AC-007, using real assessment/review/handoff creation followed by report and source-deletion cases.
- `apps/web/src/lib/integration-workbench.test.ts`: URL filter isolation, exact label preservation, three-state schema and evidence links.
- `apps/web/e2e/disposition-integration-workbench.spec.ts`: filters, keyboard, exact reports, five widths/RTL, viewer/branch access, historical selection, source deletion and original downloads.
- Existing purchase/transfer/event integration and excess-header browser tests protect shared consumers. Privilege inventory, format, lint, typecheck, logical CSS, unit tests and production build are required before delivery.

Local verification passed 1,630 web unit tests and 352 focused pgTAP assertions, including 78 new workbench assertions. The complete disposition browser workflow passed on the final production build; existing purchase, transfer, event and excess-header browser regressions also passed. English/Arabic RTL checks cover all five widths, keyboard use, escaped report text, branch access and original downloads after source deletion. Screenshots were visually inspected at mobile, laptop and desktop widths. Format, lint, typecheck, logical CSS and production build passed. The manual code/security review found no blocking issues; no independent agent or external security scanner was used. Full CI is recorded on the pull request separately from these local results.
