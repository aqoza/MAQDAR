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
- Reset clears unsubmitted edits even when already at the reset URL. Same-URL
  Reset remounts only that filter form locally and preserves sibling workflow
  drafts. URL-changing filters/reset/paging retain existing native/Next server
  navigation; draft retention is not promised across those transitions.
- Embedded workbench apply/reset/pagination retains `tab=workbench`; standalone
  routes remain supported. Local workflow tab switching retains draft values.
- Verify the production application at 1366×768 (compact laptop) and 390×844
  (mobile), in English and Arabic RTL. Supporting workflow suites retain their
  existing five-width coverage. Mobile text inputs remain 16px/24px and controls
  and disclosure targets at least 44px.
- Preserve exact decimals, source availability, unknown age/coverage, immutable
  saved evidence, manual assumptions, confirmations, tenancy and HTTP 404 guards.

Main advanced to PR #139 during this pass. Its newly merged installed-base
evaluation forms, saved reports and history are included in this same UI contract.
Their retrospective sales comparison and backend contracts remain unchanged.

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

The production Chromium matrix checks 18 routes at both target viewports in
English and real Arabic RTL (72 route/viewport/locale samples). It asserts shared
heading/value/caption sizes and line heights, nonempty role samples on saved
evidence, 12px/500 table headings, mobile control/disclosure targets and no document
overflow. Expanded forecast evidence is included; wide tables retain local scroll.

The populated driver, installed-base, conditional demand, evaluation, calendar and
event suites also inspect saved values, preview invalidation, exact-code payloads,
historical selection and tenant/location boundaries. Workflow tests exercise local
draft retention and embedded workbench apply/reset/pagination/Back/Forward. Same-URL
Reset is tested separately from full server URL/history transitions.

| Surface                    | English laptop                                                                       | Arabic mobile                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Forecast creation          | [1366×768](forecast-pages-visuals/forecast-create-en-1366.png)                       | [390×844](forecast-pages-visuals/forecast-create-ar-390.png)                       |
| Expanded forecast evidence | [1366×768](forecast-pages-visuals/forecast-result-en-1366.png)                       | [390×844](forecast-pages-visuals/forecast-result-ar-390.png)                       |
| Embedded workbench         | [1366×768](forecast-pages-visuals/workbench-en-1366.png)                             | [390×844](forecast-pages-visuals/workbench-ar-390.png)                             |
| Policy detail              | [1366×768](forecast-pages-visuals/policy-detail-en-1366.png)                         | [390×844](forecast-pages-visuals/policy-detail-ar-390.png)                         |
| Event policy               | [1366×768](forecast-pages-visuals/event-policy-en-1366.png)                          | [390×844](forecast-pages-visuals/event-policy-ar-390.png)                          |
| Evaluation detail          | [1366×768](forecast-pages-visuals/installed-base-evaluation-detail-en-1366x768.png)  | [390×844](forecast-pages-visuals/installed-base-evaluation-detail-ar-390x844.png)  |
| Evaluation history         | [1366×768](forecast-pages-visuals/installed-base-evaluation-history-en-1366x768.png) | [390×844](forecast-pages-visuals/installed-base-evaluation-history-ar-390x844.png) |

The [evidence record](forecast-pages-visuals/evidence.json) indexes 40 retained actual
screenshots, including populated driver, installed-base, conditional-demand and
calendar reports. The [computed typography samples](forecast-pages-visuals/typography.json)
record the 72-route matrix. Representative English desktop and Arabic mobile renders
were inspected directly; the evidence checker validates the record and artifact paths,
not visual correctness.

Checks passed locally:

- Production Next.js build, lint, typecheck, logical utilities and repository formatting.
- Full web unit suite: 181 files / 2,047 tests with two workers; simulation-worker: 13 tests.
- Engine non-database suite: 498 passed; 738 database cases deselected, not claimed as run.
- Local pgTAP: 102 files / 6,285 assertions.
- 34 unique relevant Playwright cases across the focused runs, including the
  72-sample matrix, dataset/evaluation evidence, local draft retention, search,
  permissions, planning workflows, Dashboard reference and shared headers.
  The final 10-case run passed after the same-URL Reset fix.
- Evidence-record validation and `git diff --check`.

The full web suite initially hit filesystem-scanning timeouts under concurrent
build/browser load. It passed with two workers; no test timeout or assertion was
weakened. The 17 broader planning/header cases ran before reconciling main's
PR #139; its newly affected evaluation pages and all changed history filters were
tested again afterward. All database fixtures used the isolated loopback stack.
No hosted configuration, migrations, actions, calculations or dependencies change
relative to main.

Limits: Chromium and emulated CSS viewports, without physical-device,
Safari/Firefox or screen-reader certification. Existing untranslated
copy still uses the established English fallback; new labels have Arabic entries.
Chromium reports native select line height as `normal` despite the shared CSS rule;
font size, bounds and mobile hit height are checked instead. No visual similarity
or test-coverage percentage is claimed.
