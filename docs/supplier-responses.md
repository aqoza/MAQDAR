# Supplier responses — Step 26c

Approved 2026-10-23. Current granted supplier users may record **Received** or **Declined** against one explicitly published ordinary handoff or batch. Received confirms receipt only; neither status accepts an order or promises supply. Responses never alter approved quantities, dates, prices, selections, inbound or stock.

## Evidence and lifecycle

Responses are append-only. Capture the verified responding account's email and ID, server timestamp, per-publication revision, optional reference (120 characters), comment/reason (2,000 characters), and client request UUID. Declined requires a nonblank reason. Exact retries within the organization/account return the original event; conflicting reuse across publications or values fails. Another account has a separate request namespace. Current authority is checked even for retries; a new response appends a correction without rewriting previous reports.

Supplier history exposes only response ID, revision, status, reference, reason, captured author email and server time. It is shared with current grants for the same organization/supplier and bounded to 25 events per page. Latest means highest serialized revision for this exact publication, independent of the history page. No report means absent evidence. Single publications, batches, members and overlapping publications never inherit responses.

A confirmed account, accepted nonrevoked grant, active supplier and nonwithdrawn publication are required on every supplier read/write. Row locks serialize writes against grant revocation, account unconfirmation, supplier inactivity and publication withdrawal/deletion. The publication lock also orders concurrent reports. Staff need current organization and receiving-location access; viewers can inspect history without publication mutation rights. Supplier-only accounts receive no staff membership or raw table access.

Withdrawal and revocation remove subsequent supplier access but preserve internal history. Captured actor evidence survives account/grant deletion. Events follow their actual publication's deletion; a copied batch and its reports survive source-handoff deletion, while deleting that batch cascades. No reports or invitations are sent to real suppliers during development.

## Acceptance and verification

- AC-001: Current supplier grants can submit both statuses against single/batch publications; decline validates its reason. Verify UI, pgTAP and runtime schemas.
- AC-002: Tenant, supplier, confirmed-account, grant, publication and receiving-location boundaries hold for reads, writes and retries. Verify pgTAP and independent-session lock waits.
- AC-003: Identical concurrent retries create one event/audit entry; different reports have serial revisions; conflicts fail and all earlier evidence remains. Verify independent database sessions.
- AC-004: History is bounded and allowlisted; copied batch retention, actual-parent cascades and operational state remain correct. Verify database and browser flows.
- AC-005: Responsive English/Arabic screens at 375, 768, 1024, 1440 and 1920px retain shared compact green typography, accessible labels and no page overflow. Inspect production-browser screenshots.

## Rollout

Additive owner-run migration `20261023220000_supplier_responses.sql` must precede deployment. Depends on the merged ZeeSpare rename and supplier-batch migration correction. Rollback the web build to hide response entry; preserve additive response/audit data. No hosted migration or deployment is performed by this step.

## Verification results

- Targeted pgTAP: tenant/privilege inventories passed (617 assertions), and the response contract passed all 58 assertions.
- Independent-session supplier tests: 27 passed, including 14 new response retry/authority races.
- Web unit suite: 205 files / 2,217 tests passed. Engine unit suite: 498 passed. Simulation supervisor: 13 passed.
- Format, lint, workspace types, logical/RTL utilities and production build passed. Production browser checks passed for the existing single/batch publication flows and the new response flow. The new test captured 20 screenshots across supplier/internal screens, English/Arabic and all five widths; overflow and shared typography assertions passed. Browser verification corrected the selector's accessible name and a same-page redirect that left history stale after saving. The full pgTAP regression run is in progress.
