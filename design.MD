# ZeeSpare design rules

## Typography — required on every page

**The Items page is the application typography reference.** Dashboard, planning pages and future features must use the same shared font scale. A screenshot or a compact layout does not authorize a separate font scale. Read this file before every UI change.

The owner approved the smaller shared standard on 2026-10-19: page titles are 16px/24px and compact record values are 14px/20px, including location codes, disposition labels, quantities, dates and money. This replaces the earlier 20px/28px title and 16px/24px record-value sizes shown in historical visual reports. Apply these shared roles across lists, detail pages, create/edit forms, previews, error and loading states; do not preserve a larger size on a particular page.

| Role                                                     | Size / line height | Weight                      | Implementation                                                            |
| -------------------------------------------------------- | ------------------ | --------------------------- | ------------------------------------------------------------------------- |
| Page title                                               | 16px / 24px        | 600                         | `text-page-title`; shared `PageHeader`                                    |
| Section title                                            | 16px / 24px        | 600                         | `text-section-title`                                                      |
| Subsection or compact widget title                       | 14px / 20px        | 600                         | `text-subsection-title`                                                   |
| Body, subtitle, navigation and buttons                   | 14px / 20px        | 400; 500 for labels/actions | `text-sm`                                                                 |
| Caption, table heading, helper text and chart annotation | 12px / 16px        | 400; 500 for table headings | `text-xs`                                                                 |
| Desktop input                                            | 14px / 20px        | 400                         | Shared input styles                                                       |
| Mobile input below 768px                                 | 16px / 24px        | 400                         | Shared mobile input styles; 44px minimum control height                   |
| Dashboard numeric KPI                                    | 24px / 28px        | 600                         | `--text-kpi`                                                              |
| Numeric KPI at compact laptop widths, 1100–1536px        | 20px / 24px        | 600                         | `--text-kpi-compact`                                                      |
| Compact planning/evidence card value                     | 14px / 20px        | 600                         | `text-evidence-value`; record codes, labels, quantities, prices and dates |
| Dashboard unavailable KPI status                         | 16px / 24px        | 600                         | Section-size status, identical for inventory and availability             |

Sizes are expressed in rem in the implementation so browser text scaling is respected. Page-title tracking is `-0.025em`; body and navigation keep normal tracking. Font stacks come from `--font-sans`: Inter first for English and the configured Arabic font first for RTL. Never set a different page-specific font family.

The Industrial Studio login approved on 2026-10-21 uses a 32–56px brand-panel display headline (line-height 1.08, weight 600). Its **sign-in and recovery headings are always 24px/32px, weight 600** (1.5rem/2rem), including mobile. This supersedes the earlier 32–40px sign-in exception. Form text retains the shared scale; inputs use 16px/24px to avoid mobile zoom. Authenticated page titles stay 16px/24px.

Use the supplied Precision ZS outlined logo at its natural aspect ratio. The Industrial Studio panel uses the website parts photograph, forest #103F33, ivory #F8F8F0 and lime #BEFF69. Artwork is decorative; the Latin logo stays unmirrored in RTL. Keep these styles scoped to the auth shell.

Login presents email/password and a **Forgot password?** link. Do not restore email sign-in controls, the separator or invitation notice. Existing invitation and previously issued sign-in callbacks remain compatible. Recovery pages share the shell and compact heading.

Below 768px, collapse the photograph and display copy to a compact logo bar. Keep workspace selection, credential inputs, password recovery and submit visible at 320×568. Inputs/buttons are 52px high (48px on short phones); links and the password toggle retain 44px targets. Allow normal scrolling for translations, errors, text enlargement and the keyboard.

## Shared application shell

