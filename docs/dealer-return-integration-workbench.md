# Dealer-return integration workbench (Step 27g)

Members can find saved dealer-return handoffs and copied batches at
`/replenishment/returns/integrations`, then inspect their original authorization
evidence and full report history. This is a read-only view of package reports;
Received does not confirm physical receipt, eligibility, credits or stock availability.

## Reporting and access

- Search saved item/package context and the latest external system/reference. Filter
  source branch and receiving hub/warehouse codes, handoff/batch kind, live source
  availability, reported status and an exact external-system label.
- Pick the latest server `recorded_at` for each exact package/system **before** status
  and search filtering. Equal times use ascending event UUID as a deterministic
  display tie-break, not evidence of external event order. Case and spaces distinguish
  system labels; key rotation does not split them.
- Without a system filter, show one row per package/system, or one No report row when
  no system has reported. With an exact system selected, a package without that
  system's report shows No report even if other systems reported. Counts refer to
  package/system results. Silence implies neither failed delivery nor physical receipt.
- Batch, member-handoff and overlapping-batch histories remain independent. Each
  evidence link opens the actual package and its own history.
- Live source availability describes whether original source records are still
  visible; it is independent from report status and does not confirm current catalog
  validity, stock or eligibility. Copied batches remain searchable after source-request
  deletion, with original payloads, downloads and independent reports retained. Single
  handoffs follow their existing source cascade. Requested dates remain unscheduled.
- Existing tenant and both-location RLS applies to rows and counts. Source/receiver
  filters never relax either endpoint's access requirement. No API-key permission,
  supplier/dealer grant, privileged browser client or business-table write is added.

## Implementation and verification

`dealer_return_integration_workbench(uuid,jsonb,integer,integer)` is a stable,
authenticated-only SECURITY INVOKER function with an empty search path. It reads
existing return handoffs, the copied-batch view and acknowledgement history. Strict
filters and page sizes 25/50/100 are bounded; rows and count share one statement
snapshot, and an out-of-range page resolves to the last page. Later navigation can
reflect later reports/deletions rather than claiming a frozen integration snapshot.

The shared compact green header, form, table and loading screen preserve typography,
English/Arabic RTL, accessible disclosures and keyboard-scrollable tables. The new
source-availability filter does not reuse purchase current/historical selection.
Return history, handoff and batch screens link to the workbench; other integrations
remain available through expandable navigation.

- `0127_dealer_return_integration_workbench.test.sql`: real guarded return fixtures,
  exact labels, latest-before-filter logic, missing systems, endpoint/tenant access,
  strict filters, bounded pages/ties, copied retention and no operational writes.
- `integration-workbench.test.ts`: exact label/URL round trips, family isolation and
  actual return evidence links.
- `dealer-return-integration-workbench.spec.ts`: production navigation/filtering,
  actual API reports, escaped long text, both-location grant changes, history links,
  pagination, source deletion, unchanged downloads, keyboard use and screenshots
  at 375/768/1024/1440/1920px in English and Arabic RTL.
- Existing return read/report and shared integration browser flows remain regressions.
  Do not run database and browser suites concurrently against their shared local stack.

## Local validation — 2026-10-24

- Production build, typecheck, lint, formatting and logical-CSS checks passed.
- All 2,315 web tests, 7,753 pgTAP assertions (129 files) and 498 non-database
  Python tests passed. Reversing latest-report ordering caused the targeted database
  test to fail; the original function was restored before the full passing suite.
- The new production browser workflow passed alongside eight existing return/API
  and integration regressions. Its assertions use the visible results table so
  hidden navigation caches cannot make the test ambiguous. Screenshots were inspected
  at all five widths in English and Arabic RTL; keyboard scrolling/disclosures and
  page-level overflow are checked. Copied CSV/JSON remained unchanged after source deletion.
- Validation used an isolated local Supabase stack and synthetic accounts only.

## Rollout

Apply `20261024210000_dealer_return_integration_workbench.sql` before deploying the
web caller. No backfill or existing record rewrite is required. Rollback can restore
the prior web build while retaining the additive read function. Hosted migration and
deployment are not included in this development step. External dealer access,
credits and physical receiving remain separate work.
