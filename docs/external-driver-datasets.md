# External-driver datasets — Step 23

Approved 2026-10-21. This is the evidence foundation for external-driver forecasting.
It does not fit a model or claim a learned causal effect.

## Contract

Forecasts → External drivers → Import driver dataset accepts one catalog item,
one active permitted location and one named driver, with its supplied unit and
source/applicability notes. Choose 1–1,096 history days ending at the cutoff and
1–90 forecast days immediately after it. No demand or forecast is changed or read
implicitly; these are selected coverage windows, not a claim of complete sales.

Upload a UTF-8 comma CSV up to 512 KiB with exactly four headers (any order):
`date,value,kind,available_on`. Dates use `YYYY-MM-DD`. `kind` is `observed` or
`planned` (including forecast assumptions). Values are plain signed decimals,
up to 12 integer and 6 fractional digits; negative temperatures and explicit zero
are valid. No exponent, NaN, Infinity, thousands separators or implicit rounding.
Decimal strings remain exact throughout parsing, JSON, SQL and rendering.

Every row must fall within the selected window, with at most one row per date.
Invalid/duplicate rows reject the whole input. Gaps remain unknown and are shown
as missing days, never zeros. Original CSV bytes are parsed in the browser and
are not uploaded to Storage or retained. Canonical parsed evidence is saved only
after explicit preview and confirmation; the existing import retention job is
unchanged. Units are labels from the source, independent of the item's stock
unit, with no inferred conversion or aggregation.

`available_on` is a source-declared calendar date, not a server-verified timestamp.
An observed value cannot be declared available before its observation date.
The cutoff and declared availability must not be later than today's date in the
location's time zone. A historical dataset may contain retrospectively observed
values in its forecast window: these remain observed and are marked after cutoff.
Planned values can be declared before their target date. Same-day claims count as
declared by cutoff; this release makes no intraday availability claim.

Preview shows each date, period, exact value, kind, availability date and cutoff
classification. History/forecast counts separately show observed/planned values,
missing days and declared availability. These counts overlap by design: value type
and cutoff availability are independent dimensions. Daily evidence is paged in
50-row slices, including every missing day.

## Access and lifecycle

Owners/admins/planners save after confirming source/unit/label applicability.
Members inspect only within current tenant/location access. SQL validates inputs
independently, fingerprints catalog identity/name/status and location/time-zone
evidence, and refuses a changed preview on first save. No raw table writes are
granted. The new table uses the existing member and restrictive location RLS.

Each dataset is immutable for application roles. Corrections use a new request
and create independent evidence, with no automatic superseding or combination.
An organization/request UUID serializes concurrent retries; equivalent canonical
inputs and the same fingerprint/author return the original ID. Conflicting reuse
fails. Caller authority is checked again after waiting for the request lock.
Retries of saved evidence do not depend on live catalog content but still require
editor/location access. Server `created_at` records the first successful import
time independently of every declared availability date.

Saved item identity/metadata survives item deletion. Location/organization
deletion follows existing cascades and business-row auditing. History filters
driver name (literal substring), exact saved item/location codes and uses bounded
25-row pages. Counts and rows obey the same RLS; concurrent new saves can change
later page results. Hidden detail URLs return HTTP 404 without a streaming ancestor.

## Acceptance and verification

- AC-001: Valid CSV, including signed high-precision values and planned assumptions,
  previews and saves without numeric conversion. Invalid headers/dates/numbers,
  duplicates, empty/oversized inputs and impossible observation availability fail
  without partial saves. Verify parser units, database cases and browser upload.
- AC-002: Every selected date is inspectable. Missing dates remain null; after-cutoff
  observations and prior-known plans remain distinct. Verify SQL expected values,
  UI counts, paged ledgers and no forecast/policy/order writes.
- AC-003: Save requires confirmation and matching current preview; identical retries
  are stable and concurrent conflicts cannot overwrite evidence. Verify SQL,
  real-connection concurrency and browser edit/preview behavior.
- AC-004: Cross-tenant, stale-active-organization, viewer/approver writes and hidden
  locations are denied. Revocation applies to retries. Verify pgTAP, privilege
  inventory, real-session concurrency and HTTP 404/browser history visibility.
- AC-005: Saved evidence survives catalog edits/deletion unchanged; scope and parent
  cascades/audits remain enforced. Verify database lifecycle tests and history links.
- AC-006: Shared compact green header/type roles, keyboard tables, localized labels
  and contained overflow work at 375/768/1024/1440/1920px in English and Arabic RTL.
  Capture and inspect screenshots from the production browser workflow.

## Rollout

Owner reviews/applies `20261021090000_external_driver_datasets.sql` using
`pnpm exec supabase db push` before deploying the web build. It is additive and
does not rewrite existing business data. Rollback restores the previous web build
and retains the table/functions/evidence. No worker changes, hosted deployment,
external feed credentials, paid services or backfill are part of this PR.
