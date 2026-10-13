# Performance

Measurements behind the "fast at 50,000 items" goal of Step 4 and the hosting decision. Re-run them when the list queries, the indexes or the hosting change.

## Setup

- Local Supabase stack (Postgres 17, Docker Desktop on a Windows laptop) with its default settings: `shared_buffers` 128 MB, `work_mem` 4 MB, `random_page_cost` 4.
- The `large` synthetic preset: 50,000 items, 12 brands, 40 locations, 120 suppliers, 64,843 supplier items, 1,812 supersessions and 13.07 M demand rows. `vacuum (analyze)` on the master tables after loading.
- Every query runs inside a rolled-back transaction as `authenticated`, a planner of the synthetic organization with the `org_id` claim, so row-level security is active. Each query carries the explicit `organization_id` filter that the screens send. The SQL is a hand-written equivalent of what PostgREST runs for each screen.
- The script ran twice. The table shows the second, warm run.

## List queries at 50,000 items

| Screen action                             | Plan                                               | Time    | Target  |
| ----------------------------------------- | -------------------------------------------------- | ------- | ------- |
| Items, page 1 by code (with brand)        | Index scan on `(organization_id, code)`            | 4.9 ms  | < 10 ms |
| Items, exact count                        | Index-only scan                                    | 17.4 ms | < 20 ms |
| Items, last page (count + backwards read) | Count, then backward index scan                    | 18.5 ms | < 60 ms |
| Items, last page read forwards (before)   | Seq scan + external sort on disk                   | 245 ms  |         |
| Items, middle page (offset 25,000)        | Index scan over the skipped rows                   | 45.2 ms |         |
| Items, page 1 by name                     | Index scan on `items_name_idx`                     | 0.7 ms  | < 10 ms |
| Items, page 1 of one brand                | Index scan on `items_brand_idx`                    | 0.7 ms  | < 10 ms |
| Items, search with two tokens and count   | Tenant filter scan on `search_text`                | 36.7 ms | < 80 ms |
| Items, search for a rare token            | Tenant filter scan on `search_text`                | 41.7 ms | < 80 ms |
| Supplier items, page 1 with embeds        | Index scan, nested-loop embeds                     | 7.0 ms  | < 10 ms |
| Supplier items, exact count               | Seq scan (64,843 rows)                             | 25.2 ms |         |
| Supplier items, sorted by unit price      | Index-only scan on `supplier_items_unit_price_idx` | 0.5 ms  |         |
| Supplier items, sorted by lead time       | Index-only scan on `supplier_items_lead_time_idx`  | 2.4 ms  |         |
| Part-code lookup (`/api/lookup/items`)    | Tenant filter scan, top 20                         | 35.3 ms |         |

Two changes came out of the first measurement:

- **Deep pages read from the nearer end.** Offset paging makes Postgres read or sort every skipped row: the last page took 245 ms, sorting 7 MB on disk. From row 1,000 on, the list counts first and then reads the page from whichever end of the order is nearer, reversing the rows in the app (`nearestRange` in `apps/web/src/lib/master-data/list-params.ts`). The last page now costs the count plus about 1 ms. Middle pages still read the skipped rows (45 ms at offset 25,000); search and filters are the way through a long list.
- **Supplier-item sort indexes.** Sorting 64,843 supplier items by unit price took 104 ms without an index. `supplier_items_lead_time_idx` and `supplier_items_unit_price_idx` bring both sorts under 3 ms.

`supabase/tests/0014_master_data_plans.test.sql` asserts these plan shapes at 50,000 items, including the backward scans and the supplier-item sorts. It does not assert timings.

Search stays a filter scan: `LIKE` is not leakproof, so under row-level security Postgres filters the organization's rows first and matches the tokens on each one. That is about 40 ms at 50,000 items and grows linearly. The 500k-item phase needs the deferred security-definer search RPC with `pg_trgm`.

## In the browser

The Playwright scale spec (`apps/web/e2e/master-data-scale.spec.ts`) seeds 50,000 items and times each navigation end to end: request, render and paint. Against `next start` on the same laptop:

| Navigation                  | Time   |
| --------------------------- | ------ |
| First page with exact total | 1.04 s |
| Sort by name                | 0.54 s |
| Last page                   | 0.54 s |
| Search for one part code    | 0.68 s |

The spec fails above 15 s; the bound only catches regressions of an order of magnitude.

## Loading the large preset

| Run                              | Wall time | Notes                                                                                                |
| -------------------------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| Fresh load                       | 652 s     | Demand `COPY` 492 s, demand reference check 84 s                                                     |
| `--replace` load                 | 783 s     | Delete 108 s (demand rows first, then the organization cascade)                                      |
| Fresh load before the loader fix | 1,506 s   | Stale item statistics from a deleted 50,000-item test run: supplier items took 724 s instead of 14 s |

`--replace` deletes the demand rows first and switches the Step 4 delete guard off for its own transaction, so the guard costs nothing there. For everyone else the guard is one `exists` probe per organization in a deleting statement.

The slow load exposed a planner trap that later imports will meet too. After a large insert is rolled back or deleted, autovacuum can leave statistics claiming zero rows over many pages. A bulk insert of children in the same transaction then plans each foreign-key check against its parent as a scan. Reproduced in a rolled-back transaction with 8,000 items and 8,000 supplier items:

