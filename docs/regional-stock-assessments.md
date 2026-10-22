# Regional stock assessments — Step 25

Approved 2026-10-22. Routes under `/replenishment/regional-stock` use the compact
green workspace, English and Arabic RTL at 375, 768, 1024, 1440 and 1920px.

## Calculation and evidence

Select one exact item code, one known unit (EA/SET/L/KG), one as-of date, a name
and 2–20 distinct active location codes. Confirm distinct physical stock holdings
and the as-of interpretation. Suggestions are capped at 200 locations; exact
permitted codes beyond the suggestions are accepted. Items need not be active;
the copied report retains their recorded status and catalog unit.

For each location choose the latest snapshot on or before the as-of date **before**
checking freshness or units. Never skip an unfavorable latest snapshot. Supplied
stock units must equal the requested unit; the catalog does not supply missing
provenance. Age 0–7 days is eligible; 8+ is stale. Snapshots may have different
dates. Missing/stale/unknown-unit/mismatched-unit lines are explicit, and regional
totals remain null if any line is unavailable. Zero and negative net stock remain
comparable; negative balances are never clamped.

Sum on-hand, allocated and (on-hand minus allocated) separately using SQL numeric,
returning decimal strings. No JavaScript floating-point aggregation. Include no
inbound, substitutes, policy protection or additional unallocated backorders.
Observed totals establish neither live availability nor transferable surplus.
Separate assessments may overlap and confer no pooling or execution rights.

## Persistence and authorization

`regional_stock_preview` is an authenticated, membership-checked definer RPC.
The UI exposes creation only to editors. Missing/inactive/foreign/inaccessible
inputs fail opaquely before returning any partial result. Every included location
must be accessible, including locations with zero or negative balances.

`regional_stock_save` is editor-only. It compares the canonical preview fingerprint,
locks item/location rows through insertion, refreshes evidence after waits and
rejects changed identities or evidence. It requires every line to be comparable.
The request UUID is organization-scoped. Identical author/input/fingerprint retries
return the original ID regardless of input location order; conflicting reuse fails.
Retries recheck current editor and all-location authority, but do not refresh
saved evidence after source changes or deletion. Inputs are limited to 8 KiB.

Reports copy item/location identities, names, source timestamps, snapshot IDs,
dates, supplied units, all quantities, confirmation and exact totals. They remain
immutable after catalog or snapshot changes/deletion. The server creation timestamp
records capture time, not verified historical availability of an imported snapshot.
The current capture is a transaction snapshot, not a lock against later imports.

The table allows authenticated SELECT only. Restrictive RLS requires the entire
immutable location-ID set, in addition to organization membership. Search/filtering
never relaxes that requirement. Losing one location hides the entire record.
Organization or included-location deletion removes assessments; unrelated location
deletion does not. Insert/delete audit records follow existing business audit rules.
No API-key scope, worker capability or operational writes are introduced.

## Verification and rollout

- `0102_regional_stock.test.sql`: decimal totals, precision bounds, snapshot selection,
  unavailable evidence, canonical retries, grants/RLS, retained copies and cascades.
- `test_regional_stock_db.py`: independent-session retry conflicts, authority changes,
  evidence refresh after waits and deletion races.
- `regional-stock.test.ts` and server-action tests: input bounds, confirmation,
  canonical ordering, guarded organization and safe error mapping.
- `regional-stock.spec.ts`: production save/refresh flow, searchable paginated history,
  HTTP 404 scope, access revocation, copied evidence, keyboard table scrolling and
  form/detail/history screenshots in English and Arabic at all five widths.

Apply `20261022030000_regional_stock_assessments.sql` through the approved hosted
migration process before deploying the web routes. This step applies it only to
local tests; hosted rollout requires separate authorization. No backfill or worker
deployment is needed. Existing stock locator and assessments remain independent.
