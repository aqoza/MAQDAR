# Planning runs (Step 7)

On **Forecasts**, owners, administrators and planners can check demand data for an active location and an inclusive date window of up to 1,096 days. A successful check reports eligible items, items with stored history, stored rows, days with records, positive-sales rows, sold quantity and lost-sales quantity. Quantities stay exact decimal strings. Empty history is a valid result, never a forecast of zero demand.

The default window is the last 365 days ending on the organization's current business date. Results include non-discontinued items only, use the data visible to the calculation's database statement snapshot, and record the calculation time. Later imports require a new run. Missing rows in the sparse demand feed do not establish data completeness or zero demand. No threshold labels a dataset "ready"; this step supplies evidence for the planner. No forecasts, orders, stock or policies are modified.

## Acceptance and boundaries

- AC-001: An editor submits a valid location/window and sees a queued run. Invalid windows, foreign locations, non-editor callers and stale organization forms cannot enqueue. Verify with pgTAP, action validation and the browser flow.
- AC-002: Repeating a request ID with the same inputs returns the same run; different inputs conflict. Concurrent submissions create at most one active run per organization. Verify using two independent database connections.
- AC-003: A worker claims a durable message and publishes the result and acknowledgement atomically. A crash leaves the message recoverable after visibility expiry. A replaced, expired or canceled lease cannot publish. Verify with database recovery and concurrency tests.
- AC-004: Processing errors retry after 15 then 30 seconds. A crash is retried after 120 seconds. Three claimed attempts exhaust the run; a final crashed attempt becomes failed when a worker next drains its message. Verify retry and exhaustion tests.
- AC-005: Members read only their organization's runs; branch users read only assigned locations. Only editors enqueue/cancel; workers have no raw table or queue access. Verify pgTAP and the privilege snapshot.
- AC-006: A planner sees queued/processing/completed/failed/canceled state, can cancel an active run and inspect exact readiness totals. The visible page refreshes every five seconds while a run is active. Verify the production-build browser test.

All verification targets the local Supabase stack. The technical throttle is one active run per organization and 20 new runs per rolling 24 hours (including canceled runs); this is a resource protection bound, not a billing tier. Latest 20 runs are shown. Existing runs are retained; no new retention policy is introduced.

## Queue and worker

The private `pgmq` queue contains only run IDs. `planning.leases` holds transport IDs, random lease tokens and expiration times. Neither is exposed through PostgREST. Public `planning_runs` has tenant and branch RLS, composite location foreign keys and no direct API writes. Nine private worker functions (`planning_claim`, `planning_task`, `planning_execute`, `classification_finish`, `forecast_finish`, `preparation_finish`, `policy_finish`, `simulation_finish`, `planning_fail`) are granted only to `maqdar_worker`, a NOLOGIN capability role. Public enqueue/cancel RPCs recheck live membership and the active-organization claim. See [policy simulations](policy-simulation.md) for the recorded-sales replay added in Step 21.

The Python worker uses psycopg autocommit: claim commits before processing. Readiness aggregation, run completion and queue archive then commit in one transaction. Run row locks serialize cancellation and completion; an already committed completion wins a racing cancellation. Claim uses `SKIP LOCKED` on the run after reading the queue to avoid a lock-order deadlock. Leases last 120 seconds; the worker's statement timeout is 90 seconds and lock timeout five seconds. Long calculations time out and eventually fail visibly; they do not loop forever. Remote DSNs require `sslmode=verify-full` and a trusted CA.

The transport follows [pgmq's visibility-timeout and archive API](https://pgmq.github.io/pgmq/api/sql/functions/), verified against the local extension version 1.5.1. The application fences retries with a token rather than assuming delivery alone guarantees unique side effects. Stopping all workers leaves queued/crashed runs pending; start a worker to resume them. The process handles SIGINT/SIGTERM after its current bounded statement. A lost database connection exits nonzero; use a process supervisor to restart it.

## Local use

After applying migrations locally and installing the engine dependencies:

```powershell
$env:MAQDAR_WORKER_DSN='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
cd engine
uv run maqdar-worker --once
# Or process continuously until stopped:
uv run maqdar-worker
```

Use the web form to enqueue a check first. `--once` processes at most one available message; an empty/delayed queue exits successfully. A handled processing failure records retry state and exits successfully; an unavailable database exits nonzero. No DSN, lease token or raw database exception is logged.

## Owner-run rollout and rollback

1. Review the migration and run `pnpm exec supabase db push` yourself. The agent does not apply hosted migrations. Enablement requires the hosted project's pgmq extension to be available.
2. Deploy the web build using the existing process. Provision a dedicated database LOGIN with only membership in `maqdar_worker` and database CONNECT. The migration creates the NOLOGIN capability role, never a password. Keep the LOGIN password and `MAQDAR_WORKER_DSN` in your worker host's secret store; do not use a browser or API service key. The worker explicitly runs `SET ROLE maqdar_worker` on connection.
3. Install the locked engine dependencies (`uv sync --locked`), configure a verified TLS database DSN for that login, and supervise `uv run maqdar-worker`. No hosted worker is started by this PR. Queue a small check and verify its completed result and attempt count in Forecasts.
4. For an application rollback, stop the worker and deploy the prior web version. Preserve the additive tables, queue and history. Cancel unwanted runs before rollback, or leave them for recovery. Schema removal or purging history requires a separate reviewed migration.

Step 8 adds [demand classification](demand-classification.md) as an explicit run kind with versioned inputs/results. Step 9 adds [forecast baselines](forecast-baselines.md). This foundation intentionally has no automatic schedule, no ERP export and no forecasting-model choice.

Expanded forecast runs (`expanded-v1`) use a 900-second visibility/lease and a 720-second isolated computation limit for up to 10 items. Prepared-group forecasts (`regional-v1`) reuse these limits for one saved group. Other run kinds retain the 120-second lease. See [forecast-expansion.md](forecast-expansion.md) and [prepared-forecasts.md](prepared-forecasts.md) for versioned numerical contracts and owner-run rollout.

Step 10 adds [demand preparation](demand-preparation.md): immutable related-part contributions and calendar evidence, with up to 25 selected codes expanding to 100 sources. It uses the existing 120-second lease and a guarded publication RPC; it does not alter forecasts.
