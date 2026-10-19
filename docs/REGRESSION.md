# UI regression ledger

## Mobile sidebar navigation

- `MOBILE-NAV-001`: ordinary navigation and brand-link activation dismiss the mobile drawer, including the active route. Modified clicks retain the drawer and desktop navigation retains collapse state. Verify English and Arabic RTL with `pnpm --filter web test:e2e mobile-sidebar.spec.ts responsive-planning.spec.ts dashboard-reference.spec.ts` against loopback fixtures. The generated sidebar primitive and all tenant/permission queries remain unchanged. See [mobile-sidebar-navigation.md](mobile-sidebar-navigation.md).

## Dashboard metrics

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

- Downstream consumers: forecast tabs/results/policies/events, ordinary/event purchasing and transfer flows, imports/wizard, Settings and Audit.
- Dependency evidence: the PageHeader/SectionLoading call scan above, thin forecast route wrappers and the standalone/embedded component props.
- Acceptance commands: `pnpm --filter web test:e2e`, `pnpm --filter web test:tabs`.
- Propagation: retain queries, contracts, mutations and permissions; run the complete browser suite when common headers/loading change, including empty, validation, independent review, stale evidence and read-only users. The tab suite also protects the existing document/form lifecycle and LTR/RTL keyboard behavior.

Final exit codes and screenshot evidence for this audit are recorded in [header-consistency.md](header-consistency.md). A green record requires actual command completion; unrun checks remain unverified.
