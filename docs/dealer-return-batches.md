# Dealer-return authorization batches

Step 27d packages 1–50 existing return handoffs at **Replenishment → Dealer returns → Return handoffs → Return authorization batches**. Editors choose handoffs, preview the complete set and save one immutable package. Members can search copied evidence and download CSV/JSON. Selection persists through search and pagination; repeated items and incompatible groups receive explicit errors.

## Group and evidence rules

Every line must share the original source branch, receiving hub/central warehouse and requested return date. Original item identities and saved item codes must both be distinct. Quantities and declared conditions remain separate; there is no pooled quantity or inferred eligibility/stock calculation. A requested return date is not a scheduled receipt.

First save requires every original handoff and approved, nonwithdrawn request to remain visible, with recorded eligibility confirmation and unchanged approval evidence. The original item must still exist with its saved code and known unit. Original endpoints must remain active with matching codes and branch-to-hub/central types. A changed or missing catalog identity requires a new request and review. The preview reads current evidence; creation locks all endpoints, items, requests and handoffs in identity order, then repeats all access and evidence checks after waits. A failed line saves nothing.

## Retry, access and retention

Sorted handoff identities form the organization's unique retry identity, independent of selection order. A transaction advisory lock serializes creation. Every retry requires current editor authority and visible original handoffs/requests; once these checks pass it returns the original saved package, even after catalog changes. No timestamps, copied values or audit inserts change on retry.

Tenant membership and access to both locations apply to table reads, invoker views, preview, creation and downloads. Counts, candidate reuse and overlapping-batch lists use the same scope. Viewers may inspect files but cannot create or preview new packages. No API-key, supplier or external-dealer permission is added. New tables/views grant only authenticated SELECT, and RPCs grant only authenticated EXECUTE; worker/service-role and raw API writes remain denied.

The package copies every complete original handoff into its versioned payload. Source-request/handoff, item or account deletion cannot erase those copied declarations or approvals. `sources_available` describes visible original handoffs independently of current catalog validity; missing sources do not invalidate the copied files. Both actual endpoint foreign keys and the organization retain deletion cascades, with the existing audit trigger. Packages may overlap; the interface shows other visible packages that reuse a handoff. No package reserves quantities or prevents duplicate external processing.

## Files and interface

The frozen `dealer-return-batch-v1` encoder retains nested handoff evidence in JSON. CSV contains one row per original handoff, exact decimal strings, explicit declared-condition/requested-return-date fields and full original handoff JSON. Shared CSV encoding provides UTF-8 BOM, quoted fields, CRLF and spreadsheet-formula neutralization. Live context and overlap counts are excluded from both files. Downloads require the current session and active organization, return private/no-store attachments with nosniff, and hide inaccessible records with HTTP 404.

The compact green interface uses shared headers, 16px titles, 14px evidence, 12px metadata, mobile input scaling, logical direction utilities and 44px controls. Wide tables scroll inside their containers. Retention/methodology stays in expandable help; requested-date and unavailable-source context remain visible. A failed save focuses its error summary. English and Arabic use the same workflow.

There are no stock, inbound, reservation, credit, financial, scheduling or execution effects. External dealer access and physical receiving remain separate work.

## Rollout and verification

Apply `20261024180000_dealer_return_batches.sql` after the request/review/handoff migrations, before deploying the web entry points. Roll back web entry points while retaining the additive schema and saved evidence. No hosted migration or deployment is part of local verification.

Run `0124_dealer_return_batches.test.sql`, the full pgTAP privilege/tenant suite and `test_dealer_return_batches_db.py` sequentially with database/browser suites. Cover canonical concurrent retries, maximum selection size, distinct item identities/codes, endpoint/date compatibility, post-wait catalog/access changes, copied retention, actual-parent cascades, overlap visibility and audit cardinality.

Run batch serializer/route/action tests and `dealer-return-batches.spec.ts` against the production build, alongside the existing request/review/handoff browser flows. Inspect selection, preview, saved package and history at 375, 768, 1024, 1440 and 1920px in English and Arabic RTL. Preserve exact quantities, keyboard controls, safe stale-preview feedback, source-deletion downloads, both-location 404s, shared typography and contained horizontal scrolling.

### Local verification — 2026-10-24

- pgTAP: 126 files / 7,592 assertions exercised. Two existing administrative-role handoff counts were scoped to their fixture organization; the repaired handoff and batch suites then passed all 76 assertions. All other suites passed in the complete run.
- Return database integration: 29 existing request/review/handoff tests and 29 new batch tests passed, including concurrent retries, access/catalog changes during lock waits, the 50-line bound, reused codes and copied-file retention.
- Web unit tests: 217 files / 2,291 tests passed; engine non-database tests: 498 passed; simulation-worker tests: 13 passed. Lint, typecheck, direction checks, formatting and the production build passed.
- All four production browser flows passed. Inspected 40 new selection/preview/detail/history screenshots at all five widths in English and Arabic RTL, with no page overflow. Verified keyboard selection/scrolling/save, changed-preview error focus, independent overlap, scoped 404s and byte-identical downloads after source deletion.
- A deliberate decimal-to-Number mutation failed the CSV snapshot; restored exact-string serialization and reran all 15 focused batch unit/action/route tests successfully.

The complete Python database suite, complete browser suite and Cloudflare packaging remain CI checks for this PR. Hosted migrations and deployments were not performed.
