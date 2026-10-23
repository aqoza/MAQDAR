-- Plan shape of the REST API at scale (Step 5b), measured like 0021: the API RPCs are
-- security-definer PL/pgSQL, which EXPLAIN cannot look into, so each call is bracketed by two
-- readings of the per-transaction scan counters (pg_stat_get_xact_numscans: Seq Scans of a table,
-- scans of an index).
-- The organization under test holds 50,000 items, 40 locations and 156,000 demand rows over 13
-- months (2025-01 to 2026-01). Two other organizations hold 100,000 more items, interleaved on
-- disk as tenants' writes are: with one tenant alone in the table, a Seq Scan or a walk of
-- items_pkey filtered by organization costs the planner about the same as the tenant's own index,
-- so the plans would not be the ones a shared table gets (measured: at half the table, the first
-- page already walks items_pkey).
-- * Item pages (first, middle, last) read items through items_organization_id_id_key (the keyset on
--   (organization_id, id)); a page with an updated_since nothing matches reads the organization's
--   items through an organization_id index (none covers updated_at). None Seq Scans items, which
--   would read every organization's items.
-- * Demand pages in all four modes touch only the partitions of their range (plan-time pruning
--   under plan_cache_mode = force_custom_plan), through the primary key (all, item, both) or
--   demand_history_location_date_idx (location), with no Seq Scan on any partition; item codes
--   resolve through id probes (the planner picks items_pkey with the organization as a filter,
--   as cheap as the (organization_id, id) key for one row), never a Seq Scan of items. The location
--   mode reads on into the next partition only to finish the date group its incremental sort is on.
-- * A 1,000-item api_upsert (500 changed, 500 new) does not Seq Scan items.
-- Fixtures run as postgres; the API RPCs run as service_role. Like 0014 and 0021, the statistics
-- target of 1000 samples every row of the organization, so plans do not depend on ANALYZE's sample.
begin;

select plan(13);

-- The SHA-256 the Worker sends for a sample key named n.
create function pg_temp.h(n text) returns bytea language sql immutable as $$
  select sha256(convert_to('zeespare_sk_' || rpad(n, 43, 'x') || 'Ab12Cd', 'UTF8'));
$$;
create function pg_temp.b64url(p text) returns text language sql immutable as $$
  select translate(encode(convert_to(p, 'UTF8'), 'base64'), E'+/=\n', '-_');
$$;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-5b2500000001', 'api25-owner@test.local', now());
insert into public.organizations (id, slug, name) values
  ('00000000-0000-4000-8000-5b25000000aa', 'api25-org', 'API plans'),
  ('00000000-0000-4000-8000-5b25000000b1', 'api25-other-1', 'Other tenant 1'),
  ('00000000-0000-4000-8000-5b25000000b2', 'api25-other-2', 'Other tenant 2');
insert into public.memberships (organization_id, user_id, role) values
  ('00000000-0000-4000-8000-5b25000000aa', '00000000-0000-4000-8000-5b2500000001', 'owner');
insert into public.api_keys (organization_id, name, display_prefix, last4, key_hash, scopes, created_by, expires_at)
values ('00000000-0000-4000-8000-5b25000000aa', 'plans', 'zeespare_sk_Plan', 'Cd12', pg_temp.h('plans'),
        array['master_data:read', 'master_data:write', 'transactions:read', 'transactions:write'],
        '00000000-0000-4000-8000-5b2500000001', now() + interval '30 days');

insert into public.brands (organization_id, code, name_en)
select '00000000-0000-4000-8000-5b25000000aa', 'BR-' || lpad(g::text, 2, '0'), 'Brand ' || g
from generate_series(1, 20) as g;
-- 150,000 items, every third one the organization's (P-000001..P-050000), changed a day ago.
with b as (
  select array_agg(id order by code) as ids from public.brands where organization_id = '00000000-0000-4000-8000-5b25000000aa'
)
insert into public.items (organization_id, code, name_en, brand_id, product_group, unit_of_measure, unit_cost, currency, created_at, updated_at)
select case g % 3 when 0 then '00000000-0000-4000-8000-5b25000000aa'::uuid when 1 then '00000000-0000-4000-8000-5b25000000b1'::uuid
                  else '00000000-0000-4000-8000-5b25000000b2'::uuid end,
       case when g % 3 = 0 then 'P-' || lpad((g / 3)::text, 6, '0') else 'O-' || lpad(g::text, 6, '0') end,
       (array['Brake pad', 'Oil filter', 'Air filter', 'Spark plug', 'Battery', 'Wiper blade', 'Clutch kit', 'Timing belt'])[1 + g % 8]
         || ' ' || lpad(((g * 7919) % 50000)::text, 5, '0'),
       case when g % 3 = 0 then b.ids[1 + (g / 3) % 20] end, 'misc', 'EA', ((g / 3) % 1000)::numeric, 'SAR',
       now() - interval '1 day', now() - interval '1 day'
