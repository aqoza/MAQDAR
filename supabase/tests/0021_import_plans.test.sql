-- Plan shape of the import checks and merges at 50,000 items (Step 5a). The checks and merges run
-- inside security-definer functions, which Postgres neither inlines nor lets EXPLAIN look into, so
-- this file measures what the real RPCs do with the per-transaction scan counters:
-- pg_stat_get_xact_numscans(table) counts Seq Scans and pg_stat_get_xact_numscans(index) counts
-- scans of that index in the current transaction. Each RPC call is bracketed by two readings:
-- * staging an items chunk: existing keys and brand codes are index probes (items natural key and
--   the staging key index for brands staged in the same batch), no Seq Scan on items or staging;
-- * staging supplier-item and demand chunks: item codes resolve through items_organization_id_code_key;
-- * committing supplier items and demand (stepped): no Seq Scan on items;
-- * committing items (atomic): no Seq Scan on items either (the master merges disable hash and
--   merge joins; the arbiter index of INSERT ... ON CONFLICT is probed in any case, so index counts
--   say nothing about the join).
-- Fixtures run as postgres; the RPCs run as an authenticated planner with the org_id claim. Like
-- 0014, the statistics target of 1000 samples every row, so plans do not depend on ANALYZE's sample.
begin;

select plan(19);

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-a21000000001', 'imp21-planner@test.local', now());
insert into public.organizations (id, slug, name) values
  ('00000000-0000-4000-8000-a21000000000', 'imp21-org', 'Import plans');
insert into public.memberships (organization_id, user_id, role) values
  ('00000000-0000-4000-8000-a21000000000', '00000000-0000-4000-8000-a21000000001', 'planner');

insert into public.brands (organization_id, code, name_en)
select '00000000-0000-4000-8000-a21000000000', 'BR-' || lpad(g::text, 2, '0'), 'Brand ' || g
from generate_series(1, 20) as g;
insert into public.items (organization_id, code, name_en, brand_id, product_group, unit_of_measure, unit_cost, currency)
select '00000000-0000-4000-8000-a21000000000', 'P-' || lpad(g::text, 6, '0'),
       (array['Brake pad', 'Oil filter', 'Air filter', 'Spark plug', 'Battery', 'Wiper blade', 'Clutch kit', 'Timing belt'])[1 + g % 8]
         || ' ' || lpad(((g * 7919) % 50000)::text, 5, '0'),
       b.id, 'misc', 'EA', (g % 1000)::numeric, 'SAR'
from generate_series(1, 50000) as g
join public.brands b on b.organization_id = '00000000-0000-4000-8000-a21000000000' and b.code = 'BR-' || lpad((1 + g % 20)::text, 2, '0');
insert into public.suppliers (organization_id, code, name_en, country_code, currency, lead_time_days_p50, lead_time_days_p90)
select '00000000-0000-4000-8000-a21000000000', 'S-' || g, 'Supplier ' || g, 'SA', 'SAR', 10, 30
from generate_series(1, 5) as g;
insert into public.locations (organization_id, code, name_en, location_type, country_code, timezone) values
  ('00000000-0000-4000-8000-a21000000000', 'L-1', 'Branch one', 'branch', 'SA', 'Asia/Riyadh'),
  ('00000000-0000-4000-8000-a21000000000', 'L-2', 'Branch two', 'branch', 'SA', 'Asia/Riyadh');

set local default_statistics_target = 1000;
-- Scans by parallel workers would be counted in the workers' backends, not here.
set local max_parallel_workers_per_gather = 0;
analyze public.brands;
analyze public.items;
analyze public.suppliers;
analyze public.supplier_items;
analyze public.locations;

-- Scan counters of this transaction, and the change since the last mark.
create temporary table fx_mark (k text primary key, n bigint not null) on commit drop;
create function pg_temp.counters() returns table (k text, n bigint) language sql as $$
  select x.k, pg_stat_get_xact_numscans(x.r)
  from (values
    ('items', 'public.items'::regclass),
    ('items_code', 'public.items_organization_id_code_key'::regclass),
    ('staged_rows', 'ingest.staged_rows'::regclass),
    ('staged_nk', 'ingest.staged_rows_batch_entity_nk_key'::regclass)
  ) as x (k, r);
$$;
create function pg_temp.mark() returns void language sql as $$
  delete from pg_temp.fx_mark;
  insert into pg_temp.fx_mark select * from pg_temp.counters();
