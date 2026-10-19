# Mobile sidebar navigation

At phone widths, selecting a sidebar destination changed the route while leaving the drawer open over the new page. This was reproduced in ACME and in the loopback browser regression before the fix.

`AppSidebar` now dismisses its mobile drawer when an ordinary pointer or keyboard activation follows a navigation or brand link. Selecting the already active page also dismisses it. Modified clicks retain their normal new-tab behavior, and desktop collapse state is preserved. The generated sidebar primitive, typography, authorization, tenant queries and database schema are unchanged.

Run the local browser matrix with:

```powershell
pnpm --filter web test:e2e mobile-sidebar.spec.ts responsive-planning.spec.ts dashboard-reference.spec.ts
```

The focused suite covers English and Arabic RTL, pointer/keyboard activation, the active link, brand navigation, modified clicks, Escape/focus restoration and collapsed desktop navigation. Helpers refuse to create fixtures outside loopback Supabase. The existing responsive suite now requires automatic dismissal before testing a separate Escape dismissal.

No hosted migration is required. Hosted retesting follows deployment; local success must not be described as an already deployed fix.

The complete CI suite also exposed a disposition acknowledgement test race during the Arabic reload. A local production-build reproduction confirmed one visible section and one hidden React streamed section. The RTL check now requires exactly one visible history, its Arabic explanation and the saved rejection reason before scrolling and capturing each viewport. It continues to fail for duplicate visible histories or missing content.
