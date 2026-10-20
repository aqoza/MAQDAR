# Network integration workbench — Step 22i

The owner approved this scope and reporting/access contract on 2026-10-21.

## Behavior

Replenishment → Network → Network integrations opens
`/replenishment/network/integrations`. Members search saved item/package context
and the latest system/reference, filter by saved warehouse code, included branch
code, handoff/batch kind, live context, exact external-system label and reported
status, then open the package's original evidence and full acknowledgement history.

Branch filtering finds complete packages. It neither implies branch-level
acceptance nor relaxes access: the warehouse and every included branch, including
zero allocations, remain required for rows, counts and drill-down. Branch codes
come from immutable package evidence. The compact branch disclosure lists each
included code once; quantities, units, zero-transfer context, dates, freight and
currency-separated totals remain intact in the original evidence.

Select the latest server-recorded report separately for each package and exact
system label **before** status and search filters. Case and surrounding spaces
distinguish labels; key rotation does not split one label. Equal server timestamps
use ascending event UUID as a deterministic display tie-break, without claiming
external event order. Labels and reports are supplied by API clients.

All-systems mode has one row per package/system or one No report row for packages
without reports. Selecting an exact system also includes packages without a
report from that system, even when another system has reported. Counts are
package/system results. No report means absent evidence, never failed delivery.
Whole-package, member-handoff and overlapping-batch histories remain independent.

Live context is separate from report status: Current means all original proposals
remain selected; Historical means a later selection exists; Unavailable means
source context cannot be resolved. Copied batches remain searchable after source
deletion, with their original downloads and independent report history. Individual
handoffs follow their existing parent cascades. Organization/location deletion
rules remain unchanged.

This is a member-facing read-only screen. It adds no API-key scope, report writer,
stock reservation, transmission, operational transfer or inbound change.

## Acceptance and verification

- AC-001: Find saved packages by item/reference, warehouse, included branch and
  kind; links open the exact package's evidence and history. Check SQL, URL units
  and real browser fixtures.
- AC-002: Latest-before-filtering, exact labels, key rotation, timestamp ties and
  No report semantics remain deterministic. Check database cases plus HTTP reports
  inspected through the browser.
- AC-003: Current/historical/unavailable context is independent of reports;
  copied batches retain searchable evidence after source deletion. Check source
  deletion and unchanged JSON/CSV in database/browser tests.
- AC-004: Membership, active organization and all-location RLS constrain rows and
  counts, including zero branches and retained batches. Browser branch filtering
  cannot reveal hidden packages; hidden detail routes still return 404. Check
  authenticated roles, cross-tenant requests and privilege inventory.
- AC-005: Return bounded 25/50/100-row pages and their count from one statement
  snapshot, clamp out-of-range pages, and preserve filters across navigation.
  Check database and URL/browser paging.
- AC-006: Shared typography, escaped report text, keyboard interaction, contained
  table scrolling and expandable help work at 375, 768, 1024, 1440 and 1920px in
  English and Arabic RTL. Capture and inspect screenshots.
- AC-007: Reads do not modify reports, selections, original files or operational
  data. Existing purchase, transfer, event and disposition workbenches retain
  their behavior. Run shared unit/browser regressions, lint, types, logical CSS,
  formatting and production build.

## Implementation and rollout

`network_integration_workbench(uuid,jsonb,integer,integer)` is stable SECURITY
INVOKER with an empty search path and authenticated-only execution. It reads the
existing network tables and invoker views under RLS. No new business table or
direct table grant is added. Filters are validated and page size is bounded.
Rows and counts use one statement snapshot; subsequent pages can reflect later
reports and selections rather than a frozen external-integration snapshot.

The shared integration screen and URL helpers include the network family. Its
loading boundary is local to the new list route and uses the same illustrated
header. Shared typography and ancestor loading behavior are unchanged.

After review, the owner applies
`20261021013000_network_integration_workbench.sql` with
`pnpm exec supabase db push` before deploying the web build. Rollback can restore
the prior web build and retain this additive read function. No backfill or
business-row rewrite is needed. Local verification uses loopback synthetic data;
hosted migration and deployment are outside this PR.

Verification files: `0093_network_integration_workbench.test.sql`, the shared
privilege inventory, `network-integration-workbench.test.ts`, and
`network-integration-workbench.spec.ts`. Final results are recorded on the PR.
