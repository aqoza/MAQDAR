# Event purchase handoff batches — Step 19i

Status: implemented 2026-10-18; review pending.

Open **Replenishment → Event batches → Choose batch lines**. Search item or event names and filter supplier, receiving location or adjusted order date. Add checked lines before changing pages or filters; added lines remain selected. Preview the comparison evidence and overlapping packages, save, then download CSV or JSON.

## Selection and totals

Select 1–50 distinct saved event purchase handoffs sharing a supplier identity, receiving-location identity, currency/precision and adjusted order date. Each item identity and saved item code may appear once, even across independent events. Units, cutoffs, receipt dates and event assumptions remain specific to each line. Ordinary purchase handoffs cannot be mixed into these packages.

The selected lines contain full event-adjusted quantities and costs. Baseline quantities and costs are comparison evidence, not additional purchases. The adjusted subtotal is the exact sum of saved rounded adjusted line subtotals. The baseline subtotal separately sums saved rounded baseline line subtotals; the comparison increase is their difference. There is no second rounding, inferred conversion, quantity pooling or repricing. Derived totals can exceed a single line's amount limit and remain exact numeric strings.

Every first save requires all proposals to remain selected, complete current price evidence to match, the supplier/receiver to be active, the saved policy-recalculation flag to be explicitly false and the event-before-receipt array to be known and empty. Missing or malformed timing evidence fails closed. One incompatible, unavailable or changed line rejects the entire save. Existing stock, inbound and event assumptions remain as-of evidence; those commitments are not refreshed.

## Retry and history rules

The sorted set of handoff UUIDs is the organization's retry identity. Input order does not matter. Concurrent identical requests produce one batch and audit event. An existing set returns its original evidence after checking live editor authority and source visibility, even when later prices or approvals changed. A replay is not fresh validation.

Different sets may reuse a handoff. Candidate reuse counts and overlap panels identify this, showing a total and at most 25 recent overlapping batches. Live selection is separate from saved files: a newer approved proposal makes packages containing the older selection historical. Original downloads remain unchanged. An individual source handoff may be deleted while its copied batch evidence survives; live context then becomes unavailable and a retry still requires source visibility. Organization/location deletion follows existing cascade semantics.

Overlap is not additional demand. Separate event drafts and ordinary purchase selections may also overlap, beyond the same-handoff reuse shown here. Packages do not prevent duplicate external execution or revoke downloaded copies. Saving/downloading creates no order, reservation, inbound, transmission or acknowledgement. Shipment consolidation, capacity scenarios, API-key access and execution are separate increments.

## File contract

`event-purchase-handoff-batch-v1` uses `purpose: planning_only` and `selected_quantity_basis: full_event_adjusted`. Its metadata and comparison summary precede UUID-ordered `lines` containing complete original `event-purchase-handoff-v1` payloads. The exporter validates the required display shape while retaining nested event, policy and forecast evidence that display components omit. Decimals, natural codes and business dates remain strings. Existing single-event and ordinary batch serializers are unchanged.

JSON has deterministic ordering and a trailing newline. CSV uses UTF-8 BOM, CRLF, quoted cells and the existing spreadsheet-safe writer. Each row is one full adjusted selection with clearly labeled baseline/difference fields, dates, price and approval/event/source references. Batch summaries repeat on every row and must not be summed; only the corresponding line subtotals are additive. Line numbers are display positions, not external order-line identifiers. JSON is the lossless format; spreadsheets may reformat codes, dates and long numbers. Snapshot tests freeze this version's bytes; future contract changes require a new version preserving historical downloads.

## Access and persistence

Owners, admins and planners preview/save. Members with current receiving-location access inspect/download. Membership and claims restrict organization access, and branch RLS applies to tables, candidate/history views and overlap counts. No service-role or worker permission is added. The download route uses the session's active organization, private/no-store attachments, nosniff and generic errors; signed-out requests return 401 and hidden records return 404.

The additive `event_purchase_handoff_batches` table has canonical-set uniqueness, explicit read-only authenticated grants, tenant/location RLS, recent/location/GIN overlap indexes and the business audit trigger. Creation is RPC-only. The save RPC shares the event-review organization lock with decisions and handoff creation. The stable preview rechecks authority after waiting and evaluates all source/price checks from one statement snapshot, with explicit scope even when invoked by the definer save RPC. It never creates individual handoffs as a side effect.

## Verification and rollout

Use synthetic data on loopback Supabase. Run pgTAP, database pytest and Playwright sequentially. Cover compatibility and 1/50/51 boundaries, duplicate items, complete copied evidence, exact totals, zero prices, large sums, current price/selection/timing gates, role/tenant/branch denial, immutable retries, source deletion and concurrent lock waits. Preserve ordinary batches and single-event handoff workflows. Check creation, real downloads, retained selection, history, filters/paging, overlap, keyboard help and screenshots at 375/768/1024/1440/1920px plus RTL.

Apply `20261018174915_event_purchase_handoff_batches.sql` before the reviewed web build. No backfill or worker change is needed. The migration creates new objects without rewriting existing business tables. Rollback restores the previous web build while retaining additive schema and evidence; destructive removal requires separate review. This increment applies local migrations only; hosted migration and deployment remain owner-run after review.

Local verification on 2026-10-18:

- Lint, typecheck, logical-direction checks, scoped formatting and production Next.js build passed.
- Full web unit suite: 1,520 tests across 132 files, including 25 new serializer, route and action tests.
- Full pgTAP suite: 4,337 assertions across 70 files. New batch coverage includes 85 assertions, a real 50-line save, zero prices, three-decimal currencies and totals beyond JavaScript safe integer precision.
- Focused database pytest: 11 concurrent/retry/authority cases passed. Non-database engine regression: 294 passed; unrelated local Acme seed tests were excluded.
- Production Playwright: event batches, individual event handoffs and ordinary purchase batches passed without retries. Coverage includes real downloads, unchanged historical bytes, stale-preview rejection, retained selection, actual multi-page candidate/history lists, overlap and live role/location restrictions.
- Screenshots reviewed for picker, preview, saved detail and history at 375, 768, 1024, 1440 and 1920px, plus RTL history at 375/1440px. Wide tables scroll inside their containers; page-level overflow checks and keyboard help focus restoration passed. The picker test waits for its specific heading and rows before taking screenshots.
- Manual security/code review covered definer scope, current authority after lock waits, immutable/current context separation, CSV escaping and session-only scoped downloads. No blocking findings; no automated security scanner was run.

The local browser fixture uses 30 synthetic saved forecast/policy outputs, then real event, independent approval and handoff RPCs. It does not represent a hosted or live-data validation. GitHub CI remains the separate clean-environment gate for the pull request.
