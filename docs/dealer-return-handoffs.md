# Dealer-return authorization handoffs (Step 27c)

Open an approved request under **Replenishment → Dealer returns** to save its handoff. The request detail is the preview: its full declared quantity, unit, condition, requested return date, original reference and recorded approval remain fixed. The handoff offers CSV/JSON downloads and links to the original request. **Return handoffs** provides paginated history, searchable by saved item/location evidence, reference, rationale and captured actors.

The requested return date is not a scheduled receipt. These files record internal authorization only. Exporting does not verify live stock, transmit a package, reserve stock, create inbound, record a receipt, create a credit or change accounting. Separate requests may overlap. Batching and external dealer access remain separate increments.

## Evidence and lifecycle

First creation requires an approved, nonwithdrawn request with recorded eligibility confirmation. The original item identity must still exist with its saved code and known catalog unit. Both original locations must remain active, keep their saved codes and retain the original branch-to-hub/central types. Changed or missing evidence requires a new request and independent review. Names, item lifecycle status and cost are not new eligibility rules.

One immutable handoff is saved per organization/request. Its versioned payload copies the complete request declaration and approval identity, captured reviewer email, time, rationale and confirmation, plus the handoff creator and server time. Existing files never query the live catalog. Later catalog edits and item/account deletion leave copied evidence intact.

Editors create handoffs. Every create or retry checks current organization authority and access to both endpoints. Existing retries return the original record without refreshing catalog evidence, timestamps or audit events. Concurrent first saves lock endpoint rows in identity order, the original item and finally the request, following the review/cascade lock order. Authority is checked again after waits, and a second existing-record lookup prevents duplicate creation.

Members with both-location access may inspect and download; tenant RLS and two restrictive endpoint policies apply to the new SELECT-only table. The security-definer creation RPC pins its search path and grants execution only to authenticated users. Raw API writes and worker/service-role access remain denied. The request is the actual parent: its deletion, organization deletion or either endpoint deletion cascades under the existing history rules.

## File contract and interface

The contract is dealer-return-handoff-v1, purpose internal_return_authorization. JSON retains nested declaration and approval evidence; CSV flattens it into one row with explicit declared_quantity, declared_condition and requested_return_date fields. Quantities remain exact decimal strings. CSV uses UTF-8 BOM, quoted fields, CRLF and shared spreadsheet-formula neutralization. Snapshot tests pin field order and bytes; future versions must retain this encoder for saved v1 records.

Download routes use the current cookie session and active organization, returning private/no-store attachments with nosniff. Hidden records return HTTP 404; no new streaming boundary changes this behavior. There is no API-key or external dealer access.

The interface retains the compact green Replenishment header, 16px page/section titles, 14px evidence values, 12px metadata, shared mobile input scale and 44px targets. Wide history tables scroll within their container. Method and retention details remain in expandable help; the requested-date limitation stays visible. Keyboard saves and failed-save focus preserve accessible feedback.

## Rollout and verification

Apply 20261024160000_dealer_return_handoffs.sql after the request/review migrations before deploying the web entry points. A web rollback should retain the additive table, grants and saved files. Hosted migrations and deployment are not part of local verification.

Run 0123_dealer_return_handoffs.test.sql, the full tenant/privilege suite and test_dealer_return_handoffs_db.py with the existing request/review tests. Cover canonical retry/concurrency, post-wait authority, catalog changes/deletion, original identity reuse, both-location RLS, account retention, actual-parent cascades, audit cardinality and operational non-effects.

Run export/action/route unit tests and dealer-return-handoffs.spec.ts against a production build, regressing dealer-returns.spec.ts and dealer-return-review.spec.ts. Inspect create/saved/history screenshots at 375, 768, 1024, 1440 and 1920px in English and Arabic RTL. Verify exact large quantities, original downloads after deletion, field search, keyboard creation, safe conflicts, no document overflow and hidden-record/download 404s.

### Local verification — 2026-10-24

- Full pgTAP: 125 files / 7,549 assertions passed; focused request/review/handoff database integration: 29 tests passed, including 8 new concurrency/lifecycle tests.
- Web unit tests: 214 files / 2,276 tests passed with two workers and unchanged timeouts; simulation-worker unit tests: 13 passed. Engine non-database suite: 498 passed.
- Workspace lint/typecheck, logical-direction and formatting checks, and the production web build passed. Final focused export/action/route/header/i18n checks: 30 passed.
- Production-build Playwright: all three request, review and handoff flows passed without retries. Inspected 30 create/detail/history screenshots at 375, 768, 1024, 1440 and 1920px in English and Arabic RTL; no page overflow. Verified keyboard save, conflict focus, exact large quantities, scoped 404s and unchanged downloads after item/reviewer deletion.
- A deliberate quantity-to-Number mutation failed the export precision/snapshot test. Restored exact-string handling and reran the focused checks successfully.

The complete Python database suite, complete browser suite and Cloudflare packaging remain CI checks for this PR. No hosted migration or deployment was performed.
