# Transfer handoff batches (Step 16f)

**Status:** Implemented and locally verified; review pending. Scope approved by the owner on 2026-10-17 after PR #46 merged as `3a97dc1`.

Open **Replenishment → Redistribution → Transfer proposal review → Transfer handoffs → Transfer handoff batches**. Choose batch lines, add checked lines before changing filters/pages, preview the saved evidence and overlap, then save and download CSV or JSON. Search history by item and filter source, destination or live selection. Compact green screens support 375, 768, 1024, 1440 and 1920px.

## Approved behavior

Editors (owners, admins and planners) preview and save 1–50 distinct handoffs. Every line must share the same directed lane identity, source/destination identities, currency/precision and dispatch date. Repeated item identities or saved item codes are rejected, including across separate drafts. Quantities, units, cutoffs and typical/slow receipt dates remain specific to each line. Quantities are never pooled.

New saves require all proposals still selected, current freight/lane/location evidence matching each saved estimate, positive available quantities and both saved timing flags explicitly false. Any invalid line rejects the entire new batch. The total is the exact sum of already-rounded line freight subtotals, with no second rounding. Each line keeps its supplied per-unit charge or its own one-shipment fee. A batch is a document package, not shipment consolidation or a new freight quote.

The sorted set of handoff identities provides stable retries independent of input order. Retries check current editor authority and visibility of all sources, then return the original batch without refreshing historical evidence. One handoff may appear in other sets. Candidate reuse counts and overlap panels expose this; panels show the count and 25 most recent overlapping batches. Later approvals make affected batches historical without changing files.

Members inspect/download only with current access to both source and destination. Missing/deleted individual source handoffs leave copied batch files intact but prevent creation retries; history shows unavailable/historical context. Existing organization/location cascade semantics remain. No worker or API-key permissions are added.

Saving/downloading does not refresh commitments, reserve stock, consolidate shipments, transmit files, create transfer orders or inbound, or prevent duplicate external execution. Stock evidence stays as-of. Transmission, integration acknowledgements and order execution remain later increments.

## Versioned files

`transfer-handoff-batch-v1` JSON stores the batch identity, organization, creation actor/time, common summary and ordered complete original `transfer-handoff-v1` payloads. Decimal values remain strings, date-only values stay date-only, and source text remains exact. The total can exceed a single line's numeric bounds and remains an exact string. Live selection is outside the immutable payload.

CSV uses UTF-8 BOM, CRLF, quoted cells and formula protection. Each row contains batch metadata followed by the existing single-handoff fields, including separate p50/p90 receipts, freight basis/rate, saved subtotal, quantities and approval/evidence references. `batch_schema_version` identifies the package, while `schema_version` identifies the source line. **Sum `subtotal` for line charges; do not sum the repeated `batch_subtotal`.** Display line numbers are not external transfer-order line numbers. Spreadsheets can reinterpret dates, long quantities or leading-zero codes; JSON preserves the source values.

The existing single-handoff CSV field builder is reused without changing its byte contract. Versioned snapshots pin JSON/CSV fields, order and encoding. Future changes must preserve these versions or introduce a new contract.

## Persistence and concurrency

The additive `transfer_handoff_batches` table has composite tenant/location references, explicit privileges, audit, tenant RLS and two restrictive endpoint policies. A unique organization/canonical-ID-set key prevents duplicate retries; a GIN index supports overlap. Invoker views expose list/candidate context with RLS. Copies contain complete evidence, with no foreign key that deletes packages when an individual source is removed.

The guarded create RPC shares transfer review's organization lock. The invoker preview explicitly checks editor authority and both endpoints even when called inside the definer create RPC. After lock waits, it rechecks current authority and all line evidence using a single preview statement snapshot. Downloads use the signed-in active organization and RLS, attachment headers, private/no-store caching and safe 401/404 errors.

## Acceptance and verification

- AC-001: An editor previews/saves compatible lines; mismatched common fields, repeated items, stale selection/freight or incomplete/flagged timing rejects all lines. Verify pgTAP plus a stale browser form.
- AC-002: All read/count/download paths require tenant and both-endpoint access; saves/retries require current editor authority. Verify privilege/RLS tests, route/action tests, separate-session demotion races and viewer/branch browser journeys.
- AC-003: Concurrent identical sets create one record/audit; reversed input order returns the same record; overlap remains visible and historical files stay fixed. Verify separate database sessions and actual browser download bytes.
- AC-004: Sum saved rounded freight, retaining each line's shipment fee and separate units/dates. Verify exact decimal pgTAP cases, a real multi-item RPC chain, and pinned file snapshots. No stock/order/receipt writes.
- AC-005: Picker, preview, detail and history remain usable at all five widths, with keyboard controls and contained table scrolling. Verify Playwright and inspect rendered screenshots.

Local verification passed 1,287 web unit tests, 379 pgTAP assertions across the new feature and tenant/privilege suites, nine independent-session database tests, and the existing single-handoff and new batch browser journeys. Picker, preview, detail and history screenshots were checked at 375, 768, 1024, 1440 and 1920px. Type checking, lint, formatting and the production build also passed. Full CI outcomes are recorded in the pull request.

All fixtures are synthetic and local/CI only. Database suites run sequentially because they share tables/statistics.

## Rollout and rollback

After review the owner runs `pnpm exec supabase db push` for `20261017145807_transfer_handoff_batches.sql`, then deploys the web build. This step applies migrations locally only. The migration creates an empty table, indexes, two guarded functions and two invoker views without rewriting existing data. No worker change is required. Roll back the web build while retaining the additive schema and saved evidence.
