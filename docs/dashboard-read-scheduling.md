# Single-pass dashboard stock summaries

The dashboard previously made one overall KPI request followed by a location catalog request
and up to five additional KPI requests. Each preview repeated the stock cohort and demand
aggregation. The read function now derives overall, currency and location aggregates from one
authorized latest-stock scan, using grouping sets. Its bounded location projection travels in
the same response. The web reader validates organization, day, selected location, row identities
and payload limits before using it; missing or invalid projections retain the previous reads.

The projection keeps 50 suggestions, an explicit truncation flag and at most five previews.
A selected location beyond the suggestion page is retained. Empty observations remain known
missing coverage. No currency pooling, decimal conversion, stale-stock assumption or inferred
availability is introduced. Existing totals, demand, date filters and error paths are preserved.

The explicit isolation browser test also found that the old dashboard loading boundary flushed
HTTP 200 before a hidden-location `notFound()` result. Removing only that boundary lets the
complete dashboard return the correct HTTP 404. The final page, shared header, typography,
sidebar and other routes' loading boundaries retain their existing rendering.

## Migration and authority

`20261021013001_dashboard_location_projection.sql` replaces only the existing stable
`SECURITY INVOKER` function. Its signature, empty search path, planner settings and grants
are preserved. Every source still passes the same tenant and assigned-location RLS. There is
no cross-request cache, new function privilege, table, index, backfill or business-data write.
PostgreSQL retains ownership and permissions for `CREATE OR REPLACE FUNCTION` with the same
signature. [PostgreSQL documentation](https://www.postgresql.org/docs/17/sql-createfunction.html).

The new JSON member is optional for callers. Older web builds ignore it; the new web build
falls back against the older function, allowing a reviewed rollout in either order. The migration
requires owner review under [CLAUDE.md](../CLAUDE.md). Apply only the reviewed staged file
after CI passes, with seeds, roles and Vault excluded. A hosted dry run alone does not apply it.
Rollback means restoring the web build first and reviewing any forward function migration;
never delete migration history or operational evidence.

## Verification

Use an isolated local Supabase project and a production web build. E2E helpers refuse
non-loopback database URLs. Generate the environment for that project, build first, then
serve the build on the configured loopback origin.

```powershell
pnpm --filter web build
pnpm --filter web exec next start -H 127.0.0.1 -p 3107
# In a second terminal, using that same generated local environment:
$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:3107'
$env:DASHBOARD_SCALE = '1'
pnpm --filter web exec playwright test e2e/dashboard.spec.ts e2e/dashboard-reference.spec.ts e2e/dashboard-isolation.spec.ts --workers=1
```

The scale fixture retains 50,000 items, 40 locations, 50,000 stock observations and 50,000 demand
rows. All three overall loads and the selected-location load retain the strict **2,000ms** limit.
Populated preview rows, positive/zero coverage and the one-row selected preview are checked
inside the timed interval. Normal bounded fixture teardown remains part of a passing test.

The single-response run passed those four timings at **1,297 / 1,443 / 1,299ms**, filtered
**1,090ms**; its then-existing HTTP-status failure was separately retained and corrected.
Final post-boundary verification is recorded in the ACME coverage report after execution.
The KPI/privilege checks pass **76 assertions** and the full web unit suite passes **1,872 tests**.
Measured temporary reads fell from **3,170 to 398 blocks** on comparable authenticated plans.
No JIT, work-memory, statement-timeout or performance-limit tuning was retained.

An overlap-only variant still missed the strict gate and was rejected. Fresh-entry private
profiles and a contended scale sample are retained as limitations, not substituted for the
repository benchmark. These local samples do not certify production cold starts, p95 latency,
concurrency, endurance or capacity. No hosted performance rollout is claimed before review.