The floating help side-panel style approved on 2026-10-18 is capped at 420px (26.25rem), with 20px (1.25rem) viewport insets on desktop and 8px (0.5rem) insets below 768px. Use a white card with 24px (1.5rem) rounded corners, a thin grey-green border, and a light neutral shadow. The card fits its content up to the available viewport height; longer guidance scrolls between the fixed header and footer. The approved smaller-text mockup is a local typography exception: 16px / 22px titles, 13px / 19px section headings and body copy, and 12px / 18px subtitles. Titles and section headings keep weight 600; footer buttons retain 14px / 20px text and all close controls retain 44px minimum targets. Keep the pale green callout. All main Replenishment tab guidance uses `HelpSidePanel`, preserving each tab's existing method copy. These styles live only in `help-side-panel.module.css`; page, navigation and sidebar typography retain the shared scale above.

- Use `AppSidebar` on every authenticated route, including Dashboard. Navigation labels are always 14px / 20px with 16px icons and the same active-label weight. The desktop navigation row is 32px. Brand, organization switcher, account footer, sidebar width and spacing do not change when navigating between Dashboard and Items.
- Below 768px, mobile drawer navigation rows and the brand link have a minimum 44px tap height. Keep navigation labels at 14px / 20px and icons at 16px; increase the hit area rather than the font. Apply this in the app-owned sidebar so the portalled drawer receives it; desktop rows remain 32px.
- Dashboard CSS may style its own panels and decorative surfaces. It must not override the shared sidebar or the shared header's text size.
- Breakpoints change layout, gaps, wrapping and density. They must not shrink or enlarge page titles, navigation, body text or captions. The explicit mobile-input and numeric-KPI roles above are the only responsive size exceptions.
- Keep prose at 12px or larger. Use natural wrapping or local table scrolling when content is constrained; do not hide text, clip the page, or shrink text to force a fit.
- Keep numeric metrics separate from headings and status text. Currency formatting and precision follow existing business rules; font changes must not alter values.
- Compact planning and evidence cards use `text-evidence-value` (14px/20px, weight 600) for record codes, labels, quantities, prices, subtotals and dates, including unavailable values and currency-specific assessment totals. Use the value token rather than a section-title token so heading changes cannot enlarge record values. These record values must remain smaller than the page title and must not use the Dashboard KPI scale. Keep the same size at every breakpoint; let longer values wrap naturally. Tables and inline evidence retain body/caption roles. Do not reuse `text-page-title` for record values or introduce `text-xl`/`text-2xl`/`text-3xl` substitutes. Forecast run identifiers and other metadata use the caption role at 12px/16px, never smaller prose.

## Illustrated section headers

The approved page-header family uses a continuous pale mint surface from the shared top bar through the page heading and any section tabs. Every route in the authenticated application shell uses its section's header, including lists, details, create/edit forms, previews, empty/error branches and loading states. There is no plain-header exception for detail or editing screens. Login and organization onboarding retain their separate shells; Dashboard retains its approved dashboard header.