from generate_series(3, 150002) as g
cross join b;
insert into public.locations (organization_id, code, name_en, location_type, country_code, timezone)
select '00000000-0000-4000-8000-5b25000000aa', 'L-' || lpad(g::text, 2, '0'), 'Branch ' || g, 'branch', 'SA', 'Asia/Riyadh'
from generate_series(1, 40) as g;
-- Items P-000001..P-000300 at every location, one day a month, 2025-01 to 2026-01.
insert into public.demand_history (organization_id, item_id, location_id, demand_date, quantity)
select '00000000-0000-4000-8000-5b25000000aa', i.id, l.id,
       (date '2025-01-01' + make_interval(months => m))::date + (i.n * 7 + l.n * 3) % 28, 1 + (i.n + l.n + m) % 5
from (select id, substr(code, 3)::integer as n from public.items
      where organization_id = '00000000-0000-4000-8000-5b25000000aa' and code <= 'P-000300') as i
cross join (select id, substr(code, 3)::integer as n from public.locations
            where organization_id = '00000000-0000-4000-8000-5b25000000aa') as l
cross join generate_series(0, 12) as m;

set local default_statistics_target = 1000;
-- Scans by parallel workers would be counted in the workers' backends, not here.
set local max_parallel_workers_per_gather = 0;
analyze public.brands;
analyze public.items;
analyze public.locations;
analyze public.demand_history;

-- Scan counters of this transaction: Seq Scans of items, scans of its (organization_id, id) key, of
-- items_pkey and of any other index leading with organization_id, and per demand partition its Seq
-- Scans (part:), primary-key scans (pkey:) and location-index scans (loc:), keyed by the partition's
-- month. Item pages are judged by the (organization_id, id) key alone: planning a query with
-- id > ... probes items_pkey for the actual id range (get_actual_variable_range), which the
-- counters cannot tell from a scan of the plan.
create temporary table fx_mark (k text primary key, n bigint not null) on commit drop;
create function pg_temp.counters() returns table (k text, n bigint) language sql as $$
  select 'items', pg_stat_get_xact_numscans('public.items'::regclass)
  union all
  select 'items_id', pg_stat_get_xact_numscans('public.items_organization_id_id_key'::regclass)
  union all
  select 'items_pkey', pg_stat_get_xact_numscans('public.items_pkey'::regclass)
  union all
  select 'items_org', sum(pg_stat_get_xact_numscans(x.indexrelid))::bigint
  from pg_index x
  join pg_attribute a on a.attrelid = x.indrelid and a.attnum = x.indkey[0]
  where x.indrelid = 'public.items'::regclass and a.attname = 'organization_id'
    and x.indexrelid <> 'public.items_organization_id_id_key'::regclass
  union all
  select 'part:' || right(c.relname, 6), pg_stat_get_xact_numscans(c.oid)
  from pg_inherits i join pg_class c on c.oid = i.inhrelid
  where i.inhparent = 'public.demand_history'::regclass
  union all
  select case p.parent when 'public.demand_history_pkey'::regclass then 'pkey:' else 'loc:' end || right(t.relname, 6),
         pg_stat_get_xact_numscans(ix.inhrelid)
  from (values ('public.demand_history_pkey'::regclass), ('public.demand_history_location_date_idx'::regclass)) as p (parent)
  join pg_inherits ix on ix.inhparent = p.parent
  join pg_index x on x.indexrelid = ix.inhrelid
  join pg_class t on t.oid = x.indrelid;
$$;
create function pg_temp.mark() returns void language sql as $$
  delete from pg_temp.fx_mark;
  insert into pg_temp.fx_mark select * from pg_temp.counters();
$$;
create function pg_temp.delta(p_k text) returns bigint language sql as $$
  select c.n - m.n from pg_temp.counters() c join pg_temp.fx_mark m on m.k = c.k where c.k = p_k;
$$;
-- The months whose counter of the given kind (part:, pkey:, loc:) moved since the mark.
create function pg_temp.months(p_kind text) returns text language sql as $$
  select '{' || coalesce(string_agg(substr(c.k, length(p_kind) + 1), ',' order by c.k), '') || '}'
  from pg_temp.counters() c join pg_temp.fx_mark m on m.k = c.k
  where c.k like p_kind || '%' and c.n > m.n;
