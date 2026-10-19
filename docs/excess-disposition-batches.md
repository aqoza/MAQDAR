# Disposition handoff batches — Step 20d

Owner-approved scope, 2026-10-19. Editors can package 1–50 disposition handoffs sharing one location, disposition intent, currency and assessment cutoff. Members with location access can search history, inspect copied evidence and download CSV or JSON. Packages record planning intent; they create no reservations, returns, write-offs or stock movements.

## Calculations and first-save gates

Retain each approved quantity and unit separately. Sum saved reference inventory values with PostgreSQL `numeric`, without currency rounding or quantity pooling. This is inventory reference value, not recovery proceeds, an accounting write-off or supplier-return eligibility. Supplier-return and scrap handoffs cannot share a batch. Reject repeated item identities or saved codes, even across separate assessments.

Every new batch requires all handoffs to remain selected approvals. Reuse `excess_disposition_preview` to check the chosen line's original stock, policy and explicit calculated/approved maximum, then compare the complete saved line. Changed or missing as-of evidence requires a new assessment/approval/handoff. Any failure rejects the entire package. Saving uses the shared disposition-review advisory lock and rechecks live editor authority, location access, selection and evidence after waiting. This serializes package creation with replacement approvals; it does not reserve stock or prevent later source edits.

## Retries, overlap and deletion

The sorted exact handoff UUID set is the per-organization retry identity. Authorized replays return the original record before testing fresh selection or evidence. They still require live editor authority and visibility of all source handoffs; after source deletion, inspect/download the original batch by its own ID instead. Concurrent identical saves create one batch and one audit event.

A handoff may occur in multiple different packages. Candidate reuse counts, overlapping-package links and history counts make that visible. Packages do not prevent duplicate external execution. Live planning selection is separate from immutable files: `current` means all source approvals remain selected, `historical` means at least one is superseded, and `unavailable` means source context is missing. These labels do not assert live stock availability.

The batch copies full original handoff payloads and has no parent handoff/assessment foreign key. Deleting a source handoff, proposal or assessment leaves original batch files intact. Organization/location deletion follows the existing cascade. Tenant/member and restrictive location RLS protect both tables and security-invoker views; application roles have SELECT only and create through the guarded RPC. API-key and worker permissions are unchanged.

## Interface and file contract

Open **Replenishment → Excess stock → Disposition handoffs → Disposition batches**. Choose lines across search/filter pages, preview the compatible set and save. Selection filters include item/reason search, location, intent and cutoff. History adds current/historical/unavailable filters, ordering and 25/50/100-row paging. Copied evidence remains inspectable even when a source link no longer resolves.

`excess-disposition-handoff-batch-v1` exports preserve canonical line order and exact decimal strings. JSON contains the complete original handoff objects with deterministic nested evidence ordering and a trailing newline. CSV has a fixed column order, UTF-8 BOM, CRLF records and shared spreadsheet-formula escaping. Each row includes `original_handoff_json` alongside readable fields and references. Spreadsheet applications may coerce decimals; JSON and raw CSV retain exact strings. Versioned serializer changes must preserve old file bytes.

Session-authenticated `/api/excess-disposition-batches/{id}/csv` and `/json` routes enforce the active organization and RLS, return private/no-store attachments with `nosniff`, and hide inaccessible records. Live selection and overlap counts never enter downloads.

The shared compact green headers use 20px page titles, 16px evidence values and 14px body/table text. Wide tables scroll within their containers. Methodology lives in expandable help. Required viewport coverage is 375, 768, 1024, 1440 and 1920px, with keyboard help and Arabic RTL checks.

## Rollout and verification

Apply additive migration `20261019044033_excess_disposition_handoff_batches.sql` before deploying the reviewed web build. Hosted migration remains owner-run after review; development uses local loopback Supabase. No backfill or worker changes are needed. Roll back the web build while retaining additive schema and historical evidence; destructive schema removal needs a separate reviewed migration.

Coverage includes atomic compatibility/selection/evidence gates, exact totals, duplicate IDs/codes, 50-line limits, scoped reads, privileges, retries, overlap, audit and deletion lifecycle. Transaction tests exercise concurrent retries, evidence and authority changes during lock waits, and replacement approvals. Unit snapshots cover complete files, precision, formula escaping, routes and actions. Production browser coverage exercises selection, preview/save, downloads, stale-preview rejection, history, scoped viewers, source deletion, five widths and RTL.

Local verification on 2026-10-19:

- Strict types, lint, logical-style checks, scoped formatting and the production Next.js build passed. All 1,606 web tests passed on the final run; an earlier busy run hit an existing filesystem-scan timeout without an assertion failure. All 294 engine unit tests passed.
- The complete pgTAP run covered 77 files and 4,804 assertions. One existing handoff deletion assertion counted unrelated local organizations; its fixture count was scoped, as was the new batch deletion count. Both disposition suites then passed all 98 assertions. The other 75 files passed in the complete run; the full suite was not repeated.
- All 66 disposition/review/handoff/batch transaction tests passed, including 19 new batch cases.
- The branch incorporates merged PR #92. New batch and existing handoff detail actions use its direct-action fragment pattern, preserving 14px action text and 44px mobile targets.
- Four production browser workflows passed on the rebased build: batches, individual handoffs, disposition review and excess assessments. Screenshots were inspected at 375/768/1024/1440/1920px and Arabic RTL; assertions cover keyboard help, 14px header actions, 44px mobile targets, scoped downloads and byte-stable files after source deletion. The merged header test's old two-link expectation was aligned with the three current destinations and extended to check the third keyboard stop.
- The focused header regression passed in English and Arabic at its five mobile/laptop/desktop viewports. Standard Cloudflare packaging rebuilt Next.js successfully, then stopped on Windows with `EPERM` creating a dependency symlink in `.open-next/middleware`; Linux packaging remains a CI check. No hosted migration or deployment was performed.