- Use the shared `PageHeader` pattern and navigation slots; keep tab behavior and actions intact. Forecasts passes server-rendered heading/artwork into its existing client tab component.
- Pass multiple header action links as a fragment. `PageHeader` already provides the wrapping flex container; an extra wrapper prevents direct-link typography and 44px mobile-target styles from applying. Preserve action order, destinations and permissions.
- `PageHeader.pattern` is required. Select the route's section explicitly: Items, Locations, Suppliers, Imports, Forecasts, Replenishment or Settings. Audit uses the Settings permissions motif. Embedded Forecasts panels explicitly pass `undefined` because their parent supplies the single banner. Do not render a bare page-level `h1` outside the approved Dashboard/Forecasts workspace header implementations.
- Put existing back/source links in `PageHeader.back`, alongside method disclosures and existing actions. Preserve their destinations, permissions and prefetch behavior. Do not add a separate back-link row above the banner. Allow long identifiers, translated titles and actions to wrap without changing the shared type scale.
- Keep the subtitle-to-tabs gap at 4–8px on desktop. The Items header, including the 44px global bar and tab row, is at most 144px tall at the reference desktop/laptop viewports. The gap between the global tagline's text box and the page title's text box is at most 12px; remove excess padding instead of changing typography.
- Align titles to the start of their heading row, including the Forecasts workspace header without a subtitle. Centering a single-line title within the 44px row must not add extra space below the global tagline. Method controls retain their independent alignment.
- Every existing loading boundary uses its section's illustrated header. Retain the existing boundary placement and list-only route groups: adding ancestor streaming changes late `notFound()` responses from HTTP 404 to HTTP 200. Preserve the 404 and authorization regression contracts. Routes without a fallback render their complete server response with the illustrated header; do not introduce a plain intermediate header. Reserve tabs only where the loaded workspace has them. Keep artwork server-rendered, with no client effect swapping plain and illustrated headers. Mobile wrapping may change height naturally.
- The standalone policy review workbench and its policy/stock details use the forecast banner. Embedded panels retain their existing hierarchy beneath the parent banner.
- The artwork must continue behind the tabs. Keep it decorative, static, hidden from assistive technology and unable to intercept clicks. Forecast curves in this artwork are illustrations, not operational metrics.
- Use faint native SVG patterns: parts for Items, pins/network for Locations, partner supply nodes for Suppliers, column mapping for Imports, forecast envelope for Forecasts, inbound cartons for Replenishment, and sliders/permissions for Settings. Mirror decorative placement for RTL and reduce its prominence on narrow screens.
- Keep shared typography, sidebar dimensions and 44px mobile targets. Allow wrapping on narrow screens instead of shrinking text or fixing the banner height.

## Settings workspace

Use grouped, searchable section navigation beside one focused panel. The desktop menu is 224px wide with a 16px panel gap; below 1100px use a collapsed section chooser with a 44px target. Keep the existing shared type roles and organization/account distinction.

Render only authorized sections on the server. Keep allowed form panels mounted while switching so drafts and validation feedback survive. Section URLs contain only navigation state; never put field values, passwords or API secrets in URLs or browser storage. Preserve the compact illustrated header during loading, existing mutation guards and each form's own save action.

## Forecast search and evidence

Nested forecast-comparison headings use `text-subsection-title` (14px/20px), and detailed method notes, training/test windows and coverage metadata use `text-xs` (12px/16px). Page/section headings stay 16px/24px and primary records/scores stay 14px/20px. Preserve the complete saved evidence and its historical-coverage caveats. Expand comparison evidence below the full result row; opening it must not squeeze the score columns or enlarge unrelated text.

Keep item search, location selection and Result prominent. Put Model and Method in an accessible More filters disclosure with its active-filter count; place page size/order by the results. Give search a clear action, expose applied filters with individual removal, and distinguish an empty dataset from no matching results. Embedded quality search, reset, chips and paging retain the Forecasts workspace and selected quality tab; standalone quality links remain supported.

Location suggestions show code and localized name and submit the existing exact code. Readiness suggestions contain active locations; historical-quality selection also supports inactive and saved codes no longer present in the catalog. Every suggestion comes from the session's organization/branch-scoped query. Do not replace this with a privileged or unbounded catalog download.

Apply the same roles throughout Forecasts: classification, creation/preparation,
policy and stock evidence, simulations/calendars/events, external drivers,
installed-base populations and conditional demand scenarios. Nested window and
summary-card headings use 14px/20px; table headings use 12px/16px, weight 500.
Source timestamps, identifiers, fingerprints, training windows and supporting
method notes use the caption role. Keep primary codes, quantities, scores and
actionable assumptions/confirmations at 14px/20px; a compact layout must not obscure
their meaning or precision. Native evidence disclosures retain 44px mobile targets.

New workflow and dataset forms reuse active-location code/name suggestions.
Historical workbench and dataset filters also support inactive/manual saved codes.
Provide a labeled, clearable search with flexible width and truthful empty/no-match
feedback. Preserve each form's exact-code fields, preview invalidation and server
authorization. Embedded workbench filtering, reset and paging retain the workspace
and selected tab, matching embedded quality navigation; standalone routes remain
available.

