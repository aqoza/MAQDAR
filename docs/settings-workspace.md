# Settings workspace

The owner approved the grouped Settings navigation and focused content panel shown in [the mockup](settings-visuals/approved-mockup.png). The shared application sidebar, illustrated header and Items type scale remain the visual baseline.

## Acceptance contract

- A signed-in member opens Settings and sees Organization first. Workspace contains Organization and Preferences; owners/admins additionally see People & access with Members, Invitations and API keys; Your account contains Password and Interface language. Administrative tools are never sent to non-admin clients.
- Selecting a section displays only its panel and updates `?section=`. The native history integration preserves browser Back/Forward and reload/deep links without fetching Settings again on each click. Existing form/action state remains mounted while switching; unsaved values are not written to browser storage or URLs.
- Searching matches translated section names and field labels. No matches produces a clear message and a clear-search control, while the active form stays intact. Keyboard Up/Down/Home/End navigate visible sections.
- Desktop uses a 224px settings menu plus one flexible panel with a 16px gap. Below 1100px a 44px section chooser collapses the menu. Small screens stack form fields and retain existing 44px controls and 16px input text. Other shared text roles do not change.
- Server loading uses the same illustrated shell and a workspace skeleton. Existing validation, permission and success feedback remain in the original forms; organization guards, one-time key disclosure and mutations are unchanged.
- Verification covers laptop/desktop/mobile, Arabic RTL, search, unsaved input, history/reload, loading, admin/viewer permissions, invitations, API-key creation/revocation, stale forms and the existing Dashboard/header checks.

## Implementation

The server page retains its data access and builds only authorized panel slots. A small client workspace handles search and navigation; all forms are existing components. Organization identity fields are paired on wide screens and the Organization/Preferences action rows use a compact divided footer.

Section URLs use Next.js's documented [native history integration](https://nextjs.org/docs/app/getting-started/linking-and-navigating#native-history-api). No backend/schema changes or new dependencies are required. The Members and API-key tables use the existing named, keyboard-scrollable table region rather than widening the page.

## Visual review

The approved mockup establishes the grouped navigation and focused form composition. The implementation deliberately retains the canonical Items typography and existing 256px application sidebar rather than copying the generated mockup's larger text and sidebar. It also retains the actual Settings SVG artwork and existing form controls. Fixture names, organization identifiers, email addresses and dates differ from the concept image.

Browser checks cover all seven panels at English 1920×900, 1366×768 and 375×900, plus Arabic 1366×768 and 375×900. Each panel is captured; the long API-key form uses full-page images. At laptop width the local menu is 224px, its gap is 16px, and both columns start at the same height. Page titles remain 20px/28px; navigation remains 14px/20px with 16px icons. Below 1100px the section chooser retains a target of at least 44px. Wide member rows scroll locally in either direction.

Arabic mirrors the workspace and translates the new navigation. The original redesign screenshots below retain the older English fallback in Members and Invitations. A [translation follow-up](settings-arabic-policy-header.md) now completes both namespaces, including actions, dialogs, feedback and errors, using the same next-intl system.

No pixel-similarity percentage is claimed for a generated concept versus a live application. The review compares composition and measured layout/type constraints, with real application content and controls.

- [Before / after at laptop size](settings-visuals/before-after.png)
- [Approved concept / implementation](settings-visuals/mockup-implementation.png)
- [Actual laptop](settings-visuals/settings-organization-en-1366.png), [mobile](settings-visuals/settings-organization-en-375.png), [Arabic laptop](settings-visuals/settings-organization-ar-1366.png), [Arabic mobile](settings-visuals/settings-organization-ar-375.png)
- [Complete API-key form](settings-visuals/settings-api-keys-en-1366-full.png), [loading](settings-visuals/settings-loading-1366.png), [empty search](settings-visuals/settings-search-empty-1366.png)
- [Measured bounds](settings-visuals/settings-bounds.json) and [visual evidence record](settings-visuals/evidence.json)

The long API-key panel uses full-page captures to show all permissions and the save action. Chromium viewport captures of that tall panel intermittently clipped the top bar despite correct visible geometry and hit testing. Full-page captures rendered it correctly. The complete form images are retained, rather than publishing clipped viewport artifacts; production header code is unchanged.

## Security and state review

- Owners/admins receive seven sections; other members receive four. Administrative panel slots are constructed only inside the existing server authorization condition, not hidden as a substitute for authorization.
- Existing tenant-scoped queries, active-organization fields, stale-form checks, mutations, API scopes, one-time secret disclosure and revocation remain intact.
- Only the section key is added to navigation state. Search text and drafts stay in component/form memory; no values or secrets are stored in URL parameters, local storage or session storage.
- Switching sections preserves form values and validation. Reloading still follows the existing unsaved-form behavior. Changing organization remounts the workspace, preventing drafts from moving into a different tenant's screen.
- Partial reference-data/query failure behavior remains unchanged. This presentation change does not add a new partial-data source or redefine existing error semantics.

## Verification

Verified against a local production build and an isolated local Supabase/Mailpit stack; no hosted services were changed.

| Check                            | Result                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production build                 | Passed                                                                                                                                                        |
| Repository lint                  | Passed                                                                                                                                                        |
| Strict TypeScript                | Passed                                                                                                                                                        |
| Web unit suite                   | 1,316 passed across 107 files                                                                                                                                 |
| Logical CSS utilities            | Passed                                                                                                                                                        |
| Repository formatting            | Passed                                                                                                                                                        |
| Affected Playwright suite        | 37 passed, including API keys, invitations, organization switching/stale forms, master data, Dashboard, illustrated headers, responsive planning and Settings |
| Settings capture refresh         | 4 passed; all panels captured in English/Arabic, including keyboard-scroll checks and throttled loading                                                       |
| Visual evidence record checker   | Passed; the checker validates record completeness, not visual similarity                                                                                      |
| Manual code/security diff review | Server authorization and tenant guards retained; no schema, RPC, generated UI or dependency changes                                                           |

The first regression pass found two strict-locator races while React briefly staged streamed content. Tests now wait for the completed workspace/header rather than inspecting the temporary staging copy. Both passed in the complete 37-test rerun. No test was skipped or quarantined.

Accessibility verification covered keyboard section selection/focus, labelled controls, active/hidden panels, mobile chooser targets and local table scrolling. It was not a full screen-reader or axe audit. Test coverage percentages were not collected; the repository's existing unit configuration was used.

To try it, open `/settings`, switch through the grouped sections, search for “time zone” or “key name”, and use browser Back/Forward. Enter a draft Organization name, switch to Preferences and save, then return: the draft remains. Repeat at 375px and switch Interface language to Arabic. Administration sections require an owner/admin.
