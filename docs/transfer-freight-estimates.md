# Transfer freight estimates (Step 16c)

From a saved transfer-date scenario, choose **Estimate transfer freight**. Inspect the current lane's supplied rate and effective date, confirm that the terms apply to the saved quantity and adjusted dispatch date, then save. The preview, immutable detail and searchable history use the compact green interface at 375, 768, 1024, 1440 and 1920px. Methodology and detailed evidence are expandable; confirmations and actionable timing warnings remain visible.

## Approved calculation

For `per_unit`, multiply the saved transfer quantity by the supplied lane rate. The lane must supply a known `freight_unit` matching the saved quantity's unit exactly. For `per_shipment`, apply one fee to this one proposed transfer, explicitly treating it as one shipment. There is no consolidation across drafts or allocation of a fee between items.

Calculate with exact SQL `numeric`, then round once, half-up, to `currencies.minor_units`. Retain the exact product and the rounded subtotal as decimal strings. For example, 8.750 × 1.234 = 10.797500, giving SAR 10.80 or KWD 10.798. A rounded subtotal above 999999999999999.999 is unavailable. Currency totals are never combined or converted.

An explicit zero rate is valid with the same evidence and confirmation. A `none` freight basis means unconfigured, not free. A saved zero transfer produces **No transfer needed**, with no freight subtotal or confirmation requirement. Only available estimates and no-transfer results can be saved; unavailable previews explain the missing input.

## Evidence and applicability

Both locations must be active. Require the same active directed lane captured by the redistribution draft and the same saved p50/p90 lead times. Recreating the same endpoint pair does not substitute a new lane identity. For either priced basis, a known finite `freight_valid_from` date must be no later than the saved adjusted dispatch. The planner confirms that current unversioned terms apply to that quantity and date. No valid-through date, historical price reconstruction or carrier commitment is inferred.

The estimate retains the complete saved transfer-date report, including quantities, both receipt scenarios and destination overdue/late inbound concerns. Timing-review flags remain visible and do not block a planning cost estimate. Current calendar edits do not recalculate saved dates. The estimate does not alter stock, allocations, policies, inbound, receipts or transfers. Taxes, FX, consolidation, inventory valuation, approvals and execution are outside this step.

The report captures current location and lane identities, update timestamps, active flags, lead times, basis, supplied rate, unit, effective date, currency precision, applicability confirmation and exact arithmetic. Saving recomputes this evidence fingerprint; changed inputs require a refreshed preview. Subsequent edits do not change saved estimates.

## Lane maintenance, imports and API

`network_links.freight_unit` and `freight_valid_from` are nullable additive fields. Existing lanes remain unknown until evidence is supplied; no catalog unit or date is backfilled. Maintenance offers both fields. The import format appends them after the original eight columns, and the existing network-links API accepts and returns them with its existing master-data scopes.

Supplying the freight basis/rate/currency group without either new field clears that field's prior evidence, even when the supplied price is unchanged. This prevents a legacy rate replacement from retaining unrelated provenance. Updates to lead times or active status alone preserve provenance. Explicit null clears a field; evidence-only updates are allowed. The import wizard and API share the same validation and merge path. A per-shipment rate does not require a freight unit.

## Access and retries

Preview explicitly checks organization membership, the active organization claim and access to both endpoints, including when called by the definer save RPC. Only owners, admins and planners save. Saved records have tenant RLS plus two ANDed restrictive endpoint policies; the history view uses invoker rights. Anonymous, service and worker roles gain no estimate capability, and authenticated direct writes are revoked. The new staging helper is private.

An organization advisory lock serializes saves. Authority is checked again after waiting, and new saves recompute evidence. Organization-scoped request UUIDs bind scenario, author, confirmation and fingerprint. Identical retries retain the original estimate and one audit event; conflicting reuse fails. Retries retain current editor and endpoint access requirements without refreshing historical prices.

## Acceptance and verification

- AC-001: Per-unit and per-shipment calculations preserve exact fractional quantities, currency rounding, explicit zero rates and unknown-versus-zero distinctions.
- AC-002: Missing or mismatched units, missing/future rate dates, inactive or replaced lanes/locations and changed lead times explain unavailability. Stale previews cannot save; later changes preserve saved evidence and warnings.
- AC-003: Maintenance, imports and API round-trip optional provenance. Legacy freight replacements clear omitted evidence, while unrelated updates retain it.
- AC-004: Tenant, claim, role and both-endpoint isolation cover preview, save, retry, details and list counts. Concurrent retries save once; rate and authority changes during lock waits are detected.
- AC-005: Authenticated browser checks cover lane editing, confirmation, stale-save recovery, immutable history, viewer/branch access and all five widths. Keyboard disclosures and contained tables remain usable.

Local verification passed 2,971 pgTAP assertions, 126 Python database tests, 294 Python unit tests and 1,225 web unit tests. The authenticated freight journey passed lane editing, confirmation, stale-save recovery, immutable history, viewer/branch access and all five widths; screenshots at each width were also inspected. Lint, TypeScript, logical CSS, formatting, retention tests and the production build passed. The full browser regression passed 59 tests; three opt-in scale tests were skipped. Database suites run sequentially because they share tables and statistics.

## Rollout and rollback

After review, apply `20261017103456_transfer_freight_estimates.sql` with `pnpm exec supabase db push` before deploying the web build. The migration adds nullable lane columns and constraints without backfilling data, updates the import contract and API projection, and creates a new table, invoker view and guarded RPCs. It changes no worker behavior or API-key scopes. Local migration testing does not deploy to the hosted project.

Roll back the web build while retaining the additive schema and immutable evidence. Existing clients can omit the new fields under the documented provenance rules. No destructive rollback is required.
