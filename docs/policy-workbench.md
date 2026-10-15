# Policy review workbench (Step 12a)

Owner-approved on 2026-10-15 after review and merge of PR #17 (`2d282dc`): a searchable policy workbench, reasoned threshold proposals and independent review. Calculated recommendations remain immutable. KPI expansion follows as Step 12b.

## Acceptance

| Criterion | Observable outcome                                                                                                                                                                               | Verification                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| AC-001    | Members find saved policies with item-code search, location/calculation/review filters, pagination and links to calculation and forecast evidence.                                               | Production-build browser tests, parameter tests                   |
| AC-002    | Planners, owners and admins submit both nonnegative thresholds and a reason against an available saved policy. Reorder reference cannot exceed periodic maximum; original evidence is unchanged. | RPC, action, exact-decimal and browser tests                      |
| AC-003    | A different approver, owner or admin approves/rejects with a reason. A terminal decision cannot be overwritten, including by competing reviewers.                                                | Role matrix, independent database sessions                        |
| AC-004    | Authors can withdraw pending proposals. Identical requests replay without duplicate events; conflicting reuse or a second pending proposal is rejected.                                          | pgTAP, concurrency and integration tests                          |
| AC-005    | Proposal and decision history retains values, reasons, identities, timestamps and outcomes. Approved values stay attached to that source policy and its units.                                   | Invoker views, browser tests, audit assertions                    |
| AC-006    | Tenant/branch RLS and live role checks protect records. Stale forms, revoked users and direct API writes cannot mutate them.                                                                     | Tenant invariants, privilege snapshots, action and database tests |
| AC-007    | Reviews produce no planning runs, purchasing or execution effects. Existing forecast/policy flows remain usable.                                                                                 | Database assertion, full regression suites                        |

## Review rules

The workbench is under **Forecasts → Policy review workbench**. Lists default to 25 rows, newest completed policy first with UUID tie-breaking. Search uses the established normalized item-code tokens; location is an exact code. Each policy detail shows the original calculation, latest approved override, and paginated proposal history.

Only available calculations accept proposals. Both proposed thresholds and a reason are required. Quantities use `numeric(18,3)` with up to 15 integer and three fractional digits; they travel as strings and are compared exactly, including values beyond JavaScript's number precision. Arabic digits are normalized. Reasons are trimmed and limited to 2,000 characters.

There is at most one pending proposal per saved policy. A proposal's values and reason cannot be edited; withdraw it and submit another. Each receives at most one terminal decision: approved, rejected or withdrawn. Approvers/owners/admins cannot approve or reject their own proposals; the author can withdraw while still a member with access to that location, even after a change to a read-only role. Decisions require a reason and live authorization.

Submission and decision request UUIDs make retries idempotent. Reusing a request for different content conflicts. Organization-scoped transaction locks serialize writes; a stale competing reviewer receives a conflict instead of overwriting a decision. Changes also append to the existing administrator-visible audit log. Proposal history is readable under the source policy's tenant and branch scope, including by viewers. User UUIDs retain actor identity; the UI identifies the current user as “you” and other actors by member ID without exposing member emails.

The latest proposal status and latest approved override are distinct: a later rejection/withdrawal does not erase the last approved values. A later approval becomes the latest approved override for that exact saved policy. History remains visible. There is no automatic carry-forward to a new run, policy activation or order generation.

## Numerical interpretation

Manual thresholds use the saved policy's units and planning date. Prepared groups keep their saved conversions; older individual forecasts keep the explicit missing-unit-label notice. Overrides do not recalculate safety stock, forecast bands or service probability, and can be below the original point-demand total. Reviewers see original and proposed values plus a link to the original evidence. Approval records a human decision, not a modeled service guarantee.

## Persistence and rollout

`policy_overrides` is RPC-only for writes and has tenant/branch RLS. `policy_workbench` and `policy_override_history` are security-invoker views; decimal projections are strings. Composite tenant keys tie each proposal to its source policy and location. No new worker capability is granted.

Owner-run rollout after review: apply `20261015183121_policy_workbench.sql` with `pnpm exec supabase db push`, then deploy the web build. Existing workers need no changes for this increment. Rollback reverts the web build while retaining the additive schema and decision history; destructive rollback requires a separately reviewed forward migration. No hosted migration or deployment is performed by this task.

## Verification

Focused SQL tests cover the role matrix, self-review denial, idempotency, audit events, exact numeric bounds and both invoker views. Independent-session integration tests cover competing submissions/decisions, membership revocation, author demotion and source availability. Browser coverage exercises pagination, filtering, proposal submission, a separate approver session, read-only viewing, unchanged original thresholds and evidence navigation. Full verification results are recorded in the pull request.
