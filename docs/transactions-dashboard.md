# Transactions and dashboard

Stock snapshots, open orders and receipts are optional import-format v1 entities. CSV/Excel imports and `/api/v1/stock-snapshots`, `/api/v1/open-orders`, `/api/v1/receipts` use the same validators and atomic merges. The API requires `transactions:read` or `transactions:write`, independently; each new endpoint accepts at most 1,000 records and lists 100 by default (maximum 1,000), with UUID cursor paging and `updated_since`. Demand history retains its existing date-window pagination and limits. The generated OpenAPI document describes all 15 resources.

Snapshots are keyed by item, location and business date. Orders and receipts are keyed by external document code and line code. Repeating a feed is idempotent. An order's quantity is its remaining open quantity; send zero or a closed/canceled status when it is no longer open. Receipts are independent observations: they never increment stock or decrement an order. Each source remains authoritative, avoiding duplicate inventory movements when all three feeds arrive.

## Dashboard definitions

- The reporting day follows the active organization's configured time zone. The latest snapshot on or before that day is used for each non-discontinued item at an active, visible location. Future snapshots are excluded.
- Inventory value is physical quantity × the supplied snapshot unit cost. Totals remain separate by currency, with three decimal places; no implicit FX conversion occurs.
- A stock-out is an observed pair with quantity minus allocated quantity at or below zero. Allocations may exceed physical stock. Missing observations are unknown, never counted as stock-outs.
- Coverage counts observed pairs; unobserved pairs are all active item/location combinations minus observed pairs. This is data coverage, not a stocking policy or a recommendation to stock every part everywhere. Observations older than seven days are flagged.
- The demand chart covers the reporting day and previous 29 days, with units sold and reported lost sales. Absent days are zero by the demand contract. Historical demand includes inactive items/locations if the user can read them.

The dashboard RPC runs with invoker rights and preserves tenant and branch RLS on every relation. Its decimal totals stay as strings through the API and display; only chart coordinates use JavaScript numbers. The chart has an accompanying daily data table. The opt-in production-browser benchmark uses 50,000 items, 40 locations, 50,000 stock observations and 50,000 demand rows; it requires each of three dashboard navigations to finish within two seconds. This is a bounded local baseline, not a claim about arbitrary history volume or production network latency:

```powershell
pnpm --filter web build
$env:CI='1'
$env:DASHBOARD_SCALE='1'
pnpm --filter web exec playwright test dashboard.spec.ts
```

Step 12b adds reporting-date and location filters, observed availability and saved forecast-quality browsing. See [planning KPIs](planning-kpis.md) for their definitions and rollout.

## Audit and maintenance

Business master data and the three new transaction tables record before/after values, actor user ID, record ID and UTC time in `audit_log`. Timestamp-only updates are ignored. Demand writes record a per-organization statement summary (row count and date range) to avoid copying bulk history. API/system writes have no user actor. Owners and admins can view the latest 100 events at `/audit`; other roles cannot read the organization-wide audit data. API roles cannot insert, update or delete audit rows. Audit records survive deletion of their source rows and organizations. Credentials and key hashes are excluded by an explicit trigger-table allow-list.

Database migrations schedule two pg_cron jobs: daily partition creation from the current month through three months ahead, and import housekeeping every five minutes. Partition maintenance is idempotent and never drops history. Housekeeping expires abandoned imports, clears bounded staging batches, prunes expired quota-ledger rows and removes row-level errors 30 days after terminal completion. Import summaries and aggregate error counts remain.

Original files also expire after 30 days. Their bytes must be removed through the [Supabase Storage API](https://supabase.com/docs/guides/storage/management/delete-objects), followed by an RPC that verifies the object no longer exists before recording `source_purged_at`. A failed Storage deletion leaves the candidate eligible for retry. The hourly retention workflow processes up to 100 originals per run, with no overlapping runs. It is **disabled until the owner configures it**.

## Owner-run rollout

1. Review and apply migrations with `pnpm exec supabase db push` against the intended linked project, then deploy the app through the existing deployment process. The agent has applied migrations only to the local stack.
2. Configure GitHub repository secrets `SUPABASE_URL` and `SUPABASE_SECRET_KEY` for that project. Set repository variable `IMPORT_RETENTION_ENABLED=true` to enable the hourly workflow, then run **Import original retention** manually once and inspect its result. The credential is used only for two retention RPCs and Storage deletion; response bodies and credentials are never logged. For another scheduler, run `node scripts/import-retention.mjs` with the same environment variables.
3. Confirm `zeespare-demand-partitions` and `zeespare-import-housekeeping` in `cron.job` and inspect failures in `cron.job_run_details`. Confirm the retention workflow remains successful. The application does not claim that retention is active before this configuration is complete.

To suspend cleanup, disable the retention repository variable and deactivate the two named cron jobs. Schema rollback uses a reviewed forward migration; do not drop transaction or audit data to roll back the UI. Existing Step 5 API clients remain compatible.
