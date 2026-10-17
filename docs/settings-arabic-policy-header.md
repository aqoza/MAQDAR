# Settings Arabic and policy-selection header

The owner requested complete Arabic Members/Invitations settings and reported that the replenishment action opens a policy list with the old plain header. Follow `design.MD` and retain the existing operational behavior.

## Implementation contract

- Translate every English key in `Members` and `InviteMembers` into Arabic, including accessible labels, dialogs, success messages, validation errors and pending-invitation actions. Preserve interpolation names, the seven-day invitation period and one-hour emailed-link validity. Reuse existing role/common translations and next-intl fallback elsewhere.
- Keep shared typography, settings layout, server authorization, invitations and member mutations unchanged. Check populated rows, dialogs, empty state, errors and successful feedback in RTL at 1366×768 and 375×900.
- Retain the replenishment action's `/forecasts/workbench` destination and policy-selection semantics. Opt the standalone workbench list into the shared forecast banner. Place its existing back link with header actions to retain the compact title position. The embedded Forecasts panel retains its current header hierarchy.
- Add a list-only loading boundary under a URL-neutral route group, with the same forecast artwork and header geometry. Policy detail routes retain their existing hierarchy.
- Verify client navigation from Replenishment, reload/loading, filters and back navigation; capture 1920×900, 1366×768 and 375×900 and RTL. Run relevant unit/browser checks plus build, lint, typecheck, formatting and logical CSS checks, then open a PR. No merge, deployment, new dependency or backend change.

The presentation remains a quiet operational workspace: the existing mint banner identifies the forecasting context, while the policy table and filters remain the main task. Loading uses existing skeletons. Empty/error/success/permission behavior retains existing controllers; no new partial-data calculation is introduced.

## Implementation

`ar.json` now supplies all 17 Members and 19 InviteMembers messages. The completeness test requires exact English/Arabic key parity in both namespaces and Arabic content in each translation. The existing message test also checks ICU placeholder parity. Existing Roles, Common, Validation and RPC error translations are reused; the invitation acceptance page and unrelated planning namespaces retain their existing locale coverage.

Rendered review found that the member role select could collapse to its arrow. A minimum width on the app-owned control keeps the selected role readable without altering the type scale or generated primitive. Wide Members rows retain the existing named, keyboard-scrollable table region.

The existing Settings keyboard/history test also exposed a timing bug: consecutive key events could read stale React search parameters and move focus without selecting the corresponding panel. The selection handler now reads the live URL before each history push. A deterministic key-burst browser regression reproduces the old failure and checks that URL, selected tab, focus and visible panel agree.

The replenishment action already points to the correct policy-selection route, `/forecasts/workbench`; it does not redirect to an obsolete route. The standalone list lacked an explicit illustrated header. It now opts into the shared forecast pattern, and its existing back link sits beside the method disclosure. The embedded Forecasts panel retains its original hierarchy. A URL-neutral `(list)` group gives only the standalone list a matching loading boundary; policy detail pages keep their existing headers.

No queries, RPCs, mutation logic, tenant/branch guards, policy-selection semantics, dependencies or generated UI components changed. The loading artwork is decorative and uses the existing shared CSS rather than a client-side header switch.

## Visual comparison

- [Actual policy header before / after at 1366×768](settings-arabic-policy-visuals/policy-before-after.png)
- [Desktop policy list](settings-arabic-policy-visuals/policy-workbench-en-1920.png), [mobile](settings-arabic-policy-visuals/policy-workbench-en-375.png), [RTL laptop](settings-arabic-policy-visuals/policy-workbench-ar-1366.png) and [RTL mobile](settings-arabic-policy-visuals/policy-workbench-ar-375.png)
- [Arabic Members](settings-arabic-policy-visuals/members-ar-1366.png), [mobile role selector](settings-arabic-policy-visuals/members-ar-375.png) and [removal dialog](settings-arabic-policy-visuals/member-dialog-ar-1366.png)
- [Arabic Invitations](settings-arabic-policy-visuals/invitations-ar-1366.png), [mobile pending invitation](settings-arabic-policy-visuals/invitations-ar-375.png) and [mobile validation](settings-arabic-policy-visuals/invitation-error-ar-375.png)
- [Real streamed loading](settings-arabic-policy-visuals/policy-workbench-loading-1366.png) and [visual evidence record](settings-arabic-policy-visuals/evidence.json)

Screenshots come from the actual local production application with isolated fixture organizations and local Mailpit. The unscaled comparison preserves both 1366×768 captures; fixture emails differ. The desktop forecast banner starts at y=0, spans the global bar and is 100px high. Page headings remain 20px/28px; no type tokens or sidebar styles changed. Mobile actions wrap naturally and wide tables scroll locally instead of widening the document.

The policy workbench's existing English fallback remains visible in RTL because the requested translation scope is Members and Invitations in Settings. Customer-entered emails and location names retain their values. No perceptual similarity score, complete application translation, screen-reader audit or coverage percentage is claimed.

## Verification

| Check                                    | Result                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production build                         | Passed on the completed code                                                                                                                      |
| Strict TypeScript                        | Passed                                                                                                                                            |
| Repository lint                          | Passed                                                                                                                                            |
| Repository unit suite                    | 1,318 passed across 107 files                                                                                                                     |
| Logical CSS utilities                    | Passed                                                                                                                                            |
| Repository formatting                    | Passed                                                                                                                                            |
| Existing application browser regressions | 20 passed: invitations, organizations/stale forms, policy review, replenishment, responsive planning, Dashboard, illustrated headers and Settings |
| Final Settings and new-regression run    | 8 passed: four new tests plus the four existing Settings tests, including rapid keyboard navigation, Arabic workflows and both loading boundaries |
| Isolated forecast-tab browser tests      | 4 passed: mobile/desktop form preservation and LTR/RTL keyboard navigation                                                                        |
| Visual evidence record                   | Passed the ECC completeness checker; screenshots were also inspected directly                                                                     |
| Manual security and diff review          | No new credentials, data access, schema, RPC, dependency or generated UI changes; existing authorization and tenant guards retained               |

There are 28 distinct passing browser tests across these runs. No test was skipped or quarantined; no existing timeout or assertion was loosened. The pre-change policy banner assertion and deterministic keyboard regression both failed before their respective fixes. The latter also explained the existing Settings history test's intermittent failure. A cold Vite navigation and two five-second source-scanning unit tests timed out while build/check processes were competing; their complete suites passed on subsequent runs without changing assertions or thresholds.

To try it, enable Arabic for the organization and choose Interface language → العربية in Settings. Open Members and Invitations, including removal confirmation, a pending invitation and validation feedback. From Replenishment choose a policy maximum: `/forecasts/workbench` should retain the mint forecast header during navigation and loading. Filters, reset, the back link and policy selection retain their existing behavior. No hosted data was changed, and nothing was merged or deployed.
