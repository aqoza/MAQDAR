# Step 19d — approved event supplier scenarios

Approved 2026-10-18. Start from one available saved event replenishment draft. Compare its baseline and event-adjusted gaps using the same explicitly selected supplier's MOQ and pack terms. Preserve the draft's complete evidence and supply-timing warnings. Dates, pricing, approvals, exports and execution remain separate increments.

## Acceptance

- AC-001: A member can inspect only their tenant and permitted receiving locations. Only live owner/admin/planner roles save, including after waiting for a request lock. Direct writes are denied. Verify with pgTAP, concurrent sessions and browser access checks.
- AC-002: For each saved gap, zero stays zero; otherwise use the smallest pack multiple at least max(gap, MOQ). Exact integer-thousandth quotient/remainder arithmetic preserves fractional and large quantities. Show each rounded quantity, overage and the rounded-quantity increase. Overflow makes the comparison unavailable. Verify independent numerical oracles.
- AC-003: Require an active supplier, supplier-item terms for the saved item, matching known source-supplied units, lead time equal to the saved policy parameter and explicit terms-at-cutoff confirmation. Eligibility applies even when both gaps are zero. Missing or incompatible evidence prevents saving. Verify database and browser validation.
- AC-004: Copy the saved draft rather than refreshing stock/inbound or recomputing event assumptions. New saves compare current supplier/terms evidence with the preview; identical retries retain original evidence after later changes and conflicting request reuse fails. Verify changed terms, source fingerprints and lock-wait races.
- AC-005: Keep immutable scoped history and full source evidence without creating ordinary supplier scenarios, orders, reservations, policy overrides or pooled event scenarios. Verify persistence, privileges, audit and no-side-effect assertions.
- AC-006: Use compact green shared typography at 375, 768, 1024, 1440 and 1920px plus RTL, keyboard disclosure and local scrolling for evidence. Verify production-build Playwright and inspect screenshots.

## Numerical oracles

| Baseline gap        | Adjusted gap        | MOQ | Pack  | Baseline quantity   | Adjusted quantity   | Quantity increase |
| ------------------- | ------------------- | --- | ----- | ------------------- | ------------------- | ----------------- |
| 1.006               | 3.265               | 2   | 1.5   | 3                   | 4.5                 | 1.5               |
| 0                   | 0                   | 20  | 6     | 0                   | 0                   | 0                 |
| 0                   | 0.001               | 20  | 6     | 0                   | 24                  | 24                |
| 1.125               | 1.126               | 1.5 | 0.25  | 1.5                 | 1.5                 | 0                 |
| 999999999999999.998 | 999999999999999.999 | 0   | 0.001 | 999999999999999.998 | 999999999999999.999 | 0.001             |

The first example has baseline overage 1.994 and adjusted overage 1.235. A pack of 0.002 in the final example overflows the supported quantity range and blocks saving.

## Design

Add a dedicated event_supplier_scenarios table and preview/save RPCs, following event-draft RLS, request-lock, fingerprint and retention conventions. Source item/unit/cutoff/lead come exclusively from the immutable draft. Read current supplier and supplier-item rows explicitly within the same organization. No master-data or import/API contract change is needed. Add new/detail/history routes under replenishment/events/suppliers and entry links from a saved event draft. Reuse existing source-report presentation inside expandable evidence.

Apply migrations only to the local test stack. Run database suites sequentially, then complete formatting, lint, typecheck, unit tests, production build, browser and security review. Open one PR without merging or deploying it.

## Evidence and lifecycle

`event_supplier_preview` reads the permitted saved draft and current supplier/terms in one statement snapshot. It does not re-read the original forecast, event, policy, stock or inbound feeds. Both comparisons retain the complete draft, including confirmations and timing flags. MOQ/pack applicability is explicitly confirmed because those terms have no historical versions; price-valid-from is not used to infer their applicability. Current catalog units never replace supplied units.

Only available comparisons can be saved. A per-organization/request advisory lock serializes saves; live editor authority, source access and preview fingerprint are rechecked after waits. The retry identity includes author, draft, supplier code, confirmation and fingerprint. Identical retries return original evidence after supplier/feed edits. Conflicting reuse fails. Direct session/API/worker writes are denied; authenticated reads use tenant and restrictive location RLS. Parent deletion follows existing cascade retention. Independent scenarios do not select an order or consume supply.

Database resource references follow the current `z.guid()` compatibility rule; retry tokens remain strict UUIDs. The event-draft resource fields and routes are aligned with this rule so nested evidence from imported identifiers remains readable. New audit labels use the shared audit catalog.

## Verification

- Full local pgTAP: 65 files and 3,950 assertions passed, including the new calculation, access, lifecycle and privilege cases.
- Eight independent-session Python database cases passed, including concurrent retries, authority/evidence changes during a lock wait and a real worker-to-supplier chain checked with an independent Decimal oracle. A missing test-fixture import was corrected before the worker case passed.
- All 1,431 web unit tests passed. An existing source-scan test exceeded its five-second timeout during concurrent checks; it passed unchanged in isolation and in the full rerun with two workers. The engine unit suite passed 286 tests.
- Typecheck, ESLint, logical CSS checks, scoped formatting and the production Next.js build passed. Manual review covered tenant/location isolation, live role checks, immutable evidence, stale previews, retry conflicts and exact arithmetic.
- Both production-browser workflows passed: event replenishment regression and event supplier creation, stale-term refresh, immutable history, viewer access and branch isolation. Inspected screenshots at 375, 768, 1024, 1440 and 1920px plus RTL at 375 and 1440px; no page-level horizontal overflow. Keyboard evidence disclosure passed. New copy uses the existing English fallback in Arabic mode.

## Rollout and rollback

Owner-run rollout: review and apply `20261018044405_event_supplier_scenarios.sql` with `pnpm exec supabase db push`, then deploy the web build. No import/API contract, worker or existing business-data change is required. The migration creates only a new table, indexes and functions with a five-second DDL lock timeout. This task applies it locally only.

Rollback restores the previous web build while preserving the additive schema and saved records. Destructive removal would need a separate reviewed migration. No historical backfill or identifier rewrite is performed.
