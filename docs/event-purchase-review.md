# Event purchase-proposal review — Step 19g

Status: approved 2026-10-18; merged in PR #77 after all CI jobs passed.

## Approved outcome

Submit an available saved event purchase-cost comparison with a positive adjusted quantity. The proposed selection is the full event-adjusted quantity and subtotal; baseline quantities, baseline subtotal and differences remain immutable comparison evidence. The workbench searches item/event names and filters supplier, receiving location, original event draft and status, with paginated decision history.

Approval records a planning selection only. No order, reservation, inbound update, transmission, export, automatic approval or policy recalculation occurs. Separate event drafts and ordinary purchasing selections remain independent and can overlap; this is not a duplicate-order guard.

## Lifecycle and access

Owners, admins and planners submit. A different owner, admin or approver approves or rejects. Authors may withdraw pending proposals while still members with receiving-location access, including after demotion to viewer. Every operation and history read enforces current tenant/claim/location scope. Reasons are trimmed and limited to 1–2,000 characters.

Allow one pending proposal per original event replenishment draft across alternative supplier, delivery and price comparisons. Derive lineage from saved database rows. The latest approved revision is selected for that exact draft; previous decisions remain. New pending, rejected or withdrawn revisions leave an existing selection unchanged.

Identical request retries return the original transition under current authority and scope; conflicting reuse fails. Serialize transitions with an organization advisory lock, recheck permissions/evidence after waiting and audit each successful transition once. Source identities and terminal decisions are immutable through application roles.

## Evidence and timing

At submission and approval, recompute event purchase-cost preview with confirmed applicability and match its complete fingerprint. Recheck the original supplier-item identity, unit, price, currency precision, effective date and active supplier/receiver evidence. Changed evidence requires a fresh cost comparison even if its rounded subtotal happens to match. A zero quote is eligible with complete evidence and positive adjusted quantity; no-order and unavailable outcomes cannot submit.

Approval requires saved `policy_recalculation_required` to be explicitly false and `event_before_receipt` to be a known empty array. Missing/null evidence fails closed. Timing-flagged proposals can still be submitted, inspected, rejected or withdrawn. There is no warning bypass. Positive event additions before receipt are timing concerns, not calculated shortages. Existing overdue/late inbound warnings remain visible without a new approval gate.

Rejection and withdrawal remain available after price/entity changes. Identical retries preserve the original decision after later changes. No live stock, commitment, MOQ, lead-time or calendar recalculation occurs; the saved event assumptions and baseline evidence remain fixed.

## Implementation

The additive `event_purchase_proposals` table has tenant-composite estimate, event-draft and location keys, unique pending/retry constraints, authenticated read-only grants, tenant/location RLS and business audit. Guarded submit/decide RPCs enforce transitions; `event_purchase_review_list` uses invoker rights and projects exact decimal strings and separate live selection status.

Saved cost comparisons link to submission and draft history. Replenishment includes an Event review workspace. Detail pages retain the baseline/adjusted cost report and saved chain. Methodology uses the current shared help side panel; actionable timing/evidence gates stay visible. Shared compact green typography covers 375, 768, 1024, 1440 and 1920px and RTL.

## Acceptance and verification

1. A positive adjusted quantity can be independently approved as the full selection, with baseline/difference evidence and source quantities, dates and costs unchanged.
2. Enforce pending uniqueness per original event draft, latest approved revision selection, terminal immutability, stable/conflicting retries and independent drafts.
3. Prove live roles, author withdrawal after demotion, tenant/claim/location isolation, denied direct writes and after-lock authority/scope changes.
4. Exercise current price, unit, identity, date, currency and active-entity changes at submit/approve; zero price; no-order sources; true/null/missing policy flags and nonempty/null/missing event timing evidence. Rejection and withdrawal remain available after staleness.
5. Verify a real worker source chain, concurrent submissions/decisions, one audit per transition and unchanged stock/inbound/ordinary purchase selections.
6. Verify source-to-review navigation, role-appropriate forms, search/filter/pagination, all five widths, RTL, keyboard help and locally scrolling tables. Preserve ordinary purchase review and event cost workflows.

## Verification results

- All 4,187 pgTAP assertions across 68 files passed, including event review, tenant/claim/location invariants and explicit privilege snapshots.
- All 25 event-review database integration cases passed: competing submissions/decisions, identical retries, changed price/unit/date/currency/identity/active entities and authority while waiting, withdrawal scope changes, and a real worker-to-review source chain.
- All 1,475 web unit tests across 126 files passed. Full ESLint, final typecheck, logical CSS, scoped Prettier and the production build passed. All 294 non-database engine tests passed; unrelated untracked Acme tests were excluded.
- Production Playwright passed the event-cost and ordinary purchase-review regressions. The new event-review workflow passed with retries disabled after correcting a test selector to the shared help button's actual label. No application change was needed for that correction.
- Browser checks cover independent approval, one pending proposal across alternate estimates, both timing gates, stale-price refusal, withdrawal, a later selected approval with historical evidence retained, viewer/branch access, search/filter/pagination and unchanged stock/inbound.
- Inspected detail and list screenshots at 375/768/1024/1440/1920px, plus list RTL at 375/1440px. Shared typography and locally scrolling tables fit without page overflow. Keyboard help opening, Escape and focus return passed. New Arabic copy uses the existing English fallback.
- Manual implementation/security review found no blocking issue in source lineage, tenant/location grants, live post-lock authority, retry identity, terminal decisions, complete price fingerprints, fail-closed timing or exact decimal projections. No automated security scan was claimed.
- Fixtures targeted local loopback Supabase; database suites ran sequentially. No hosted migration or deployment was performed. PR CI will cover the broader Linux workflow matrix and Cloudflare packaging.

## Rollout and rollback

Apply additive migration `20261018124406_event_purchase_review.sql` before the reviewed web deployment. No data backfill, worker or integration API-key change is needed. Development applies it only to local Supabase. Roll back the web build while retaining additive schema and decision history. Destructive removal requires a separate reviewed migration.
