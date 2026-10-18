# Dashboard metric wrapping

At tablet widths with the sidebar visible, the three-column metric strip leaves too little room for values and their trend markers. Percentages and counts can split across lines, and a currency total can overlap the adjacent metric.

Use two columns below 1100px and one column below 768px. Keep numeric values unbroken while allowing trend markers and currency labels to wrap independently. Preserve the shared typography, exact currency disclosures and all calculations; only dashboard layout is changed.

Regression point `TEST-DASHBOARD-METRIC-001` extends `apps/web/e2e/dashboard-reference.spec.ts`: at 375, 768, 800 and 1024px, numeric metrics occupy one line, fit their available body width and leave no horizontal page overflow. Existing empty-state, laptop, desktop, keyboard, typography and RTL checks remain in the same suite.

The defect was reproduced with the visible synthetic metric values in a local layout fixture using the application stylesheet and compiled fonts: several 800px numeric values occupied 56px at a 28px line height. The patch reduced them to one line and passed overflow checks at 375, 768, 800, 1024, 1100, 1280, 1440 and 1920px. This fixture is layout evidence; the application E2E test is the integration regression check.

No database migration, configuration, permission, dependency, tenant record or API contract changes are required.
