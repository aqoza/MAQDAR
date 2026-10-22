# Regional sourcing — Step 25c

Approved 2026-10-22 after PR #142 merged. One scenario covers one saved ordinary
individual-item replenishment draft using every other member of one active named
region as a potential source. Regions contain 2–20 same-organization locations.

## Calculation and evidence

Explicitly select each source's saved policy, calculated maximum or particular
approved override, and additional unallocated backorders (including explicit zero).
Reuse the existing redistribution checks: same item, known supplied units and
cutoff, exact-cutoff stock and an active directed source-to-destination lane.
All participating locations must be active. Require confirmation of source
commitments and current lane applicability to the historical cutoff.

Source surplus is `max(on-hand − allocations − additional backorders − maximum, 0)`.
Source inbound is excluded. The destination keeps its original stock, remaining
open inbound, backorders, maximum, gap and overdue/late warnings. New source
previews do not refresh destination commitments.

The existing exact allocator receives the saved destination gap as its budget and
source surpluses as its weights/caps. Floor each to integer thousandths first.
Allocate the smaller of the gap and the sum of usable source surpluses, using
integer quotient/remainder arithmetic. Award remaining thousandths in descending
remainder order, with ascending location UUID as the tie-break. No source surplus
or destination gap is exceeded; sub-thousandth residuals remain unallocated.
Quantities remain decimal strings through calculation, persistence and display.

Show proposed quantity and remaining surplus per source, stock retained after
allocations/backorders/transfers, total proposed quantity and remaining destination
gap. Retained stock may be negative when commitments already exceed stock; do not
clamp that balance. Incomplete evidence makes all coordinated allocation totals
unknown and prevents saving. Complete zero surplus is a valid zero result.

The captured region contains its original definition; the separate location
evidence contains current labels and timestamps resolved by immutable identity.
Each source retains its stock, selected policy/override and lane evidence. The
independent single-source transfer cap is deliberately not presented as the
coordinated source allocation. No dates, freight estimate or arrival guarantee is
calculated. Scenarios may overlap and reserve no stock or change operational data.

## Lifecycle and access

Editors preview through the UI and save. The database preview also allows members
with access to every region location. Full-region access governs reads, counts,
history, source options and retries, including zero-surplus members. Regions grant
no new authority. The new table has SELECT-only authenticated privileges, tenant
RLS and restrictive all-location RLS; only guarded RPCs can insert.

Inputs are bounded to 16 KiB and canonicalized by UUID, source order and decimal
representation. Organization/request UUID identifies retries. Identical author,
input and fingerprint returns the original record; conflicting reuse fails.
Every retry checks current membership, editor authority and all-location access.

New saves lock the request, then participating items/locations and region in the
existing assessment order. Recheck authority and recompute the preview after
waits. A changed preview must be refreshed. A SHARE lock on the region serializes
saving with archive: a committed archive prevents a new scenario, while a completed
save keeps its evidence. Capture is an as-of transaction snapshot, not a reservation
or a lock against subsequent stock imports.

Copied scenarios survive deletion/change of source regions, drafts, policies and
stock. Deleting the organization or any included location deletes the complete
scenario through the existing audit convention. New saves cannot use archived
regions; identical retries retain their original evidence after archive.

## Interface and verification

Routes live under `/replenishment/regional-stock/sourcing`, linked from regional
stock history and region details. Region/destination selection and saved history
are searchable and paginated at 25 rows. Per-source policy and approved-maximum
pickers are separately paginated, preserving explicit selections across pages.
Saved history searches captured region, item and location labels; it does not depend
on live source rows. English and Arabic use the shared compact green shell,
16px headings, 14px evidence and local keyboard-scrollable tables.

- AC-001: Exact proportional allocation, source/destination caps, zero and negative
  retained balances, unit/date/lane checks and explicit overrides — pgTAP and pytest.
- AC-002: Omitted/duplicate members, foreign/partial-location inputs, read counts
  and editor-only writes — tenant/ACL invariants, pgTAP and browser HTTP 404s.
- AC-003: Canonical retries, one audit, conflicts, stale previews and authority
  changes after waits — independent database sessions and action tests.
- AC-004: Archive/save ordering and copied evidence after source deletion —
  concurrency tests, pgTAP and held-preview browser checks.
- AC-005: Full preview/save/history workflow, policy/override pagination, keyboard
  table use and screenshots at 375/768/1024/1440/1920px in both locales — Playwright.

Run `0104_regional_sourcing.test.sql`, tenant/privilege invariants,
`test_regional_sourcing_db.py`, the sourcing schema/action tests and
`regional-sourcing.spec.ts`. Run shared database and browser fixtures sequentially.

## Rollout

Apply `20261022050000_regional_sourcing.sql` through the owner-reviewed hosted
migration workflow before deploying the web application. Implementation and
fixtures use the local database only. No worker, API-key scope, backfill or hosted
deployment is required by this PR. Roll back the web application while retaining
the additive schema and saved evidence.
