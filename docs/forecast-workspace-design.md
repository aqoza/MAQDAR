# Forecasts workspace pilot

The owner requested this Forecasts-only pilot on 2026-10-17, using their supplied MAQDAR mockup as the visual reference. PR #31's compact typography is the base. Other pages keep their existing appearance.

## Design contract

- Surface: `/forecasts`, where planners check demand readiness and reach classification, forecasting, preparation, quality and policy review.
- Primary action: check one active location's demand history for the chosen dates using the existing guarded planning action.
- Hierarchy: compact page introduction with a decorative forecasting illustration; six task cards; a location/date toolbar and readiness panel beside a short list of real recent runs; complete run evidence below.
- Reference observations: pale blue/lilac atmosphere, white rounded surfaces, distinct icon accents, a violet selected task, dark primary action and a separate recent-runs column. Keep the approved 20/16/14px type roles and 16px mobile input text.
- Data integrity: use actual runs, statuses and readiness counts. No example locations or invented metrics. The readiness check still requires one location; the mockup's “All locations” placeholder must not imply a new backend capability.
- Scope: styling and composition of the Forecasts landing page. Route-scoped shell accents must disappear on navigation elsewhere. Existing routing, role guards, active-run restrictions, cancellation, refresh and detailed evidence remain functional.
- Viewports: 375×900, 768×900 and 1440×900; also inspect mobile RTL, long location codes and keyboard use. Wide content must not cause page overflow.
- Accessibility: text status as well as color, explicit form labels, visible focus, 44px primary controls, decorative illustrations hidden from assistive technology, no essential motion. The task cards must be real links or clearly unavailable controls.

## State contract

| State      | Trigger                                              | Feedback and next action                                                    |
| ---------- | ---------------------------------------------------- | --------------------------------------------------------------------------- |
| Loading    | Submit readiness or active worker run                | Pending submit, progress notice, refresh and authorized cancellation        |
| Empty      | No prior runs                                        | Readiness guidance and useful primary action; recent-runs empty text        |
| Error      | Invalid input or failed run                          | Visible error/recovery guidance; editable inputs and retry                  |
| Partial    | Readiness evidence unavailable or incomplete history | Explicit unavailable/no-history text; preserve available evidence           |
| Success    | Completed run                                        | Real status, result links and detailed readiness metrics                    |
| Permission | Viewer/approver/branch role                          | Read-only guidance, accessible saved results, creation controls unavailable |

Verification evidence and screenshots are stored locally under `test-results/forecast-workspace/`.
