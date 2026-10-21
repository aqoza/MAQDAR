# Installed-base datasets — Step 24

Approved 2026-10-21. Capture the equipment population served by one location and
mapped to one catalog part. This is an evidence foundation; installed quantities
are fitted-part counts, not demand, stock, failure estimates or replacement orders.

## Contract

Forecasts → Installed base → Import population accepts a dataset name, exact part
and active service-location codes, the part's known matching unit, one as-of date,
source notes and a source-declared availability date. The as-of date cannot be in
the location's future; declared availability must be on/after that date and no
later than today there. Server import time is recorded separately. These dates
are source claims and do not establish independently verified historical knowledge.

Upload UTF-8 comma CSV, at most 512 KiB and 1,000 groups, with these exact headers
in any order: `group_code,group_name,installed_on,active_assets,parts_per_asset`.
Codes/names are required trimmed text, limited to 100/200 characters. Codes are
case-sensitive and unique within the dataset. `installed_on` is a YYYY-MM-DD date
no later than the as-of date, or an empty cell for explicitly unknown age. Counts
are nonnegative whole numbers, up to 15 digits. Part quantities per asset are
positive exact decimals, up to 15 integer and 3 fractional digits, in the supplied
unit. Reject invalid rows, duplicate codes, extra precision and oversized inputs
atomically; do not round, fill gaps, infer dates or convert units.

For each group, installed quantity = active assets × parts per asset. Compute and
sum exact decimal strings without binary floating point. Show total assets and
installed quantity, known/unknown-age asset counts, and each group's elapsed age
in calendar days at the as-of date. Zero-count groups remain evidence; missing
installation dates remain unknown even for zero counts. No failure, replacement,
retirement or future population growth is inferred.

Preview validates independently in SQL. Saving requires explicit source/unit
applicability and non-overlap confirmations. The application cannot verify that
groups represent disjoint equipment; the confirmation remains a planner claim.
Original CSV bytes are parsed locally and not stored; canonical parsed evidence
is saved. Existing import-file retention is unchanged.

## Lifecycle and access

Owners/admins/planners save; members inspect within current organization/location
access. No raw table writes, API-key scopes or worker capabilities are added.
First saves require the current preview fingerprint. Request UUIDs serialize
retries; canonical group order and equivalent decimal spellings return the original
record for the same author, input and fingerprint. Conflicting reuse fails, and
authority is checked again after waits. Saved retries preserve original evidence
after catalog changes, while still requiring current editor/location access.

Datasets are immutable. Corrections create independent datasets; no implicit merge
or supersession occurs. Saved item metadata survives item deletion; organization
and location deletion follow existing cascades and audit rules. History offers
literal name search, exact part/location filters and 25-row pages. Groups use
50-row local pages. Hidden URLs return HTTP 404. Existing forecasts, policies,
stock, reservations and orders are unchanged.

## Acceptance and verification

- AC-001: Valid groups preview exact products/totals and known/unknown ages;
  malformed, duplicate, future or incompatible evidence cannot save. Verify parser
  units, SQL arithmetic/date boundaries and browser upload/error recovery.
- AC-002: Confirmation and fresh evidence are mandatory; canonical retries remain
  stable, conflicts fail and concurrent saves create one record/audit. Verify SQL,
  real database sessions and preview invalidation in the browser.
- AC-003: Tenant/location isolation, read-only roles, revoked access and post-wait
  checks hold for preview, save, retries and history. Verify pgTAP, privilege
  inventory, database concurrency and HTTP 404 checks.
- AC-004: Original source evidence and import time survive catalog changes/item
  deletion; corrections remain separate and no operational rows change. Verify
  database lifecycle, audits and browser history.
- AC-005: Shared illustrated Forecasts header and compact green typography,
  keyboard access, local table scrolling and translated evidence work at
  375/768/1024/1440/1920px in English and Arabic RTL. Capture and inspect production
  browser screenshots.

## Rollout

Owner reviews/applies `20261021170000_installed_base_datasets.sql` before deploying
the web build. Rollback restores the previous web build and retains saved evidence.
This increment adds no external feed, engine fitting, hosted deployment or backfill.
