# Dashboard reference implementation: approval plan and functional gaps

Status: Track A approved by the owner on 2026-10-17 and implemented on `feat/step-dashboard-reference`. Track B remains recommendations only. The inspection below records the pre-implementation state; see [dashboard-reference-verification.md](dashboard-reference-verification.md) for implementation and verification results.

## Scope and inspection status

Reproduce the supplied dashboard in the actual authenticated Next.js application. The attachment is the visual authority; its sample numbers are not business requirements or fixtures for production. Track A is one frontend PR. Track B contains recommendations requiring separate approval.

The supplied PNG is **1672 × 941 pixels**, verified from the file. Use this native viewport as the primary visual comparison and also verify the requested approximate **1648 × 928** viewport. The reference places the two lower tables **side by side beneath the chart**, with insights and the decorative card in a separate right column.

Inspected:

- `CLAUDE.md` and `docs/PLAN.md`, including session protocol and owner-approved metric definitions.
- `apps/web/src/app/(app)/dashboard/page.tsx`, `components/dashboard-demand-chart.tsx`, `lib/dashboard.ts` and its unit tests.
- Application/root layouts, app sidebar, organization switcher, page header, global/workspace CSS and generated Base UI button/card/sidebar components.
- `dashboard_kpis`, the original dashboard contract, generated RPC types, and `supabase/tests/0035_planning_kpis.test.sql`.
- Dashboard, planning KPI, responsive and smoke Playwright suites; Playwright configuration; locale resolution, message namespaces, English/Arabic messages and direction handling.
- Planning KPI, transactions/dashboard, inventory-policy, stock-comparison and replenishment documentation; saved forecast-quality query and navigation.

ECC `intent-driven-development` was verified in the current session catalog and its complete installed SKILL.md was read and applied to this plan. Implementation/test/review skills will be read when those stages begin; no implementation or automated review is claimed here.

### Checkout and environment

