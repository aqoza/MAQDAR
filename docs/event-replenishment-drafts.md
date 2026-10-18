# Event-adjusted replenishment drafts (Step 19c)

Approved 2026-10-18 after PR #63 merged as `e012d0c`. Select one saved event-policy scenario, inspect baseline and event-adjusted gaps against the same stock/inbound evidence, then save an independent immutable draft. Supplier rounding, approvals and exports for these drafts remain separate increments.

## Acceptance and calculation

| Criterion | Expected behavior                                                                                                                                                                                                                         | Verification                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| AC-001    | Members inspect only their organization and permitted locations; owners/admins/planners save. Direct writes are denied.                                                                                                                   | pgTAP, action and browser tests                       |
| AC-002    | The saved event-policy report still matches its source evidence. Use its calculated baseline and adjusted maxima, cutoff, unit and policy parameters; never carry an override or combine scenarios.                                       | pgTAP and real-worker integration                     |
| AC-003    | Both gaps equal `max(maximum − inventory position, 0)` using exact decimals and the same position. Position is on-hand minus allocations plus all remaining positive open inbound minus explicit additional unallocated backorders.       | Independent numerical oracles                         |
| AC-004    | Stock is dated exactly at the cutoff; stock/inbound units are known and matching. Confirm complete synchronized inbound and that event additions are absent from allocations and entered backorders. Missing evidence never becomes zero. | pgTAP, browser                                        |
| AC-005    | Retain overdue/after-protection warnings, including when the gap is zero. Preserve original evidence, reject changed previews and conflicting retries, and recheck authority/evidence after lock waits.                                   | pgTAP, independent-session races                      |
| AC-006    | Preview, save and browse scoped history with keyboard access, shared compact green typography and no page overflow at 375, 768, 1024, 1440 and 1920px, including RTL.                                                                     | Production-build Playwright and screenshot inspection |

The existing replenishment preview supplies one statement snapshot of stock and inbound. Every positive remaining open order counts, regardless of supplier/due date; receipts are never deducted again. The existing 1,000-line completeness bound applies. Negative inventory position is retained. A resulting gap above numeric(18,3) is unavailable. Available zero-gap drafts may be saved; unavailable previews cannot be saved.

Event additions remain fixed planner assumptions. Saved safety stock and service assumptions are unchanged. The baseline and adjusted gaps are calculated independently from the same position, rather than adding event demand to a previously clamped gap. The increase can therefore be smaller than the event addition. The explicit event confirmation prevents knowingly counting the same incremental demand in the target and commitments. The aggregate feeds cannot establish that correspondence themselves.

## Evidence, access and compatibility

`event_replenishment_preview` verifies the selected saved scenario against `event_policy_preview` before obtaining the calculated-policy replenishment evidence. Changed sources require a new scenario. Both calls enforce tenant and location access even inside the definer save function. No current catalog unit or approved override replaces saved evidence.

The additive `event_replenishment_drafts` table grants authenticated SELECT only, with tenant and restrictive location RLS. New records retain the full scenario and baseline stock/order report, confirmations, maxima, both gaps and SHA-256 fingerprint. A per-organization/request advisory lock serializes saves. Identical author/input retries return the original record even after feeds change; conflicting reuse fails. New saves recheck live authority and evidence after waiting. Parent deletion cascades under existing planning retention rules; normal users cannot edit/delete records.

Ordinary replenishment drafts, policies, overrides and downstream purchasing records are unchanged. No orders, reservations, allocations or inventory updates result. Separate drafts can propose the same supply. These records have no supplier-rounding or export entry point in this increment.

## Verification

Local verification on 2026-10-18:

- All 3,877 pgTAP assertions across 64 files passed, including completeness limits, exact arithmetic, permissions, stale evidence and immutable retries.
- Eight focused Python database cases passed across the main run and the added inbound-race run: concurrent retries, lock-wait authority/evidence changes and the real forecast → policy → event → replenishment path.
- All 1,398 web tests and 294 engine non-database/non-statistical tests passed. New validation/action coverage includes 20 web cases.
- Lint, typecheck, logical CSS, scoped formatting and the production build passed.
- Production-build Playwright passed without retries: preview/confirmation checks, stale-save rejection, refresh/save/history, viewer and branch access, keyboard disclosure, five viewport widths and RTL. Screenshots were inspected at 375, 768, 1024, 1440 and 1920px, with RTL at 375 and 1440px.

The migration was applied only to the local Supabase stack. Hosted migration and deployment remain pending review.

## Rollout and rollback

Review and apply `20261018035710_event_replenishment_drafts.sql` using `pnpm exec supabase db push`, then deploy the web build. This task uses only the local test stack. No worker change is required. Rollback restores the previous web build while retaining the additive schema and saved evidence; destructive removal requires a separate reviewed migration. No existing data is backfilled or rewritten.
