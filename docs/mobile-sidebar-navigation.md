# Mobile sidebar navigation

At phone widths, selecting a sidebar destination changed the route while leaving the drawer open over the new page. This was reproduced in ACME and in the loopback browser regression before the fix.

`AppSidebar` now dismisses its mobile drawer when an ordinary pointer or keyboard activation follows a navigation or brand link. Selecting the already active page also dismisses it. Modified clicks retain their normal new-tab behavior, and desktop collapse state is preserved. The generated sidebar primitive, typography, authorization, tenant queries and database schema are unchanged.

Run the local browser matrix with:

```powershell
pnpm --filter web test:e2e mobile-sidebar.spec.ts responsive-planning.spec.ts dashboard-reference.spec.ts
```

The focused suite covers English and Arabic RTL, pointer/keyboard activation, the active link, brand navigation, modified clicks, Escape/focus restoration and collapsed desktop navigation. Helpers refuse to create fixtures outside loopback Supabase. The existing responsive suite now requires automatic dismissal before testing a separate Escape dismissal.

No hosted migration is required. Hosted retesting follows deployment; local success must not be described as an already deployed fix.
