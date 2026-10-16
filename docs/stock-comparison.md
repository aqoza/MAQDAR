# Individual-item stock comparison (Step 12c)

Owner-approved 2026-10-16: optional source-supplied demand/stock units, saved forecast/policy provenance, and a read-only comparison at the selected policy's forecast cutoff. The subsequent [Step 12d extension](prepared-stock-comparison.md) adds eligible prepared-group comparisons under its separate pooling rules; this document describes individual comparisons.

## Workflow and interpretation

Open **Forecasts → Policy review workbench**, choose a policy, then **Compare stock with calculated maximum** or **Compare stock using revision N** on an approved proposal. The report identifies the exact policy, threshold basis/revision, cutoff, snapshot identity/date/update time, quantities, supplied unit cost and currency. No newer policy or override replaces that choice automatically. Members can inspect reports within their existing tenant and branch access.

The comparison date must equal the saved forecast cutoff. Use the latest recorded snapshot on or before that date; snapshots exactly seven days old are accepted, and older observations are unavailable. Later observations never leak into the comparison. The snapshot and individual policy must have matching known units. The selected policy must have an available maximum. Pending, rejected, withdrawn, foreign-policy and inaccessible overrides cannot be used.

`quantity above maximum = max(on-hand − allocated − selected periodic maximum, 0)`

`value above maximum = quantity above maximum × snapshot unit cost`

Arithmetic is exact SQL numeric; the API and UI carry decimal strings. Display rounds to three decimal places. Value retains the supplied snapshot currency. Current catalog unit/cost does not replace saved evidence. A valid zero is distinct from unavailable; missing/stale snapshots, unknown/conflicting units, incompatible dates, unavailable policies and prepared groups show a reason and no calculated quantity/value.

This is a scenario using currently recorded data, not a reconstruction of information available on a historical decision date. Correcting a snapshot can change the report; policy evidence remains immutable and the displayed update time identifies the observation. An approved override created after the cutoff is a deliberately selected scenario threshold, not evidence it was active then.

The metric is named **available stock above selected policy maximum**. A periodic maximum targets inventory position, which also considers on-order quantities, backorders and commitments; see [MIT inventory-policy notes, slides 5–7](https://ocw.mit.edu/courses/esd-260j-logistics-systems-fall-2006/8b53c45fd26ffff706d815131e8d177e_lect11.pdf). This release excludes inbound orders, backorder inference, stock pooling, portfolio totals, purchasing, transfers, disposal and automatic policy activation.

## Unit provenance

`unit_of_measure` is an optional trailing column on demand-history and stock-snapshot import v1 files and an optional API field. Values use the existing vocabulary: `EA`, `SET`, `L`, `KG`. A demand label covers both sold and lost quantities; a stock label covers physical/allocated quantities and the cost per physical unit. No conversion is implied. Existing headers and payloads remain valid. New unlabeled rows store NULL; no historical data is backfilled from the current catalog.

An explicit label or null replaces the row's unit. If an import/API update provides a demand quantity, or stock quantity/allocation/cost/currency, while omitting the unit, provenance is cleared even if the supplied values are numerically unchanged. This prevents legacy clients from carrying a prior unit claim into a new observation. Replaying a complete API representation including its unit is still a no-op. Demand upserts continue to require sold or lost quantity; a unit alone cannot create or update a demand row. Explicit null/empty labels mean unknown.

New individual forecasts capture `source-units-v1` evidence in the same immutable input snapshot as demand: recorded-row count, unknown-unit row count and distinct supplied units. Only a nonempty history with the same explicit unit on every captured row is consistent. Missing days remain zero under the previously approved complete-history confirmation; they add no invented source observations. Empty or partly unlabeled history has an unknown unit. Multiple known units produce an `incompatible_units` result with no forecast/model scores; normalize the input and create a new run. Lost-sale-only rows count toward unit consistency.

New policies copy that saved evidence and unit. Old forecasts/policies remain readable and non-comparable. Catalog/source changes after capture cannot change retries or saved results. A previously queued run with an older captured payload remains unknown. New demand preparation captures explicit unit contradictions against its saved catalog mapping, limited to lifecycle-eligible rows, and blocks those groups with `unit_mismatch`; unlabeled historical preparation retains its prior semantics. Publication guards prevent older workers from publishing a normal result for a newly captured conflict.

## Acceptance and verification

| Criterion                                                                                                                                     | Verification                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Optional units preserve old imports, API payloads and exact numeric representations; explicit null and omission cannot leave stale provenance | Contract/loader checks, API pgTAP round-trips, browser API exercise    |
| Captured units survive catalog/history changes and flow into policies; mixed and unknown histories remain distinct                            | Worker integration tests and preparation unit test                     |
| 12 on hand − 2 allocated − maximum 7 gives 3 units, worth 3.375 KWD at cost 1.125                                                             | pgTAP numerical oracle                                                 |
| Seven-day freshness boundary, future exclusion, cutoff mismatch, missing units and valid zero behave explicitly                               | pgTAP boundaries and browser date changes                              |
| Explicit approved revision is honored; branch, tenant and active-claim restrictions remain enforced                                           | pgTAP security/privilege tests and independent-review browser workflow |
| A real forecast/policy exposes source units and its calculated stock comparison; reviewed overrides can be inspected separately               | Production-build Playwright                                            |

## Owner-run rollout and rollback

Stop workers, review/apply `20261015224157_stock_comparison.sql` with `pnpm exec supabase db push`, deploy the updated worker code (`uv sync --locked`) and web build, then restart workers. The migration adds nullable columns and unvalidated checks that enforce new writes without scanning/backfilling historical demand; it preserves all existing rows. Small import-contract metadata and API projections are updated in the same migration. The comparison RPC uses invoker rights with explicit organization filtering and underlying RLS; worker capability grants remain unchanged.

For rollback, disable new submissions and cancel queued runs before reverting workers. Preserve additive columns and saved evidence. Retain readers that understand `incompatible_units`, or roll forward with a reader fix; old readers do not know that diagnostic status. Removing schema or evidence requires a separately reviewed forward migration. This development step applies migrations only to the local test stack; hosted rollout remains owner-run.
