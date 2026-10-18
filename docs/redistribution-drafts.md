# Redistribution drafts (Step 16)

Status: merged in PR #38 as `2888553`. PR #37 merged as `a16f232` with all three CI jobs passing, including browser tests and Cloudflare packaging.

## Approved scope

Save individual-item transfer quantity scenarios from a saved destination replenishment draft and an explicitly selected source policy maximum at another location. Use an active directed network lane. Keep the compact green interface at 375, 768, 1024, 1440 and 1920px. Dates, freight costing, approval and execution follow separately.

`redistribution-quantity-v1` uses exact decimal quantities:

- Source surplus = max(source on-hand − allocations − additional unallocated backorders − selected source maximum, 0).
- Proposed transfer = min(source surplus, saved destination replenishment gap).
- Source inbound does not contribute stock available to transfer. Additional backorders are explicitly entered, including zero, and exclude commitments already allocated.
- Both policies must describe the same individual item, known matching units and the same forecast cutoff. Stock evidence on both sides must be dated exactly at that cutoff. The destination keeps its saved stock, inbound, backorders and maximum; the source uses a fresh stock comparison at the shared cutoff. This is an as-of scenario, not current availability or a reconstruction from versioned feeds.
- Planners confirm that source commitments and current lane settings apply at that cutoff. Unknown, stale or incompatible evidence produces an unavailable preview; only available previews can be saved. An available zero quantity is distinct from missing evidence.
- Destination overdue/late inbound warnings remain visible. Lane p50/p90 calendar-day lead times are context only; no arrival date or timely-supply claim is calculated.
- Drafts neither reserve stock nor change stock, inbound, receipts, approvals or orders. Multiple scenarios may propose the same stock. Execution must resolve competing claims separately.

## Acceptance

- AC-001: Choose a saved destination draft and a paginated compatible source policy through an active directed lane; explicitly select the calculated maximum or a specific approved revision. Inspect source/destination evidence and save a quantity scenario.
- AC-002: Exact arithmetic handles fractions, deficits, zero destination gaps and source backorders without counting source inbound or subtracting receipts again. Unknown units, different items/cutoffs, prepared groups, missing/exact-date stock and inactive/reversed lanes cannot produce quantities.
- AC-003: Both locations must be authorized for previews, candidate selection, saved details and list counts. Tenant/active-organization isolation applies throughout; only owners/admins/planners save. Anonymous, service and worker roles gain no capability.
- AC-004: New saves recheck evidence fingerprints and live authority after lock waits. Identical request retries return the original record, even after feed/lane changes. Conflicting requests fail. Saves are append-only and audited once; existing records never reserve or mutate operational data.
- AC-005: Accessible filters, forms, disclosures and contained table scrolling work at all five widths. Reasons, confirmations and timing warnings remain visible; methodology is expandable.

## Architecture and rollout

The invoker preview explicitly checks membership and both endpoint scopes so the same checks survive the guarded definer save call. Two restrictive read policies on the saved table are ANDed together: destination scope and source scope. The invariant test adds only the exact existing set-based predicate shape for `source_location_id`. Both endpoints are joined through scoped location rows in the invoker candidate view.

Organization-scoped request UUIDs identify retries. An organization advisory lock serializes saves; authority is checked again after waiting. A fingerprint covers the destination's immutable report, source comparison, additional backorders, confirmations and lane terms. The saved JSON contains decimal strings and keeps its original evidence; later source-feed or lane changes require a refreshed preview for new records.

After review, the owner runs `pnpm exec supabase db push` to apply `20261017082212_redistribution_drafts.sql` before deploying the web build. Hosted migrations and deployment were not performed for this step. Roll back the web build while retaining the table, views and RPCs; no destructive rollback or data backfill is required. Tests use synthetic local data only.

## Verification

- Local pgTAP: 2,801 assertions across 49 files, including 76 redistribution assertions and the expanded tenant/privilege invariants.
- Python: 293 engine tests and 113 database tests, including seven redistribution concurrency and freshness tests. Database suites run sequentially.
- Web: 1,205 unit tests; lint, TypeScript, logical CSS, formatting and the production build. Generated database types match the local schema; all three retention-script tests pass.
- Browser checks cover paginated source policies and approved revisions, explicit confirmations, exact quantities, changed-input rejection, stable saved evidence, viewer access and both-location scope. The full regression found an over-compressed mobile table; table minimum widths and keyboard-accessible scrolling address it. All seven affected workflow/responsive checks pass after that correction, giving passing coverage for all 55 non-scale browser tests across the regression and final rerun. Three opt-in scale tests are intentionally skipped.
- Screenshot review includes 64-character source codes and expanded source, destination and lane evidence at 375 and 1440px; automated layout checks also cover 768, 1024 and 1920px. Methodology stays expandable and the actual destination timing warning remains visible.
