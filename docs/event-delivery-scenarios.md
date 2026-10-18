# Step 19e: event delivery-date scenarios

Approved 2026-10-18 after PR #66 merged as `6005140` with all three CI jobs passing.

## Approved result

From one immutable event supplier scenario, save an indicative order/receipt-date comparison while retaining both rounded quantities, units, supplier terms and the complete event/draft evidence. Use current explicitly confirmed supplier and receiving calendars. Reuse private calendar helpers rather than changing ordinary purchasing behavior.

## Acceptance

- AC-001: Members see only their tenant and allowed receiving locations; owner/admin/planner saves recheck live authority after the request lock. Reject direct writes and cross-scope reads. Verify pgTAP, concurrent sessions and browser roles.
- AC-002: Requested date is a finite date on or after the saved cutoff, bounded to 1900–2100. Find the next known supplier working day, add the fixed saved lead in calendar days, then find the next known receiver working day. Preserve the existing 90-date search bound and stop at unknown coverage. Verify independent date fixtures, closures, overrides, inactive calendars and unknown dates.
- AC-003: Each positive quantity shares the resulting dates; a zero quantity needs no order. If both are zero, return a saveable no-order result with no fabricated dates and no calendar-applicability requirement. Positive scenarios require active supplier/receiver and explicit confirmation. Unavailable scheduling results cannot save.
- AC-004: Retain the source's original supplier terms, quantities, stock/inbound, event assumptions, maxima and warnings. Read current supplier/receiver identities and calendars only. A new save recomputes its preview and rejects changed evidence; retries bind author, source, date, confirmation and fingerprint and return the original record. Verify source/feed edits, calendar changes, concurrent retries and immutable history.
- AC-005: Flag receipt beyond cutoff plus saved lead. List positive event additions dated strictly before receipt as timing concerns; do not calculate shortages or promise same-day availability. A resolved date does not establish stock coverage, supplier capacity or event fulfillment. Preserve independent scenarios; no overrides, policy recalculation, reservations, orders, pricing or export.
- AC-006: Add creation/detail/paginated history and source navigation using shared compact green typography. Collapse detailed calendar/day/source evidence; retain actionable warnings. Verify 375/768/1024/1440/1920px, RTL, keyboard interaction, scoped reads and stale previews with production Playwright and screenshot inspection.

## Implementation map

- Add `event_delivery_scenarios` and guarded preview/save RPCs in one additive migration, explicit grants, tenant/location RLS and audit. No API/worker privileges or master-data changes.
- Reuse `app.delivery_calendar_context`, `app.delivery_next_working_day`, `calendarEvidenceSchema` and `calendarSearchSchema`. Capture bounded reference windows exactly as ordinary delivery scenarios do. Do not silently extend holiday coverage.
- New `/replenishment/events/deliveries` creation/detail/history routes, event delivery schemas, preview/save form and compact report. Link from the saved event supplier detail. Reuse nested event supplier evidence without linking a report to ordinary supplier routes.
- Regenerate DB types; update privilege/invariant tests and explicit audit labels.
- Database tests cover dates, zero/positive comparisons, before/on/after-receipt additions, original warnings, unavailable states, current claims/roles, source isolation, stale evidence, retries, retention and no purchasing side effects. Python tests cover lock waits and a complete saved source chain. Browser tests cover creation/history, refresh and scope.
- Run shared database suites sequentially; web lint/types/unit/logical checks and production build; browser workflow at five widths/RTL; manual security and screenshot review.
- Record verification results below, then open one PR. No hosted migration, deployment or new-PR merge.

## Evidence and limits

The source is one immutable `event_supplier_scenarios` report. Its quantities, supplier terms, fixed lead, event assumptions and original stock/inbound evidence are copied without looking up newer supplier-item terms or commitments. Current supplier/receiving identities and calendars are captured in the new report. Independent comparisons neither stack events nor select a purchase.

The private calendar helpers follow the ordinary delivery rules: explicit overrides, known holidays/weekends and verified coverage determine working days. Search stops at an unknown date rather than skipping it. Calendar applicability confirmation does not establish absent coverage; no coverage is extended in this increment. Each stage inspects at most 90 dates. All dates are business dates, with no intraday cutoffs, capacity or supplier promises.

Positive quantities share the schedule; a zero comparison displays “No order needed.” When both are zero, no calendar searches or receipt dates are produced. Unavailable schedules can be inspected but cannot be saved. A receipt after the original cutoff plus saved lead flags required policy recalculation without performing it. Positive event additions strictly before receipt are listed individually; the list is neither a shortage calculation nor a finding that same-day or later demand is covered. Without a resolved receipt, event timing remains unassessed.

New saves recheck live editor authority after the per-organization/request lock and recompute the preview fingerprint. Changed calendar or source evidence requires refresh. Retry identity binds author, source scenario, requested date, confirmation and fingerprint. Identical retries retain the original record even after later edits. Direct writes are denied; current member/active-claim and receiving-location rules apply to previews and history. Parent deletion follows the existing cascade retention rule.

## Rollout and rollback

After review, apply additive migration `20261018063627_event_delivery_scenarios.sql` before deploying the web build. The new table starts empty; indexes, explicit privileges, RLS and RPCs are added under a five-second DDL lock timeout. There is no data backfill, import/API contract change or worker upgrade. This task applies it only to the local stack.

Roll back by restoring the previous web build and retaining the additive schema and saved evidence. Destructive removal requires a separate reviewed migration.

## Verification

- Full local pgTAP: 66 files and 4,029 assertions passed. The first run exposed an existing supplier-test cascade assertion that counted other organizations' browser fixtures; both cascade checks now scope to their own fixture organization, and the full rerun passed. The 90-closed-day fixture uses an explicit closure rather than an invalid seven-day weekend.
- Web: all 1,449 unit tests, typecheck, ESLint, logical CSS and scoped Prettier checks passed. The production build passed again after making the event-date warning details expandable.
- Engine: all 294 non-database tests, including statistical checks, passed. Unrelated untracked Acme tests were excluded.
- All nine independent-session database cases passed, including simultaneous retries, post-wait role/membership/calendar/supplier/receiver/source changes and the real worker → policy → event → replenishment → supplier → delivery chain.
- Production Playwright: both the event delivery workflow and existing event supplier regression passed with retries disabled. Checks cover stale-calendar refresh, unchanged saved quantities after master/feed edits, unknown coverage, immutable history, member/editor/branch access, keyboard disclosures and page overflow. All seven screenshots were visually inspected: 375/768/1024/1440/1920px plus RTL at 375/1440px. Wide tables scroll inside their containers; detailed event dates and calendar/source evidence stay collapsed. Arabic uses the existing English fallback for the new messages.
- Manual review covered tenant/location predicates, live authority after lock waits, exact saved quantities, calendar applicability, immutable source evidence, changed previews and retry conflicts. No dependency, API or worker permission change is introduced.
- Local validation does not replace the full pull-request CI matrix, including unrelated browser/database workflows and Cloudflare packaging. No hosted migration or deployment was performed.
