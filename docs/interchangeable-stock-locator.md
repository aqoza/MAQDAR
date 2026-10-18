# Interchangeable stock locator (Step 17b)

Status: PR #59 was reviewed at `fc97ad3` without blocking findings and merged as `d9e16f9` after all three CI jobs passed. Direct one-way search follows separately in [Step 17c](direct-substitute-stock-locator.md); this two-way mode retains its approved scope.

## Approved scope

Members can select **Exact + interchangeable** from the existing stock locator. Exact-item search remains the default. Each item/location has its own stock observation, current item status and exact/interchangeable label; quantities are never pooled. No stock reservation, transfer draft/order, stock mutation or integration API is added.

Alternatives follow connected current two-way interchange records at 1:1. The requested item's catalog unit and every intermediate/alternative catalog unit must equal the explicitly requested unit. One-way relationships in either direction, supersession conversions and paths through incompatible catalog units are excluded. A mismatched requested catalog unit leaves exact-item observations available and visibly explains why alternatives cannot be searched. Catalog units never supply missing snapshot units or relabel stock.

The latest snapshot on or before the chosen stock date wins **before** unit, quantity and age checks. Matching means positive on-hand minus allocations, a matching supplied unit and age at most seven days. Missing, stale, zero/negative and incompatible observations remain separate. No inbound, policy protection or additional commitments enter the calculation. Recorded item status is displayed, without inferring permission to issue or transfer the stock.

All matching item/location rows rank by unrounded straight-line distance; unknown distances follow known ones. Source code/ID then item code/ID break ties deterministically. An alternative at a closer source can precede exact stock farther away. Current directed-lane p50/p90 lead times remain independent references, with absent lanes explicit. Each source and the active receiver must be visible under existing tenant, active-organization and branch RLS.

Relationships have no historical versions. The UI labels them as current catalog evidence even when the stock date is historical. Inspect evidence shows one deterministic shortest-hop two-way path per alternative, including codes, units, relationship IDs, recorded priorities and relationship/catalog update times. A retained path is evidence of connectivity, not an issue preference; priorities do not affect distance ranking. Cycles and multiple paths never duplicate an item/location row.

## Bounds and implementation

The existing `stock_locator` signature is retained. Its allow-listed filter object gains `scope: exact | interchangeable` (default `exact`) and its JSON response gains item identity/status, scope and connection evidence. Existing response fields retain their meaning, except expanded results count item/location observations rather than distinct locations. The browser labels its pager accordingly.

Breadth-first traversal retains at most 100 items including the requested item, with at most 99 links in a path. Crossing this bound raises a specific visible error; no partial group is returned. Exact-only lookup remains available. The set of visited IDs prevents cycles; each breadth selects a deterministic predecessor per newly discovered item. Traversal carries compact item IDs; full connection metadata is built once per distinct item on the returned page. Stock, catalog and path reads share the stable function's statement snapshot. Paging remains 25/50/100 rows, and no new tables, grants, dependencies or API-key scopes are needed.

## Acceptance and verification

All checks use synthetic loopback data.

- AC-001: An exact search keeps its original stock eligibility and default behavior. Opting in returns direct and transitive same-unit two-way alternatives, labeled separately. Existing pgTAP/browser regression plus new database/browser workflows verify this.
- AC-002: Cycles and diamonds yield one row per item/location with an inspectable valid path. One-way edges, supersessions and mismatched unit bridges contribute no alternative stock. Database fixtures cover reverse traversal, current graph edits and the 100/101-item boundary.
- AC-003: Latest-observation selection, seven/eight-day freshness, future-only data, unknown/different supplied units, zero/negative stock and large exact decimals remain observable without pooling or fallback. Database and browser tests verify these boundaries.
- AC-004: Viewer and branch members see only permitted sources, counts and lane references after receiver authorization. Receiver-only/source-only access, cross-tenant requests and unchanged execute privileges are tested by pgTAP/browser workflows. Reads must leave stock, relationships, audits and drafts unchanged.
- AC-005: Matching rows rank by distance with stable item/location paging; exact rows have no artificial priority over closer alternatives. Database/browser tests cover ties, unknown distances, source filtering, expanded counts and retained URL scope.
- AC-006: Shared compact green typography and controls work at 375, 768, 1024, 1440 and 1920px, with keyboard disclosures, local table scrolling, visible group-limit/unit explanations and Arabic RTL. Playwright checks and screenshot inspection verify the layouts.

## Rollout and rollback

After review, apply `20261017200503_interchangeable_stock_locator.sql` before deploying the web build. The new client requires the additive result fields. The previous web build can still use the upgraded RPC with its original filters; roll back the web build while retaining the read-only function. Reverting the function itself, if needed, requires a new forward migration after the client rollback. No stored business data is changed. Hosted rollout remains separate from this implementation.

## Verification record

- All 3,496 pgTAP assertions across 59 files passed. After the final query optimization, both affected suites passed again: 138 assertions, including 62 new interchange cases.
- All 1,321 web unit tests and 294 engine unit tests passed; 169 database-marked engine tests are left to the complete CI run. Two filesystem-scanning web tests initially timed out while the production build ran; rerunning with two workers passed without changing their assertions or timeouts.
- Repository formatting, lint, TypeScript, logical CSS, generated database-type comparison and the production build passed. The migration changes no function signature, so generated types are unchanged.
- A local rollback-only benchmark searched 100 connected items across 200 sources (20,000 observations), returning 100 rows with paths up to 99 links in 4.725 seconds under the eight-second authenticated request timeout. JSON was approximately 1.60 MB. This is one synthetic development-machine measurement, not a hosted latency guarantee; it improved from 7.456 seconds before compact traversal and page-only path expansion.
- Both locator browser workflows passed against the final local production build without retries, including viewer/branch access, direct/transitive evidence, filters, paging, incompatible units and oversized-group recovery. The five existing responsive-planning regressions also passed. An initially over-strict test label was corrected without changing application behavior.
- Layout checks and screenshot inspection cover 375, 768, 1024, 1440 and 1920px, with Arabic RTL at 375 and 1440px. Shared typography, contained controls, keyboard disclosure, local table scrolling and text bounds after font loading were checked. English fallback copy remains supported in Arabic.
- No hosted migration or deployment was performed. Full CI results are recorded on the PR.
