# Step 22f: network handoff batches

Status: approved by the owner on 2026-10-20 after PR #119 merged as `2ace263`.

## Outcome

Editors can package 1–50 complete selected network handoffs from one warehouse and dispatch date. Branch sets may differ. Every source approval remains intact, including zero branches, quantities, dates, freight and original evidence. Members with access to every participating location can inspect history and download CSV/JSON.

The picker is under **Replenishment → Network → Network transfer handoffs → Network handoff batches**. Add checked handoffs before changing filters or pages, preview the package and its overlap, then save. Search history by saved item, warehouse or branch; filter by warehouse and current/historical/unavailable source context.

## Grouping and totals

- Group by the saved source warehouse identity and adjusted dispatch date.
- Reject repeated handoff IDs, item identities or saved item codes. Do not split an approval or pool quantities.
- Retain each item's unit and cutoff and every branch's allocated quantity, p50/p90 receipts, lane terms and saved rounded freight.
- Sum saved positive-branch subtotals once, separately by currency. No second rounding or FX; precision for a given currency must agree.
- Retain each original shipment fee. This is document packaging, not shipment consolidation or a new freight estimate.
- Keep zero allocations as no-transfer context, with no invented dates or costs. A batch can contain up to 1,000 branch rows across 50 original handoffs.

## First-save validation and access

Every proposal must still be selected, its current freight/active lane/location evidence must match, and every positive branch's saved p50/p90 timing gate must be explicitly clear. One invalid source rejects the entire new batch. Saved stock commitments, quantities, calendars and dates are not refreshed.

Owners, admins and planners create. Members need current access to the warehouse and the union of all included branches, including zero branches, to inspect counts, candidates, history, overlap, copied evidence or downloads. No partial package is exposed to a user with narrower branch access.

Creation shares the network-review organization lock, protecting selection changes and concurrent retries. It locks participating locations and source handoffs against deletion, then rechecks authority and evidence after all waits. Inputs contain only source identities; clients cannot supply actor IDs, copied payloads, totals or location scope.

## Retries and retention

The sorted distinct handoff set is the retry identity, independent of input order. Identical authorized retries return the original record. Handoffs may occur in other batches; picker reuse counts and overlap panels show this under the same all-location access rules.

Later evidence changes or approvals do not alter files. A copied batch survives deletion of an individual source handoff, while its live context becomes unavailable. Creation retries still require all original sources to exist and be visible. Deleting the organization or any participating location removes its batch; insert and cascade deletion are audited.

Live context is independent of the saved files:

- **Current:** all original handoffs remain visible and their proposals are selected.
- **Historical:** all source handoffs remain visible, but at least one approval is no longer selected.
- **Unavailable:** at least one original handoff or its review context is missing.

Current selection does not assert that present freight matches, refresh availability or validate a new transfer. Independent allocations and overlapping packages can propose the same stock. No reservation, stock movement, transfer order or inbound update occurs.

## File contract

`network-handoff-batch-v1` JSON stores the batch identity, organization, creator/time, common summary and ordered complete `network-transfer-handoff-v1` payloads. Original decimal values remain strings. Currency totals are exact strings and can exceed a single source line's bounds.

CSV has one row per original handoff/branch, including zero branches. It reuses the single-network row serializer and adds batch metadata, handoff number and branch number. UTF-8 BOM, CRLF, quoted cells and spreadsheet-formula neutralization follow the existing download contract.

`batch_totals_json` and `package_totals_json` repeat context. **Do not sum repeated batch or source-package totals.** To aggregate line costs, sum each branch's `subtotal` once in its currency. JSON preserves exact source text and numeric strings; spreadsheet applications may reformat CSV values.

Browser-session downloads use `/api/network-batches/{id}/{json|csv}`, with active-organization RLS, safe 401/404 errors, attachment headers and private/no-store/no-sniff responses. No integration API-key permissions, acknowledgements or transmission are added.

## Verification

- Real multi-item allocation → scheduling → freight → independent approval → handoff → batch tests verify currency totals, original shipment fees, different branch sets, zero context and exact copied evidence.
- Database tests cover invalid sets, duplicate items/codes, stale selection/freight/timing, canonical/concurrent retries, post-wait authority checks, source deletion races, retained files and location cascades.
- pgTAP verifies tenant isolation, all-location visibility, immutable privileges, audited retention/cascades and invoker history/candidates.
- Unit tests pin versioned JSON/CSV, exact decimal strings, formula protection, bounded inputs and safe route/action behavior.
- Production browser tests exercise the picker, preview/save, downloads, overlap, stale saves, historical/unavailable context, missing-branch 404s, reader access and retained copied evidence.
- Inspect picker, preview, detail and history at 375, 768, 1024, 1440 and 1920px, plus Arabic RTL. Use shared compact green components, typography, keyboard controls and contained table scrolling.

All fixtures are synthetic and local/CI. Repository lint, types, formatting, logical CSS, tests, production build and CI are required before review.

## Rollout

Apply `20261020220000_network_handoff_batches.sql` before deploying these web routes. This additive migration creates an empty table, guarded functions, invoker views, RLS and cascade/audit behavior. It performs no backfill or operational writes. Roll back the web release while retaining schema and copied planning evidence. Hosted migration/deployment remains separate.
