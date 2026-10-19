# Disposition handoffs — Step 20c

Owner-approved scope, 2026-10-19. Save one immutable handoff from a selected approved supplier-return or scrap proposal. Members with location access can inspect searchable history and download CSV or JSON. These files record planning intent: they do not create supplier returns, scrap execution, accounting write-offs, stock reservations or stock movements.

## Evidence and lifecycle

The first save requires an owner, admin or planner with location access, the latest approved revision for the exact assessment/item, and matching original selected-line evidence. The guarded RPC shares the disposition review advisory lock and repeats live authority checks after waiting. `excess_disposition_preview` rechecks the original policy, explicit calculated/approved maximum and cutoff against the latest eligible stock snapshot. The complete chosen line must match the proposal's saved line. Missing or changed stock, policy or override evidence requires a new assessment and approval. Changes to another assessment line do not invalidate this one.

The proposal itself is the retry identity. A retry still requires current editor authority and location access, but returns the original handoff before checking current selection or source freshness. Duplicate concurrent saves create one record and one audit. A later approval makes older handoffs historical; it never replaces their payload. Selection is live context in a security-invoker view and is excluded from download content. Pending, rejected and withdrawn proposals are not eligible for first export.

The payload copies the exact approved quantity/unit, disposition kind, item/location identities and codes, cutoff, reference value/currency, author and independent approval reasons, assessment metadata and confirmation, and the full original chosen line. Quantities and values remain decimal strings. Reference inventory value remains the exact approved quantity × saved snapshot unit cost, without cash rounding. It is neither recovery proceeds nor an accounting write-off. Supplier-return intent does not identify a supplier or establish return eligibility.

Separate assessments and handoffs may propose overlapping stock. Exporting never refreshes commitments or establishes live availability, obsolescence or permission to execute. Batching, integration access, transmission and execution are separate work.

## Files and interface

Open **Replenishment → Excess stock → Disposition review**, select an approved proposal and choose **Save handoff**. Existing records show **Open saved handoff**. **Disposition handoffs** provides search across copied item/location codes and assessment/proposal/approval reasons, location/intent/current-or-historical filters, newest/oldest order and 25/50/100-row URL paging.

`excess-disposition-handoff-v1` JSON uses deterministic recursive object-key ordering, retains every field of the copied line and ends with a newline. CSV uses a fixed column order, UTF-8 BOM, CRLF records, quoted fields and the shared spreadsheet-formula protection. Its `assessment_line_json` column retains complete original line evidence alongside readable quantities, values and source references. Serializer changes require a new version; old files must remain byte-stable. Spreadsheet applications may coerce long decimals when opening CSV; JSON and raw CSV preserve the exact strings.

Cookie-authenticated routes `/api/excess-disposition-handoffs/{id}/csv` and `/json` use the session's active organization and table RLS. Responses are private/no-store, have safe attachment names and `nosniff`, and hide missing or out-of-scope records. No integration API-key scope or worker permission is added. Application roles have SELECT only; create uses the guarded RPC.

The shared illustrated headers and compact green panels retain 20px titles, 16px evidence values and 14px body text. Help is expandable, tables scroll locally, and required viewport coverage is 375, 768, 1024, 1440 and 1920px plus keyboard and Arabic RTL.

## Persistence and rollout

`excess_disposition_handoffs` has composite organization/proposal and organization/location foreign keys, membership RLS, restrictive location RLS and business auditing. Deleting the parent assessment/proposal, location or organization cascades according to the existing lifecycle. Source policy or catalog changes do not delete the copied handoff. No source records are updated.

Apply additive migration `20261019032256_excess_disposition_handoffs.sql` before deploying the reviewed web build. The owner runs `pnpm exec supabase db push` against the linked hosted project after review. Development applies only to local loopback Supabase. There is no backfill or worker change. Roll back the web build while retaining additive schema and history; destructive schema removal requires a separately reviewed migration.

## Verification

The tests cover selection and source gates, exact evidence, retries, audits, parent lifecycle and tenant/location permissions; real transaction races cover duplicate saves, replacement approval, evidence changes and permission changes while waiting. Unit snapshots protect versioned files, nested evidence, decimal precision, CSV escaping and route boundaries. The browser workflow covers real creation/downloads, history and search, stale-source refusal, scoped users, five widths, keyboard help and RTL.

Local verification on 2026-10-19:

- Typecheck, lint, logical-style checks, scoped formatting and diff checks passed. All 1,585 web unit tests passed on the final run; the first run encountered an existing filesystem-scan test timeout while other checks were busy. Engine unit tests also passed.
- The existing 75 pgTAP files passed. The new handoff file passed all 41 assertions after correcting a test-only fixture lookup; this was a targeted rerun, not a second full database run.
- All 47 disposition/handoff transaction-race tests passed, including 19 new handoff cases.
- All three production browser workflows passed: excess assessments, disposition review and handoffs. The handoff workflow then passed again after extending the create-form check to all five widths. Screenshots confirmed compact layouts, readable evidence, local table scrolling and RTL; keyboard help returned focus correctly.
- The production Next.js build passed. Local Cloudflare packaging stopped on Windows with a dependency-symlink `EPERM`; Linux packaging remains a CI check. No hosted migration or deployment was performed.
