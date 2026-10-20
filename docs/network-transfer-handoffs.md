# Step 22e: network transfer handoff exports

Status: approved by the owner on 2026-10-20 after PR #118 merged as `d22d37e`.

## Outcome

Members can save and download a complete approved network proposal as an immutable planning handoff. One handoff covers the warehouse and every branch in that proposal. Quantities, dates, freight and approval evidence remain exactly as approved.

## Scope

- Create one handoff per selected approved network proposal, with stable retries.
- Provide searchable handoff history, an evidence detail page, and CSV/JSON downloads.
- Include the source warehouse, item/unit, original allocation, proposal/approval references, common dispatch date, and each branch's allocated quantity, p50/p90 receipt dates, freight basis and saved cost.
- Retain the saved currency-separated totals; do not add unlike currencies or recalculate line costs.
- Include zero-allocation branches as explicit "no transfer needed" context, without inventing dates or costs.
- Keep live selected/historical status separate from the immutable export.
- Use the existing compact green components and shared typography, with English and Arabic RTL at 375, 768, 1024, 1440 and 1920px.

## First-save checks

- The proposal is approved and remains selected for its original network allocation.
- Its saved estimate is complete and has at least one positive branch allocation.
- Current freight evidence matches the saved estimate.
- Every participating location remains active; the original lanes remain active with their saved lead times.
- Every positive branch has known saved receipts and both timing-review flags explicitly clear. Zero branches require no receipt dates.
- The caller is an editor in the active organization and can access the warehouse and every branch, including zero-allocation branches.
- Selection and evidence checks run atomically using the existing network-review lock, with authority rechecked after lock waits.

## Evidence and lifecycle

- Copy the approved evidence into a versioned network-specific payload. Preserve decimal values as strings.
- Never refresh saved stock commitments, quantities, calendar evidence or dates during export.
- Repeated creation for the same proposal returns its original handoff after checking current caller authority, even if selection or freight evidence changed later.
- Later approvals make older handoffs historical without altering their files.
- Members need access to every participating location to inspect or download.
- Follow the existing single-transfer handoff parent-deletion and audit behavior: this increment does not introduce copied-batch survival rules.
- Download original saved evidence using deterministic JSON and spreadsheet-safe CSV escaping, with attachment/no-cache/no-sniff response headers.
- Inaccessible records return 404; unauthenticated download requests follow the existing 401 contract.

## Implementation

1. Add a migration for the tenant-scoped handoff table, read-only RLS, guarded creation RPC, audit behavior and list view.
2. Reuse network review/freight evidence validation and the shared CSV writer; add a network-specific schema and serializers.
3. Add creation controls to approved proposal details, handoff history/detail routes and download handlers.
4. Generate database types, add translations, and document the file contract and roadmap status.

## Using the handoff

Open Replenishment → Network → Network transfer review. An editor can save a handoff from a selected approved proposal. The detail page offers repeated keyboard-accessible JSON and CSV downloads and links back to the approved proposal and its freight estimate.

The network workspace and review header link to `/replenishment/network/handoffs`. Search includes saved item, warehouse and branch codes; warehouse and current/historical selection filters apply before pagination. The detail screen shows live selection and freight context separately from the saved evidence.

Browser-session downloads use `/api/network-handoffs/{id}/{json|csv}`. These are not integration API-key endpoints and grant no new key scope. The JSON contract is `network-transfer-handoff-v1`; all saved decimal quantities and costs remain strings. CSV has a UTF-8 BOM, CRLF rows, quoted fields and spreadsheet-formula neutralization. It contains one branch row, including zero branches, per saved freight line. `package_dispatch_date` and `package_totals_json` repeat package context; consumers must not sum the repeated totals. Zero branches have blank transfer dispatch/receipt dates and no computed freight cost, while recorded lane terms remain evidence.

The SQL creation RPC is `network_handoff_create(organization, proposal)`. Clients cannot supply payloads, actor IDs, location scope or selection state. The database derives these from the approved chain.

## Rollout

Apply `20261020203000_network_handoffs.sql` before deploying the web routes. This is an additive migration with no backfill or operational writes. If the web release is rolled back, retain the new tables and saved evidence; do not drop handoffs as a rollback mechanism. Hosted deployment remains a separate operation.

## Verification

- Database tests for cross-tenant isolation, all-location access, editor restrictions, selected approval, freight changes, positive-branch timing gates and zero-branch context.
- Stable retry tests before and after changes to selection/evidence; access revocation remains effective on retries and downloads.
- Concurrency checks for approval/save races and permission changes while waiting for locks.
- Exact-value serialization and CSV escaping tests.
- Browser coverage for creation, history, downloads, historical selection, restricted-location failures, all five widths and Arabic RTL.
- Run repository lint, logical CSS, typecheck, unit/database tests, production build and relevant browser tests; require CI before review.

## Boundaries

This produces planning files only. Cross-proposal batching, shipment consolidation, API read scopes, acknowledgements, transmission, stock reservations, transfer orders and execution remain later increments. Separate allocations may propose overlapping stock.
