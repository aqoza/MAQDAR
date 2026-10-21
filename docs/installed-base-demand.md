# Installed-base demand scenarios — Step 24b

Approved 2026-10-21 after the installed-base foundation in PR #136. A planner selects
one saved population dataset, supplies explicit replacement assumptions, inspects an
exact preview and saves an immutable conditional demand scenario.

## Calculation contract

- Select a named scenario, a cutoff on or after both the population as-of date and
  its source-declared availability, and a whole-day horizon of 1–90 (default 28).
  The cutoff cannot be in the future in the saved service location's timezone.
- Every saved equipment group, including a zero-asset group, needs an explicit
  nonnegative replacement rate per installed unit per calendar day, a source/reason
  and a source-declared availability date no later than the cutoff. Blank is unknown;
  zero must be supplied. Decimal rates accept up to six integer and nine fractional
  digits, without exponent notation. Sources/reasons allow 1–1,000 characters.
- Group daily expected part demand = saved installed quantity × group rate. Sum
  group contributions for each calendar day from cutoff + 1 through cutoff + horizon.
  Horizon demand = daily demand × horizon. PostgreSQL `numeric` performs all arithmetic;
  quantities and rates cross JSON/TypeScript boundaries as exact decimal strings.
  No order rounding, currency conversion, age adjustment or demand redistribution occurs.
- Population and rates remain constant. The applicability confirmation states that
  replacements restore the installed population rather than depleting it. Multiple
  replacements per installed unit are possible under an explicit expected-rate assumption;
  rates are not probabilities and are not capped at one.
- Results are fractional expected demand conditional on the supplied evidence, not
  learned failure forecasts or evidence of causality. No uncertainty bands, backtests,
  inferred growth, retirement or missing ages are calculated. Existing forecasts,
  policies, stock and orders are unchanged.

## Evidence and lifecycle

`installed_base_demand_preview` canonicalizes group order, whitespace and equivalent
decimal spellings, verifies the full group set, and returns copied population evidence,
group contributions, a daily ledger and a SHA-256 fingerprint. Unconfirmed previews
can be inspected; saving requires explicit applicability confirmation.

`installed_base_demand_save` accepts a client request UUID and the preview fingerprint.
First saves re-read and lock the population row, recheck authority after lock waits,
and reject changed evidence. Identical requests return the original record; a reused
UUID with different input, fingerprint or author fails. Retries recheck current editor
and location access, including after waits. New scenarios require a visible source.

Saved reports copy all population metadata, source declarations, original server
import time, known/unknown ages, supplied rates and results. The scenario has a
separate server save time. Neither timestamp verifies a source's historical availability
claim. Ages remain those at the original population as-of date. Corrections create
new scenarios. Current catalog names, units and population changes do not rewrite
captured inputs; separate scenarios are independent and never combined automatically.

The saved scenario retains its copy if the source dataset or catalog part is removed.
The UI then identifies unavailable original context and still displays copied evidence.
Organization/location deletion retains the existing cascade and audit behavior.

## Access and interface

Owners, admins and planners save through the guarded server actions and database RPC.
Members inspect through tenant and restrictive location RLS, including host-bound
organization claims. Viewers/approvers/branch users cannot save or retry. Direct table
mutations, anonymous access, service-role table access and worker access are revoked.
The private normalizer has no application execute grant. Audit records follow the
existing business-row trigger; one successful save creates one audit insertion.

Routes:

- `/forecasts/installed-base/[id]/demand`: create from one saved population.
- `/forecasts/installed-base/demand`: searchable, location/item-filtered, paginated history.
- `/forecasts/installed-base/demand/[id]`: copied evidence and immutable results.

Rates can be entered manually (25 groups per page) or imported as UTF-8 CSV (512 KiB,
up to 1,000 groups). Exact columns: `group_code,daily_rate,source,available_on`; dates
are ISO calendar dates. Require every saved group exactly once. Blank templates do
not invent assumptions. Template codes carry a uniform spreadsheet text marker to
prevent formula execution. The importer accepts the complete original or complete
marked code set; it never guesses between individual code aliases. Invalid uploads block preview/save and leave editable prior
values available for correction. Input changes hide an outdated preview/save action.

Group contributions paginate at 50 rows. Daily ledgers and detailed population evidence
are expandable. Tables scroll within focusable containers; use shared compact green
components, logical directions and typography at 375, 768, 1024, 1440 and 1920px in
English and Arabic RTL. This bounded calculation is synchronous; no worker job or
forecast schema is added.

## Verification and rollout

- `installed-base-demand.test.ts`: exact canonical input, zero/missing distinction,
  rate/date/horizon bounds, CSV duplicates/groups/Unicode/size checks.
- Installed-base demand server-action tests: active editor guard, bounded payloads,
  confirmation, exact strings, safe errors and redirect behavior.
- `0100_installed_base_demand.test.sql` plus privilege snapshot: exact group/day totals,
  availability, stable retries, tenant/branch roles, copied history, audit and cascades.
- `test_installed_base_demand_db.py`: Decimal oracles at tiny/maximum values and 1,000
  groups, independent-session duplicate/conflicting saves, authority/evidence changes
  during advisory and source-row waits, and retained-source retries.
- `installed-base-demand.spec.ts`: manual/CSV workflow, all five widths/RTL, keyboard
  table scrolling, scoped views, pagination and source deletion. CI retains screenshots
  under the existing `installed-base-*.png` artifact pattern.

Apply additive migration `20261021193000_installed_base_demand.sql` before deploying
the web bundle. Regenerate shared types from the local stack. Hosted migration and
deployment remain separate from this PR; no backfill or new operational integration
is required.
