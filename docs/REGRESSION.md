# UI regression ledger

## Forecast search and comparison evidence

- `FORECAST-SEARCH-001`: `forecast-search-usability.spec.ts` verifies active-only readiness suggestions, inactive/manual historical quality codes, normalized code/name search, cancellation, visible loading/empty/error feedback, keyboard selection and tenant/branch isolation. Keep recent-run search explicitly scoped to the latest 20 authorized runs and use stable run-type codes across locales.
- `FORECAST-SEARCH-002`: quality search, reset, chips, display controls, paging and browser Back/Forward retain the embedded quality tab with one filter form; standalone quality remains supported. Expanded evidence uses full-row 14px headings and 12px metadata without changing exact scores or coverage meaning. Verify populated mobile keyboard scrolling as well as the truthful empty state. Run the new spec with `forecast-tabs.spec.ts`, `planning-kpis.spec.ts`, `planning.spec.ts` and `responsive-planning.spec.ts` against the local production build. Run queue-sensitive pgTAP and browser workers sequentially. Retain English/Arabic laptop, mobile and tablet screenshots; see [forecast-search-usability.md](forecast-search-usability.md).

## External-driver evidence

- `DRIVER-001`: `external-drivers.spec.ts` imports signed high-precision CSV values, rejects duplicates, distinguishes gaps/availability/types, invalidates changed previews and saves immutable evidence. Verify viewer/branch history and HTTP 404, five widths in English/Arabic, shared typography, keyboard tables and escaped source text. Run parser units, `0096_external_drivers.test.sql`, tenant/privilege inventories and `test_external_drivers_db.py` sequentially with browser tests against loopback only.

## Master-data table keyboard access

- `MASTER-TABLE-001`: populated master-data tables expose their translated entity name and a focusable horizontal scroll region. At 375px, keyboard users can Tab into the region and scroll to trailing monetary columns with ArrowRight; focus remains visible and the page does not overflow. Keep sort links, exact currency formatting and generated table primitives unchanged. Run `master-data.spec.ts` against local fixtures and retain the phone screenshot.

## Policy simulation conflicts

- `SIM-CONFLICT-001`: a blocked simulation submission must show simulation-specific active-run/request-reuse guidance, preserve the entered quantities and leave the original run queued. Do not display the generic organization-owner conflict copy. Run the simulation action tests and `pnpm --filter web test:e2e policy-simulation.spec.ts` against loopback fixtures. Database errors, tenant checks and queue limits remain unchanged.

## Mobile sidebar navigation

- `MOBILE-NAV-002`: drawer navigation and the brand link meet the 44px mobile target rule in English and Arabic RTL while labels remain 14px/20px and icons remain 16px. The 1366×768 checks retain 32px desktop rows and the shared 16px page title, then exercise collapse/navigation. Capture the open drawer so target density is reviewable. Run `mobile-sidebar.spec.ts`, `responsive-planning.spec.ts`, `dashboard-reference.spec.ts` and `page-headers.spec.ts` against the local production build. See [merged-header-mobile-targets.md](merged-header-mobile-targets.md).

- `MOBILE-NAV-001`: ordinary navigation and brand-link activation dismiss the mobile drawer, including the active route. Modified clicks retain the drawer and desktop navigation retains collapse state. Verify English and Arabic RTL with `pnpm --filter web test:e2e mobile-sidebar.spec.ts responsive-planning.spec.ts dashboard-reference.spec.ts` against loopback fixtures. The generated sidebar primitive and all tenant/permission queries remain unchanged. See [mobile-sidebar-navigation.md](mobile-sidebar-navigation.md).

## Dashboard metrics

- `DASHBOARD-PERF-001`: reuse the same-response location projection only when tenant/day/location and bounded row identities match. Older functions retain the authenticated legacy reads and unavailable states. Keep the five-row cap, exact decimals and strict two-second opt-in `DASHBOARD_SCALE=1` production-build gate, including populated location evidence inside the timer. Run `dashboard.spec.ts`, `dashboard-reference.spec.ts` and `dashboard-isolation.spec.ts` with local fixtures. Hidden/foreign location filters must return actual HTTP 404 before streaming; retain the complete dashboard response without an ancestor loading boundary. See [dashboard-read-scheduling.md](dashboard-read-scheduling.md).

