# Regional freight estimates (Step 25e)

From a saved regional transfer-date scenario, editors can inspect and save one complete freight estimate. The original region must exist and be unarchived for a new estimate. Members require access to every saved location, including zero allocations, to preview or read history. A region never grants access.

## Calculation and evidence

- Quantities, individual source dispatch dates, p50/p90 receipts, stock commitments and inbound/timing warnings are copied from the saved scenario. No source recalculation occurs.
- Every original directed source-to-destination lane and participating location must remain active; p50/p90 leads must match the saved schedule.
- Positive lines use quantity × supplied rate for `per_unit`, or one fee for that source transfer for `per_shipment`. Per-unit pricing requires matching known supplied units. A known rate-valid-from date must be no later than that source's saved dispatch. Applicability confirmation is required.
- Exact PostgreSQL numeric arithmetic; round each line once half-up to currency minor units, then sum rounded lines separately by currency. Line amounts must fit numeric(18,3); aggregates remain exact decimal strings. Quantities are never pooled. Per-shipment fees remain separate.
- Explicit zero rates are valid with normal evidence. Unconfigured terms remain unavailable. Zero quantities need no pricing/confirmation but retain active lane/location and access checks.
- Partial line evidence is inspectable; totals and saving are unavailable unless every positive line is priced. All-zero scenarios may save `no_transfer_needed` with empty totals.

## Persistence and authority

`regional_freight_preview` returns `regional-freight-v1` with copied source evidence, current terms, currency precision, current location evidence, line results and a fingerprint. `regional_freight_save` validates organization/editor authority, serializes request UUIDs, and rechecks authority after waits. It locks participating locations in ID order, then the original region and saved parent, matching region archive lock order. The fresh preview must match the submitted fingerprint.

Identical retries match organization, author, parent, confirmation and fingerprint and return the original immutable record, even after region archiving or source evidence changes. Access and editor authority are still required. Conflicting UUID reuse fails. New saves after region archive/deletion fail. Saved rows are select-only under tenant plus all-location RLS; service and worker roles have no access. Audit records capture insert/deletion.

Deleting the actual regional date/sourcing parent, organization or included location follows existing cascades. Deleting a region definition or changing pricing, calendars, policies or stock does not rewrite retained estimates. No taxes, FX, booking, consolidation, reservation, transfer creation or stock movement is performed.

## Interface and verification

Start at a saved regional schedule → **Estimate regional freight**. Confirm applicability, refresh and save. The history at `/replenishment/regional-stock/sourcing/freight` supports search by item, region and source/receiving location plus parent filtering and pagination. Details retain original evidence, with compact disclosures and keyboard-scrollable tables.

Database tests cover exact costs, per-source effectivity, currency rounding, missing/incompatible terms, zeros, stale previews, access, concurrency, archive ordering, retries and deletion. Browser tests cover saving, stale-preview refresh, history/search, actual 404 responses, all-location restrictions, keyboard use and preview/detail/evidence/history at five widths in English and Arabic RTL. No hosted migration or deployment is part of this change.
