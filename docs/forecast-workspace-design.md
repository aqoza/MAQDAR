# Forecasts workspace pilot

The owner approved the compact emerald/sage mockup on 2026-10-17 after the original Forecasts pilot in PR #32 was merged. This follow-up applies that approved design to `/forecasts` only. PR #31's compact typography remains the base; other pages keep their existing appearance.

## Design contract

- Surface: `/forecasts`, where planners check demand readiness and reach classification, forecasting, preparation, quality and policy review.
- Primary action: check one active location's demand history for the chosen dates using the existing guarded planning action.
- Hierarchy: one-line page title with optional methodology; slim workflow navigation; one location/date toolbar and primary action; searchable latest-20 run table beside the selected run's evidence. Four readiness counts stay visible; additional saved metrics expand in place. There is no duplicate readiness action or decorative hero.
- Reference observations: the approved local compact green mockup uses emerald actions, sage active navigation and selection, white panels and charcoal text. Keep the approved 20/16/14px type roles and 16px mobile input text. Status wording remains explicit, with red failure and amber progress accents.
- Data integrity: use actual runs, statuses and readiness counts. No example locations or invented metrics. The readiness check still requires one location; the mockup's “All locations” placeholder must not imply a new backend capability.
- Scope: styling and composition of the Forecasts landing page. Route-scoped shell accents must disappear on navigation elsewhere. Existing routing, role guards, active-run restrictions, cancellation, refresh and detailed evidence remain functional.
- Viewports: 375×900, 768×900, 1366×768 and 1440×900; also inspect mobile RTL, long location codes and keyboard use. Desktop controls start above 300px; eight run rows should fit in the laptop table. Wide content scrolls inside the table rather than widening the page.
- Accessibility: text status as well as color, explicit form labels, visible focus, 44px mobile controls and no essential motion. Workflow navigation uses real links or clearly unavailable controls. Row selection keeps keyboard focus, exposes pressed state and points to the evidence panel.

## State contract

| State      | Trigger                                              | Feedback and next action                                                    |
| ---------- | ---------------------------------------------------- | --------------------------------------------------------------------------- |
| Loading    | Submit readiness or active worker run                | Pending submit, progress notice, refresh and authorized cancellation        |
| Empty      | No prior runs                                        | Readiness guidance and useful primary action; recent-runs empty text        |
| Error      | Invalid input or failed run                          | Visible error/recovery guidance; editable inputs and retry                  |
| Partial    | Readiness evidence unavailable or incomplete history | Explicit unavailable/no-history text; preserve available evidence           |
| Success    | Completed run                                        | Real status, result links and detailed readiness metrics                    |
| Permission | Viewer/approver/branch role                          | Read-only guidance, accessible saved results, creation controls unavailable |

Verification evidence and screenshots for the compact green revision are stored locally under `test-results/forecast-compact-green/`. The original pilot evidence remains in `test-results/forecast-workspace/`.
