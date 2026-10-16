# Application typography and help

Approved on 2026-10-17 after the PR #30 review and a rendered typography comparison. MAQDAR keeps Inter and Noto Sans Arabic and uses a compact operational hierarchy.

| Role                       | Size / line height | Weight  |
| -------------------------- | ------------------ | ------- |
| Page title                 | 20px / 28px        | 600     |
| Section heading            | 16px / 24px        | 600     |
| Subsection heading         | 14px / 20px        | 600     |
| Body, table values, labels | 14px / 20px        | 400–500 |
| Secondary metadata         | 12px / 16px        | 400     |
| Dashboard KPI values       | 28px / 36px        | 600     |
| Mobile field values        | 16px / 24px        | 400     |

The rem-based heading/metric tokens live in `apps/web/src/app/globals.css`. Use `PageHeader` for a title with description/actions; use `text-section-title` and `text-subsection-title` for lower headings. KPI labels can use semantic h2 elements without acquiring section-heading styling. Numeric values and dates are separate from heading roles.

The authenticated content area inherits 14px body type. Native controls match the existing shadcn input convention: 16px below 768px, 14px above. Generated shadcn components remain unchanged. Maintain logical spacing, readable contrast, zoom, keyboard focus and local table scrolling.

Use `HelpDisclosure` for formulas, methodology and background assumptions. Its native details/summary works without client JavaScript and supports keyboard interaction. Keep a short context label when interpretation matters, such as “Historical model-selection scores”. Preserve full methodology inside the disclosure.

Keep errors, partial/unavailable results, stale-data notices, active-run feedback, pending reviews, policy-recalculation warnings and required confirmations visible at the relevant result/action. Do not place interactive form controls or action requirements inside background help. Handoff descriptions and overlap warnings must continue to distinguish planning evidence from an actual order. Existing evidence disclosures need not be wrapped in another disclosure.

## Reference

The [Syncron D2D product sheet](https://www.syncron.com/hubfs/Syncron_2025/Document/Syncron-Syncron-D2D-product-sheet.pdf), page 1, includes a compact “Dealer requests” interface with tabs and a table dominating the working area. That supports a quieter, task-first layout. D2D is a related product; the public [Service Parts Planning page](https://www.syncron.com/solutions/service-parts-planning) is marketing material, not an application type specification. No exact Syncron CSS tokens were verified. These are MAQDAR's approved sizes, not a claim of pixel-identical Syncron styling.

## Verification

Check 375, 768 and 1440px layouts, long labels, native field sizes and keyboard disclosure/table access. Use local fixtures for populated, partial, unavailable and review-warning states. Keep computational and authorization regression coverage unchanged; this is a presentation-only increment.