Reset clears both applied filters and unsubmitted edits, including when its
destination is already the current URL. Reset only the current filter form;
retained drafts in other Forecasts workflow tabs must survive.

Recent-run search has a flexible-width control row, a clear button, status/type filters and a visible **Latest 20 only** scope with a matching count. It searches only the loaded, authorized recent runs. Do not imply it searches the complete archive. Keep mobile input text at 16px and interactive targets at least 44px; layout changes must not shrink the shared type scale.

## Implementation and review

`apps/web/src/app/globals.css` defines the semantic type tokens. Reuse them in app-owned components and styles. Generated `src/components/ui` primitives stay untouched. Additions or changes to the scale require an explicit design-rule update approved by the owner; do not create one-off pixel sizes in a feature stylesheet.

For typography changes, compare Dashboard and Items at the same viewport and browser zoom. Check actual computed font sizes, line heights and font families, including sidebar labels and controls. Verify client navigation in both directions, mobile, laptop, desktop and Arabic RTL. Run the existing responsive and dashboard reference browser tests and inspect their screenshots.

The header contract test rejects omitted section patterns, bare authenticated page titles and plain loading boundaries. Follow the executable [UI regression ledger](docs/REGRESSION.md), preserve hidden-record HTTP 404 assertions, and retain desktop, mobile and Arabic RTL screenshots when changing shared headers.

## ZeeSpare identity

The public name is **ZeeSpare**, with this capitalization in both locales. The precision-Z mark in `src/components/zeespare-mark.tsx` remains in onboarding, the sidebar and favicon; its master assets live in `docs/brand/zeespare`. The approved Industrial Studio auth shell uses the supplied outlined Precision ZS SVG in `public/images/auth/zeespare-precision-reversed.svg`, preserving its natural aspect ratio. Do not rebuild that wordmark with text or apply the former login wordmark font rule. Application text roles remain unchanged. Keep Latin wordmarks LTR inside RTL layouts and never mirror either mark.

Forest #103E31, emerald #155C46, signal lime #C2F970 and warm paper #F7F8F2 form the brand palette. Lime is decorative and must not be used for small text on white. Do not change shared semantic status colors to brand colors.

## Public website exception

The public product homepage and workspace finder use an editorial display scale scoped to `public.module.css`: responsive 44–77px hero, 28–40px section titles and 36px finder title. Use the existing ZeeSpare palette, mark and planning illustration, logical CSS, visible focus and 44px targets. This does not change authenticated application typography or the approved login design.

## Transactional emails

All Supabase Auth emails use the shared shell in `scripts/render-email-templates.mjs` and copy in `supabase/templates/content.en.json`. Run `pnpm emails:generate` after edits; never restyle a generated template independently. Keep the original Precision logo as a PNG at its natural ratio, forest masthead, lime action, mint security panel and warm-paper background. See [branded-emails.md](docs/branded-emails.md) for coverage and owner-run rollout.

Email-specific type roles are 24px/32px event heading, 14px/22px body, 14px/20px action, 12px/18px supporting text and 28px/36px verification code. These inline pixel sizes and Arial/Helvetica fallbacks are for email-client compatibility only; they do not change app typography. Use a fluid 600px presentation table and a minimum 48px action target. Text, actions and security guidance must remain understandable with images blocked and media queries stripped. Keep one primary action, descriptive links and a text code; no scripts, web fonts, tracking pixels or tokens in image URLs.

Preserve callback URLs, token types, expiry, confirmation requirements and notification enablement. Native templates remain English until a separately reviewed localized-delivery implementation exists. Do not infer organization identity or locale from untrusted Auth user metadata. Verify desktop and narrow/mobile HTML previews plus real local Auth/Mailpit delivery. Record email-client testing limits honestly; Chromium screenshots alone do not certify Outlook or Gmail rendering.