- Downstream consumers: the Dashboard metric strip and its currency disclosure. Other pages do not use these classes; shared type tokens and headers are unchanged.
- Dependency evidence: `rg -n 'dashboard-metric|dashboard-currencies' apps/web/src` and `rg -n "dashboard.css" apps/web/src/app/globals.css` identify the stylesheet, DashboardMetrics and DashboardValuation.
- Acceptance commands: `pnpm --filter web test`, `pnpm lint`, `pnpm typecheck`, `pnpm check:logical`, `pnpm --filter web build`, and `pnpm --filter web test:e2e dashboard-reference.spec.ts responsive-planning.spec.ts`. Existing browser suites run sequentially against local fixtures or CI, never hosted tenants.
- Propagation: changes to metric layout require populated and empty dashboard checks at phone, tablet, laptop, desktop and RTL widths. Shared header/token changes additionally require the downstream suites below.
- Regression point: TEST-DASHBOARD-METRIC-001 requires single-line numeric values that fit their metric body and no page-wide overflow at 375, 768, 800 and 1024px. See [dashboard-metric-wrapping.md](dashboard-metric-wrapping.md).

Audit bases for the full header pass: `8a078f5`, then main `4707e36` including event batches, acknowledgements and the event integration workbench. Commands run from the repository root against a local production build and isolated local Supabase/Mailpit. Set `PLAYWRIGHT_BASE_URL` and `MAQDAR_TEST_DSN` for that stack. These browser suites share data infrastructure and run sequentially. No hosted mutation, merge or deployment is part of these commands.

## Shared header and loading

- `TYPE-001`: the owner-approved compact standard is 16px/24px/600 for page titles and 14px/20px/600 for compact record values. Browser suites use `e2e/helpers/typography.ts` as an independent expected contract, including the reported disposition-batch location, label, date and currency fields. Keep body/sidebar/action text at 14px/20px, mobile inputs at 16px/24px, and documented Dashboard/login exceptions. Run the full browser suite for shared token changes and retain laptop/mobile/Arabic RTL comparisons. See [compact-shared-typography.md](compact-shared-typography.md).

- `HEADER-006`: `page-headers.spec.ts` enforces the 12px maximum tagline-to-title gap for every section at desktop, laptop and mobile widths in English and Arabic RTL. The Forecasts workspace title must stay at the start of its heading row rather than inheriting vertical centering. The reported 1366px gap was 20px; use the current 16px/24px title role and preserve existing method/tab behavior. Run the section-header matrix, responsive planning, Forecasts tab workflows and header detail/loading checks. See [forecast-header-alignment.md](forecast-header-alignment.md).

- `EXCESS-HEADER-002`: after the PR #91/#92 integration, require each handoff, review and history/new destination exactly once rather than assuming there are only two actions. Verify every rendered link's visibility, 14px/20px typography, bounds and 44px mobile target; traverse the complete action sequence with the keyboard in LTR and RTL. Retain the five-viewport list/create matrix and existing workflow suites.

- `EXCESS-HEADER-001`: `excess-header.spec.ts` covers both grouped-action consumers (excess-stock list/create), shared 16px/24px titles and 14px/20px action text, locale font families, keyboard order, viewport bounds, and 44px mobile action targets. It checks 1280×800, 1366×768, 1440×900, 375×900 and 390×844 in English and Arabic RTL. The section-local fix changes only `ExcessStockHeader`'s action wrapper, with no shared CSS, navigation, loading or type-token change. Include `excess-stock.spec.ts` for preview/saved consumers and `excess-disposition.spec.ts` for the related review workflow, alongside the existing header/responsive/Dashboard/Settings suites. See [final-header-check.md](final-header-check.md).

