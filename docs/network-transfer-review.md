# Step 22d: Network transfer-proposal review

Status: implemented and locally verified; full CI and PR review pending. Revision 1. The owner approved the following rules on 2026-10-20.

PR #115 was reviewed and merged as d575c7670d020614d1df9c48f3607468ff92125b. All four CI jobs passed on its reviewed head, fb1ace162c9b6613ff5ce3e3f4def15736a9f673.

## Approved outcome

Submit one saved, complete network freight estimate as one proposal covering the warehouse and every branch. An independent reviewer approves or rejects the whole proposal; the author can withdraw it. Inspect the allocation, fixed dates, branch freight costs, currency totals and decision history together.

The saved Step 22c quantities, dates, commitments and freight evidence stay fixed. At least one branch must have a positive allocation; zero branches remain visible as context. No partial-branch approvals or automatic rerationing.

## Approved rules

1. Use the complete network proposal as the approval unit. Keep compact green shared typography at 375, 768, 1024, 1440 and 1920px, keyboard access and Arabic RTL.
2. Owners/admins/planners submit; a different owner/admin/approver approves or rejects; authors who remain members with all-location access may withdraw pending proposals. Require reasons and access to the warehouse and every branch for every operation and history read. Allow one pending proposal per original network allocation, across alternative date/freight estimates. Later approval selects that allocation's proposal while preserving earlier decisions. Pending/rejected/withdrawn proposals do not replace the prior selection. Separate allocations and individual redistribution proposals remain independent and may overlap.
3. Recheck current freight, original active lanes, matching lead times and active locations at submission and approval against the captured estimate. Changed evidence requires a new estimate. Approval also requires explicitly clear saved p50 and p90 timing flags for every positive branch; true, missing or unknown timing blocks approval. Zero branches require no receipt dates. Flagged proposals remain inspectable/rejectable/withdrawable; saved inbound warnings remain visible without becoming an additional gate.

## Acceptance criteria

- AC-001: An editor submits a complete saved estimate with a positive branch and a reason. The proposal retains all branches and exact evidence without modifying the estimate. Zero-only, missing or stale estimates fail without a new record. Verify local database and authenticated browser tests.
- AC-002: Submission and independent approval enforce current freight/location/lane evidence. Stale rates, lane identity/leads or endpoint status fail; rejection and authorized withdrawal remain available. Verify database boundary and stale-form browser cases.
- AC-003: One positive branch with true, null or missing p50/p90 timing evidence prevents approval of the whole proposal. Clear positive branches and zero branches with no receipt dates can proceed. Verify database tests without inventing new dates or refreshing commitments.
- AC-004: Tenant, active-organization and all-location access protect rows, counts, details, actions and retries. Deny direct writes and API/worker capabilities. Verify pgTAP, authenticated HTTP 404 behavior and independent-session authority changes during lock waits.
- AC-005: Concurrent submissions and decisions leave at most one pending proposal per original allocation and one terminal decision per proposal. Canonical retries bind actor, source/proposal, action and normalized reason; identical retries preserve the result and conflicting reuse fails. Verify independent database sessions and audit counts.
- AC-006: Later approval changes only that allocation's selected proposal. Earlier decisions and captured evidence remain inspectable; separate allocations and existing redistribution selections remain independent. Verify database and browser history.
- AC-007: Search/filter review history, inspect the full evidence chain and use submit/approve/reject/withdraw controls at all five widths and Arabic RTL. Verify keyboard use, contained table scrolling, shared typography and screenshots.
- AC-008: Approval changes no stock, inbound, reservation, allocation quantity, calendar date, freight amount or operational order. Keep source-parent deletion/audit behavior consistent with existing planning review records. Verify database lifecycle assertions.

## Implementation and verification

The additive migration supplies the review table, guarded actions, invoker history and set-based required-location RLS. The interface reuses existing role/reason/action conventions and the network freight report presentation, with English/Arabic review strings and generated database types.

Local verification passed 37 network review database cases and 517 targeted pgTAP assertions, including tenant isolation, worker denial, concurrent decisions, authority changes while waiting on locks and parent deletion. All 1,805 web unit tests passed with two workers, plus six worker-controller tests. The initial unrestricted unit run hit the existing five-second timeout in two filesystem-scanning contract tests; the complete bounded rerun passed.

Formatting, lint, TypeScript, logical CSS and the production build passed. The existing network freight browser journey and the new network review journey passed. The latter covers stale-price approval rejection, independent decisions, withdrawal, selected/history behavior, restricted-location HTTP 404s, keyboard table scrolling and containment at all five widths plus Arabic RTL. English screenshots at all five widths and Arabic mobile/desktop screenshots were inspected. Full clean CI remains the final gate before marking the PR ready.

Apply `20261020183000_network_review.sql` before deploying the web release. Hosted migrations and deployment remain separate and owner-run. Roll back the web release while retaining additive review records; no destructive schema rollback is needed.

## Scope boundary

Approval records a planning selection; it does not refresh live commitments or establish live stock availability. Handoff exports, transmission, shipment consolidation, reservations, transfer orders, policy optimization and execution remain subsequent increments.
