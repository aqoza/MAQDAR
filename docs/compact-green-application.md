# Compact green application design

The owner approved extending the Forecasts design across the other pages after PR #33 was reviewed and merged as `d76a93a` on 2026-10-17.

## Design contract

- Purpose: daily service-parts operations. Planners should reach filters, records and supported actions within the first viewport.
- Reference: the approved compact Forecasts workspace. Use emerald primary actions, sage active states, white panels, a faint green-gray canvas and charcoal text. Keep red errors and amber warnings distinct.
- Scope: Dashboard; item, location and supplier lists/forms; Imports; planning creation, results and review; Replenishment and purchasing; Settings, audit and account screens. Preserve all business rules, permissions, required confirmations and immutable evidence.
- Hierarchy: 20px page titles, 16px section titles, 14px body/labels, 12px secondary metadata. Use a 44px app header, 16px page spacing, compact filter panels and slim section navigation. Tables scroll inside their containers. Mobile inputs use 16px text and interactive controls have 44px touch targets.
- Density: show the five Dashboard KPIs on one row at wide sizes; at tablet sizes use two summary cards followed by three count cards. Place related navigation horizontally and use shared table/form styling. Keep methodology expandable; actionable warnings remain visible. Do not introduce decorative artwork or extra banners.
- Implementation: shared design tokens and explicit application classes, reusing existing components. Do not edit generated shadcn files or change database/API behavior. Forecasts adopts shared shell colors while retaining its tested run browser.
- Viewports: 375x900, 768x900, 1024x768, 1366x768, 1440x900 and 1920x1080. Inspect representative pages from each family, a long-content table, mobile navigation, RTL, keyboard focus and reduced motion. The owner explicitly added 1024px and 1920px checks during the rollout.

## Content states

| State      | Trigger                                                          | Required feedback                                                                      |
| ---------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Loading    | Navigation, form submission or import processing                 | Existing skeleton/progress and disabled pending action; cancellation where supported   |
| Empty      | No records or no matching filters                                | Visible empty text and relevant creation/reset action                                  |
| Error      | Invalid form, failed import or unavailable request               | Existing actionable error and retry/edit path                                          |
| Partial    | Missing snapshots, incomplete source evidence or import warnings | Explicit missing/unknown state; do not replace missing values with zero                |
| Success    | Saved record, completed run or reviewed proposal                 | Existing success/result/evidence and supported next action                             |
| Permission | Viewer or restricted role                                        | Read-only records and existing access boundary; no unauthorized creation/review action |

Rendered evidence is stored locally under `test-results/compact-green-application/` and validated with the ECC frontend evidence checker.

## Verification

The rollout passed lint, typecheck, formatting, logical utilities and the production build; 1,150 Vitest tests, 2,548 pgTAP assertions and 393 Python tests passed. The full browser suite passed 49 cases with three opt-in scale cases skipped. After the final tablet adjustment, Dashboard and all 15 representative screens passed again, including the added 1024x768 and 1920x1080 cases (six passing cases, one opt-in scale case skipped).

Manual review used isolated local synthetic data. It covered populated and empty screens, form errors, stale/missing snapshots, RTL, visible keyboard focus and laptop layouts. Automated responsive coverage checks 75 page/viewport combinations and reduced-motion styles at 1024px. Measured shared text contrast is at least 5.25:1; mobile native inputs use 16px text and 44px height. This is targeted accessibility verification rather than a complete accessibility audit.