$$;
create function pg_temp.delta(p_k text) returns bigint language sql as $$
  select c.n - m.n from pg_temp.counters() c join pg_temp.fx_mark m on m.k = c.k where c.k = p_k;
$$;

create function pg_temp.files(p_files jsonb) returns jsonb language sql as $$
  select jsonb_agg(f || jsonb_build_object('original_name', (f ->> 'entity') || '.csv', 'extension', 'csv', 'size_bytes', 1000,
                                           'sha256', encode(sha256(convert_to(f::text, 'UTF8')), 'hex')) order by o)
  from jsonb_array_elements(p_files) with ordinality as x (f, o);
$$;

-- The counter itself sees a Seq Scan.
do $$ begin perform pg_temp.mark(); end $$;
set local enable_indexscan = off;
set local enable_indexonlyscan = off;
set local enable_bitmapscan = off;
do $$ begin perform count(*) from public.items where organization_id = '00000000-0000-4000-8000-a21000000000'; end $$;
set local enable_indexscan = on;
set local enable_indexonlyscan = on;
set local enable_bitmapscan = on;
select is(pg_temp.delta('items'), 1::bigint, 'the counter records a deliberate Seq Scan on items');

------------------------------------------------------------------------------------------------
-- Batch A (atomic): 10 new brands and 4,990 items (2,495 renamed, 2,495 new under the new brands).
------------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-a21000000001", "role": "authenticated", "email": "imp21-planner@test.local", "org_id": "00000000-0000-4000-8000-a21000000000"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-a21000000001';
select is(
  public.import_create_batch('00000000-0000-4000-8000-a210000b0001', '00000000-0000-4000-8000-a21000000000', pg_temp.files($$[
    {"file_no": 1, "entity": "brands", "rows_total": 10, "columns": ["brand_code", "name_en"]},
    {"file_no": 2, "entity": "items", "rows_total": 4990,
     "columns": ["item_code", "name_en", "brand_code", "product_group", "unit_of_measure", "unit_cost", "currency"]}]$$)) ->> 'status',
  'staging',
  'A: the batch is created'
);
select lives_ok(
  $$select public.import_stage_chunk('00000000-0000-4000-8000-a210000b0001', 1::smallint, 1,
      (select jsonb_agg(jsonb_build_array(g, 'BX-' || lpad(g::text, 2, '0'), 'New brand ' || g, null, null, null, null) order by g)
       from generate_series(1, 10) as g)::text);
    select public.import_seal_file('00000000-0000-4000-8000-a210000b0001', 1::smallint, 10)$$,
  'A: the brands file stages and seals'
);
reset role;
do $$ begin perform pg_temp.mark(); end $$;
set local role authenticated;
select is(
  (public.import_stage_chunk('00000000-0000-4000-8000-a210000b0001', 2::smallint, 1,
     (select jsonb_agg(jsonb_build_array(g,
                         case when g % 2 = 0 then 'P-' || lpad((g * 10)::text, 6, '0') else 'N-' || lpad(g::text, 6, '0') end,
                         'Item ' || g, null,
                         case when g % 2 = 0 then 'BR-' || lpad((1 + g % 20)::text, 2, '0') else 'BX-' || lpad((1 + g % 10)::text, 2, '0') end,
                         'misc', 'EA', '1', 'SAR', null, null, null) order by g)
      from generate_series(1, 4990) as g)::text) ->> 'errors_added')::int,
  0,
  'A: the 4,990-row items chunk stages without errors'
);
reset role;
select is(pg_temp.delta('items'), 0::bigint, 'A, staging items: no Seq Scan on items');
select cmp_ok(pg_temp.delta('items_code'), '>=', 4990::bigint, 'A, staging items: existing keys are probes of items_organization_id_code_key');
select cmp_ok(pg_temp.delta('staged_nk'), '>=', 10::bigint, 'A, staging items: brands staged in the batch are found through the staging key index');
select is(pg_temp.delta('staged_rows'), 0::bigint, 'A, staging items: no Seq Scan on the staging table');

set local role authenticated;
select is(
  public.import_seal_file('00000000-0000-4000-8000-a210000b0001', 2::smallint, 4990) -> 'batch' ->> 'status',
  'validated',
  'A: the batch validates'
);
reset role;
do $$ begin perform pg_temp.mark(); end $$;
set local role authenticated;
select results_eq(
  $$select x ->> 'status', x ->> 'commit_mode', x -> 'counts' -> 'items' from (select public.import_commit_step('00000000-0000-4000-8000-a210000b0001') as x) as s$$,
  $$values ('succeeded'::text, 'atomic'::text, '{"inserted": 2495, "updated": 2495, "unchanged": 0, "deleted": 0, "skipped": 0}'::jsonb)$$,
  'A: 5,000 rows commit atomically'
);
reset role;

