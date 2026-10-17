# MAQDAR design rules

## Typography — required on every page

**The Items page is the application typography reference.** Dashboard, planning pages and future features must use the same shared font scale. A screenshot or a compact layout does not authorize a separate font scale. Read this file before every UI change.

| Role                                                     | Size / line height | Weight                      | Implementation                                                |
| -------------------------------------------------------- | ------------------ | --------------------------- | ------------------------------------------------------------- |
| Page title                                               | 20px / 28px        | 600                         | `text-page-title`; shared `PageHeader`                        |
| Section title                                            | 16px / 24px        | 600                         | `text-section-title`                                          |
| Subsection or compact widget title                       | 14px / 20px        | 600                         | `text-subsection-title`                                       |
| Body, subtitle, navigation and buttons                   | 14px / 20px        | 400; 500 for labels/actions | `text-sm`                                                     |
| Caption, table heading, helper text and chart annotation | 12px / 16px        | 400; 500 for table headings | `text-xs`                                                     |
| Desktop input                                            | 14px / 20px        | 400                         | Shared input styles                                           |
| Mobile input below 768px                                 | 16px / 24px        | 400                         | Shared mobile input styles; 44px minimum control height       |
| Dashboard numeric KPI                                    | 24px / 28px        | 600                         | `--text-kpi`                                                  |
| Numeric KPI at compact laptop widths, 1100–1536px        | 20px / 24px        | 600                         | `--text-kpi-compact`                                          |
| Other planning metric display                            | 28px / 36px        | 600                         | `text-metric`                                                 |
| Dashboard unavailable KPI status                         | 16px / 24px        | 600                         | Section-size status, identical for inventory and availability |

Sizes are expressed in rem in the implementation so browser text scaling is respected. Page-title tracking is `-0.025em`; body and navigation keep normal tracking. Font stacks come from `--font-sans`: Inter first for English and the configured Arabic font first for RTL. Never set a different page-specific font family.

## Shared application shell

- Use `AppSidebar` on every authenticated route, including Dashboard. Navigation labels are always 14px / 20px with 16px icons and the same active-label weight. The desktop navigation row is 32px. Brand, organization switcher, account footer, sidebar width and spacing do not change when navigating between Dashboard and Items.
- Dashboard CSS may style its own panels and decorative surfaces. It must not override the shared sidebar or the shared header's text size.
- Breakpoints change layout, gaps, wrapping and density. They must not shrink or enlarge page titles, navigation, body text or captions. The explicit mobile-input and numeric-KPI roles above are the only responsive size exceptions.
- Keep prose at 12px or larger. Use natural wrapping or local table scrolling when content is constrained; do not hide text, clip the page, or shrink text to force a fit.
- Keep numeric metrics separate from headings and status text. Currency formatting and precision follow existing business rules; font changes must not alter values.

## Implementation and review

`apps/web/src/app/globals.css` defines the semantic type tokens. Reuse them in app-owned components and styles. Generated `src/components/ui` primitives stay untouched. Additions or changes to the scale require an explicit design-rule update approved by the owner; do not create one-off pixel sizes in a feature stylesheet.

For typography changes, compare Dashboard and Items at the same viewport and browser zoom. Check actual computed font sizes, line heights and font families, including sidebar labels and controls. Verify client navigation in both directions, mobile, laptop, desktop and Arabic RTL. Run the existing responsive and dashboard reference browser tests and inspect their screenshots.
