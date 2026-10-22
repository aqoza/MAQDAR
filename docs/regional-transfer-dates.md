# Regional transfer dates — Step 25d

Approved 2026-10-22 after PR #143 merged as `e5971cd`. One saved schedule uses
one complete regional sourcing scenario. Keep every allocated quantity, remaining
gap, protected maximum and stock/inbound commitment fixed.

## Scheduling and evidence

Choose one requested dispatch date on or after the saved cutoff, between
1900-01-01 and 2100-12-31. For each positive source allocation independently:

1. Resolve the next known source working day on or after the requested date.
2. Add that source's saved lane p50 and p90 leads in calendar days.
3. Resolve each nominal receipt to the next known destination working day.

Reuse calendar precedence, verified holiday coverage and the 90-evaluated-date
search bound. Unknown required days stop a search; missing holiday rows never
imply working days. Keep resolved partial results inspectable, but save only when
all positive sources have dispatch and both receipt dates. Zero allocations need
no calendar searches or receipt dates. An entirely zero scenario can save without
calendar confirmation or destination policy timing evidence.

New previews/saves require the original unarchived region, active participating
locations and the original active directed lanes with unchanged saved leads,
including zero allocations. Positive transfers require confirmation that current
calendar evidence applies. Capture calendars, holidays, overrides, evaluated dates
and current lane/location identities and timestamps. Changed fingerprints require
a refreshed preview.

The sourcing report does not contain the destination's policy lead time. Capture
this parameter from its original immutable policy, requiring matching saved
location, unit and cutoff; missing evidence prevents a positive schedule. Compare
each receipt with cutoff plus this fixed lead. Preserve existing inbound warnings.
Typical/slow dates and timing-review flags are indicative scenarios, not calculated
shortages, calibrated probabilities or guaranteed arrivals. Freight, approvals,
reservations, policy recalculation and execution remain separate.

## Lifecycle and access

Editors create schedules. Members must have access to every captured region member
for preview, history, counts and detail, including zero allocations. The UI creation
route is editor-only. Database previews check membership and the full location set
before accessing private calendar evidence. Tables have SELECT-only authenticated
privileges, tenant RLS and restrictive all-location RLS; writes use guarded RPCs.

Organization/request UUID identifies a retry. Matching author, sourcing identity,
requested date, confirmation and fingerprint returns the original record; conflicting
reuse fails. All retries recheck current membership, editor role and location access.
They retain original evidence after subsequent calendar/lane/policy changes or region
archive/deletion.

First saves lock the request, locations in identity order, region and saved sourcing
parent, then recheck authority and preview evidence. Region SHARE locks serialize
with archive: a committed archive blocks a new save; a completed save keeps its
history. Capturing evidence is an as-of snapshot and never refreshes or reserves stock.

Date records belong to their saved sourcing parent. Parent, organization or included
location deletion cascades with existing audit behavior. Deleting original stock,
drafts, policies or region definitions does not alter already saved date evidence.
Separate schedules remain independent.

## Interface and acceptance

Routes are under `/replenishment/regional-stock/sourcing/dates`, with creation and
history links from sourcing. History searches copied region/item/location labels,
supports source filtering and paginates scoped results. Detailed calendars and
original sourcing evidence are expandable. Use shared compact green screens,
16px headings, 14px primary values, local keyboard table scrolling and Arabic RTL.

- AC-001: Independent source dispatch and typical/slow receipts; unchanged exact
  allocations and inbound warnings — pgTAP, database examples and Playwright.
- AC-002: Zero quantities/leads, unknown dates, missing confirmation/policy and
  bounded partial searches — database boundary tests; incomplete saves are rejected.
- AC-003: Region archive, stale calendar/lane/location evidence and post-wait
  permissions — independent-session tests, pgTAP and held-preview browser checks.
- AC-004: Tenant/all-member reads, editor writes, canonical retries, one audit and
  parent deletion — privilege invariants, database tests and HTTP 404 checks.
- AC-005: Full preview/save/history, filters, keyboard use and screenshots at
  375/768/1024/1440/1920px in English and Arabic — Playwright and visual inspection.

Run `0105_regional_dates.test.sql`, tenant/ACL invariants,
`test_regional_dates_db.py`, regional date schema/action tests and
`regional-dates.spec.ts`. Database and browser fixtures run sequentially.

Local validation on 2026-10-22: 26 database integration tests, 598 pgTAP assertions
across the feature and tenant/privilege invariants, 2,107 web unit tests and 13
simulation-supervisor tests passed. Production build, TypeScript, lint, formatting
and logical-layout checks passed. The production browser workflow passed with 40
English/Arabic screenshots across the five widths, including preview, saved detail,
expanded evidence and history. Fresh-database full-suite validation runs in PR CI.

## Rollout

Apply `20261022060000_regional_transfer_dates.sql` through the owner-reviewed hosted
migration workflow before deploying the web application. Development uses the local
test stack only. No worker, API-key scope, backfill or hosted deployment is required.
Roll back the web release while retaining additive schema and saved evidence.
