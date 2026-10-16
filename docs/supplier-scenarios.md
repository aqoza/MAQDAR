# Supplier MOQ/pack scenarios (Step 13b)

Owner-approved on 2026-10-16 after PR #22 merged (`44da11b`). A planner selects one active supplier for a saved available individual-item replenishment draft, inspects its MOQ/pack terms and saves a rounded quantity and overage. Pricing totals, calendars, prepared groups and order execution remain later increments.

## Acceptance

| Criterion | Observable outcome                                                                                                                                                                                               | Verification                                                  |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| AC-001    | Select a supplier explicitly from a saved draft; preferred status never silently selects or replaces the source.                                                                                                 | Browser workflow and SQL fixtures                             |
| AC-002    | Zero gap stays zero. Positive gaps round max(gap, MOQ) up to a pack multiple, with exact overage above gap. Fractional packs and quantity limits remain exact.                                                   | Hand-calculated SQL fixtures, including large boundary values |
| AC-003    | Known matching supplied units, an active supplier, matching supplier-item/policy calendar-day lead time and explicit terms-at-cutoff confirmation are required. Missing or incompatible evidence is unavailable. | SQL and input tests                                           |
| AC-004    | Supplier maintenance, import v1 and API accept optional source-supplied units. Legacy terms remain unknown; replacing MOQ/pack or price/currency without a unit clears stale provenance.                         | UI, import/API and contract tests                             |
| AC-005    | Save immutable evidence, reject a changed preview, replay identical requests once and retain original evidence after supplier/feed edits.                                                                        | SQL, independent-session concurrency and browser tests        |
| AC-006    | Members read paginated history under tenant/branch RLS; only live editors save. No order, reservation, policy change or worker job is created.                                                                   | Privilege, authorization and browser checks                   |

## Calculation and scope

For a positive saved gap, quantity is the smallest multiple of the supplier pack size at least as large as both that gap and the supplier MOQ. For a zero saved gap, quantity is zero even when the MOQ is positive. Overage is quantity minus the saved gap. For example: gap 8, MOQ 10, pack 6 produces quantity 12 and overage 4; gap 1.125, MOQ 1.5, pack 0.25 produces 1.5 and 0.375.

`supplier-rounding-v1` uses integer thousandths with numeric quotient/remainder arithmetic, avoiding rounded division at large pack boundaries. Values above `numeric(18,3)` produce an unavailable result. Decimal strings remain exact through display. Eligibility is checked even for zero gaps.

The source draft, gap and policy evidence stay fixed. The current stock/order book is not queried or refreshed. A new current-stock decision requires a new replenishment draft. The supplier-item planning lead time must equal the saved policy's fixed lead time; mismatch does not silently recalculate the target or imply timely delivery. The source draft's overdue/late-inbound limitations still apply.

Supplier terms have no historical versions. The user confirms that the captured current MOQ/pack terms apply at the source draft cutoff. The existing `valid_from` field means **price** valid from and is not used to infer historical MOQ/pack applicability. This increment calculates no prices, currencies, FX or arrival dates. A changed supplier row or terms row requires a refreshed preview before saving.

## Units, compatibility and access

`supplier_items.unit_of_measure` is a nullable source claim for MOQ, pack multiple and price per unit (`EA`, `SET`, `L`, `KG`). It is editable in supplier maintenance and is an optional trailing import v1 field. No existing row is backfilled from catalog units. For imports/API, explicitly supplied units (including NULL) take precedence; updates to MOQ, pack, price or currency without the unit clear it. Lead time, preferred status, part number and price-date-only updates preserve it. Natural-key supplier/item codes identify the row; they are not unit evidence. Legacy headers remain accepted.

Only the save RPC inserts scenarios. It verifies editor authority again after its organization lock, repeats tenant/branch access checks through the preview, and derives location from the source draft. Request UUIDs bind author, source draft, selected supplier code, confirmation and preview fingerprint. Identical retries return the original record even if terms subsequently change; conflicting reuse fails. Unavailable diagnoses may be saved for inspection.

The report stores source draft identity/fingerprint, saved gap and lead time, supplier identity/activity, MOQ/pack/unit and source update timestamps. Prices are not included. Audit insertion and tenant/branch RLS apply; no direct session, API or worker write grants exist. Source draft or organization deletion follows the existing cascade lifecycle. A narrow invoker view supports paginated history without loading full reports.

## Verification and rollout

Use only the local Supabase test stack for migration and data tests. Run pgTAP, Python database tests and Playwright sequentially. Complete formatting, lint, typecheck, contract/type drift checks, unit tests, production build, browser evidence inspection and CI packaging.

Owner-run rollout: review `20261016090322_supplier_scenarios.sql`, pause browser imports, apply with `pnpm exec supabase db push`, then deploy the web build and reload import pages before resuming. The nullable column and NOT VALID enum constraint need no historical backfill/validation scan; DDL has a five-second lock timeout. Indexes are on the new empty scenario table only. Workers are unchanged.

Retain the additive schema and saved evidence on rollback. Legacy CSV headers and API requests remain supported, but an older web build sends eleven staging cells for supplier items while this migration expects twelve. Browser supplier-item imports therefore require this contract-aware build; keep those imports paused if reverting the web build and restore a compatible build before resuming. Subsequent schema corrections use forward migrations. No hosted migration or deployment is performed by this task.