$$;
-- What a call scanned since the mark.
create function pg_temp.items_scans() returns text language sql as $$
  select format('items seq %s, (organization_id, id) %s, other organization_id index %s', pg_temp.delta('items'),
                case when pg_temp.delta('items_id') > 0 then 'yes' else 'no' end,
                case when pg_temp.delta('items_org') > 0 then 'yes' else 'no' end);
$$;
create function pg_temp.demand_scans() returns text language sql as $$
  select format('partitions seq %s, pkey %s, location index %s', pg_temp.months('part:'), pg_temp.months('pkey:'), pg_temp.months('loc:'));
$$;

create temporary table results (k text primary key, body json not null, items text not null, demand text not null,
                               items_seq bigint not null, items_by_id boolean not null) on commit drop;

-- One API call as service_role between two counter readings; its result and scans are kept under k.
create function pg_temp.call(p_k text, p_sql text) returns void language plpgsql as $$
declare
  v_body json;
begin
  perform pg_temp.mark();
  set local role service_role;
  execute p_sql into v_body;
  reset role;
  insert into pg_temp.results (k, body, items, demand, items_seq, items_by_id)
  values (p_k, v_body, pg_temp.items_scans(), pg_temp.demand_scans(), pg_temp.delta('items'),
          pg_temp.delta('items_id') + pg_temp.delta('items_pkey') > 0);
end;
$$;

-- The counters see a deliberate Seq Scan of items and of one demand partition.
do $$ begin perform pg_temp.mark(); end $$;
set local enable_indexscan = off;
set local enable_indexonlyscan = off;
set local enable_bitmapscan = off;
do $$ begin perform count(*) from public.items where organization_id = '00000000-0000-4000-8000-5b25000000aa'; end $$;
do $$ begin perform count(*) from public.demand_history where organization_id = '00000000-0000-4000-8000-5b25000000aa' and demand_date >= '2025-04-01' and demand_date < '2025-05-01'; end $$;
set local enable_indexscan = on;
set local enable_indexonlyscan = on;
set local enable_bitmapscan = on;
select is(
  format('items %s, partitions %s', pg_temp.delta('items'), pg_temp.months('part:')),
  'items 1, partitions {202504}',
  'the counters record a deliberate Seq Scan on items and on the one demand partition of April 2025'
);

------------------------------------------------------------------------------------------------
-- Item pages
------------------------------------------------------------------------------------------------
create temporary table item_ids on commit drop as
select row_number() over (order by i.id) as n, i.id from public.items i where i.organization_id = '00000000-0000-4000-8000-5b25000000aa';

select pg_temp.call('items first', $$select public.api_list(pg_temp.h('plans'), 'items', null, 1000)$$);
select pg_temp.call('items middle', format('select public.api_list(pg_temp.h(%L), %L, %L, 1000)', 'plans', 'items',
  pg_temp.b64url(json_build_object('v', 1, 'k', 'items', 'a', (select id from item_ids where n = 25000), 'u', null,
                                   't', '2026-01-01T00:00:00.000000Z')::text)));
select pg_temp.call('items last', format('select public.api_list(pg_temp.h(%L), %L, %L, 1000)', 'plans', 'items',
  pg_temp.b64url(json_build_object('v', 1, 'k', 'items', 'a', (select id from item_ids where n = 49500), 'u', null,
                                   't', '2026-01-01T00:00:00.000000Z')::text)));
select pg_temp.call('items since', $$select public.api_list(pg_temp.h('plans'), 'items', null, 1000, now() + interval '1 day')$$);

select is(
  (select format('%s rows, %s; %s', json_array_length(body -> 'data'), case when body ->> 'next_cursor' is null then 'last' else 'more' end, items)
   from results where k = x.k),
  x.expected,
  x.k || ' page: ' || x.description
)
from (values
  ('items first', '1000 rows, more; items seq 0, (organization_id, id) yes, other organization_id index no',
   'the keyset index items_organization_id_id_key, no Seq Scan on items'),
  ('items middle', '1000 rows, more; items seq 0, (organization_id, id) yes, other organization_id index no',
   'the keyset index items_organization_id_id_key from the cursor''s id, no Seq Scan on items'),
  ('items last', '500 rows, last; items seq 0, (organization_id, id) yes, other organization_id index no',
   'the keyset index items_organization_id_id_key to the end, no Seq Scan on items'),
  ('items since', '0 rows, last; items seq 0, (organization_id, id) no, other organization_id index yes',
   'updated_since matching nothing reads only the organization''s items (an organization_id index), no Seq Scan on items')
) as x (k, expected, description)
order by x.k;

