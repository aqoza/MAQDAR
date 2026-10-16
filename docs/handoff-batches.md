# Purchase handoff batches (Step 15b)

Open **Replenishment → Purchase handoffs → Purchase handoff batches**, then **Choose batch lines**. Search item codes and filter supplier, receiving location or adjusted order date. Add checked lines before changing pages or filters; added lines remain selected. Preview the evidence and overlapping packages, then save and download CSV or JSON.

## Owner-approved behavior

Owners, admins and planners may preview and create batches. Members inspect/download within their tenant and current location access. Select 1–50 distinct saved handoffs sharing one supplier identity, receiving-location identity, currency/precision and adjusted order date. Each item identity and saved item code may appear only once, including handoffs from different drafts. Units, planning cutoffs and receipt dates remain specific to each line; quantities are never pooled.

New batches require every source proposal to remain selected, current supplier-price evidence to match its saved estimate, and the saved policy-recalculation flag to be explicitly false. An unavailable, incompatible or changed line rejects the whole operation. The subtotal is the exact sum of already-rounded saved line subtotals; no second rounding or recalculation of individual prices occurs. The derived sum may exceed a single line's amount limit and remains an exact numeric string.

The sorted set of handoff IDs is the retry identity. Repeating the same set, in any input order, returns the original batch after checking live editor authority and source visibility. It does not revalidate or replace historical prices/approvals. One handoff may appear in multiple different sets; candidate counts and overlap panels show this explicitly. Overlap panels show the total and the 25 most recent matching batches. Batch detail/list selection status is live context; exports are immutable. A later approval marks batches containing its predecessor as historical. Current price is checked for new saves, not claimed by the historical detail page.

Batching does not place or reserve orders, transmit files, claim external acceptance, change approvals or add inbound. Overlap is not additional demand. These packages cannot prevent duplicate external orders or revoke downloaded copies. ERP mapping, transmission, acknowledgment and execution follow separately. Taxes, freight, FX, container fill and quantity consolidation are outside this increment.

## File contract: `purchase-handoff-batch-v1`

JSON contains fixed top-level metadata, a `summary`, and ordered `lines` containing complete original `purchase-handoff-v1` payloads. Lines are ordered by handoff UUID so input order cannot affect identity or file bytes. Amounts/quantities and natural codes remain strings; dates remain business-day strings.

CSV is UTF-8 with BOM, CRLF, quoted cells and formula-safe text. One row represents one saved handoff, with batch ID, display line number, common metadata, exact quantity/unit/dates/cost and approval/evidence references. The batch subtotal repeats on each line; **do not sum that column**. `line_subtotal` is the additive column. Display line numbers are not external order-line codes. JSON preserves source text without CSV's protective apostrophes; spreadsheets may still reformat dates, long numbers or leading-zero codes.

Serializers and snapshot tests freeze v1 field order and encoding. Any later contract change requires a new version while preserving existing downloads. Step 15 single-handoff serializers remain unchanged. Downloads require the signed-in member's active organization and RLS, use attachment headers and private/no-store caching, and return safe errors for inaccessible or invalid records. There is no service-role client or external transport.

## Persistence, concurrency and access

`purchase_handoff_batches` is an additive RPC-only table with tenant/location RLS, explicit privileges, one audit entry per new batch, a unique organization/canonical-ID-set key, and a GIN index for overlap queries. Copies survive deletion of an individual source handoff; such batches show unavailable source context and cannot be recreated via retry. Organization/location deletion retains the existing cascade behavior. Source references inside the copied evidence are historical identifiers, not guaranteed live links.

`purchase_handoff_batch_preview` is an invoker function with explicit editor and source-location checks, including when called by the definer create RPC. Creation takes the purchase-review organization lock shared with proposal decisions, then checks authority and all evidence again. All lines and their price checks use the preview statement's database snapshot. No partially saved batch is possible. Invoker views expose history, source selection and scoped overlap counts. No existing business tables or worker permissions change.

## Verification and rollout

pgTAP covers tenant/branch/role access, direct-write denial, complete evidence preservation, mixed headers, repeated items, 1/50/51 bounds, multi-unit/multi-receipt batches, exact costs, stable set retries, overlap counts, price/policy/selection gates and unchanged stock/orders/receipts. The 50-line save is tested under an eight-second statement budget. Independent-session Python tests exercise concurrent creation and changes to price, approval, authority and source availability while waiting. Web tests cover versioned files, formula text, precision, input validation, actions and protected download routes. Production Playwright verifies selecting, previewing, saving, downloading, overlap, stale saves, historical evidence and scoped member reads.

After review, the owner runs `pnpm exec supabase db push` for `20261016165635_purchase_handoff_batches.sql`, then deploys the web build. No worker update is required. The migration creates an empty table, indexes, two functions and three invoker views without rewriting existing data. Rollback restores the previous web build and retains additive database objects and evidence. This task applies only local migrations and does not deploy.