| Parent statistics                 | Foreign-key checks |
| --------------------------------- | ------------------ |
| Stale: zero rows over 1,147 pages | 10.6 s             |
| After `analyze public.items`      | 0.2 s              |

The loader now analyzes every master table right after its `COPY` (`ANALYZE` counts the transaction's own rows). The Step 5 import must do the same before loading children.

## Cloudflare Workers CPU

On 2026-10-11 the Workers dashboard showed a median CPU time of about 86 ms per request over 24 hours for the active deployment (5ade8824, the Step 3 build). The Workers Free plan allows 10 ms of CPU per request, so the app needs Workers Paid ($5 per month) whatever Step 4 adds. That is an owner decision.

The planned local CPU profile of the Step 4 pages (`cf:preview`) was not run, because the production median already decides the plan. Profile the list and edit pages if CPU cost becomes a concern on the paid plan.

## Import wizard (Step 5a)

### Through the wizard at scale

`apps/web/e2e/imports-scale.spec.ts` (`SCALE=1`) drives the wizard in Chromium against `next start` and the local stack, with the files the `large` synthetic preset generates (written to disk, never loaded by `maqdar-synth`), into a fresh organization. Times are wall clock on the same Windows laptop as above; RPC figures come from the browser's requests and from `import_batches.progress`.

| Run                                                                                                             | Rows                          | Parse in the browser | Stage and check | Commit          | End to end | Target |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------- | -------------------- | --------------- | --------------- | ---------- | ------ |
| Master bundle: 50,000 items, 64,843 supplier items, 1,812 supersessions, 120 suppliers, 40 locations, 12 brands | 116,827 in 6 files            | 1.8 s                | 30.2 s          | 61.5 s, stepped | 94 s       | 4 min  |
| Demand history, 3 months of the large preset                                                                    | 1,000,000 in 1 file (31.8 MB) | 7.9 s                | 182.9 s         | 97.0 s, stepped | 289 s      | 8 min  |

| Request or unit                | p50      | p95      | Max                                     |
| ------------------------------ | -------- | -------- | --------------------------------------- |
| Master chunk (5,000 rows)      | 850 ms   | 1,268 ms | 1,276 ms                                |
| Master seal                    | 524 ms   | 2,535 ms | 2,535 ms                                |
| Master commit unit (35 units)  | 2,143 ms | 3,395 ms | 4,345 ms (supplier items 50,001-55,000) |
| Demand chunk (10,000 rows)     | 1,614 ms | 2,391 ms | 2,926 ms                                |
| Demand commit unit (122 units) | 726 ms   | 1,164 ms | 1,449 ms (cleanup)                      |

Every unit stays well inside the 8 s statement timeout, and this run needed no retry (earlier runs, before the unit sizes were lowered, recovered from timeouts by halving). Two figures are slightly above the plan's aims: master commit units reach a p95 of 3.4 s against an aim of 3 s, and demand staging took 183 s against 180 s. Hosted compute may be slower: units then take longer and the client halves a unit that times out, so imports slow down rather than fail. Re-importing the same bundle unchanged was checked functionally (no updates, `updated_at` unchanged) in `imports.spec.ts`, not timed at this scale.

### Fixes found by measuring

Measured on the local stack (Docker, one transaction per experiment, rolled back).

| What                                                        | Before                                               | After                        |
| ----------------------------------------------------------- | ---------------------------------------------------- | ---------------------------- |
| 20,000 supersessions in one statement (cycle guard per row) | over 5 minutes (quadratic)                           | 4.2 s                        |
| Stepped commit of 20,000 supersessions                      | first 5,000-row unit 30.3 s, the others 3.2 to 4.2 s | whole file in one unit 5.3 s |
| Chunk route body handling, 5,000 items (680 KB), Node       | 21.1 ms                                              | 7.7 ms                       |

The cycle guards used a recursive CTE planned from the table's statistics; while one statement inserted thousands of rows into a table whose statistics said empty, each row's check scanned the rows inserted so far. They now walk the chain with one primary-key probe per step. A merge of 20,000 supersessions spends about 3.2 s in the insert and its three foreign-key checks and 1.6 s in the guard; stepped commits therefore merge supersession, holiday-override and location-parent files in one unit only up to 10,000 rows (about 2.7 s), well inside the 8 s statement timeout.

The chunk route no longer parses the `{"rows": "…"}` body and serializes the megabyte again for supabase-js: one scan checks that the body is exactly the client's envelope, and its JSON string literal becomes `p_rows` of the RPC body (old path: parse 3.5 ms, byte count 4 ms, stringify and encode 13 ms; medians of 25 in Node 24). Not yet measured in `cf:preview`.

Demand merges in units of 10,000 rows: in end-to-end runs the first 20,000-row unit of a fresh 100,000-row import hit the 8 s statement timeout every time, while 10,000-row units take 0.6 to 1.5 s.

For demand, a single `MERGE` (insert, update and the delete of days whose quantities are both 0) was faster than `DELETE` plus `INSERT … ON CONFLICT` for 20,000 rows: 1.1 to 1.8 s against 2.4 to 2.9 s on the insert path, and 0.7 s against 1.6 to 2.4 s when nothing changed, so `MERGE` ships. Merge targets whose statistics are far behind (zero rows over many pages, or more than twice the pages they record) are analyzed before a unit, the same trap the loader hit; demand leaf partitions are analyzed when stale, the 96-partition parent never.
