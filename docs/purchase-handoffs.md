# Purchase handoffs (Step 15)

Open a selected approved proposal and choose **Save handoff**. The saved detail page offers CSV and JSON downloads. **Replenishment → Purchase handoffs** searches item codes and filters exact supplier/location codes and current versus historical selection.

## Approved behavior

Owners, admins and planners create handoffs. Members may inspect and download records within their current tenant/location access, including viewers and assigned branch users. Approval permissions are unchanged.

There is one handoff per approved proposal. Creation checks that the proposal is still its original draft's latest approved selection, that current supplier-price evidence matches the estimate's fingerprint, and that saved `policy_recalculation_required` is explicitly false. The approved quantity, unit, dates, price and subtotal stay fixed. A changed price requires a new estimate and approval; a changed selection requires the currently selected proposal.

The proposal itself is the retry identity. Concurrent creation returns one record and produces one audit entry. An existing handoff is returned after later price or selection changes, subject to current editor authority and source access. Retries do not create new evidence or claim that old evidence was checked again.

A later approved proposal can have its own handoff. Older handoffs remain historical; their original contents are preserved. The detail page shows current selection and the price check at page load separately from the saved evidence. An unavailable current-price check does not hide the saved download or imply a match.

Handoffs are **as-of planning evidence only**. Creation/download never places an order, contacts a supplier, records acceptance, reserves stock, changes a proposal decision or adds inbound. It does not refresh stock, inbound, policy or calendar assumptions. Identity is scoped to a saved proposal/draft; it does not prevent duplicate orders across different drafts or revoke already downloaded files. Saved multi-line [handoff batches](handoff-batches.md) group compatible handoffs and show overlapping packages. ERP mappings, transmission, acknowledgment and execution require later increments.

## File contract: `purchase-handoff-v1`

Both formats include a stable handoff ID, organization ID, creation time/actor, proposal ID/revision, approval evidence, original draft and estimate IDs, policy/forecast references, and the approved item/supplier/location/quantity/unit/dates/pricing. The purpose is `planning_only` and a notice states that this is not an order, supplier acceptance or inbound quantity.

JSON is UTF-8 with a trailing newline and deterministic field order. It contains `schema_version`, `purpose`, `notice`, `handoff_id`, `organization_id`, `created_by`, `created_at`, `proposal`, `evidence` and the complete saved `estimate`. Quantities, money and exact products remain decimal strings. Identifiers and natural codes remain strings; no JavaScript number conversion occurs. Times are saved instants, and business dates remain date-only strings.

CSV has one header and one record, UTF-8 BOM, CRLF line endings and every field quoted. It flattens the approved values, approval reasons and evidence references. Formula-like text receives a leading apostrophe using the existing spreadsheet-safe writer. JSON preserves those source values verbatim. Spreadsheet software may still reformat long numbers, leading-zero codes or dates when opening CSV; use JSON for lossless integration. No external order/line code is invented and the file is not the `open_orders` import format.

The v1 serializers and snapshot tests freeze column names, order and encoding. Subsequent contract changes require a new version while retaining v1 download behavior. Files contain the original snapshot only; current selection/price status is contextual UI information and does not rewrite old exports.

Downloads use the signed-in user's session, active organization and table RLS. They are attachments with `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`. Missing/inaccessible records return 404; signed-out API requests return 401. The implementation uses no service-role data client, connector credentials, Storage bucket or background task.

## Persistence and concurrency

`purchase_handoffs` is an additive, RPC-only table with tenant-composite proposal/location foreign keys, a unique organization/proposal identity, explicit privileges, tenant/branch RLS and the business audit trigger. The copied JSON is immutable to API roles and the worker. Source/org deletion retains the existing cascade semantics of the planning evidence chain.

`purchase_handoff_create` shares the purchase-review organization lock with submission/decision RPCs. It rechecks live role and source visibility after waiting, then returns an existing record or validates the selected approval and current price before inserting. The invoker `purchase_handoff_list` calculates current selection without mutating saved contents. No changes are made to import or REST transaction contracts.

## Verification and rollout

pgTAP tests cover roles, tenant/branch visibility, direct-write denial, source selection, exact copied evidence, price/policy gates, historical retries, auditing and unchanged stock/orders/receipts. Independent-session Python tests cover creation races and changes to selection, price, authority and source availability during lock waits. Web tests cover exact serialization, formula handling, bounded filters, actions and download access/error behavior. Production Playwright checks creation, download bytes, a stale save, history, member/branch reads and unchanged inbound.

After review, the owner runs `pnpm exec supabase db push` for `20261016132739_purchase_handoffs.sql`, then deploys the web build. No worker update is needed. The migration creates an empty table, indexes, one RPC and an invoker view without rewriting existing records. Rollback restores the earlier web build and retains the additive database objects and saved evidence. This development task does not apply hosted migrations or deploy.
