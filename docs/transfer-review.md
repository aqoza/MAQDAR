# Transfer-proposal review (Step 16d)

**Status:** Implemented; review pending. The owner approved the rules below on 2026-10-17 after PR #41 was reviewed and merged as `3b4cfde`.

Submit a positive saved freight estimate for independent review. The compact green workbench searches items and locations, filters source/destination and status, and retains decisions and the full quantity, date and freight evidence at 375, 768, 1024, 1440 and 1920px.

## Approved rules

Owners, admins and planners submit. A different owner, admin or approver approves or rejects. Authors may withdraw a pending proposal while still members with access to both locations, including after a role change. Every action requires a trimmed reason of 1–2,000 characters.

One proposal may be pending per original **redistribution draft**, across alternative date and freight estimates. Later approval selects that draft's newest approved revision; older decisions remain. New pending, rejected and withdrawn revisions leave the prior approval selected. Different redistribution drafts can still propose the same stock, including drafts sharing a destination replenishment gap.

Submission and approval recompute current freight evidence against the saved estimate. Active locations, the exact active lane with its saved leads, rate, unit, effective date, currency precision and captured timestamps must still match. Changes require a new estimate. Approval also requires both saved p50 and p90 timing-review flags to be explicitly false; true, null or missing blocks approval. Flagged proposals remain inspectable and can be rejected or withdrawn. There is no timing bypass.

Approval records a planning selection. Saved quantity, stock commitments, calendars, dates and costs stay fixed as-of evidence. It does not confirm live stock, reserve quantities, create inbound or transfer orders, consolidate shipments, transmit to another system or execute a transfer. Existing destination supply warnings remain visible.

## Persistence and access

The new table has tenant-composite references and two restrictive endpoint policies. Invoker history counts and detail reads require both locations. Guarded RPCs derive lineage from saved rows, check authority again after an organization advisory lock, and enforce one pending proposal and one terminal decision. API roles and workers gain no writes or new scopes.

Request UUIDs bind actor, source or proposal, action and normalized reason. Identical retries return the original result after later evidence changes, subject to current membership, role and both-location access. Conflicts fail without another audit event. Source estimates are immutable.

## Acceptance and verification

- AC-001: An editor with both-location access submits a positive available estimate with a reason; missing/zero/unavailable or changed inputs fail without a proposal. Verify with local pgTAP and the authenticated browser journey.
- AC-002: Only an independent authorized reviewer approves/rejects; only the author withdraws. Competing requests and retries retain one pending proposal, one terminal decision and one audit per transition. Verify pgTAP and independent Python database sessions.
- AC-003: Current freight evidence and both explicit false timing flags gate approval. Rejection/withdrawal remain possible after changes. Verify stale rate, lead, active-location and missing/flagged timing cases.
- AC-004: Tenant, active-organization and both-endpoint scope protect preview, detail, history/counts, submission, decisions and retries. Verify denied direct writes and lost access while waiting.
- AC-005: History retains earlier approvals while marking the latest approval selected, without modifying stock, inbound or saved reports. Verify SQL assertions and the browser journey at all five widths, including keyboard controls and contained tables.

Local verification passed 3,042 pgTAP assertions, 142 Python database tests, 294 Python unit tests and 1,237 web unit tests. The independent-session tests cover competing submissions/decisions, stable retries and live role, membership, rate, lane, location and endpoint-access changes during lock waits. Lint, TypeScript, logical CSS, formatting, retention tests and the production build passed. The web unit suite passed with bounded workers after a filesystem-scan test timed out under concurrent build load.

The authenticated transfer-review journey passed stale-form approval rejection, independent rejection/approval, newer-selection history, flagged-timing withdrawal, viewer/branch access, keyboard controls and all five widths. Screenshots were inspected; that inspection led to keeping short labels and monetary amounts together in the history table. The full browser regression passed 60 tests; three opt-in scale tests were skipped. Database suites run sequentially because they share tables and statistics.

## Rollout and rollback

After review, apply `20261017114415_transfer_review.sql` with `pnpm exec supabase db push` before deploying the web build. This adds an empty table, indexes, guarded RPCs and an invoker view; it rewrites no existing data and changes no worker or integration contract. Local tests target only the local Supabase stack. Hosted migration/deployment is not part of this increment.

Rollback restores the previous web build while retaining additive schema and immutable review evidence.