------------------------------------------------------------------------------------------------
-- Demand pages: the range 2025-03-10..2025-05-20 lies in the partitions of 2025-03, -04 and -05
------------------------------------------------------------------------------------------------
select pg_temp.call('demand all', $$select public.api_list_demand(pg_temp.h('plans'), '2025-03-10', '2025-05-20')$$);
select pg_temp.call('demand all, page 2', format('select public.api_list_demand(pg_temp.h(%L), %L, %L, null, null, %L)',
  'plans', '2025-03-10', '2025-05-20', (select body ->> 'next_cursor' from results where k = 'demand all')));
select pg_temp.call('demand item', $$select public.api_list_demand(pg_temp.h('plans'), '2025-03-10', '2025-05-20', 'P-000007')$$);
select pg_temp.call('demand location', $$select public.api_list_demand(pg_temp.h('plans'), '2025-03-10', '2025-05-20', null, 'L-05', null, 100)$$);
select pg_temp.call('demand location, page 2', format('select public.api_list_demand(pg_temp.h(%L), %L, %L, null, %L, %L, 100)',
  'plans', '2025-03-10', '2025-05-20', 'L-05', (select body ->> 'next_cursor' from results where k = 'demand location')));
select pg_temp.call('demand both', $$select public.api_list_demand(pg_temp.h('plans'), '2025-03-10', '2025-05-20', 'P-000007', 'L-05')$$);

select is(
  (select format('%s; %s; items seq %s, items probed by id %s', case when json_array_length(body -> 'data') > 0 then 'rows' else 'empty' end,
                 demand, items_seq, case when items_by_id then 'yes' else 'no' end)
   from results where k = x.k),
  x.expected,
  x.k || ': ' || x.description
)
from (values
  ('demand all', 'rows; partitions seq {}, pkey {202503,202504,202505}, location index {}; items seq 0, items probed by id yes',
   'the primary keys of the three partitions of the range only, item codes by id probes, no Seq Scan'),
  ('demand all, page 2', 'rows; partitions seq {}, pkey {202503,202504,202505}, location index {}; items seq 0, items probed by id yes',
   'the keyset from the cursor on the same three primary keys, no Seq Scan'),
  ('demand item', 'rows; partitions seq {}, pkey {202503,202504,202505}, location index {}; items seq 0, items probed by id no',
   'a primary-key prefix (organization, item) in the three partitions only, the item by its code, no Seq Scan'),
  ('demand location', 'rows; partitions seq {}, pkey {}, location index {202503,202504}; items seq 0, items probed by id yes',
   'demand_history_location_date_idx in date order, reading on into the next partition only to finish the last date, no Seq Scan'),
  ('demand location, page 2', 'rows; partitions seq {}, pkey {}, location index {202503,202504}; items seq 0, items probed by id yes',
   'the location index from the cursor''s date, never outside the range, no Seq Scan'),
  ('demand both', 'rows; partitions seq {}, pkey {202503,202504,202505}, location index {}; items seq 0, items probed by id no',
   'a primary-key prefix (organization, item, location) in the three partitions only, no Seq Scan')
) as x (k, expected, description)
order by x.k;

------------------------------------------------------------------------------------------------
-- A 1,000-item upsert: 500 existing items renamed, 500 new ones
------------------------------------------------------------------------------------------------
select pg_temp.call('upsert items', format('select public.api_upsert(pg_temp.h(%L), %L, %L::jsonb, gen_random_uuid())::json', 'plans', 'items',
  (select jsonb_build_object('records', jsonb_agg(jsonb_build_object(
            'item_code', case when g % 2 = 0 then 'P-' || lpad((g * 50)::text, 6, '0') else 'N-' || lpad(g::text, 6, '0') end,
            'name_en', 'Item ' || g, 'brand_code', 'BR-' || lpad((1 + g % 20)::text, 2, '0'), 'product_group', 'misc',
            'unit_of_measure', 'EA', 'unit_cost', '1', 'currency', 'SAR') order by g))
   from generate_series(1, 1000) as g)::text));

select is(
  (select format('%s recorded %s: %s', body ->> 'result', body ->> 'recorded', (body -> 'counts')::jsonb) from results where k = 'upsert items'),
  format('succeeded recorded true: %s', '{"inserted": 500, "updated": 500, "unchanged": 0, "deleted": 0, "skipped": 0}'::jsonb),
  'upsert items: 500 updated and 500 inserted in one recorded write'
);
select is(
  (select split_part(items, ',', 1) from results where k = 'upsert items'),
  'items seq 0',
  'upsert items: no Seq Scan on items (keys, brand codes and merges are index probes)'
);

select * from finish();

rollback;
