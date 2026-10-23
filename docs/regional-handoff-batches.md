# Regional handoff batches — Step 25h

A batch copies 1–50 complete selected regional handoffs sharing the same saved region definition, receiving location and requested dispatch date. Actual source dispatches and p50/p90 receipts remain per-source. Every source, including zero allocations, stays in the evidence and access scope.

## Calculation and first-save gates

The server sums saved rounded source freight subtotals separately per currency. Original per-shipment charges remain; quantities are never pooled. Every approval must still be selected, the original region unarchived, locations active, original lanes active with saved leads, freight evidence unchanged, and positive-source timing flags explicitly clear. Any failed line aborts the transaction.

Regional handoff v1 does not carry an item UUID. New batches resolve it through the original destination draft and policy under the same organization and receiving location, matching the copied draft evidence and saved policy code/unit, then verify that the original item exists. Current item codes are never used to infer identity. Missing lineage prevents a new batch. Duplicate original item UUIDs or saved codes are rejected. Item identity evidence is copied separately, leaving the original v1 handoff unchanged.

## Lifecycle and authority

The canonical sorted handoff set is the retry identity. Retries require current editor authority and every original handoff to remain visible, but return existing files before checking changed live evidence. First saves serialize with regional review/archive/rate edits and recheck authority after lock waits. Browser readers need membership plus access to every participating location, including zeros. Views are security invoker; writes are RPC-only. No API-key scope is added.

Copied batches have no foreign key to source handoffs, region definitions or item lineage. Downloads survive archive, changed freight, later approval and source deletion. Missing source context is `unavailable`, separately from historical selection. Participating-location and organization deletion cascade; inserts and deletion are audited. Overlapping batches are allowed and visible only within the caller's current scope.

## Files and interface

JSON `regional-handoff-batch-v1` contains immutable original handoffs, item identity evidence and currency-separated totals. CSV emits one row per handoff/source with batch metadata, source number and original item UUID. Repeated batch/package totals are metadata, not additional line charges. Decimal text remains exact and CSV formula text is escaped. Downloads use session authorization, active organization, private/no-store and safe attachments.

Selection, preview, saved evidence and searchable history use the shared compact green design, contained wide tables and English/Arabic RTL. Shared typography and layouts are verified at 375, 768, 1024, 1440 and 1920px. Evidence disclosures keep full source and approval details inspectable.

Batches are planning packages. They do not consolidate shipments, refresh stock commitments, prevent duplicate external execution, reserve stock or create transfers.

## Verification and rollout

`test_regional_batches_db.py` covers real multi-item RPC chains, canonical/concurrent retries, exact totals, identity, selection/evidence gates, all-location authority, copied retention and cascades. `0109_regional_batches.test.sql` and shared invariants check the privilege boundary. Web tests pin versioned JSON/CSV and guard download/actions; `regional-batches.spec.ts` covers the authenticated workflow and five-width bilingual layouts.

The migration is additive. A web rollback retains saved packages. Hosted migrations/deployment are separate from this PR.
