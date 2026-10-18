# Event purchase handoffs — Step 19h

Status: merged in PR #79 on 2026-10-18.

## Saved selection

Open a selected approved event purchase proposal and choose **Save handoff**. The saved package contains the full adjusted quantity and subtotal. Baseline quantities, baseline costs and increases remain comparison evidence, not additional order lines. The event-handoff history searches item/event names and filters supplier, receiving location and current/historical selection.

Owners, admins and planners create. Members with current receiving-location access inspect and download, including viewers and assigned branch users. Every operation intersects membership with tenant claims and location scope. Separate event drafts and ordinary purchase selections remain independent and may overlap.

## Initial creation and retries

A new handoff requires the original draft's latest approved selection, an available positive adjusted quantity, matching complete current price evidence with active supplier/receiver, an explicitly false saved policy-recalculation flag and a known empty event-before-receipt array. Missing or malformed timing evidence fails closed. Recompute pricing from the saved delivery; changed evidence requires a new cost comparison and approval. Keep saved quantities, dates, stock/inbound, event assumptions and warnings fixed.

The proposal is the retry identity. Creation shares the event-review organization lock so a later approval cannot race the selection check. Recheck live editor authority and source access after waiting. Concurrent retries create one record and one audit event. Existing handoffs return unchanged after subsequent price/selection changes; replay does not claim fresh validation. A later selected approval may have its own handoff, while prior files remain historical.

Saving or downloading is planning evidence only: no order, supplier contact, reservation, refreshed stock commitment, inbound update or policy recalculation. The identity does not prevent duplicate external orders across drafts or revoke files already downloaded. Batching, API-key access, transmission and acknowledgements are separate increments.

## Versioned file contract

`event-purchase-handoff-v1` identifies the format, `purpose` is `planning_only`, and `selected_quantity_basis` is `full_event_adjusted`. The immutable payload holds handoff metadata, proposal revision and approval reasons/actors, event and event-policy IDs, source draft, supplier/delivery/cost IDs, underlying policy/forecast references, fingerprints and the complete saved cost comparison.

JSON retains original text, decimal strings and date-only business dates, with deterministic alphabetical object-key ordering and a trailing newline. Validation preserves the complete nested saved report, including baseline model scores, forecast history and uncertainty fields that display components do not render. CSV is one header and one record, with UTF-8 BOM, CRLF, quoted fields and the existing spreadsheet-safe writer. The selected columns are explicitly `selected_adjusted_quantity` and `selected_adjusted_subtotal`; baseline and increases are labeled comparison columns. No quantities or money pass through JavaScript numeric conversion. JSON retains full daily event/source evidence; CSV supplies exact selected values, comparison totals and evidence references. Spreadsheet applications can reformat long numbers, leading-zero codes or dates; JSON is the lossless format.

Freeze serializers with versioned snapshots. Future format changes require a new version while preserving old downloads. Current selection and price checks are displayed outside the saved files. A failed current-price check does not hide historical downloads or imply a match.

## Persistence and security

`event_purchase_handoffs` uses tenant-composite proposal/location foreign keys, unique organization/proposal identity, explicit grants, tenant/branch RLS and the business audit trigger. Only the guarded creation RPC writes; API roles and the worker cannot directly mutate history. The invoker list view calculates current selection separately. Source/org deletion follows the existing cascade retention semantics of the planning chain.

The authenticated download route uses the user's session, active organization and RLS. Missing/inaccessible records return 404 and signed-out requests return 401. Attachments use private/no-store and nosniff headers. No service-role client, Storage bucket, background task or integration-key scope is added.

## Verification and rollout

Verify initial evidence/selection gates, stable retries, exact copying, independent location/tenant access, direct-write denial, concurrency and changes during lock waits. Test deterministic CSV/JSON, spreadsheet-formula handling, safe route/action failures and browser creation/download/history/filter/pagination. Check all five widths (375, 768, 1024, 1440 and 1920px), RTL, keyboard help/focus and locally scrolling tables. Preserve event-review and ordinary-handoff flows.

The additive migration is `20261018160537_event_purchase_handoffs.sql`. Apply it before deploying the reviewed web build. No backfill or worker change is needed. Development uses local Supabase only. Rollback restores the earlier web build and retains the additive objects and saved evidence; destructive removal requires a separately reviewed migration.

## Verification results

- All 4,245 pgTAP assertions across 69 files passed. The existing event-review fixture now scopes its admin-role selection assertions to its own organization, so it also passes with local browser data present.
- All 12 event-handoff database integration cases passed, including concurrent creation, one audit entry, changed selection/price/unit/identity/active supplier or receiver/authority while waiting, and historical retries under live authority.
- All 1,495 web unit tests across 129 files passed, including deterministic exports, full nested source preservation, formula-safe CSV and safe route/action access failures. Full lint, typecheck, logical CSS, scoped formatting and the final production build passed. Two source-scanning tests timed out during the initial concurrent build; the unchanged suite passed after the build completed.
- All 294 non-database engine tests passed; unrelated untracked Acme tests were excluded. Database suites ran sequentially against loopback Supabase.
- Production Playwright passed the event handoff flow and event review regression with retries disabled. The ordinary purchase-handoff regression also passed. An initial browser assertion caught nested forecast fields being stripped by a display schema; the exporter now validates without replacing the saved report, and both unit/browser regressions verify complete original evidence. The initial review regression timed out while a decision remained pending in the UI; the unchanged test passed on the final run.
- Verified creation/download bytes, fixed full adjusted quantities, historical downloads after later selection/price changes, stale creation refusal, viewer/branch/anonymous access, search/filter/pagination and unchanged stock/inbound. Inspected list and detail screenshots at 375/768/1024/1440/1920px and list RTL at 375/1440px. Local table scrolling, keyboard help, Escape and focus return passed. Arabic uses the existing English fallback for new copy.
- Manual implementation/security review found no remaining blocker. No automated security scan, hosted migration or deployment was performed.