-- Left to the planner, 50,000 items of one organization and 4,990 staged rows make it hash-join
-- items to app.import_rows_items() over a Seq Scan of items, in the UPDATE and in the INSERT ...
-- WHERE NOT EXISTS: 2 Seq Scans, each reading every organization's items. The merges pin nested
-- loops (measured: the same 0.75 s on 5,000 rows).
select is(pg_temp.delta('items'), 0::bigint, 'A, items merge: no Seq Scan on items');

------------------------------------------------------------------------------------------------
-- Batch B (stepped): 5,000 supplier items and 10,000 demand rows over existing items.
------------------------------------------------------------------------------------------------
set local role authenticated;
select lives_ok(
  $$select public.import_create_batch('00000000-0000-4000-8000-a210000b0002', '00000000-0000-4000-8000-a21000000000', pg_temp.files($j$[
      {"file_no": 1, "entity": "supplier_items", "rows_total": 5000,
       "columns": ["supplier_code", "item_code", "lead_time_days", "unit_price", "currency"]},
      {"file_no": 2, "entity": "demand_history", "rows_total": 10000,
       "columns": ["item_code", "location_code", "demand_date", "quantity"]}]$j$))$$,
  'B: the batch is created'
);
reset role;
do $$ begin perform pg_temp.mark(); end $$;
set local role authenticated;
select is(
  (public.import_stage_chunk('00000000-0000-4000-8000-a210000b0002', 1::smallint, 1,
     (select jsonb_agg(jsonb_build_array(g, 'S-' || (1 + g % 5),
                         'P-' || lpad(g::text, 6, '0'),
                         null, '12', null, null, null, '9.5', 'SAR', null, null) order by g)
      from generate_series(1, 5000) as g)::text) ->> 'errors_added')::int,
  0,
  'B: the 5,000-row supplier-items chunk stages without errors'
);
select lives_ok(
  $$select public.import_seal_file('00000000-0000-4000-8000-a210000b0002', 1::smallint, 5000)$$,
  'B: the supplier-items file seals'
);
reset role;
select ok(
  pg_temp.delta('items') = 0 and pg_temp.delta('items_code') >= 5000,
  'B, staging supplier items: item codes are index probes, no Seq Scan on items'
);
do $$ begin perform pg_temp.mark(); end $$;
set local role authenticated;
select is(
  (public.import_stage_chunk('00000000-0000-4000-8000-a210000b0002', 2::smallint, 1,
     (select jsonb_agg(jsonb_build_array(g, 'P-' || lpad(((g * 11) % 50000 + 1)::text, 6, '0'), 'L-' || (1 + g % 2),
                         (date '2024-03-01' + g % 28)::text, '3', null, null) order by g)
      from generate_series(1, 10000) as g)::text) ->> 'errors_added')::int,
  0,
  'B: the 10,000-row demand chunk stages without errors'
);
reset role;
select ok(
  pg_temp.delta('items') = 0 and pg_temp.delta('items_code') >= 10000,
  'B, staging demand: item codes are index probes, no Seq Scan on items'
);

set local role authenticated;
select is(
  public.import_seal_file('00000000-0000-4000-8000-a210000b0002', 2::smallint, 10000) -> 'batch' ->> 'status',
  'validated',
  'B: the batch validates'
);
reset role;
do $$ begin perform pg_temp.mark(); end $$;
set local role authenticated;
do $$
declare
  v jsonb;
  i integer := 0;
begin
  loop
    v := public.import_commit_step('00000000-0000-4000-8000-a210000b0002');
    i := i + 1;
    exit when (v ->> 'done')::boolean or v ->> 'status' <> 'committing' or i >= 100;
  end loop;
end
$$;
reset role;
select ok(
  pg_temp.delta('items') = 0 and pg_temp.delta('items_code') >= 15000
  and (select status = 'succeeded' and commit_mode = 'stepped' from public.import_batches where id = '00000000-0000-4000-8000-a210000b0002'),
  'B, stepped commit of supplier items and demand: item codes are index probes, no Seq Scan on items'
);

select * from finish();

rollback;
