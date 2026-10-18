# Planned-event demand scenarios (Step 19)

Owner-approved on 2026-10-18 after PR #61 merged as `fe2c9a4`.

Open a saved individual-item forecast, inspect an item, then **Plan event demand**. Name a campaign, recall or tender, explain its assumptions, and enter additional quantities for individual dates. Preview the baseline, additions and adjusted demand; confirm that additions are incremental before saving. **Planned-event history** lists independent scenarios for that forecast with pagination.

## Calculation and evidence

Only a selected item result from a successful forecast with consistent, known supplied demand units is eligible. Prepared groups and older forecasts without unit evidence are unavailable. The source must contain 1–90 consecutive forecast dates starting immediately after its saved history cutoff. Current catalog units never substitute for saved evidence.

Additions are nonnegative decimal quantities with at most 15 integer and three fractional digits. The browser accepts localized digits and properly grouped numbers, normalizing them without converting to binary floating point. RPCs accept canonical decimal strings. Dates must be unique and fall within the saved horizon. The form explicitly starts every date at zero; RPC dates omitted from an otherwise valid nonempty list have zero additional demand. Negative adjustments, date spreading, probabilities and inferred conversions are outside this release.

Daily scenario demand is the exact saved baseline plus its explicit addition. Totals sum these exact numerics; no rounding or stock/order arithmetic is involved. Zero-addition scenarios are permitted. Separate saved scenarios always start from the original baseline and never stack automatically.

Each record preserves the complete forecast evidence, original model-selection scores and uncertainty bands, entered assumptions, date-level comparison and totals. The interface labels scores and bands as baseline-only: adjusted uncertainty is not calculated. Tender quantities are planner assumptions rather than probability-weighted commitments. Source forecast and policy records remain unchanged.

## Access and persistence

Owners, admins and planners create scenarios. Members can inspect records within their tenant and permitted location. Source/preview RPCs explicitly enforce membership, active-organization claims and location access, including when called through a security-definer function. The table permits authenticated SELECT only, with tenant and restrictive location RLS. Writes go through the guarded save RPC and generate one business audit per new record.

A client request UUID serializes retries per organization. Authority is rechecked after lock waits. Identical retries by the original author return the original scenario; changed content or reuse by another author fails. A fresh save recomputes and compares the preview fingerprint. Editing the form hides its previous preview and save button until it is previewed again. A later source change does not rewrite saved scenarios. Source forecast, organization and location deletion retain the existing cascade behavior.

## Acceptance and verification

- AC-001: Given a known-unit forecast, preview explicit additions and observe exact daily and total baseline-plus-addition results, including maximum precision and zero. Verify with SQL and unit tests.
- AC-002: Given duplicate/out-of-horizon dates, negative quantities, unsupported source evidence or mismatched units, preview/save refuses the input without partial records. Verify with SQL, unit and browser tests.
- AC-003: Given viewer, branch, other-tenant or stale-organization sessions, only allowed inspection succeeds and editor-only saving remains enforced. Verify RLS, RPCs and server actions with SQL, browser and unit tests.
- AC-004: Given concurrent retries or authority/source changes during a lock wait, save produces one immutable record/audit or a clear refusal. Verify independent database sessions; confirm forecast, policy and inbound records remain unchanged.
- AC-005: Given a saved scenario, inspect original model scores/bands and independent history. No adjusted uncertainty or automatic stacking is presented. Verify SQL and browser workflows.
- AC-006: At 375, 768, 1024, 1440 and 1920px and Arabic RTL, enter, preview, save and inspect with shared typography, keyboard controls and local table scrolling. Verify Playwright assertions and rendered screenshots.

Local verification passed: 3,718 pgTAP assertions across 62 files, five independent-session concurrency tests, 1,363 web unit tests, TypeScript, lint, logical CSS, formatting and the production build. The browser workflow passed without retries, including preview/save/history, confirmation persistence, independent scenarios, maximum-precision quantities, long names and viewer/branch access. Screenshots were inspected at all five widths and Arabic RTL at 375/1440px. The unit suite used two workers locally after parallel filesystem-scan tests timed out under load; no assertions or timeouts were weakened.

All test fixtures target the loopback database. No hosted data or credentials are used. The PR runs the complete engine, database, browser and Cloudflare packaging checks in CI.

## Rollout and rollback

Apply `20261017231319_planned_event_scenarios.sql` before deploying the web build. This additive migration creates an empty scenario table and guarded RPCs without modifying existing business records or worker permissions. Restore the previous web build for rollback and retain the additive schema/history. Prepared groups, policy recalculation, replenishment execution and reservations remain separate increments.
