# Network allocation — Step 22

Status: merged in PR #111 as `8fee288`. Revision 1.

The owner approved one saved allocation scenario for one item, an active central warehouse or hub, and 1–20 active receiving branches. Planners explicitly select a warehouse policy maximum (calculated or a particular approved revision) and one saved ordinary replenishment draft per branch.

## Calculation and evidence

Reuse `redistribution_preview` for each branch: same individual item, known matching units and cutoff, exact-cutoff stock, explicit source additional unallocated backorders, and an active directed lane. Warehouse surplus is `max(on-hand − allocations − additional unallocated backorders − selected maximum, 0)`. Warehouse inbound is excluded. Saved branch drafts retain their stock, complete-inbound confirmation, maximum and gap; their commitments are not refreshed.

Convert surplus and gaps to integer thousandths by flooring; any smaller residual remains unallocated. Set the budget to the smaller of source thousandths and total gap thousandths. Each branch starts with the integer quotient of `budget × branch gap / total gap`. Give remaining thousandths to descending exact remainders, breaking ties by ascending location UUID. Zero total gap allocates zero. No floating point or rounded division is used.

Show the original branch gap, proposed quantity and remaining gap separately. Retained warehouse stock means `on-hand − allocations − additional backorders − proposed transfers`, and can be negative if commitments already exceed stock. Retained surplus is separately shown. Lane p50/p90 values describe current settings confirmed applicable at cutoff; they do not calculate arrival dates. Overdue/late inbound warnings remain visible.

## Authority and persistence

- Members can preview; owners/admins/planners save. Every operation requires current organization membership and access to the warehouse and **all** branches.
- `required_location_ids` is derived only by the guarded save RPC. The restrictive RLS subset predicate uses one set-based scoped-location InitPlan, ANDed with organization membership. A member who loses even one location sees neither the record nor its list/count.
- Save serializes organization requests, rechecks current editor authority after waiting, recalculates all evidence and compares the preview fingerprint before inserting anything.
- Request UUID retries require the same author, canonical draft set, source policy/maximum, commitments and fingerprint. Identical retries return the original evidence even after later changes; conflicting reuse fails.
- Saved scenarios copy their evidence and survive source policy/draft deletion. Current access still governs reads/retries. Deleting any participating location deletes the complete scenario; organization deletion cascades. A pinned-path, trigger-only definer handles receiving-location deletion; save locks all locations against deletion before insertion.
- There are no API-key or worker grants, direct client mutations, reservations, orders, transfer execution or inventory writes. Separate scenarios can propose the same stock.

## Acceptance and verification

All criteria are required and apply only to the local development stack or isolated CI.

| ID     | Starting condition and action                                                          | Expected result / prohibited effect                                                   | Verification                                                                            |
| ------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| AC-001 | Select compatible drafts and a warehouse maximum; preview                              | One exact shared budget; no branch gap exceeded, no pooled branch quantity            | pgTAP quotient/remainder boundaries and 151 twenty-branch cases; independent DB example |
| AC-002 | Use missing/incompatible stock, unit, cutoff, lane, confirmation or inactive locations | Unavailable quantities remain unknown; save nothing                                   | DB evidence and stale-preview cases                                                     |
| AC-003 | Repeat/reorder a save, including concurrent requests                                   | One immutable record and audit; conflicting reuse fails                               | Independent-session DB tests                                                            |
| AC-004 | Revoke one location or edit authority; read/save/retry                                 | Denied without exposing hidden evidence; recheck after lock wait                      | RLS/count, authority and concurrency tests; browser 404                                 |
| AC-005 | Change evidence after preview or delete source records after save                      | First save requires refresh; original saved evidence survives source changes/deletion | DB and browser tests                                                                    |
| AC-006 | Select, preview, save and inspect at 375/768/1024/1440/1920px and Arabic RTL           | Shared green/type roles, keyboard tables, no page overflow; no operational changes    | Playwright screenshots and UI checks                                                    |

## Rollout and rollback

Additive migration `20261020120000_network_allocation.sql`, generated types, and web deployment. No worker change or historical backfill. Apply only through the owner-authorized deployment workflow after review. Rollback the web release first and retain the new tables and saved evidence; do not remove history as an application rollback. Local validation uses `supabase migration up --local`, focused pgTAP, independent-session pytest, unit/type/lint checks and Playwright. CI verifies the complete migration chain from an empty local database.
