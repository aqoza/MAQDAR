# MAQDAR design rules

## Typography — required on every page

**The Items page is the application typography reference.** Dashboard, planning pages and future features must use the same shared font scale. A screenshot or a compact layout does not authorize a separate font scale. Read this file before every UI change.

| Role                                                     | Size / line height | Weight                      | Implementation                                                 |
| -------------------------------------------------------- | ------------------ | --------------------------- | -------------------------------------------------------------- |
| Page title                                               | 20px / 28px        | 600                         | `text-page-title`; shared `PageHeader`                         |
| Section title                                            | 16px / 24px        | 600                         | `text-section-title`                                           |
| Subsection or compact widget title                       | 14px / 20px        | 600                         | `text-subsection-title`                                        |
| Body, subtitle, navigation and buttons                   | 14px / 20px        | 400; 500 for labels/actions | `text-sm`                                                      |
| Caption, table heading, helper text and chart annotation | 12px / 16px        | 400; 500 for table headings | `text-xs`                                                      |
| Desktop input                                            | 14px / 20px        | 400                         | Shared input styles                                            |
| Mobile input below 768px                                 | 16px / 24px        | 400                         | Shared mobile input styles; 44px minimum control height        |
| Dashboard numeric KPI                                    | 24px / 28px        | 600                         | `--text-kpi`                                                   |
| Numeric KPI at compact laptop widths, 1100–1536px        | 20px / 24px        | 600                         | `--text-kpi-compact`                                           |
| Compact planning/evidence card value                     | 16px / 24px        | 600                         | `text-evidence-value`; quantities, prices, subtotals and dates |
| Dashboard unavailable KPI status                         | 16px / 24px        | 600                         | Section-size status, identical for inventory and availability  |

Sizes are expressed in rem in the implementation so browser text scaling is respected. Page-title tracking is `-0.025em`; body and navigation keep normal tracking. Font stacks come from `--font-sans`: Inter first for English and the configured Arabic font first for RTL. Never set a different page-specific font family.

The login brand-panel headline is a display-type exception requested by the owner on 2026-10-19: 32–56px (`clamp(2rem, 3.3vw, 3.5rem)`), line-height 1.08, weight 600, and tracking -0.055em; mobile uses 32px with line-height 1.1. The owner also requested a larger sign-in heading: 32–40px (`clamp(2rem, 2.5vw, 2.5rem)`), line-height 1.12, weight 600, and tracking -0.045em; mobile uses 32px. These exceptions apply only to the two login headings. Form labels, inputs and buttons, authenticated page titles, navigation, and all other shared type roles retain the scale above.

## Shared application shell

The floating help side-panel style approved on 2026-10-18 is capped at 420px (26.25rem), with 20px (1.25rem) viewport insets on desktop and 8px (0.5rem) insets below 768px. Use a white card with 24px (1.5rem) rounded corners, a thin grey-green border, and a light neutral shadow. The card fits its content up to the available viewport height; longer guidance scrolls between the fixed header and footer. The approved smaller-text mockup is a local typography exception: 16px / 22px titles, 13px / 19px section headings and body copy, and 12px / 18px subtitles. Titles and section headings keep weight 600; footer buttons retain 14px / 20px text and all close controls retain 44px minimum targets. Keep the pale green callout. All main Replenishment tab guidance uses `HelpSidePanel`, preserving each tab's existing method copy. These styles live only in `help-side-panel.module.css`; page, navigation and sidebar typography retain the shared scale above.

- Use `AppSidebar` on every authenticated route, including Dashboard. Navigation labels are always 14px / 20px with 16px icons and the same active-label weight. The desktop navigation row is 32px. Brand, organization switcher, account footer, sidebar width and spacing do not change when navigating between Dashboard and Items.
- Dashboard CSS may style its own panels and decorative surfaces. It must not override the shared sidebar or the shared header's text size.
- Breakpoints change layout, gaps, wrapping and density. They must not shrink or enlarge page titles, navigation, body text or captions. The explicit mobile-input and numeric-KPI roles above are the only responsive size exceptions.
- Keep prose at 12px or larger. Use natural wrapping or local table scrolling when content is constrained; do not hide text, clip the page, or shrink text to force a fit.
- Keep numeric metrics separate from headings and status text. Currency formatting and precision follow existing business rules; font changes must not alter values.
- Compact planning and evidence cards use `text-evidence-value` (16px/24px, weight 600) for quantities, prices, subtotals and dates, including unavailable values. These record values must remain smaller than the page title and must not use the Dashboard KPI scale. Keep the same size at every breakpoint; let longer values wrap naturally. Tables and inline evidence retain body/caption roles. Do not reuse `text-page-title` for record values or introduce `text-xl`/`text-2xl`/`text-3xl` substitutes. Forecast run identifiers and other metadata use the caption role at 12px/16px, never smaller prose.

