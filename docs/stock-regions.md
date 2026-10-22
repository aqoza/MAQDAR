# Reusable stock regions — Step 25b

Approved 2026-10-22 after PR #141 merged. A named region fixes 2–20 active
location identities in one organization. Editors create and archive definitions;
members need access to every included location for any inspection or reuse.

## Behavior and acceptance

- AC-001: An editor enters an English name, optional Arabic name and 2–20 distinct
  permitted active location codes, confirms distinct physical holdings and previews
  their identities. Save rejects a changed preview. SQL, action and browser tests
  cover validation, changed evidence and exact membership; no stock changes occur.
- AC-002: Membership and names remain fixed. Corrections create a new definition.
  Archive is terminal and idempotent, retaining its first actor/time and one audit
  event. Concurrent tests verify live editor and location authority after waits.
- AC-003: The assessment form can select a saved region or keep manual location
  selection. Region membership resolves by saved UUID, never by an old code that
  might now name a different location. The latest-stock, seven-day, supplied-unit,
  exact quantity and distinct-holdings rules remain unchanged. SQL and existing
  assessment tests compare both paths, including negative balances and renames.
- AC-004: A new assessment copies the whole region definition, its identity and
  creation time alongside current stock evidence. It rejects archived regions,
  inactive/missing/hidden locations and changed evidence. Archive/save race tests
  prove no new save can cross an already committed archive; existing save retries
  retain their copied evidence and still check current caller authority.
- AC-005: Region history supports English-name search, captured location-code and
  active/archived filters, with 25 records per page. Filters and counts retain
  all-location RLS. Browser tests check viewer and partial-location HTTP 404s,
  access changes, search, archive and retained assessment evidence.
- AC-006: Form, detail, history and assessment reuse follow the compact shared green
  design, 16px titles, 14px evidence and logical CSS. Browser evidence covers
  375, 768, 1024, 1440 and 1920px in English and Arabic RTL. Wide evidence tables
  scroll within keyboard-accessible containers; no ancestor loading boundary is added.

## Evidence and lifecycle

`stock_regions` stores copied location labels, identities and source timestamps,
canonical input and a SHA-256 preview fingerprint. The English name is required
(1–200 characters); Arabic is optional (up to 200). Names need not be unique:
detail URLs and copied assessment evidence identify the exact definition by UUID.
No editing, unarchiving, automatic merging or cross-organization sharing is added.

Create retry identity is organization/request UUID. The same actor, canonical input
and preview fingerprint returns the original record, even after archive or catalog
changes. Conflicting reuse fails. Archive retries return the original state without
replacing the actor/time. All retries recheck current permissions.

Region suggestions show up to 200 recent unarchived authorized definitions; full
history provides a Use region link for definitions outside that list. Location
suggestions show up to 200 permitted active locations; other exact permitted codes
can be entered. The captured membership display uses original codes; the assessment
preview shows current names/codes resolved by identity. Inactive members prevent new
use even if a region itself remains unarchived.

Archived definitions remain readable. Archiving never changes past assessments.
Source stock/item changes or deletion never rewrite copied assessment evidence.
Organization deletion and included-location deletion remove dependent regions and
assessments with existing audit behavior; unrelated location deletion has no effect.
Region definitions confer no new access or pooling authority. Separate definitions
and assessments may overlap. No inbound, stock, reservation, policy or order is changed.

## Database and rollout

Authenticated users have SELECT only on `stock_regions`; tenant RLS and a restrictive
immutable location-set predicate enforce membership and every-location access.
Only guarded RPCs create/archive records. No API-key or worker capability is added.
Creation locks locations through insertion. Assessment creation locks locations before
its region, then rechecks authority, active state and evidence after waits. The manual
assessment contract stays compatible; region input/evidence is an additive alternative.

Apply `20261022040000_stock_regions.sql` through the approved hosted migration process
before the web deployment. This implementation applies it locally only; no worker,
backfill or production deployment is required by this PR.

Verification: `0103_stock_regions.test.sql`, tenant/ACL invariant suites,
`test_stock_regions_db.py`, existing regional-stock concurrency tests,
`stock-regions.test.ts`, region server-action tests and `stock-regions.spec.ts`.
Run database fixtures and browser fixtures sequentially against loopback only.
