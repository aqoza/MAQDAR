# Direct substitute stock locator (Step 17c)

Status: owner-approved on 2026-10-18. PR #59 was reviewed without blocking findings and merged as `d9e16f9` with all three CI jobs passing.

## Approved behavior

The stock locator gains an optional **Exact + direct substitutes** mode alongside exact-only and two-way interchangeable search. Exact-only remains the default. Each item/location retains a separate observation, current item status and match label. No stock pooling, reservations, issue authorization or order creation is added.

A substitute qualifies only through a current explicit `one_way` record from the requested item to that alternate. Both catalog units must equal the requested unit; quantities are interpreted at 1:1. Reverse links, one-way chains, two-way bridges and supersession conversions never expand this mode. A requested catalog-unit mismatch leaves exact observations available with an explanation. Missing snapshot units never inherit catalog units.

The existing stock rules remain: choose the latest snapshot on or before the selected date before evaluating freshness, unit or quantity. Matching stock is positive on-hand minus allocations, with a matching supplied unit and age no more than seven days. Missing, stale, incompatible and zero/negative observations remain inspectable. No inbound, source policy protection or additional commitments enter the quantity; observed stock is not transferable surplus.

Matching rows rank by unrounded straight-line distance, unknown distances last, then source code/ID and item code/ID. Recorded priority is evidence, not a ranking rule. A closer substitute can precede farther exact stock. Current directed-lane p50/p90 references remain separate from distance, without an arrival promise. Existing tenant, active-organization and branch rules require access to both the receiver and each source.

Relationship evidence includes the requested-to-alternate direction, ID, priority, note and relationship/catalog update times. Notes render as text. Relationships are current unversioned records, including when the stock date is historical; this does not reconstruct historical catalog validity. Each direct substitute has exactly one link in its evidence path.

## Implementation and compatibility

The existing `stock_locator` RPC signature, invoker rights and grants remain unchanged. Its filter allow-list gains `scope: substitutes`; prior exact/interchangeable modes retain their meanings. Row match kinds distinguish `substitute` from `interchangeable`. Relationship notes are additive, and the frontend accepts their absence for older compatible responses. Direct candidate discovery is non-recursive and bounded to 100 items including the requested item. Exceeding the bound returns a visible `substitute_limit` error with no partial results. Exact and interchangeable searches remain usable independently.

Stock rows are still paged in groups of 25/50/100. Path metadata is expanded only for items on the returned page. All reads share the stable function's statement snapshot, keeping catalog, relationship and stock evidence coherent. No stored business data or generated database signatures change.

## Acceptance and verification

- AC-001: Only explicit outgoing same-unit one-way links qualify. Reverse, chained, cyclic, mixed, two-way, supersession and incompatible-unit paths do not infer further candidates. Existing exact and interchangeable regressions remain green.
- AC-002: Latest-snapshot selection, seven/eight-day freshness, missing/future observations, unknown/different supplied units, zero/negative quantities and large exact decimals preserve their existing meanings without fallback or pooling.
- AC-003: Direction, note, priority, current item status and update evidence are inspectable. Catalog edits are reflected on subsequent requests; priorities do not change distance order. HTML-looking notes render as plain text.
- AC-004: Tenant/active-claim and viewer/branch checks cover receiver-only, source-only and both-location access, including scoped counts. Reads leave stock, relationships, audits and drafts unchanged.
- AC-005: Filtering and deterministic paging retain the selected mode, with no repeated item/location pairs. The 100/101-item boundary produces a visible error while exact-only lookup remains available.
- AC-006: Shared compact green typography, contained form controls, keyboard evidence disclosure and local table scrolling work at 375, 768, 1024, 1440 and 1920px, with Arabic RTL checks at 375 and 1440px.

Database fixtures run in rollback transactions; browser fixtures target the loopback stack. Full verification outcomes are recorded below and on the PR. Database suites, engine database tests and Playwright run sequentially to avoid interfering with shared tables and statistics.

## Rollout and rollback

Apply `20261017211239_direct_substitute_stock_locator.sql` before deploying the new web build. The previous web build remains compatible with the upgraded RPC, so rollback can retain the read-only migration and restore the previous client. Any function rollback requires a new forward migration after the client rollback. This implementation performs no hosted migration or deployment.

## Verification record

- All 3,566 pgTAP assertions across 60 files passed, including 70 new direct-substitute cases and both existing locator suites.
- All 1,323 web unit tests, 294 engine unit tests and three import-retention checks passed. The engine's 169 database-marked tests are included in the complete CI run.
- Repository formatting, lint, TypeScript, logical CSS, generated-type comparison and production build passed. The generated database types are unchanged.
- All three locator browser workflows passed against the final local production build without retries. Checks include exact/interchangeable compatibility, direct orientation, safe note rendering, filters/paging, catalog mismatch, viewer/branch access and overflow recovery.
- Final screenshots were inspected at 375, 768, 1024, 1440 and 1920px, and Arabic RTL at 375/1440px. Checks cover shared 20px titles and 14px table text, contained controls, local table scrolling, keyboard disclosure, directionally isolated item codes and visible paragraph bounds. The 768px scope-field width was adjusted after visual inspection to retain the complete mode label without an extra form row.
- Hosted data and deployment were untouched. Complete CI outcomes are recorded on the PR.