## Illustrated section headers

The approved page-header family uses a continuous pale mint surface from the shared top bar through the page heading and any section tabs. Every route in the authenticated application shell uses its section's header, including lists, details, create/edit forms, previews, empty/error branches and loading states. There is no plain-header exception for detail or editing screens. Login and organization onboarding retain their separate shells; Dashboard retains its approved dashboard header.

- Use the shared `PageHeader` pattern and navigation slots; keep tab behavior and actions intact. Forecasts passes server-rendered heading/artwork into its existing client tab component.
- `PageHeader.pattern` is required. Select the route's section explicitly: Items, Locations, Suppliers, Imports, Forecasts, Replenishment or Settings. Audit uses the Settings permissions motif. Embedded Forecasts panels explicitly pass `undefined` because their parent supplies the single banner. Do not render a bare page-level `h1` outside the approved Dashboard/Forecasts workspace header implementations.
- Put existing back/source links in `PageHeader.back`, alongside method disclosures and existing actions. Preserve their destinations, permissions and prefetch behavior. Do not add a separate back-link row above the banner. Allow long identifiers, translated titles and actions to wrap without changing the shared type scale.
- Keep the subtitle-to-tabs gap at 4–8px on desktop. The Items header, including the 44px global bar and tab row, is at most 144px tall at the reference desktop/laptop viewports. The gap between the global tagline's text box and the page title's text box is at most 12px; remove excess padding instead of changing typography.
- Every existing loading boundary uses its section's illustrated header. Retain the existing boundary placement and list-only route groups: adding ancestor streaming changes late `notFound()` responses from HTTP 404 to HTTP 200. Preserve the 404 and authorization regression contracts. Routes without a fallback render their complete server response with the illustrated header; do not introduce a plain intermediate header. Reserve tabs only where the loaded workspace has them. Keep artwork server-rendered, with no client effect swapping plain and illustrated headers. Mobile wrapping may change height naturally.
- The standalone policy review workbench and its policy/stock details use the forecast banner. Embedded panels retain their existing hierarchy beneath the parent banner.
- The artwork must continue behind the tabs. Keep it decorative, static, hidden from assistive technology and unable to intercept clicks. Forecast curves in this artwork are illustrations, not operational metrics.
- Use faint native SVG patterns: parts for Items, pins/network for Locations, partner supply nodes for Suppliers, column mapping for Imports, forecast envelope for Forecasts, inbound cartons for Replenishment, and sliders/permissions for Settings. Mirror decorative placement for RTL and reduce its prominence on narrow screens.
- Keep shared typography, sidebar dimensions and 44px mobile targets. Allow wrapping on narrow screens instead of shrinking text or fixing the banner height.

## Settings workspace

Use grouped, searchable section navigation beside one focused panel. The desktop menu is 224px wide with a 16px panel gap; below 1100px use a collapsed section chooser with a 44px target. Keep the existing shared type roles and organization/account distinction.

Render only authorized sections on the server. Keep allowed form panels mounted while switching so drafts and validation feedback survive. Section URLs contain only navigation state; never put field values, passwords or API secrets in URLs or browser storage. Preserve the compact illustrated header during loading, existing mutation guards and each form's own save action.

## Implementation and review

`apps/web/src/app/globals.css` defines the semantic type tokens. Reuse them in app-owned components and styles. Generated `src/components/ui` primitives stay untouched. Additions or changes to the scale require an explicit design-rule update approved by the owner; do not create one-off pixel sizes in a feature stylesheet.

For typography changes, compare Dashboard and Items at the same viewport and browser zoom. Check actual computed font sizes, line heights and font families, including sidebar labels and controls. Verify client navigation in both directions, mobile, laptop, desktop and Arabic RTL. Run the existing responsive and dashboard reference browser tests and inspect their screenshots.

The header contract test rejects omitted section patterns, bare authenticated page titles and plain loading boundaries. Follow the executable [UI regression ledger](docs/REGRESSION.md), preserve hidden-record HTTP 404 assertions, and retain desktop, mobile and Arabic RTL screenshots when changing shared headers.
