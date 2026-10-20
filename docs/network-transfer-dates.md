# Network transfer dates — Step 22b

Status: implemented; review pending. Revision 1.

The owner approved saved date scenarios from one saved network allocation on 2026-10-20. Preserve every allocated quantity, branch gap and original commitment. Choose one requested dispatch date at or after the allocation cutoff. Freight, approvals, reservations, policy recalculation and execution remain outside this increment.

## Dates and evidence

- Resolve one common dispatch on the next known warehouse working day. Add each positive branch's saved lane p50/p90 lead times in calendar days, then independently resolve the next known receiving working day.
- Reuse the existing private calendar helpers, precedence, verified coverage and 90-evaluated-date bound. Unknown dates stop a search. Keep partial results inspectable, but save a complete schedule only when every positive branch resolves both receipts.
- Zero allocations have no dispatch/receipt obligation or calendar search. Still require active participating locations and the same active directed lanes with unchanged saved leads. An all-zero allocation needs no calendar confirmation and saves as no transfer needed.
- Require confirmation that current calendar settings apply to the requested dates. Capture calendar, holiday, override, lane and location evidence; changed previews require refresh.
- Compare each positive branch's receipts with its saved cutoff plus the original policy's fixed lead time. The copied allocation does not include this parameter, so first preview requires the original branch policy, matching item/unit/cutoff, and captures its lead/review evidence. Missing policy evidence makes that branch unavailable. Saved date history does not reread policies.
- Keep existing overdue/late inbound warnings. Timing-review flags describe dates beyond the policy reference, not calculated shortages, calibrated probabilities or guaranteed arrival. Dates never refresh stock/inbound or recalculate allocation.

## Access and lifecycle

Members need access to the warehouse and every saved branch, including zero allocations. Preview explicitly checks this before private calendar access. Owners/admins/planners save through a guarded RPC; direct/API-key/worker writes are denied. The new table uses the same immutable required-location array and restrictive set-based RLS as the allocation.

Serialize saves by organization, recheck authority after waiting, lock the parent against deletion, and recompute the fingerprint before first save. Request UUIDs bind author, parent, requested date, confirmation and fingerprint. Identical retries return the original record; conflicting reuse fails. Saved quantities and calendars remain immutable after later edits.

The date scenario belongs to its allocation: parent, organization or participating-location deletion cascades. Source policy/draft deletion leaves existing allocation and date reports intact. No new source draft, transfer order, inventory movement or inbound record is created.

## Acceptance

| ID     | Scenario and action                                                           | Expected result                                                              | Verification                             |
| ------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------- |
| AC-001 | Preview a positive saved allocation with different branch calendars           | One dispatch, independent typical/slow receipts, unchanged exact quantities  | Database examples and browser workflow   |
| AC-002 | Use unknown/closed dates, zero quantities, zero leads or a date before cutoff | Bounded diagnostics; no partial schedule saved; zeros have no dates          | pgTAP/database boundary cases            |
| AC-003 | Change calendars, lane leads, active flags or policy evidence before save     | Refresh or unavailable; no stale first save                                  | Database and browser stale-preview cases |
| AC-004 | Lose one location or editor role, including during lock wait                  | No hidden preview/history/count; no unauthorized save/retry                  | Independent-session tests and HTTP 404   |
| AC-005 | Retry concurrently, reorder nothing, then change/delete original evidence     | One save/audit; conflict rejection; immutable copied history; parent cascade | Database concurrency/lifecycle cases     |
| AC-006 | Inspect/create/history at 375/768/1024/1440/1920 and Arabic RTL               | Shared green typography, keyboard disclosures/tables, contained overflow     | Playwright and screenshot inspection     |

All tests use synthetic local or isolated CI data. Rollout is an additive migration and web release; no worker or production configuration changes. Roll back the web release while retaining schema and saved evidence.

## Verification

Local checks passed: 1,774 web unit tests, lint, typecheck, logical CSS, production build, 22 independent-session database cases and 484 focused pgTAP assertions. The production Playwright workflow covers complete and unavailable previews, stale-save recovery, copied history after source edits, all-location HTTP 404s, keyboard tables/disclosures, all five widths and Arabic RTL. Desktop and mobile RTL screenshots were inspected.

The migration has only been applied to the local test stack. Full CI additionally checks the complete migration chain, database types, browser regression suite and Cloudflare packaging before review.