- Downstream consumers: master data; Forecasts; Imports; ordinary/event Replenishment and transfers; Settings/Audit.
- Dependency evidence: `rg -n 'PageHeader|SectionLoading|PageHeaderArt' apps/web/src` and [the 117-route source inventory](header-consistency-visuals/routes.json). Master-data wrappers call ListScreen/EditScreen; the Forecasts workspace composes embedded section components under its existing banner.
- Acceptance commands: `pnpm --filter web test -- src/components/page-header-contract.test.ts`, `pnpm typecheck`, `pnpm check:logical`. The browser ledger below also requires existing hidden-record HTTP 404 assertions; do not add ancestor streaming that changes them to HTTP 200.
- Propagation: changes to PageHeader, header CSS, section loading or header navigation require every downstream UI command below. A type-only change still requires typecheck and the contract guard.
- Regression points: HEADER-001 (section pattern and bare-title guard), HEADER-002 (illustrated existing loading boundaries), HEADER-003 (reported transfer detail and route navigation), HEADER-004 (loading/RTL/compact geometry).
- HEADER-005 also checks early validation render branches, including invalid batch selections, so a missing title cannot bypass the guard by rendering no heading at all.
- HEADER-002 recognizes the shared `IntegrationWorkbenchHeader` wrapper used by Event Integration loading, and separately verifies that wrapper renders `PageHeader` with the replenishment pattern. A guard-only correction requires the contract tests and full unit suite; no header/loading implementation is changed or bypassed.

## Compact evidence typography

- Currency-specific excess-stock totals also use the value role. `excess-stock.spec.ts` checks rendered 14px/20px/600 values and the locale's font family in preview and saved Arabic evidence, including 1366×768 and 375px mobile. The title uses 16px/24px/600; table rows remain 14px. Run this suite alongside the header, responsive, Dashboard and Settings matrices for the merged-header audit. See [merged-header-verification.md](merged-header-verification.md).

- Downstream consumers: transfer freight, redistribution, replenishment, supplier/delivery scenarios, purchase costs and forecast policy/stock evidence cards. The shared `text-evidence-value` role is 14px/20px semibold at every viewport; Dashboard KPIs retain their separate tokens.
- Dependency evidence: `rg -n 'text-evidence-value|styles.metrics' apps/web/src`. Quantities, money and dates keep their existing formatters and data contracts.
- Acceptance commands for a value-role-only correction: lint, strict types, unit tests, logical utilities, production build, and `pnpm --filter web test:e2e header-consistency.spec.ts responsive-planning.spec.ts dashboard-reference.spec.ts page-headers.spec.ts`. Inspect actual transfer and purchase screenshots at desktop/laptop/mobile and Arabic RTL. Retain the full-suite requirement above whenever header composition, navigation or loading changes.

## Master data

- Downstream consumers: Items/Brands/Supersessions/Interchanges, Locations/Network/Calendars/Holidays, Suppliers/Supplier items/FX rates, including create/edit wrappers.
- Dependency evidence: `rg -n 'ListScreen|EditScreen' 'apps/web/src/app/(app)'` and `AREA_TABS` in `src/components/master-data/area-tabs.tsx`.
- Acceptance command: `pnpm --filter web test:e2e` (master-data, header and responsive cases).
- Propagation: shared edit/header changes require all master-data, header and responsive workflows; no business-query exemption is inferred from a green source scan.

## Planning, Imports and account administration

- `FORECAST-003`: `forecast-pages-consistency.spec.ts` checks remaining Forecasts
  forms, saved forecast/policy/stock/event evidence and driver/installed-base
  histories in the real production app at 1366×768 and 390×844, English and Arabic.
  Assert 16px titles, 14px subsection/value roles, 12px/500 table headings, no page
  overflow and 44px mobile controls/disclosures. Preserve exact saved values.
  `forecast-tabs.spec.ts` checks active-only suggestions and draft retention for
  every workflow; `policy-workbench.spec.ts` checks embedded apply/reset/paging and
  Back/Forward plus standalone behavior. Driver/installed-base suites retain
  preview invalidation, exact-code submission, historical lookup, scoped HTTP 404
  and their existing responsive/RTL cases. Include newly merged installed-base
  evaluation history, creation and saved reports in `installed-base-evaluation.spec.ts`.
  See
  [forecast-pages-consistency.md](forecast-pages-consistency.md). These are
  presentation/lookup refinements; no action/RPC/calculation changes are authorized.

