# Forecast search and compact evidence

The approved proposal is the local Forecasts mockup reviewed on 2026-10-21. Its purpose is to help planners choose a location and find saved forecasting evidence with the existing shared type scale. The source reference is the user's three screenshots and the interactive proposal at `forecast-refinement/index.html` in this chat's visualization workspace.

## Design and behavior contract

- Page and section titles remain 16px/24px. Nested comparison headings become 14px/20px; supporting notes and training/test metadata use 12px/16px. Primary item identifiers and scores stay 14px/20px. No shared app/sidebar scale changes.
- Quality: wide item search, code/name location suggestions, Result filter, progressive Model/Method filters, result display controls, removable applied filters and clear/reset. Searching via Enter, reset, chips, page-size/order changes and pagination retain the embedded quality tab and URL state; the standalone route remains compatible.
- Evidence: the primary row stays scannable. Its disclosure opens across the table's full width, preserving exact saved scores, unit labels, comparison windows, independent evaluation model and coverage interpretation.
- Readiness: a bounded searchable location chooser submits the existing exact active code. It starts a new demand check; it is separate from recent-history filtering.
- Recent runs: wider search, clear, run type/status filters and live matching count. The visible scope remains the latest 20 authorized runs; this change does not add an archive query.
- Localized text and labels use next-intl. Verify actual English and Arabic locales at 1366×768 laptop and 390×844 mobile widths. Inputs retain 16px mobile text and at least 44px targets. Tables scroll locally rather than overflowing the page.
- Access: use the session server client and active organization for lookup; retain location RLS, bounded results, no-store responses, query bounds and stale-request cancellation. Historical quality supports inactive/manual saved codes. No database/RPC/forecast-calculation changes are required.

## State and verification requirements

Lookup has loading, no-match and recoverable-error feedback with manual code entry. Quality distinguishes no saved data from no filter matches and retains unavailable scores/evidence as unavailable. Existing permission/read-only and active-run states remain. Verify keyboard suggestion selection, clear/focus, stale request isolation, empty filters, tab/URL restoration, precise decimal display and tenant/branch denial using only the isolated local Supabase stack.

## Implementation

The lookup reads at most 20 code/name matches through the existing session server client, active organization and location RLS. It searches normalized tokens, debounces requests, cancels stale work and returns private no-store responses. Readiness remains an active-code submission; quality permits inactive catalog entries and valid historical codes. The browser never receives a privileged Supabase client. There are no migrations, new RPCs or calculation changes.

Quality filtering remains server-rendered with URL state. Search, filter removal, reset, display controls and pagination retain the embedded quality tab; browser Back/Forward restores one filter form. Local workflow-tab switches continue preserving form drafts without navigation. Run types use stable codes independently of translated labels.

Comparison evidence occupies a separate row across the table. The laptop layout reserves space for its disclosure control, tablet filters use two flexible columns, and mobile controls retain the shared input and touch-target sizes. Header actions wrap below the title when the sidebar leaves too little horizontal space. English and Arabic labels cover the touched controls and run-result links.

## Visual evidence

The retained images use synthetic fixtures in the actual local production application, not the proposal's HTML. Browser viewports are 1366×768, 390×844, 768×844 and 800×844; full-page captures also show content below the viewport. They verify compact comparison typography, readable primary values, local table scrolling, searchable locations, filter disclosures and real Arabic RTL text.

| Surface                                    | English                                                                                                                        | Arabic RTL                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Laptop quality evidence                    | [1366px](forecast-search-visuals/forecast-quality-en-1366.png)                                                                 | [1366px](forecast-search-visuals/forecast-quality-ar-1366.png)                                                                 |
| Mobile quality evidence                    | [390px](forecast-search-visuals/forecast-quality-en-390.png)                                                                   | [390px](forecast-search-visuals/forecast-quality-ar-390.png)                                                                   |
| Laptop run search and location suggestions | [1366px](forecast-search-visuals/forecast-runs-en-1366.png)                                                                    | [1366px](forecast-search-visuals/forecast-runs-ar-1366.png)                                                                    |
| Mobile run search and location suggestions | [390px](forecast-search-visuals/forecast-runs-en-390.png)                                                                      | [390px](forecast-search-visuals/forecast-runs-ar-390.png)                                                                      |
| Embedded tablet filters                    | [768px](forecast-search-visuals/quality-workspace-en-768.png), [800px](forecast-search-visuals/quality-workspace-en-800.png)   | [768px](forecast-search-visuals/quality-workspace-ar-768.png), [800px](forecast-search-visuals/quality-workspace-ar-800.png)   |
| Standalone tablet filters                  | [768px](forecast-search-visuals/quality-standalone-en-768.png), [800px](forecast-search-visuals/quality-standalone-en-800.png) | [768px](forecast-search-visuals/quality-standalone-ar-768.png), [800px](forecast-search-visuals/quality-standalone-ar-800.png) |
| Standalone mobile disclosure               | [390px](forecast-search-visuals/quality-standalone-en-390.png)                                                                 | [390px](forecast-search-visuals/quality-standalone-ar-390.png)                                                                 |

Visual inspection compares the hierarchy and density with the approved proposal and the user's screenshots. It does not claim a measured perceptual similarity percentage. Browser coverage is Chromium; Firefox, Safari and real-device assistive technology were not tested. Test fixtures do not represent customer data. No merge or deployment is part of this change.

## Verification

Verified locally on 2026-10-22:

- Production Next.js build, TypeScript, ESLint, formatting and logical CSS checks pass.
- Web unit suite: 1,996 tests in 176 files pass. Simulation-worker suite: 13 tests pass. A final focused rerun of lookup access, quality navigation and numeric-formatting tests also passes (16 tests). Coverage was not collected.
- All 100 existing pgTAP files have passing results. The first run passed 93 files while seven planning-queue files collided with concurrently running browser workers. After stopping the browser runner and completing its one stale synthetic job, the seven files pass alone (264 assertions). Queue-sensitive suites must run sequentially, as they already do in CI. No database or application changes were made to accommodate this test interference.
- All 18 selected production-browser cases pass across focused sequential runs: the five new cases, two existing forecast-tab cases, the KPI/evidence case, five planning workflows and five full-app responsive cases (375/768/1024/1440/1920px). These verify exact decimals, unavailable scores, actual Arabic RTL, drafts, URL history, queue/cancel behavior and populated quality-table keyboard scrolling. Existing assertions and worker timeouts remain intact. A cold local regional fit completed in 104.8s, just beyond the existing 100s test-process limit; its focused rerun passes at the unchanged limit.
- The [rendered evidence record](forecast-search-visuals/evidence.json) passes the installed ECC frontend evidence checker. The 18 retained screenshots were visually inspected; the record does not substitute for that inspection.

The browser acceptance command is `pnpm --filter web exec playwright test e2e/forecast-search-usability.spec.ts e2e/forecast-tabs.spec.ts e2e/planning-kpis.spec.ts e2e/planning.spec.ts e2e/responsive-planning.spec.ts`. Use only loopback Supabase/Mailpit fixtures and complete pgTAP before starting browser workers. The existing CI runs the complete browser suite; the remaining unrelated browser suites were not rerun locally.
