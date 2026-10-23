# Supplier event batch publications

Step 26f explicitly shares event purchase batch selections with supplier users. Start from **Replenishment → Events → Handoff batches → Supplier publication**. An editor previews the complete supplier summary and confirms before publishing. Supplier users open **Event purchase proposals** in their accepted portal. No supplier response form is added in this increment.

## Shared contract

One publication covers 1–50 original handoffs from one event purchase batch. Share only saved item/supplier/receiving codes, full adjusted quantity and unit, proposed order/receipt dates, unit price, currency and adjusted subtotal. The batch total is the saved sum of rounded adjusted line subtotals; quantities and units remain separate. There is no additional rounding. Baseline quantities/subtotals, cost differences, event names/additions, forecasts, stock, approval reasons and original internal identifiers never enter the supplier summary.

The strict `supplier-batch-proposal-v1` summary reuses the ordinary supplier-facing allowlist. Each line is `supplier-proposal-v1`. The combined `supplier_portal_event_packages` reader returns only publication identity, creation time, kind, summary and bounded visible-overlap metadata. The legacy single-event reader remains unchanged. Ordinary package readers and supplier response endpoints remain independent.

## Publication checks and concurrency

First publication requires current editor authority and receiving-location access, confirmation and the preview fingerprint. Every original handoff must still exist, match its copied batch line, remain selected by an approved event proposal, have a positive available adjusted estimate, and pass the existing price/active supplier/receiver checks. Saved policy recalculation must be explicitly false and event-before-receipt evidence explicitly empty. Header values, member identities/count and the saved subtotal must match all lines. A missing, changed or invalid member rejects the entire publication.

Creation serializes with event purchase review, locks memberships, the batch and original handoffs, then stabilizes the supplier, receiver and every original supplier-item price row before taking a fresh preview. Waiting callers recheck current authority and evidence. This prevents a price, selection, source deletion or access change from slipping through between preview and save. The unique organization/batch key ensures one immutable publication and one creation audit entry.

## Access, retries and retention

Only owners/admins/planners publish or withdraw. Internal members inspect within existing receiving-location restrictions. Suppliers use separate accepted organization/supplier grants; every request checks the current account, verified email, grant revocation and active supplier. Supplier grants confer no staff membership or raw planning-table access. Anonymous users, API service integrations and workers gain no publication authority.

Retries require current editor and batch access, but return the original publication without refreshing values, even after changed prices or member-handoff deletion. Withdrawal removes supplier access on subsequent requests; retries never restore it. Internal history remains available. Copied summaries follow their actual batch and location deletion cascades, not the deletion of a member handoff.

Individual and batch publications remain independent. Overlap counts and links cover only currently visible event publications for the same organization/supplier. Unpublished, withdrawn and ordinary publications remain private. A retained batch can still identify overlap through copied member identities after source deletion, without exposing those identities to suppliers. Links refer only to publication IDs and are capped at 25; the count remains complete.

## Interface and verification

Use the shared compact green header, 16px page titles, 14px evidence values, logical spacing and keyboard-scrollable tables. Verify internal preview, supplier listing and batch detail at 375, 768, 1024, 1440 and 1920px in English and Arabic RTL. Preserve keyboard confirmation, visible errors and hidden-record HTTP 404 behavior.

Coverage includes pgTAP authorization/privacy/atomicity/retention checks, independent-connection races including a changed second member, strict schema and server-action tests, and browser flows with retained screenshots. Regression checks include individual event publications and ordinary supplier publications/responses.

Apply the additive migration before deploying the new routes. Roll back by disabling these entry points; retain publication and audit records. No hosted schema changes are part of this implementation. Publications are planning proposals: viewing creates no acceptance, supply commitment, purchase order, reservation or inbound stock.

### Local validation record

- Full pgTAP: 120 files / 7,251 assertions passed.
- Concurrent publication and regression tests: 34 passed, including 15 event-batch cases and second-member price/deletion races.
- Web unit suite: 208 files / 2,239 tests passed with two workers. Two earlier default-worker runs each hit a different existing 5-second repository file-scan timeout; no assertions or timeouts were relaxed. Simulation worker: 13 passed.
- Engine non-database suite, including statistical checks: 498 passed.
- TypeScript, lint, logical-direction checks, repository formatting and production Next.js build passed.
- Four authenticated production-browser flows passed: event batches, individual event publications, ordinary batches and ordinary supplier responses.
- New preview/list/detail screens passed typography and document-overflow checks at 375, 768, 1024, 1440 and 1920px in English and Arabic RTL. Thirty screenshots were captured; representative layouts across all five widths and both locales were visually inspected. Keyboard confirmation/table focus, private evidence, visible overlap, current roles, copied history, withdrawal and revocation passed.

All local verification used the task-owned loopback stack. Linux CI remains the full browser/database integration and Cloudflare packaging gate; hosted migrations and deployment are separate.
