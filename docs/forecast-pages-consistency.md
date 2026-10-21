# Forecast pages consistency

This follows the approved search and compact evidence treatment in PR #138 across
the remaining Forecasts workflows. The primary task is selecting an authorized
location, filtering saved evidence and inspecting the complete original result.
The direction remains compact, quiet and practical; no new forecasting rules,
queries, dependencies or backend capabilities are introduced.

## Acceptance contract

- Retain the shared illustrated Forecasts header, 16px/24px page and section
  titles, 14px/20px subsection titles and primary records, and 12px/16px table
  headings and supporting metadata. Table headings use weight 500. Do not shrink
  primary quantities, exact money or actionable confirmation copy.
- Reuse session-scoped code/name suggestions in classification, forecasting,
  preparation, workbench, external-driver and installed-base workflows. New
  workflow suggestions are active-only. Historical filters also support inactive
  and manually entered saved codes. The existing server actions retain authority.
- Keep search and location controls flexible, labeled and individually clearable.
  Filtering remains explicit. Distinguish an empty history from no matches.
- Reset clears unsubmitted edits even when already at the reset URL. Remount only
  that filter form, preserving its existing native/Next submission, navigation and
  sibling workflow drafts.
- Embedded workbench apply/reset/pagination retains `tab=workbench`; standalone
  routes remain supported. Local workflow tab switching retains draft values.
- Verify the production application at 1366×768 (compact laptop) and 390×844
  (mobile), in English and Arabic RTL. Supporting workflow suites retain their
  existing five-width coverage. Mobile text inputs remain 16px/24px and controls
  and disclosure targets at least 44px.
- Preserve exact decimals, source availability, unknown age/coverage, immutable
  saved evidence, manual assumptions, confirmations, tenancy and HTTP 404 guards.

## Content states to verify

| State      | Trigger, feedback and next action                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| Loading    | Location lookup visibly reports progress; a later query cancels the older request.                     |
| Empty      | An empty dataset says nothing is saved; a filtered history reports no matches and permits reset.       |
| Error      | Lookup failure preserves the typed code and provides retry/manual-code guidance.                       |
| Partial    | Missing coverage, dates, ages and excluded driver evidence remain explicit rather than inferred.       |
| Success    | Filters return the authorized saved records; exact values and complete disclosures remain inspectable. |
| Permission | Existing viewer restrictions, location-scoped lookup and hidden-record HTTP 404 remain enforced.       |

## Verification

Results and actual screenshots are recorded here after the checks complete.
Chromium screenshots are browser evidence, not certification on a physical
13-inch device, Safari or a screen reader.
