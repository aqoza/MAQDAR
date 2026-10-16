# Replenishment drafts (Step 13)

Owner-approved on 2026-10-16 after PR #21 merged (`edf397b`): saved individual-item replenishment gaps from an explicitly selected calculated or approved policy maximum. Supplier MOQ/pack rounding, calendars, prepared groups and order execution follow in later increments.

## Acceptance

| Criterion | Observable outcome                                                                                                                                                            | Verification                                 |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| AC-001    | Select a calculated maximum or a particular approved revision from the policy workbench; inspect the stock and inbound evidence before saving.                                | SQL and production-browser tests             |
| AC-002    | Compute the exact unrounded gap with explicit additional unallocated backorders and order completeness confirmation. Missing evidence is unavailable, never an inferred zero. | Hand-calculated SQL fixtures and input tests |
| AC-003    | Require known matching units and stock dated exactly at the saved policy cutoff. Preserve legacy imports with unknown units.                                                  | Import/API, schema and SQL tests             |
| AC-004    | Count every positive remaining open inbound line regardless of due date. Flag overdue and after-protection arrivals; never subtract receipts again.                           | SQL and browser evidence assertions          |
| AC-005    | Save immutable evidence with actor and time, reject a changed preview, and replay duplicate save requests without duplicate records or audit events.                          | SQL and independent-session tests            |
| AC-006    | Members browse drafts under tenant/branch RLS; only planners, owners and admins save. Live authorization, including after lock waits, applies.                                | Role, privilege and concurrency tests        |
| AC-007    | Search/filter paginated saved drafts and inspect the original evidence after feeds change. Drafts do not create orders, reservations or planning jobs.                        | Browser and SQL assertions                   |

## Calculation and evidence

`replenishment-gap-v1` calculates:

```text
available stock = on-hand − allocations
inventory position = available stock + remaining open inbound − additional unallocated backorders
unrounded gap = max(selected periodic-review maximum − inventory position, 0)
```

Backorders are a required, nonnegative quantity entered in the saved policy unit, including an explicit zero when none exist. They must exclude commitments already represented by allocations. Negative stock availability is retained. The reorder-point reference is not a trigger in this periodic-review calculation. The selected maximum is used exactly, including an explicitly chosen approved override; newer approvals do not replace that choice.

The policy must have a successful source run, an available maximum, consistent captured individual-item demand units, and a saved protection period. The stock snapshot must be dated **exactly** at the forecast cutoff and carry that same known unit. Earlier stock accepted by the read-only excess comparison is insufficient for this draft calculation. Catalog units are never used to repair missing evidence.

All positive `open` lines at the same organization, item and location count, across suppliers and all expected arrival dates. Closed, canceled and zero-quantity lines do not count. `quantity` is already the remaining outstanding quantity; receipts never decrement it again. Every included line needs the same known unit. No foreign currencies are combined and no purchase cost is calculated.

An arrival before the cutoff is flagged overdue. An arrival after cutoff + saved lead time + saved review interval is flagged after the protection period. Both remain in inventory position. Consequently a zero gap does not imply timely supply or a service guarantee. This increment does not perform time-phased netting or expediting.

The planner explicitly confirms that the order book is complete and synchronized with stock at the policy cutoff. The mutable order feed has no historical versions: this is an attested recorded scenario, not a reconstructed historical planning decision. An empty order book becomes zero inbound only with that confirmation. Without it, inbound and the gap remain unknown.

Each preview captures up to 1,000 positive open lines, using a limit-plus-one completeness check. Above that bound, line evidence is omitted and no partial inbound total or gap is reported. Calculations use PostgreSQL numeric arithmetic and decimal strings throughout the UI; a gap outside `numeric(18,3)` is unavailable. Unavailable diagnoses can also be saved for inspection.

## Persistence and access

`replenishment_preview` uses invoker rights and explicit tenant/branch checks. `replenishment_save` repeats live editor authorization after its organization-scoped transaction lock, recalculates a preview from one statement snapshot, and compares a SHA-256 fingerprint with the inspected preview. A changed input requires a refreshed preview. The fingerprint is a freshness check, not an authorization token.

The save request UUID binds the author, policy, basis/revision, backorders, confirmation and fingerprint. Identical retries return the original record even after feeds change; conflicting reuse fails. The saved JSON includes source identifiers, stock/order update timestamps, quantity/unit evidence, selected threshold/revision, arrival flags and the result. Members can read it under tenant/branch RLS. There are no direct session, API or worker write grants. Insertions append to the administrator audit log; source policy/organization deletion follows existing cascade retention rules.

The Replenishment list uses a narrow invoker view so paginated browsing does not load every line's evidence. The detail page reads the saved report. Workers and queue capabilities are unchanged.

## Import/API compatibility and rollout

`open_orders.unit_of_measure` is an optional trailing import v1 field (`EA`, `SET`, `L`, `KG`). Existing rows remain NULL. Replacing an item's identity, remaining quantity or cost/currency without supplying its unit clears prior unit evidence; date, supplier and status-only updates preserve it. Unit-only updates and explicit NULL are accepted. The open-order merge checks references only when supplied, allowing partial existing-line updates while retaining required-reference validation for inserts.

The Python contract, generated JSON/Markdown/SQL seed and OpenAPI are regenerated together. API records include the nullable unit field. Quantity and unit replays remain idempotent.

Owner-run rollout: review and apply the two migrations with `pnpm exec supabase db push`, then deploy the web build. `20261016073852_replenishment_drafts.sql` adds nullable provenance and draft records with a five-second DDL lock timeout; it performs no historical table backfill or validation scan. `20261016074253_replenishment_order_index.sql` is a separate, single-statement concurrent index migration to avoid blocking inbound feed writes. If an interrupted concurrent build leaves an invalid index, the owner should review and remove that invalid index before retrying; an invalid index must not be silently accepted. No worker restart is needed.

Rollback reverts the web build while retaining the additive schema, provenance and saved evidence. Further schema changes use a reviewed forward migration. This task applies migrations only to the local test stack.
