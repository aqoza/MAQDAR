# Internal dealer-return review (Step 27b)

The existing **Replenishment → Dealer returns** workbench now supports one independent approval or rejection of a request's full declared quantity. History filters distinguish requested, approved, rejected and withdrawn records. Search includes the saved item/location/reference evidence plus the decision rationale and captured reviewer email. Rationale is expandable in the history table; the complete decision appears on the request detail.

## Decision contract

An owner, admin or approver other than the request author may decide an undecided, nonwithdrawn request. Both-location access and current organization membership remain mandatory. Every decision requires a bounded rationale. Approval also requires an explicit eligibility-assessment confirmation; rejection records no such confirmation. This is a human review of declared evidence, including unknown condition. The application does not infer eligibility, available stock, physical condition or a receipt date.

Approval authorizes the entire original declared quantity internally. There are no partial decisions or quantity edits. The original request report is unchanged. The reviewer identity/email, server time, decision, rationale and confirmation are saved on the same protected record. One terminal decision is allowed; another review cannot replace it. Corrections require a new independent request.

Before a new approval, the original item identity must still exist, with the saved code and catalog unit. Both original endpoints must remain active and retain their saved codes and branch/hub/central kinds. A changed or deleted identity, code, unit or endpoint kind requires a new request. Names, item lifecycle status and costs are not eligibility rules; the original declared labels/status remain as saved. Rejection remains available when catalog evidence changes or disappears. Neither path reads stock or financial balances.

## Lifecycle and concurrency

Authors may withdraw only before a decision. Approval, rejection and withdrawal lock the same request, so competing operations cannot create conflicting terminal outcomes. Approval locks endpoint catalog rows in stable identity order before the request to follow endpoint-deletion lock order, and locks the original item before validating its current unit. Authority and request lifecycle are checked again after lock waits.

The request identity is the decision retry identity. A retry by the original reviewer with the same canonical rationale, outcome and confirmation returns the existing record; conflicting content or another reviewer fails. Current reviewer authority and both-location access are required on every retry. Existing decision retries do not revalidate changed catalog evidence, rewrite timestamps or create duplicate audit events. Existing creation retries retain the reviewed request, and withdrawal retries retain an earlier withdrawal. No retry can reopen a terminal request.

The additive migration extends `dealer_return_requests`; existing SELECT-only grants, tenant and two restrictive endpoint RLS policies remain. The new `dealer_return_review` security-definer RPC pins its search path and grants execution only to authenticated users. Direct writes remain denied. The existing audit trigger records the decision update. Copied declarations and reviewer evidence survive item/account deletion; organization or either endpoint deletion retains the existing request cascade rules.

## Interface and rollout

The approved compact green layout and shared illustrated Replenishment header remain. Headings use 16px, record values 14px and metadata 12px; mobile inputs retain the shared 16px scale. The review form requires a decision and rationale, shows approval confirmation only for approval, retains failed input and marks validation beside the field. Saving is disabled while pending. Recorded decisions remove both review and withdrawal controls. Hidden records retain HTTP 404 responses without a new streaming boundary.

Apply `20261024140000_dealer_return_review.sql` after Step 27 through the reviewed migration workflow before deploying the new interface. A web rollback must preserve the database's terminal-decision and withdrawal protections. No hosted migration or deployment is part of local verification.

Approval creates no inbound, reservation, transfer, stock movement, credit or accounting record. Partial quantities, external dealer access, credits and physical receiving remain separate increments.

## Verification

Run `0122_dealer_return_review.test.sql` with the original return, tenant and privilege tests; run `test_dealer_return_review_db.py` and `test_dealer_returns_db.py` for concurrent sessions. Cover independent roles, current-authority retries, immutable rationale/actor/time, catalog identity reuse, changed units/endpoints, both-location history, deletion and operational non-effects. Browser coverage uses `dealer-return-review.spec.ts` plus `dealer-returns.spec.ts` against a production build, retaining form/approved/history screenshots at 375, 768, 1024, 1440 and 1920px in English and Arabic RTL.

Local verification on 2026-10-24 passed:

- Full pgTAP suite: 124 files, 7,502 assertions.
- Original-return and review concurrent-session tests: 21 passed.
- Full web unit suite: 211 files, 2,265 tests; engine unit suite: 498 tests.
- Production build, workspace type checking, lint, formatting and logical-direction checks.
- Original return browser regression and the new review flow, including keyboard approval, validation recovery, changed-catalog approval refusal followed by rejection, terminal controls and both-location HTTP 404/read checks.
- Thirty new form/approved/history screenshots at all five widths in English and Arabic RTL, visually inspected with no page-level overflow. Wide history tables retain local scrolling.
- A reviewer-independence mutation failed its test; the implementation was restored and all 17 focused helper/action/header checks passed.

The broader Python database integration and full browser suites run in CI; local database integration was focused on the 21 return tests. No hosted migration or deployment was performed.
