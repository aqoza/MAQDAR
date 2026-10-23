# Supplier event publications (Step 26e)

Internal editors can open an individual event purchase handoff and choose **Supplier publication** to preview and explicitly share its full event-adjusted selection. Suppliers enter **Event purchase proposals** from their existing supplier portal. Ordinary publications and their responses remain separate.

## Shared contract

Each immutable `supplier-proposal-v1` summary contains only saved item, supplier and receiving-location codes, full adjusted quantity and unit, adjusted order date, receipt date, unit price, currency and adjusted subtotal, plus the schema and planning-only markers. Quantities and money remain exact decimal strings. The subtotal is the saved rounded adjusted subtotal; nothing is recalculated for publication.

Baseline quantities/costs, differences, event names and additions, forecasts, stock, approval reasons and internal source identifiers are excluded by an explicit database projection. Both server rendering and the supplier reader validate a strict summary schema. The supplier sees a planning proposal; viewing does not record receipt, acceptance or supply commitment. Event batches and event supplier responses are deferred.

## First publication and retries

First publication requires an owner/admin/planner, receiving-location access, the latest selected approved event proposal, a positive available cost estimate, current matching price evidence and active supplier/receiver. Saved policy recalculation must be explicitly false and the saved before-receipt event-addition list explicitly empty. Missing timing evidence blocks publication. The handoff must contain the exact saved estimate. The planner confirms the displayed summary and submits its fingerprint; changed previews must be refreshed.

Publication shares the event-purchase review advisory lock, locks membership authority and source/pricing rows, and validates again after waits. Concurrent identical requests create one row and one audit insertion. There is one publication per event handoff. Retries require current editor and source visibility but retain the original values after later price changes or superseding approval; they never clear withdrawal. Changed selections require a newly approved estimate/handoff and explicit publication.

Editors may withdraw a publication. Internal scoped members retain the saved summary and withdrawal state. The actual event handoff, organization, supplier and receiving-location parent cascades remove the publication; creation, withdrawal and deletion use existing audit rules. Region/batch retention semantics do not apply to these individual event publications.

## Access and routes

Supplier access requires a current accepted, nonrevoked organization/supplier grant, a confirmed account, an active supplier and a nonwithdrawn publication on every request. A grant creates no organization membership or access to raw publication, handoff or planning tables. Revocation and withdrawal take effect on subsequent requests. Foreign supplier accounts, organizations and receiving branches remain isolated.

- Internal preview/history: `/replenishment/events/handoffs/[handoffId]/publish`.
- Supplier list: `/supplier-portal/[grantId]/events`.
- Supplier summary: `/supplier-portal/[grantId]/events/[publicationId]`.
- RPCs: `supplier_event_publication_preview`, `supplier_event_publication_publish`, `supplier_event_publication_withdraw` and `supplier_portal_event_publications`.

The supplier reader projects publication ID, creation time and the allowlisted summary only, with creation-descending/ID ordering, page sizes 25/50/100 and bounded/clamped pages. Supplier-facing list/detail requests use the live grant reader; inaccessible details return 404. Ordinary publication and response RPCs do not accept event publication identities. API keys and worker roles gain no capability.

## UI and rollout

Use the existing compact green PageHeader, supplier summary, confirmation form and keyboard-scrollable table. English and Arabic use shared typography at 375, 768, 1024, 1440 and 1920px. Methodology lives in expandable help; the shared summary and explicit publication confirmation remain visible.

The additive migration is `20261024014500_supplier_event_publications.sql`; generated database types include its table and four public RPCs. Apply through the repository migration workflow after review, before deploying the new routes. No hosted migration, invitation or deployment is performed by this increment. Roll back the new web entry points if needed, retaining audited records; withdraw publications or revoke grants to remove supplier access.

## Verification

Database tests cover the exact allowlist, adjusted-versus-baseline selection, live price/timing gates, tenant/branch/supplier isolation, current grant acceptance, withdrawal, retries, audit and actual-parent deletion. Two-session tests cover duplicate publication and authorization/price/selection changes during advisory and row-lock waits. Browser coverage checks the preview-to-publication flow, strict external boundary, current authority, immutable history, keyboard interaction, five widths and both locales. Test fixtures use only an isolated loopback stack.

### Local validation record

- Full pgTAP: 119 files / 7,186 assertions passed.
- New two-session publication tests: 13 passed, covering duplicate saves and changes during advisory/row-lock waits.
- Web unit suite: 207 files / 2,230 tests passed. Engine non-database, non-statistical unit suite: 490 passed. Simulation worker: 13 passed.
- TypeScript, lint, logical-direction checks, repository formatting and production Next.js build passed.
- Five authenticated production-browser flows passed: event handoffs (including the new preview entry point), ordinary batch publications, new event publications, supplier invitations/single publications and ordinary responses.
- The new browser flow checks typography and page overflow at 375, 768, 1024, 1440 and 1920px in English and Arabic, plus keyboard confirmation/table focus, strict external projection, stale authority, immutable pricing, withdrawal and grant revocation. Thirty screenshots were captured; representative preview, list and summary layouts spanning all five widths were visually reviewed.

All verification used the task-owned loopback stack. Linux CI remains the Cloudflare packaging and full browser/database integration gate.
