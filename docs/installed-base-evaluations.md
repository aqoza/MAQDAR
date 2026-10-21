# Installed-base demand evaluations — Step 24c

Approved 2026-10-22 after PR #137 was merged as `17f9bbd`. Evaluate one saved
installed-base demand scenario against its complete recorded-sales window. This
is a retrospective comparison, not measured equipment failures or verified
out-of-sample forecasting accuracy. It does not fit rates or change policies.

## Accepted calculation and evidence

- Use the scenario's exact item/location identities, known unit, cutoff and full
  1–90 day ledger. Its last day must be strictly before today in its saved service
  timezone; today is not complete. The window cannot be shortened or extended.
- Require explicit complete-history confirmation before previewing or saving.
  An absent day then represents zero recorded sales and zero recorded lost sales.
  Preserve an explicit recorded/missing indicator and the supplied unit for each
  observed row. Missing days have no fabricated supplied-unit evidence.
- Every observed row, including a lost-sales-only row, must have the same known
  unit as the scenario. No filling of unknown units or conversion is permitted.
- Score only sold quantity. Keep lost sales in a separate total and daily column;
  do not infer unmet demand, replacement events or failures from either measure.
- Daily difference is expected minus sold. Positive signed bias means expectations
  exceeded recorded sales. Every horizon day has equal weight. MAE is mean absolute
  difference, RMSE is the root of mean squared difference, and bias is mean difference.
- PostgreSQL numeric multiplication/sums preserve exact daily differences, totals,
  absolute-error sum and squared-error sum. Division/root metrics are rounded once
  to 24 fractional digits after high-precision numeric calculation. Saved exact
  sums and day count make the metrics inspectable. JSON/UI values remain decimal
  strings; no binary floating-point conversion or order rounding occurs.
- Copy the entire source scenario, including its population, unknown ages, rate
  declarations and separate source/server timestamps. Copy daily sales evidence
  from a single database snapshot. Demand rows have no import timestamp; the
  evaluation's server save time records this capture, not historical availability.
  Availability claims remain claims even if the source scenario was saved later.

## Lifecycle and access

Owners/admins/planners preview/save in the UI. Members inspect within current
organization/location access. Database previews enforce member and location access;
saves enforce editor authority. No direct table mutation, API-key permission or
worker capability is added. All definer functions pin an empty search path.

A fresh preview fingerprint is required on first save. Source-row sharing locks
protect the scenario capture, and request locks serialize retries. Authority is
rechecked after both waits. The fresh preview captures the then-visible sales in
one MVCC snapshot and rejects changed input/source/sales evidence. This does not
lock operational sales or prevent subsequent imports; the saved copy remains fixed.

Same author, canonical input, request UUID and fingerprint return the original
record after current editor/location checks. Conflicting UUID reuse fails. Original
copies survive scenario, population, item or sales deletion; new saves require a
visible source scenario. Organization/location cascades and business-row audit remain.
Separate evaluations stay independent; no winner or combined result is inferred.

## Interface and verification

- Create: `/forecasts/installed-base/demand/[id]/evaluate`.
- Searchable 25-row history: `/forecasts/installed-base/evaluations`.
- Saved evidence: `/forecasts/installed-base/evaluations/[id]`.
- Shared Forecasts header, compact green components, immutable summary, scrollable
  daily ledger and expandable calculation/source details. No ancestor loading
  boundary is added, preserving hidden-record HTTP 404 responses.

Acceptance checks:

1. Complete, confirmed, compatible history produces exact daily/aggregate evidence
   and independently verified metrics; incomplete horizons, bad units and malformed
   input fail. SQL assertions, Decimal oracles and browser error recovery verify this.
2. Changed evidence requires refresh, repeated saves are stable, conflicting retries
   fail and post-wait authority changes deny access. Real database sessions verify
   first saves, retries, source locks and one-record/one-audit behavior.
3. Tenant/location boundaries apply to preview, save, history and hidden URLs.
   Viewer/approver/branch roles cannot save. pgTAP privileges/RLS, server-action
   tests and browser 404 checks verify access and source-independent retained copies.
4. Production Playwright covers the complete workflow, search/pagination, keyboard
   ledger scrolling and 375/768/1024/1440/1920 widths in English and Arabic RTL.
   Screenshots use the existing `installed-base-*.png` CI artifact pattern.

Apply additive migration `20261022010000_installed_base_evaluations.sql` before the
web deployment. No hosted migration, backfill, engine changes, uncertainty bands,
forecast/policy changes, reservations or operational orders are part of this PR.