- Driver forecasts (Step 23b): `driver-forecasts.spec.ts` queues from captured sources,
  publishes through the worker boundary, checks viewer/hidden-location access and
  retains form/result screenshots at all five widths in English and Arabic. Run
  `test_driver_forecasting.py`, `test_driver_forecasts_db.py` and
  `0097_driver_forecasts.test.sql` for availability, holdout, retry and lease gates.
  Keep the legacy forecast evidence schema used by purchase/export APIs unchanged;
  the extended read schema serves forecast results and saved quality only.

- Downstream consumers: forecast tabs/results/policies/events, ordinary/event purchasing and transfer flows, imports/wizard, Settings and Audit.
- Dependency evidence: the PageHeader/SectionLoading call scan above, thin forecast route wrappers and the standalone/embedded component props.
- Acceptance commands: `pnpm --filter web test:e2e`, `pnpm --filter web test:tabs`.
- Propagation: retain queries, contracts, mutations and permissions; run the complete browser suite when common headers/loading change, including empty, validation, independent review, stale evidence and read-only users. The tab suite also protects the existing document/form lifecycle and LTR/RTL keyboard behavior.

Final exit codes and screenshot evidence for this audit are recorded in [header-consistency.md](header-consistency.md). A green record requires actual command completion; unrun checks remain unverified.

- Multi-driver forecasts (Step 23c): run `0098_multi_driver_forecasts.test.sql`,
  `test_multi_driver_forecasting.py`, `test_multi_driver_forecasts_db.py`,
  `multi-forecast-actions.test.ts` and `multi-driver-forecasts.spec.ts`. Cover 2/5
  drivers, an independent ridge oracle, constant/collinear inputs, no availability
  leakage, canonical concurrent retries, revoked authority, immutable deletion-safe
  capture and fenced publication. Exercise the real bounded numerical child,
  quality filtering, five widths and Arabic RTL; inspect saved screenshots.
  Keep Step 23b suites and frozen policy/export/OpenAPI contracts unchanged.

## Installed-base evidence

- `BASE-001`: `installed-base.spec.ts` validates CSV duplicates, exact installed
  quantities, unknown ages, both confirmations, stale previews, immutable history,
  filters/pagination and viewer/branch HTTP 404. Capture and inspect form, detail
  and history at 375/768/1024/1440/1920px in English and Arabic RTL.
- Run `src/lib/installed-base.test.ts`, the installed-base server-action tests,
  `0099_installed_base.test.sql`, tenant/privilege invariants and
  `engine/tests/test_installed_base_db.py`. Keep database tests and browser fixtures
  sequential against loopback only. Check canonical/concurrent retries and revoked
  authority after waits, catalog changes/deletion and no operational writes.

- `BASE-002`: `installed-base-demand.spec.ts` validates manual rates and CSV imports,
  explicit zero versus missing assumptions, late evidence, confirmation, stale preview
  hiding, exact fractional expectations, daily/group evidence, source deletion and
  scoped paginated history. Capture form/detail/history at all five widths and Arabic
  RTL; verify keyboard scrolling and inspect representative screenshots.
- Run `installed-base-demand.test.ts`, its server-action tests,
  `0100_installed_base_demand.test.sql`, privilege/tenant invariants and
  `test_installed_base_demand_db.py`. Include maximum/tiny decimal oracles, 1,000
  groups, concurrent retries and revoked authority/evidence changes during both
  advisory and source-row waits. Keep shared database and browser suites sequential.

## Installed-base evaluations (Step 24c)

- Run `installed-base-evaluation.spec.ts` with production build and the local stack.
- Check confirmed complete history, matching known units, stale-preview recovery,
  exact daily differences, separate lost sales and copied scenario evidence.
- Verify search/pagination, viewer/branch HTTP 404 boundaries and retained captures
  after source deletion; never add an ancestor streaming loading boundary.
- Retain form/detail/history screenshots at 375, 768, 1024, 1440 and 1920px in
  English and Arabic RTL. Preserve shared 16px page titles and keyboard ledger scrolling.