The working checkout is on `codex/step-16b-transfer-dates` at `2888553` (merged PR #38), with active, unrelated transfer-date changes. Its local `origin/main` initially pointed at the same commit. GitHub's connector reports current `main` at `747d39d3db75f72c76b15805430b4d5aa9841ac5`, PR #39, adding forecast workspace tabs. Direct sandbox Git network access failed; GitHub inspection succeeded. No pull, reset, stash or branch switch was performed in this dirty checkout.

After approval, use a suitable isolated managed worktree based on verified current `main`, following the repository branch convention (`feat/step-N-<slug>`) with a descriptive dashboard slug. Re-read instructions and relevant files on that base. Keep every unrelated working change out of the dashboard PR. Do not include or modify transfer-date migrations or generated database types.

Node, pnpm, uv and Docker are installed, web dependencies are present, and `.env.local` points to loopback Supabase. Read-only Docker inspection confirmed the ZeeSpare database/auth/REST/gateway services are running. The vector container is restarting; application/browser readiness remains to be verified. No credentials were printed. No tests, application screenshots or similarity measurements have run for this task yet.

## Reference geometry and visual tokens

Initial pixel-edge readings below are from the native screenshot, with approximately 1–2px uncertainty at softened edges. These are a starting measurement sheet, not a claim to know the source CSS or font. Refine against browser screenshots rather than applying arbitrary spacing.

| Region              | Native screenshot bounds / treatment                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar             | x 0–247; approximately 248px wide; full height; logo near (25,16); navigation begins near y 139                                                                           |
| Main content        | x 275 to 1651; approximately 1376px; 27px inset after sidebar, 21px outer end space                                                                                       |
| Header              | Compact actions in top ~58px; trigger near (275,14); actions near y 11, 36px tall                                                                                         |
| Heading             | x 284, top about 60px; roughly 40px title, 16px subtitle near y 112                                                                                                       |
| Filter surface      | (275,149), about 1376×88px; 22px inline padding; 36px controls                                                                                                            |
| Unified KPI surface | (275,249), about 1376×107px; five compact cells, four vertical dividers; no individual outer cards                                                                        |
| Main chart card     | (275,372), about 1066×280px; chart plot about x 351–1318, y 440–595                                                                                                       |
| Insights            | (1357,372), about 294×398px; four separated compact rows                                                                                                                  |
| Location table      | (275,668), about 538×251px                                                                                                                                                |
| Risk table          | (829,668), about 512×251px                                                                                                                                                |
| Lower right panel   | (1357,782), about 294×139px                                                                                                                                               |
| Major gaps          | 16px between content columns and lower cards; 12px from filters to KPIs; 16px from KPIs to content                                                                        |
| Card surfaces       | Near white, approximately 12–14px radius, very light borders; restrained or absent shadow                                                                                 |
| KPI typography      | Approximately 13px labels, 24px values, 12px explanations; 54–56px icon tiles                                                                                             |
| Content typography  | Approximately 20px chart title; 16px other panel titles; 12–14px controls/table/body; compact 32px table rows                                                             |
| Colors              | Navy text, muted slate-blue secondary text; deep green actions; emerald sold series with translucent fill; orange lost-sales series; pale green/blue/red icon backgrounds |

Sampled pixels include canvas `#F2F7F7` at (260,500), inter-card canvas `#F1F7F7` at (1000,365), white input surface at (1000,183), and table header `#F8FAFB` at (1100,730). Gradients and antialiasing mean a single pixel is not a universal token. Retain Inter and Noto Sans Arabic initially; the raster does not establish an exact font identity.

Use named dashboard tokens for sidebar width, shell spacing, column width, card radius, row density, typography and colors. Scope dashboard surfaces/large title to this route; do not globally replace the approved compact 20px titles on other screens. Adapt the shared sidebar/header through explicit presentation hooks while keeping their behavior. At smaller widths, collapse columns and wrap the unified strip without page overflow; wide tables scroll within accessible regions. Preserve logical CSS properties and RTL mirroring.

No source brand/world-map/wave artwork was found; the only repository image found is the existing monogram `icon.svg`, which differs from the reference cube. Faithful logo and decorative asset reproduction is part of Track A. Document residual artwork differences if the supplied raster cannot establish exact vector geometry; do not invent additional decoration.

## Semantic differences that must remain truthful

1. **Observed pairs are stock observations.** They are not pairs with demand. Unobserved means missing stock snapshots, not no observed demand. Preserve the documented definition in subtitles and accessible explanations.
2. **Availability is available / observed.** Available means physical quantity minus allocations is positive. Missing stock stays unknown. A location table must expose available/observed and separately identify missing coverage; it must not silently use the full catalog cross-product as its denominator.
3. **Stock-outs are current observed zero/negative available stock.** That count is not a forecast-based at-risk count. The screenshot uses similar wording for different concepts; keep them separate.
4. **Stale observations remain in dashboard totals but are flagged.** Strictly more than seven days is stale. Stock comparison and replenishment have different eligibility rules; neither can be silently generalized into a current risk measure.
5. **Valuation is physical stock × snapshot-supplied unit cost, separated by currency.** Preserve exact decimal strings and the existing three-decimal dashboard display. Do not turn several currencies into the sample `$1.26M`. A compact currency selector/summary may display one explicitly identified currency with every exact total accessible; never combine currencies or silently discard them.
6. **The 30-day demand series has its existing contract.** It includes the reporting day and prior 29 days, separates sold/lost quantities, and includes readable inactive historical entities. It is not a stock-cohort denominator and cannot provide a unit-safe risk calculation by itself.
7. **No sample trend is authoritative.** The screenshot's changes and example values are not sufficient to define comparison periods, population consistency, zero-baseline behavior or percentage points versus relative percentages.
8. **Warnings take precedence over fixed-height clipping.** Missing, stale, error and multi-currency states may need more height than the ideal reference. Preserve the normal-state composition and document these deliberate variations.

## Functional gap assessment

Priorities: P0 = needed for truthful Track A; P1 = essential to make all pictured business features operational; P2 = operational improvement; P3 = advanced capability.

| Reference feature                | Current implementation                                                                                                      | Missing functionality                                                                         | Proposed implementation                                                                                                               | Priority |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Sidebar, header and composition  | Functional Base UI sidebar, organization switching, role-gated routes and 44px header; separate KPI cards; full-width chart | Reference geometry, branding, action treatment and asymmetric grid                            | Scoped presentation changes; preserve providers, forms, permissions and routes                                                        | P0       |
| KPI trend comparisons            | Current-day or selected-day values only                                                                                     | Prior-period access/comparison contract, delta calculations and annotations                   | Neutral unavailable trend treatment in A; approved comparison contract in B                                                           | P1       |
| Inventory valuation/currency     | Exact per-currency RPC totals and formatter                                                                                 | Compact multi-currency presentation; no approved single consolidated value                    | Reuse exact totals with explicit currency and access to all totals; no FX                                                             | P0       |
| Demand chart interactions        | Recharts lines, generic tooltip, legend, accessibility layer and daily table                                                | Reference fill/dots/grid/tooltip, period display and refined interaction                      | Restyle existing 30-day series; preserve keyboard/table access; date control uses existing reporting filter                           | P0       |
| Stock availability by location   | `dashboard_kpis` already accepts one location; no multi-row widget                                                          | Location list and bounded per-location orchestration; no aggregate location RPC               | A: maximum five visible active locations, stable code order, existing KPI calls; B: batch projection if needed for scale              | P0/P2    |
| Items at risk of stock-out       | Forecast results, stock snapshots, policies and saved replenishment drafts exist separately                                 | Risk read model, eligibility/selection policy, threshold and ranking                          | Full table structure with unavailable explanation in A; separately approved risk service in B                                         | P1       |
| Forecast-based inventory risk    | Saved daily forecasts, bands, immutable unit provenance                                                                     | Approved forecast-as-of choice, aligned stock date, completeness, inbound/backorder treatment | Define a versioned risk contract before implementing; reuse saved evidence rather than live catalog inference                         | P1       |
| Days of cover / days left        | No dashboard calculation or RPC located                                                                                     | Depletion algorithm, rounding, zero-demand and beyond-horizon semantics                       | Unavailable in A; explicit time-phased calculation proposal in B                                                                      | P1       |
| Planning insights                | No dashboard insight feed                                                                                                   | Comparison/risk facts, prioritization and evidence references                                 | A: four compact rows using current coverage/stock facts and explicit unavailable states; B: deterministic evidence-backed insights    | P0/P1    |
| Forecast quality                 | Existing scoped `/forecasts/quality`, saved metrics and result links                                                        | Dashboard integration/context                                                                 | Keep header link and contextual entry; retain distinction between selection scores and held-out coverage                              | P0       |
| Contextual navigation            | Dashboard links to quality/import/audit; existing planning/master-data routes                                               | Widget links and selected-location propagation                                                | Link location rows to filtered dashboard, actual evidence to existing detail pages; disable unsupported destinations with explanation | P0       |
| Date/location filters            | URL-driven server GET form, validated dates, exact visible active location code, reset                                      | Reference control presentation and location suggestions                                       | Preserve contract; add bounded server-read active location choices with exact-code entry retained for larger lists                    | P0       |
| Empty/loading/stale/error states | Empty explanation, no-observation unavailable ratio, stale notices; errors throw; no dashboard-specific loading/error files | Card-preserving loading, safe retry, partial widget failure and explicit unsupported state    | Add route-local localized states, preserve not-found behavior and coverage warnings                                                   | P0       |
| Decorative panel/header art      | Absent                                                                                                                      | Logo, pale global-map/waves, informational copy                                               | Reproduce only reference artwork; present as decorative/accessibly hidden where appropriate                                           | P0       |
| Notification bell                | No dashboard notification feed located                                                                                      | Alerts, unread status, history and delivery rules                                             | Represent unavailable capability without fake unread indicator; operational notifications require separate scope                      | P2       |

### Dependencies, business rules, security and complexity by gap

Complexity is relative implementation effort: S = local presentation/query wiring; M = several components plus integration tests; L = new domain contract, data access and substantial numerical/security validation. These are not calendar estimates.

**G1 — Shell and visual structure (M).** Existing navigation/switcher/auth remain the implementation foundation. Change app-owned components and styles, not generated `components/ui` internals. No query, RPC or database change. Dashboard-specific large title is an intentional exception to the current 20px-title test. Update that assertion only for this route; retain other pages' expectations, mobile drawer focus/keyboard behavior, account switching and role gates. Styling must not leak after client navigation.

**G2 — KPI trends (M–L).** Existing RPC can retrieve another date, so a basic comparison does not necessarily need a new RPC or schema. What is missing is an approved rule: comparison date/window; current versus historical cohort; percentage-point versus relative change; zero/missing baseline; coverage quality; per-currency alignment. Current stock queries use today's catalog even for past reporting dates, so they cannot claim reconstructed historical membership. Historical catalog snapshots would need additional backend persistence if required. Reuse `dashboard_kpis` and exact decimals after approval; avoid doubling heavy reads per metric. Every comparison must share tenant/location scope. Track A performs no speculative comparison.

**G3 — Compact currency presentation (M).** Existing `inventory_value` and `formatInventoryValue` are sufficient; no new RPC/schema or financial formula is needed. Reuse exact strings and explicit currency codes. Allow a compact chosen-currency view with an accessible list of all exact totals, or expand when necessary; choose based on the actual screenshot iteration without hiding data. Handle large numbers and Arabic numbering without `Number` conversion. FX aggregation, rates and monetary trends are separate business scope. Read only the user's scoped summary.

**G4 — Chart controls (M).** Existing30-day payload is sufficient for appearance, hover/focus tooltip, dates and accessible table. No new RPC/schema. The pictured range control initially represents only the supported 30-day interval; changing the reporting date changes the interval end. Do not offer nonfunctional 90-day/custom options. Longer ranges would require a reviewed query/interface extension and payload bounds. Reuse the date-only UTC formatter and Recharts; exact table amounts remain strings while plot coordinates use numbers. Never use this cross-item series for risk, valuation or forecast accuracy calculations.

**G5 — Location availability (M for A, M for batch B).** Query active visible locations with explicit organization filtering and RLS; show up to five in stable code order, clearly a preview rather than a best/worst ranking. Call existing `dashboard_kpis` with the same day for each row, at most five calls, and reuse the primary result when the location is already selected. Preserve available/observed, unknown coverage and stale flags. No new business formula/schema/RPC is required for A. Existing calls redundantly compute demand, so measure the added cost; do not issue a call for every location. If the bounded approach fails the latency budget, report that result and request approval for a set-based invoker RPC instead of silently adding backend logic. A batch RPC would require a reviewed migration/grants/tests, but no new business table. All rows and counts must stay inside branch scope; failed reads are unavailable, not zero. Existing Locations is a catalog destination, not falsely labeled as a complete availability report.

**G6 — Forecast risk and at-risk table (L).** Stock, daily forecast evidence, policy selections and replenishment reports are reusable inputs, not an existing risk model. Decide the risk definition/horizon, eligible saved forecast, reporting cutoff, freshness, stock coverage, treatment of allocations/backorders/inbound, unit matching and tie-breaking. Do not automatically select the newest policy or treat a saved replenishment gap as a probability or arrival guarantee. Individual and prepared-group evidence need distinct eligibility; pooling is only valid under documented saved two-way 1:1 rules. A bounded, tenant/branch-scoped projection or RPC is recommended after approval; a migration is likely for the read interface, while new tables are needed only if decisions/evaluations are persisted. Validate source coverage before ranking so missing evidence cannot make the risk count appear low. Avoid loading all daily evidence JSON on the dashboard. A contains headings/columns and a truthful unavailable body, without invented item rows or days-left badges.

**G7 — Days of cover (L, depends on G6).** No implementation was found. Decide between a mean-rate ratio and exhaustion against the saved daily forecast; neither is authorized yet. Define fractional/whole-day presentation, zero/negative available stock, zero forecast demand, partial horizons, unknown units, and what “beyond horizon” means. Do not display infinity/zero for missing evidence. Reuse daily forecast output and exact stock quantities; implement exact server-side arithmetic in the approved risk interface. A read-only calculation needs no table, but its RPC requires a migration and numerical/tenancy tests. Keep probabilistic risk separate from deterministic point-forecast depletion.

**G8 — Insights (M–L).** A can restate actual current availability, observed stock-outs, missing snapshots and stale coverage using the loaded summary; this needs no RPC, database change or new risk calculation. Wording must say current fact, not improvement or predicted risk. Preserve the four-row visual pattern, links and explicit missing-dependency messages. B needs G2/G6/G7, approved severity/order rules, source references and clear observation times. A deterministic read-only resolver is sufficient initially; persistence, dismissal, scheduled alerts or a separate insight API need additional approval. No LLM or new external service is required. Scope every input and link; never reveal hidden location names in explanations.

**G9 — Quality and contextual links (S–M).** Reuse `forecast_quality` and existing filtered URLs/results. No new schema/RPC for linking. Pass supported location parameters; do not imply a destination honors a dashboard date parameter when it does not. Do not manufacture a portfolio accuracy percentage by averaging item RMSE/MAE. Saved model-selection scores and separately evaluated interval coverage retain their respective windows and caveats. Import links stay editor-only; audit stays owner/admin-only; actual detail queries remain the authorization boundary.

**G10 — Filters (M).** Reuse URL state, `dashboardParams`, `reportingDay`, `next/form` and the existing RPC. A bounded location query is new data-access wiring, not new business logic; no migration needed. Code entry remains possible beyond the suggestion limit. Unknown, inactive and inaccessible codes retain indistinguishable not-found handling. Dates remain organization-zone business dates and future/malformed input retains current validation. No browser Supabase client or session-refresh mechanism is added. Apply/reset and widget links must propagate the same intended scope.

**G11 — State handling (M).** Reuse current empty/null and freshness fields. Add localized skeletons, route retry and individual location-widget failures without raw database messages. No new query/schema required. Maintain no-data versus known zero versus unsupported versus failed distinctions. Keep freshness and missing-coverage evidence visibly discoverable; actionable stale warnings cannot be hidden just to preserve height. Test delayed/error responses, empty organizations, mixed currencies, long identifiers and branch-only visibility. Optional panels must not turn a valid main summary into an application-wide failure.

**G12 — Artwork and notifications (M artwork; L operational alerts).** Recreate the supplied visual elements only. Assets contain no customer data and need no backend changes. The bell's design does not authorize an unread event or arbitrary navigation: use an explicit unavailable control without a fabricated count/dot. An actual feed requires event sources, visibility, read state, retention and delivery decisions; likely new tables/RLS/RPCs or jobs. Invitation counts already have their own meaning and must not be relabeled as planning alerts.

## Track A — Implementation sequence for approval

1. **Isolate and baseline.** Create/reuse an appropriate clean worktree from current main, read its latest instructions, verify local service connectivity, run the actual application and capture a before screenshot. Coordinate database tests with other active work; shared suites run sequentially and no database reset is assumed.
2. **Reference tokens and shell.** Implement scoped layout/typography tokens; reproduce sidebar branding/avatar/navigation and header action presentation while keeping authorization/account behavior. Add matching reference-only decorative assets.
3. **Page layout and KPI strip.** Build the precise filter bar, title/subtitle, unified five-cell strip, left chart/two-table region and right insight/decorative region. Preserve truthful metadata and currency access. Use responsive min-width rules and logical CSS.
4. **Existing data integration.** Keep server rendering and current KPI RPC. Add bounded visible-location preview reads. Use real summary facts for insight rows; missing trends/risk remain explicitly unavailable. Keep all destinations honest and role-aware.
5. **Chart and states.** Reproduce area fill, solid series, points, grid, legend and tooltip using Recharts. Preserve daily-table accessibility. Add route-local loading/error/retry and per-panel unavailable states, English/Arabic message coverage and reduced-motion support.
6. **Screenshot correction cycles.** Capture and compare the real application at the native and requested viewports; perform at least three deliberate passes: geometry, typography/color, then density/icons/interaction. Re-capture after each meaningful change and inspect overlays/differences.
7. **Verification and review.** Run the commands below, inspect the focused diff, document visual deltas and frontend/backend boundaries, then open and attach one reviewable PR. Do not merge, deploy or push hosted migrations.

Proposed app-owned boundaries: dashboard page + presentation components/module CSS; bounded server data loader; the existing demand chart; shell/sidebar/switcher presentation hooks; route-local loading/error components; next-intl messages; dashboard and responsive/browser tests; this gap/verification report. Generated UI files and existing RPC signatures remain unchanged.

## Acceptance criteria

| ID    | Starting condition and action                                                | Required observable result / prohibited side effect                                                                              | Verification                                                                      |
| ----- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| AC-01 | Open authenticated dashboard at 1672×941 and 1648×928 with stable local data | Reference composition, compact unified five-cell strip and all pictured panels present; no invented metrics                      | Actual browser screenshots, bounding-box checks, side-by-side/overlay/diff report |
| AC-02 | Apply a valid day/location, then reset                                       | KPI/chart/location preview follow URL scope and existing definitions; future/invalid/inaccessible input retains current handling | Unit tests and real local Supabase Playwright                                     |
| AC-03 | View zero, missing, stale and multi-currency stock                           | Distinct states; exact currency-separated totals; visible stale/coverage evidence; no fabricated trend/risk                      | Existing numeric tests plus focused fixtures/browser checks                       |
| AC-04 | Use each visible action as editor, viewer and scoped branch member           | Authorized routes and account switching work; restricted actions/data stay hidden; unavailable actions explain why               | Existing shell/KPI/organization tests plus contextual navigation checks           |
| AC-05 | Hover/focus chart, inspect dates and open daily table                        | Correct sold/lost series and 30-day scope; keyboard/text equivalent; no numeric precision loss in table                          | Playwright pointer/keyboard/table assertions                                      |
| AC-06 | Resize 375/768/1024/1440/1920 and switch Arabic                              | No page overflow; logical mirroring, readable numbers, internal table scrolling, working mobile drawer                           | Responsive and RTL Playwright; logical-utility check                              |
| AC-07 | Delay or fail supported data reads                                           | Stable loading structure, safe retry/unavailable copy; no zeros substituted for failures or raw error exposure                   | Controlled local failure tests and browser screenshots                            |
| AC-08 | Navigate away and back; inspect final diff                                   | Other pages retain approved typography/behavior; no backend/domain or unrelated transfer-date edits                              | Cross-route browser regressions, focused diff review and required checks          |

## Mandatory visual comparison method

- Use actual `/dashboard` with authenticated loopback Supabase data. Keep synthetic fixtures strictly local/test-only; no production mock switches, seeded production values or demo route substituted for the real application.
- Freeze the reporting day through the supported URL, use repeatable local fixtures, wait for fonts/chart readiness, and record Chromium version, viewport, device-pixel ratio, locale and sidebar state. Capture a pointer-active tooltip comparison separately from the default view.
- Produce reference/implementation side-by-side, a50% opacity overlay and a difference image at identical dimensions. At 1648×928, disclose any resampling of the native reference. Never resize the implementation merely to hide layout errors.
- Aim for at least 95% perceptual similarity. Report the chosen measurement (for example SSIM if available), actual scores and comparison regions; a raw pixel pass rate is not itself a perceptual score. Report full-frame differences separately from structural comparisons that mask changing data/copy. Publish masks and excluded areas so truthful unavailable sections cannot be hidden in a score.
- Content differences are unavoidable where backend features are unavailable, currencies differ, labels preserve documented semantics, warnings are necessary or original artwork/font data is absent. Record those separately from fixable geometry errors. Do not claim 95% or “pixel-perfect” without evidence, and do not fabricate data to achieve it.
- Add deterministic screenshot regression baselines after the implementation is reviewed; do not equate matching a self-generated baseline with matching the supplied reference.

## Engineering verification

Run on the isolated implementation branch; these are planned commands, not completed checks:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm check:logical
pnpm --filter web build
pnpm --filter web test:e2e
pnpm db:test
```

Prioritize dashboard, planning-kpis, responsive-planning, smoke and organizations suites while iterating; run the full required browser suite before handoff. For the bounded location reads, repeat the existing optional dashboard scale test against a production build with `DASHBOARD_SCALE=1`, and record full dashboard and filtered navigation timings. Do not run shared database suites concurrently. Follow any additional current-main CI checks, including engine checks, where required by the repository. Test failures caused by infrastructure or baseline changes must be reported separately, not counted as passes.

Existing responsive tests hard-code 20px titles and the previous canvas color for every page. Update dashboard-only expectations to the newly approved reference; preserve their functional overflow, keyboard and cross-page checks. Keep current exact-decimal, stale-boundary and RLS assertions intact. Recheck the PR #39 forecast-tab changes when running shared navigation tests.

## Track B — Recommended roadmap, not authorized implementation

| Group / order | Recommended increment                                           | Dependencies and decisions                                                                                                | Complexity |
| ------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Essential 1   | Approve comparison and risk semantics                           | KPI baseline windows/cohorts, percentages vs points, forecast/date/unit eligibility, depletion and shortage definitions   | M analysis |
| Essential 2   | KPI comparison read model and truthful trend badges             | Essential 1; per-currency exact arithmetic, coverage and zero-baseline handling; consider batching repeated reads         | M–L        |
| Essential 3   | Risk/depletion projection and drill-down                        | Essential 1; saved forecast selection, compatible stock/unit evidence, bounded query and missing-coverage accounting      | L          |
| Essential 4   | Populate at-risk table and evidence-backed insight feed         | Essential 2–3; deterministic priorities, eligible records and contextual navigation                                       | M          |
| Operational 1 | Batch location availability and full location report            | A's measured query cost and scale requirements; invoker RPC, pagination, tenant/branch tests                              | M          |
| Operational 2 | Data freshness/coverage diagnostics                             | Existing snapshots/readiness; explicit feed expectations before alerts or SLAs                                            | M          |
| Operational 3 | Notification center and subscriptions                           | Approved event model, user scope, unread/dismissal behavior and retention; separate persistence/authorization             | L          |
| Operational 4 | Realized forecast monitoring                                    | Held-out future actuals, aligned saved horizons/units and selection-bias rules; distinct from saved quality scores        | L          |
| Advanced 1    | Time-phased shortages and inbound reliability                   | Risk model plus confirmed synchronized order-book data, due dates/backorders and arrival semantics                        | L          |
| Advanced 2    | Probabilistic service risk and policy simulation                | Validated uncertainty paths, independent calibration and explicit cycle-service vs fill-rate objective                    | L          |
| Advanced 3    | Prepared-group / multi-echelon planning and redistribution risk | Approved pooling, source/destination constraints, network lanes and reproducible evidence; no implicit reservations       | L          |
| Advanced 4    | Excess/obsolescence and scenario valuation                      | Existing explicit stock comparison; approved lifecycle/valuation definitions, per-currency provenance and cost allocation | L          |

Track A approval authorizes visual implementation and existing-data integration only. It does not approve Track B formulas, backend migrations, jobs, notifications or live deployment.

## Approval record

The owner approved Track A as specified: faithful layout, all sections represented, supported data integrated, unavailable trends/risk/days-left explicitly disclosed, and mandatory actual-app screenshot verification. This includes the dashboard-only typography exception and semantic copy corrections described above.

Approval: “Approved. Proceed with Track A as documented, preserve the unrelated work, complete screenshot comparisons and all required checks, and open a reviewable PR. Keep Track B out of scope; do not merge or deploy.”
