-- Step 5a import merges, through the RPCs a planner calls (create, stage, seal, commit):
-- * insert, update and unchanged counts for every entity; the provided columns change, the
--   unprovided ones keep their stored values, and new rows get the table defaults (compared with a
--   row inserted directly with the same columns);
-- * unchanged rows are not written at all: same ctid, updated_at and search_text, and a re-import
--   of the same files changes nothing;
-- * preferred-supplier switch, supersession successor replacement, reversed interchange and fx
--   pair orientation (replaced only when the file maps direction or rate), location parents
--   defined later in the same file, holiday update by (scope, start), an empty cell clearing a
--   nullable column;
-- * demand: upsert, 0/0 delete, an unprovided quantity keeps the stored value, zero rows for new
--   keys are skipped with a warning;
-- * atomic path: a merge that fails (a supersession cycle planted after validation) leaves every
--   target table unchanged and the batch invalid;
-- * stepped path (6,000 demand rows in units of 3,000): an item deleted after validation, and again
--   between steps, fails the unit that merges its rows with changed_during_commit and keeps the
--   cursor; a creator demoted to viewer gets MQ403; import_resume after re-adding the item finishes;
-- * staging rows carrying another organization's id inside a batch are ignored;
-- * app.import_prepare_stats analyzes a parent whose statistics claim zero rows over many pages,
--   fires the 10 % rule and never touches the demand_history parent; a stepped unit refreshes the
--   statistics of its own target, which the units before it grew;
-- * a stepped commit forced into one-row units still merges a holiday file and a supersession file
--   in one unit each, so a reversal or freed range spread over the file never meets the old edge.
-- Fixtures and checks run as postgres; every import call runs as the planner with the org_id claim.
-- Stored rows get updated_at 2020-01-01 so a write (updated_at = now()) is visible in the same
-- transaction.
begin;

select plan(99);

------------------------------------------------------------------------------------------------
-- Fixture (as postgres). A: the importing organization; B: same codes, must never change;
-- R: reference rows inserted directly with only the columns the import files provide.
------------------------------------------------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-a18000000001', 'imp18-planner@test.local', now());
insert into public.organizations (id, slug, name) values
  ('00000000-0000-4000-8000-a18000000000', 'imp18-org-a', 'Import merge A'),
  ('00000000-0000-4000-8000-b18000000000', 'imp18-org-b', 'Import merge B'),
  ('00000000-0000-4000-8000-c18000000000', 'imp18-org-r', 'Import merge reference rows');
insert into public.memberships (organization_id, user_id, role) values
  ('00000000-0000-4000-8000-a18000000000', '00000000-0000-4000-8000-a18000000001', 'planner');

create function pg_temp.cal(p_code text) returns uuid language sql stable as
  $$select id from public.work_calendars where organization_id = '00000000-0000-4000-8000-a18000000000' and code = p_code$$;
create function pg_temp.loc(p_code text) returns uuid language sql stable as
  $$select id from public.locations where organization_id = '00000000-0000-4000-8000-a18000000000' and code = p_code$$;
create function pg_temp.brand(p_code text) returns uuid language sql stable as
  $$select id from public.brands where organization_id = '00000000-0000-4000-8000-a18000000000' and code = p_code$$;
create function pg_temp.item(p_code text) returns uuid language sql stable as
  $$select id from public.items where organization_id = '00000000-0000-4000-8000-a18000000000' and code = p_code$$;
create function pg_temp.sup(p_code text) returns uuid language sql stable as
  $$select id from public.suppliers where organization_id = '00000000-0000-4000-8000-a18000000000' and code = p_code$$;

insert into public.work_calendars (organization_id, code, name_en, name_ar, country_code, weekend_days, observe_public_holidays, is_active, updated_at) values
  ('00000000-0000-4000-8000-a18000000000', 'CAL-1', 'Calendar one', null, 'SA', '{5,6}', true, true, '2020-01-01 00:00:00+00'),
  ('00000000-0000-4000-8000-a18000000000', 'CAL-2', 'Calendar two', 'تقويم', 'SA', '{6,7}', false, false, '2020-01-01 00:00:00+00'),
  ('00000000-0000-4000-8000-b18000000000', 'CAL-1', 'B calendar', null, 'AE', '{6,7}', true, true, '2020-01-01 00:00:00+00');
insert into public.holiday_overrides (organization_id, country_code, starts_on, ends_on, kind, name_en, name_ar, note, updated_at) values
  ('00000000-0000-4000-8000-a18000000000', 'SA', '2026-03-01', '2026-03-01', 'closure', 'Stocktake', 'جرد', 'keep', '2020-01-01 00:00:00+00'),
  ('00000000-0000-4000-8000-a18000000000', 'SA', '2026-04-01', '2026-04-02', 'working_day', 'Extra day', null, null, '2020-01-01 00:00:00+00');
insert into public.locations (organization_id, code, name_en, name_ar, location_type, country_code, city, latitude, longitude, timezone, work_calendar_id, updated_at) values
  ('00000000-0000-4000-8000-a18000000000', 'L-1', 'Riyadh DC', null, 'central', 'SA', null, null, null, 'Asia/Riyadh', null, '2020-01-01 00:00:00+00'),
  ('00000000-0000-4000-8000-a18000000000', 'L-2', 'Jeddah branch', 'فرع جدة', 'branch', 'SA', 'Jeddah', 21.5, 39.2, 'Asia/Riyadh', pg_temp.cal('CAL-1'), '2020-01-01 00:00:00+00'),
  ('00000000-0000-4000-8000-b18000000000', 'L-1', 'B DC', null, 'central', 'AE', null, null, null, 'Asia/Dubai', null, '2020-01-01 00:00:00+00');
insert into public.network_links (organization_id, from_location_id, to_location_id, lead_time_days_p50, lead_time_days_p90, freight_basis, freight_cost, currency, updated_at) values
  ('00000000-0000-4000-8000-a18000000000', pg_temp.loc('L-1'), pg_temp.loc('L-2'), 2, 4, 'per_unit', 1.5, 'SAR', '2020-01-01 00:00:00+00'),
  ('00000000-0000-4000-8000-a18000000000', pg_temp.loc('L-2'), pg_temp.loc('L-1'), 3, 5, 'none', null, null, '2020-01-01 00:00:00+00');
insert into public.brands (organization_id, code, name_en, name_ar, brand_type, country_of_origin, is_active, updated_at) values
  ('00000000-0000-4000-8000-a18000000000', 'BR-1', 'Falcon', null, null, null, true, '2020-01-01 00:00:00+00'),
  ('00000000-0000-4000-8000-a18000000000', 'BR-2', 'Desert', 'صحراء', 'aftermarket', 'SA', false, '2020-01-01 00:00:00+00'),
  ('00000000-0000-4000-8000-b18000000000', 'BR-1', 'B brand', null, null, null, true, '2020-01-01 00:00:00+00');
insert into public.items (organization_id, code, name_en, name_ar, brand_id, product_group, unit_of_measure, unit_cost, currency, status, introduced_on, updated_at) values
  ('00000000-0000-4000-8000-a18000000000', 'P-1', 'Part one', 'قطعة ١', pg_temp.brand('BR-1'), 'battery', 'EA', 10, 'SAR', 'active', null, '2020-01-01 00:00:00+00'),
  ('00000000-0000-4000-8000-a18000000000', 'P-2', 'Part two', 'قطعة', pg_temp.brand('BR-2'), 'filter', 'SET', 20, 'SAR', 'phase_out', '2024-01-01', '2020-01-01 00:00:00+00');
insert into public.items (organization_id, code, name_en, product_group, unit_of_measure, unit_cost, currency, updated_at)
select '00000000-0000-4000-8000-a18000000000', c, 'Part ' || substr(c, 3), 'misc', 'EA', 1, 'SAR', '2020-01-01 00:00:00+00'
from unnest(array['P-3', 'P-4', 'P-5', 'P-6', 'P-7', 'P-8', 'P-9', 'P-10', 'P-11', 'P-12', 'P-13', 'P-S1', 'P-S2']) as c;
insert into public.items (organization_id, code, name_en, product_group, unit_of_measure, unit_cost, currency, updated_at) values
  ('00000000-0000-4000-8000-b18000000000', 'P-1', 'B part one', 'misc', 'EA', 1, 'KWD', '2020-01-01 00:00:00+00'),
  ('00000000-0000-4000-8000-b18000000000', 'P-B', 'B only', 'misc', 'EA', 1, 'KWD', '2020-01-01 00:00:00+00');
insert into public.item_supersessions (organization_id, predecessor_item_id, successor_item_id, effective_on, quantity_factor, note, updated_at) values
  ('00000000-0000-4000-8000-a18000000000', pg_temp.item('P-1'), pg_temp.item('P-2'), '2025-01-01', 2, 'keep', '2020-01-01 00:00:00+00'),
  ('00000000-0000-4000-8000-a18000000000', pg_temp.item('P-12'), pg_temp.item('P-13'), '2025-02-01', 1, null, '2020-01-01 00:00:00+00');
insert into public.item_interchanges (organization_id, item_id, alternate_item_id, direction, priority, note, updated_at) values
  ('00000000-0000-4000-8000-a18000000000', pg_temp.item('P-4'), pg_temp.item('P-5'), 'one_way', 3, 'keep', '2020-01-01 00:00:00+00'),
  ('00000000-0000-4000-8000-a18000000000', pg_temp.item('P-8'), pg_temp.item('P-9'), 'two_way', 1, null, '2020-01-01 00:00:00+00');
insert into public.suppliers (organization_id, code, name_en, name_ar, country_code, currency, lead_time_days_p50, lead_time_days_p90, is_active, work_calendar_id, updated_at) values
  ('00000000-0000-4000-8000-a18000000000', 'S-1', 'Supplier one', null, 'JP', 'JPY', 30, 45, true, null, '2020-01-01 00:00:00+00'),
  ('00000000-0000-4000-8000-a18000000000', 'S-2', 'Supplier two', 'مورد', 'KR', 'USD', 20, 30, false, pg_temp.cal('CAL-2'), '2020-01-01 00:00:00+00'),
  ('00000000-0000-4000-8000-b18000000000', 'S-1', 'B supplier', null, 'JP', 'JPY', 30, 45, true, null, '2020-01-01 00:00:00+00');
insert into public.supplier_items (organization_id, supplier_id, item_id, supplier_part_number, lead_time_days, lead_time_days_p90, min_order_quantity, pack_size, unit_price, currency, is_preferred, valid_from, updated_at) values
  ('00000000-0000-4000-8000-a18000000000', pg_temp.sup('S-1'), pg_temp.item('P-1'), null, 10, null, 0, 1, 1000, 'JPY', true, null, '2020-01-01 00:00:00+00'),
  ('00000000-0000-4000-8000-a18000000000', pg_temp.sup('S-2'), pg_temp.item('P-1'), 'KR-77', 15, 30, 2, 5, 9, 'USD', false, '2025-01-01', '2020-01-01 00:00:00+00');
insert into public.fx_rates (organization_id, from_currency, to_currency, valid_from, rate, note, updated_at) values
  ('00000000-0000-4000-8000-a18000000000', 'USD', 'SAR', '2026-01-01', 3.75, 'keep', '2020-01-01 00:00:00+00'),
  ('00000000-0000-4000-8000-a18000000000', 'AED', 'SAR', '2026-01-01', 1.02, null, '2020-01-01 00:00:00+00');
insert into public.demand_history (organization_id, item_id, location_id, demand_date, quantity, lost_sales_quantity) values
  ('00000000-0000-4000-8000-a18000000000', pg_temp.item('P-1'), pg_temp.loc('L-1'), '2024-01-01', 5, 0),
  ('00000000-0000-4000-8000-a18000000000', pg_temp.item('P-1'), pg_temp.loc('L-1'), '2024-01-02', 3, 1),
  ('00000000-0000-4000-8000-a18000000000', pg_temp.item('P-1'), pg_temp.loc('L-1'), '2024-01-03', 2, 0),
  ('00000000-0000-4000-8000-a18000000000', pg_temp.item('P-1'), pg_temp.loc('L-1'), '2024-01-04', 7, 2),
  ('00000000-0000-4000-8000-b18000000000',
   (select id from public.items where organization_id = '00000000-0000-4000-8000-b18000000000' and code = 'P-1'),
   (select id from public.locations where organization_id = '00000000-0000-4000-8000-b18000000000' and code = 'L-1'),
   '2024-01-02', 8, 0);

-- Reference rows in R, inserted with exactly the columns the M1/D1 files provide for new rows.
insert into public.work_calendars (organization_id, code, name_en, country_code) values
  ('00000000-0000-4000-8000-c18000000000', 'REF', 'Reference', 'AE');
insert into public.holiday_overrides (organization_id, work_calendar_id, starts_on, ends_on, kind, name_en)
select '00000000-0000-4000-8000-c18000000000', w.id, '2026-05-01', '2026-05-02', 'closure', 'Reference'
from public.work_calendars w where w.organization_id = '00000000-0000-4000-8000-c18000000000' and w.code = 'REF';
insert into public.locations (organization_id, code, name_en, location_type, country_code, timezone) values
  ('00000000-0000-4000-8000-c18000000000', 'REF-1', 'Reference one', 'branch', 'SA', 'Asia/Riyadh'),
  ('00000000-0000-4000-8000-c18000000000', 'REF-2', 'Reference two', 'branch', 'SA', 'Asia/Riyadh');
insert into public.network_links (organization_id, from_location_id, to_location_id, lead_time_days_p50, lead_time_days_p90)
select '00000000-0000-4000-8000-c18000000000', a.id, b.id, 1, 2
from public.locations a, public.locations b
where a.organization_id = '00000000-0000-4000-8000-c18000000000' and a.code = 'REF-1'
  and b.organization_id = '00000000-0000-4000-8000-c18000000000' and b.code = 'REF-2';
insert into public.brands (organization_id, code, name_en) values
  ('00000000-0000-4000-8000-c18000000000', 'REF', 'Reference');
insert into public.items (organization_id, code, name_en, product_group, unit_of_measure, unit_cost, currency) values
  ('00000000-0000-4000-8000-c18000000000', 'REF-1', 'Reference one', 'misc', 'EA', 5.5, 'SAR'),
  ('00000000-0000-4000-8000-c18000000000', 'REF-2', 'Reference two', 'misc', 'EA', 1, 'SAR');
insert into public.item_supersessions (organization_id, predecessor_item_id, successor_item_id, effective_on)
select '00000000-0000-4000-8000-c18000000000', a.id, b.id, '2025-03-01'
from public.items a, public.items b
where a.organization_id = '00000000-0000-4000-8000-c18000000000' and a.code = 'REF-1'
  and b.organization_id = '00000000-0000-4000-8000-c18000000000' and b.code = 'REF-2';
insert into public.item_interchanges (organization_id, item_id, alternate_item_id)
select '00000000-0000-4000-8000-c18000000000', a.id, b.id
from public.items a, public.items b
where a.organization_id = '00000000-0000-4000-8000-c18000000000' and a.code = 'REF-1'
  and b.organization_id = '00000000-0000-4000-8000-c18000000000' and b.code = 'REF-2';
insert into public.suppliers (organization_id, code, name_en, country_code, currency, lead_time_days_p50, lead_time_days_p90) values
  ('00000000-0000-4000-8000-c18000000000', 'REF', 'Reference', 'DE', 'EUR', 40, 60);
insert into public.supplier_items (organization_id, supplier_id, item_id, lead_time_days, unit_price, currency)
select '00000000-0000-4000-8000-c18000000000', s.id, i.id, 40, 12.5, 'EUR'
from public.suppliers s, public.items i
where s.organization_id = '00000000-0000-4000-8000-c18000000000' and s.code = 'REF'
  and i.organization_id = '00000000-0000-4000-8000-c18000000000' and i.code = 'REF-1';
insert into public.fx_rates (organization_id, from_currency, to_currency, valid_from, rate) values
  ('00000000-0000-4000-8000-c18000000000', 'EUR', 'SAR', '2026-01-01', 4.1);
insert into public.demand_history (organization_id, item_id, location_id, demand_date, quantity)
select '00000000-0000-4000-8000-c18000000000', i.id, l.id, '2024-01-05', 6
from public.items i, public.locations l
where i.organization_id = '00000000-0000-4000-8000-c18000000000' and i.code = 'REF-1'
  and l.organization_id = '00000000-0000-4000-8000-c18000000000' and l.code = 'REF-1';

------------------------------------------------------------------------------------------------
-- Harness: import files as rows of JSON objects; helpers build the manifest and the chunks and
-- drive the RPCs. They are security invoker, so the RPCs run as the impersonated planner.
------------------------------------------------------------------------------------------------
create temporary table fx_files (
  batch_id uuid not null,
  file_no integer not null,
  entity text not null,
  columns text[] not null,
  rows jsonb not null,
  primary key (batch_id, file_no)
) on commit drop;
create temporary table fx_contract on commit drop as
select c.entity, c.position, c.name, e.load_order
from ingest.contract_columns c
join ingest.contract_entities e on e.entity = c.entity;
grant select on fx_files, fx_contract to authenticated;

-- The p_files manifest of a batch.
create function pg_temp.manifest(p_batch uuid) returns jsonb language sql stable as $$
  select jsonb_agg(jsonb_build_object(
           'file_no', f.file_no, 'entity', f.entity, 'original_name', f.entity || '.csv', 'extension', 'csv',
           'content_type', 'text/csv', 'size_bytes', 1000,
           'sha256', encode(sha256(convert_to(p_batch::text || ':' || f.file_no::text, 'UTF8')), 'hex'),
           'rows_total', jsonb_array_length(f.rows), 'columns', to_jsonb(f.columns))
         order by f.file_no)
  from pg_temp.fx_files f
  where f.batch_id = p_batch;
$$;

-- Rows p_first..p_last of a file as chunk JSON: [row_no, cells in contract order], a string for
-- every column the file provides (a missing key is an empty cell) and null for the others.
create function pg_temp.chunk(p_batch uuid, p_file_no integer, p_first integer, p_last integer) returns text language sql stable as $$
  select jsonb_agg(jsonb_build_array(r.ord) || (
           select jsonb_agg(case when c.name = any (f.columns) then to_jsonb(coalesce(r.obj ->> c.name, '')) else 'null'::jsonb end
                            order by c.position)
           from pg_temp.fx_contract c
           where c.entity = f.entity)
         order by r.ord)::text
  from pg_temp.fx_files f
  cross join lateral jsonb_array_elements(f.rows) with ordinality as r(obj, ord)
  where f.batch_id = p_batch and f.file_no = p_file_no and r.ord between p_first and p_last;
$$;

-- Creates the batch, stages every file in load order in chunks of p_chunk rows and seals it.
create function pg_temp.stage(p_batch uuid, p_chunk integer default 5000) returns text language plpgsql as $$
declare
  f record;
  v_first integer;
begin
  perform public.import_create_batch(p_batch, '00000000-0000-4000-8000-a18000000000', pg_temp.manifest(p_batch));
  for f in
    select x.file_no, jsonb_array_length(x.rows) as n
    from pg_temp.fx_files x
    join (select distinct c.entity, c.load_order from pg_temp.fx_contract c) as e on e.entity = x.entity
    where x.batch_id = p_batch
    order by e.load_order, x.file_no
  loop
    v_first := 1;
    while v_first <= f.n loop
      perform public.import_stage_chunk(p_batch, f.file_no::smallint, v_first,
                                        pg_temp.chunk(p_batch, f.file_no, v_first, least(v_first + p_chunk - 1, f.n)));
      v_first := v_first + p_chunk;
    end loop;
    perform public.import_seal_file(p_batch, f.file_no::smallint, f.n);
  end loop;
  return (select b.status from public.import_batches b where b.id = p_batch);
end;
$$;

-- Commit steps until the batch stops committing. Returns the last step's result.
create function pg_temp.commit(p_batch uuid, p_max_rows integer default null) returns jsonb language plpgsql as $$
declare
  v jsonb;
  i integer := 0;
begin
  loop
    v := public.import_commit_step(p_batch, p_max_rows);
    i := i + 1;
    exit when (v ->> 'done')::boolean or v ->> 'status' <> 'committing' or i >= 500;
  end loop;
  return v;
end;
$$;

-- Every row version of an organization's target rows: an UPDATE, even one that changes nothing,
-- gives the row a new ctid.
create function pg_temp.versions(p_org uuid) returns text language sql stable as $$
  select coalesce(string_agg(x.v, ',' order by x.v), '')
  from (
    select 'work_calendars ' || ctid::text || ' ' || updated_at::text as v from public.work_calendars where organization_id = p_org
    union all select 'holiday_overrides ' || ctid::text || ' ' || updated_at::text from public.holiday_overrides where organization_id = p_org
    union all select 'locations ' || ctid::text || ' ' || updated_at::text from public.locations where organization_id = p_org
    union all select 'network_links ' || ctid::text || ' ' || updated_at::text from public.network_links where organization_id = p_org
    union all select 'brands ' || ctid::text || ' ' || updated_at::text from public.brands where organization_id = p_org
    union all select 'items ' || ctid::text || ' ' || updated_at::text from public.items where organization_id = p_org
    union all select 'item_supersessions ' || ctid::text || ' ' || updated_at::text from public.item_supersessions where organization_id = p_org
    union all select 'item_interchanges ' || ctid::text || ' ' || updated_at::text from public.item_interchanges where organization_id = p_org
    union all select 'suppliers ' || ctid::text || ' ' || updated_at::text from public.suppliers where organization_id = p_org
    union all select 'supplier_items ' || ctid::text || ' ' || updated_at::text from public.supplier_items where organization_id = p_org
    union all select 'fx_rates ' || ctid::text || ' ' || updated_at::text from public.fx_rates where organization_id = p_org
    union all select 'demand_history ' || tableoid::regclass::text || ' ' || ctid::text from public.demand_history where organization_id = p_org
  ) as x;
$$;

-- The rows M1 must leave alone (identical in the file) and the rows it updates.
create function pg_temp.m1_rows(p_changed boolean) returns table (t text, v text, updated_at timestamptz) language sql stable as $$
  select 'work_calendars', ctid::text, updated_at from public.work_calendars
  where organization_id = '00000000-0000-4000-8000-a18000000000' and code = case when p_changed then 'CAL-2' else 'CAL-1' end
  union all
  select 'holiday_overrides', ctid::text, updated_at from public.holiday_overrides
  where organization_id = '00000000-0000-4000-8000-a18000000000' and country_code = 'SA'
    and starts_on = case when p_changed then date '2026-03-01' else date '2026-04-01' end
  union all
  select 'locations', ctid::text, updated_at from public.locations
  where organization_id = '00000000-0000-4000-8000-a18000000000' and code = case when p_changed then 'L-2' else 'L-1' end
  union all
  select 'network_links', ctid::text, updated_at from public.network_links
  where organization_id = '00000000-0000-4000-8000-a18000000000'
    and from_location_id = pg_temp.loc(case when p_changed then 'L-1' else 'L-2' end)
    and to_location_id = pg_temp.loc(case when p_changed then 'L-2' else 'L-1' end)
  union all
  select 'brands', ctid::text, updated_at from public.brands
  where organization_id = '00000000-0000-4000-8000-a18000000000' and code = case when p_changed then 'BR-2' else 'BR-1' end
  union all
  select 'items', ctid::text, updated_at from public.items
  where organization_id = '00000000-0000-4000-8000-a18000000000' and code = case when p_changed then 'P-2' else 'P-1' end
  union all
  select 'item_supersessions', ctid::text, updated_at from public.item_supersessions
  where organization_id = '00000000-0000-4000-8000-a18000000000'
    and predecessor_item_id = pg_temp.item(case when p_changed then 'P-1' else 'P-12' end)
  union all
  select 'item_interchanges', ctid::text, updated_at from public.item_interchanges
  where organization_id = '00000000-0000-4000-8000-a18000000000'
    and least(item_id, alternate_item_id) = least(pg_temp.item(case when p_changed then 'P-4' else 'P-8' end),
                                                  pg_temp.item(case when p_changed then 'P-5' else 'P-9' end))
    and greatest(item_id, alternate_item_id) = greatest(pg_temp.item(case when p_changed then 'P-4' else 'P-8' end),
                                                        pg_temp.item(case when p_changed then 'P-5' else 'P-9' end))
  union all
  select 'suppliers', ctid::text, updated_at from public.suppliers
  where organization_id = '00000000-0000-4000-8000-a18000000000' and code = case when p_changed then 'S-2' else 'S-1' end
  union all
  select 'supplier_items', ctid::text, updated_at from public.supplier_items
  where organization_id = '00000000-0000-4000-8000-a18000000000'
    and supplier_id = pg_temp.sup(case when p_changed then 'S-2' else 'S-1' end) and item_id = pg_temp.item('P-1')
  union all
  select 'fx_rates', ctid::text, updated_at from public.fx_rates
  where organization_id = '00000000-0000-4000-8000-a18000000000' and valid_from = '2026-01-01'
    and least(from_currency, to_currency) = case when p_changed then 'SAR' else 'AED' end
    and greatest(from_currency, to_currency) = case when p_changed then 'USD' else 'SAR' end;
$$;

create temporary table fx_b_before on commit drop as
select pg_temp.versions('00000000-0000-4000-8000-b18000000000') as v;
create temporary table fx_m1_unchanged on commit drop as
select * from pg_temp.m1_rows(false);
create temporary table fx_search on commit drop as
select code, search_text from public.items where organization_id = '00000000-0000-4000-8000-a18000000000' and code in ('P-1', 'P-2');

------------------------------------------------------------------------------------------------
-- M1: every master entity, files mapping only the key and the columns new rows need; each file
-- has one unchanged row, one update and one insert.
------------------------------------------------------------------------------------------------
insert into fx_files values
  ('00000000-0000-4000-8000-a180000b0001', 1, 'work_calendars', array['work_calendar_code', 'name_en', 'country_code'], $j$[
    {"work_calendar_code": "CAL-1", "name_en": "Calendar one", "country_code": "SA"},
    {"work_calendar_code": "CAL-2", "name_en": "Calendar two (renamed)", "country_code": "SA"},
    {"work_calendar_code": "CAL-3", "name_en": "Calendar three", "country_code": "AE"}]$j$),
  ('00000000-0000-4000-8000-a180000b0001', 2, 'holiday_overrides',
   array['country_code', 'work_calendar_code', 'starts_on', 'ends_on', 'kind', 'name_en'], $j$[
    {"country_code": "SA", "starts_on": "2026-03-01", "ends_on": "2026-03-02", "kind": "closure", "name_en": "Stocktake"},
    {"country_code": "SA", "starts_on": "2026-04-01", "ends_on": "2026-04-02", "kind": "working_day", "name_en": "Extra day"},
    {"work_calendar_code": "CAL-1", "starts_on": "2026-05-01", "ends_on": "2026-05-02", "kind": "closure", "name_en": "Inventory"}]$j$),
  ('00000000-0000-4000-8000-a180000b0001', 3, 'locations',
   array['location_code', 'name_en', 'location_type', 'country_code', 'timezone'], $j$[
    {"location_code": "L-1", "name_en": "Riyadh DC", "location_type": "central", "country_code": "SA", "timezone": "Asia/Riyadh"},
    {"location_code": "L-2", "name_en": "Jeddah hub", "location_type": "hub", "country_code": "SA", "timezone": "Asia/Riyadh"},
    {"location_code": "L-3", "name_en": "Dammam branch", "location_type": "branch", "country_code": "SA", "timezone": "Asia/Riyadh"}]$j$),
  ('00000000-0000-4000-8000-a180000b0001', 4, 'network_links',
   array['from_location_code', 'to_location_code', 'lead_time_days_p50', 'lead_time_days_p90'], $j$[
    {"from_location_code": "L-1", "to_location_code": "L-2", "lead_time_days_p50": "3", "lead_time_days_p90": "5"},
    {"from_location_code": "L-2", "to_location_code": "L-1", "lead_time_days_p50": "3", "lead_time_days_p90": "5"},
    {"from_location_code": "L-1", "to_location_code": "L-3", "lead_time_days_p50": "1", "lead_time_days_p90": "2"}]$j$),
  ('00000000-0000-4000-8000-a180000b0001', 5, 'brands', array['brand_code', 'name_en'], $j$[
    {"brand_code": "BR-1", "name_en": "Falcon"},
    {"brand_code": "BR-2", "name_en": "Desert Gold"},
    {"brand_code": "BR-3", "name_en": "Oasis"}]$j$),
  ('00000000-0000-4000-8000-a180000b0001', 6, 'items',
   array['item_code', 'name_en', 'product_group', 'unit_of_measure', 'unit_cost', 'currency'], $j$[
    {"item_code": "P-1", "name_en": "Part one", "product_group": "battery", "unit_of_measure": "EA", "unit_cost": "10", "currency": "SAR"},
    {"item_code": "P-2", "name_en": "Part two (revised)", "product_group": "filter", "unit_of_measure": "SET", "unit_cost": "20", "currency": "SAR"},
    {"item_code": "P-NEW", "name_en": "New part", "product_group": "misc", "unit_of_measure": "EA", "unit_cost": "5.5", "currency": "SAR"}]$j$),
  ('00000000-0000-4000-8000-a180000b0001', 7, 'item_supersessions',
   array['predecessor_item_code', 'successor_item_code', 'effective_on'], $j$[
    {"predecessor_item_code": "P-1", "successor_item_code": "P-3", "effective_on": "2025-01-01"},
    {"predecessor_item_code": "P-12", "successor_item_code": "P-13", "effective_on": "2025-02-01"},
    {"predecessor_item_code": "P-10", "successor_item_code": "P-11", "effective_on": "2025-03-01"}]$j$),
  ('00000000-0000-4000-8000-a180000b0001', 8, 'item_interchanges', array['item_code', 'alternate_item_code', 'direction'], $j$[
    {"item_code": "P-5", "alternate_item_code": "P-4", "direction": "one_way"},
    {"item_code": "P-8", "alternate_item_code": "P-9", "direction": "two_way"},
    {"item_code": "P-6", "alternate_item_code": "P-7", "direction": "two_way"}]$j$),
  ('00000000-0000-4000-8000-a180000b0001', 9, 'suppliers',
   array['supplier_code', 'name_en', 'country_code', 'currency', 'lead_time_days_p50', 'lead_time_days_p90'], $j$[
    {"supplier_code": "S-1", "name_en": "Supplier one", "country_code": "JP", "currency": "JPY", "lead_time_days_p50": "30", "lead_time_days_p90": "45"},
    {"supplier_code": "S-2", "name_en": "Supplier two (Seoul)", "country_code": "KR", "currency": "USD", "lead_time_days_p50": "20", "lead_time_days_p90": "30"},
    {"supplier_code": "S-3", "name_en": "Supplier three", "country_code": "DE", "currency": "EUR", "lead_time_days_p50": "40", "lead_time_days_p90": "60"}]$j$),
  ('00000000-0000-4000-8000-a180000b0001', 10, 'supplier_items',
   array['supplier_code', 'item_code', 'lead_time_days', 'unit_price', 'currency'], $j$[
    {"supplier_code": "S-1", "item_code": "P-1", "lead_time_days": "10", "unit_price": "1000", "currency": "JPY"},
    {"supplier_code": "S-2", "item_code": "P-1", "lead_time_days": "20", "unit_price": "9", "currency": "USD"},
    {"supplier_code": "S-3", "item_code": "P-NEW", "lead_time_days": "40", "unit_price": "12.5", "currency": "EUR"}]$j$),
  ('00000000-0000-4000-8000-a180000b0001', 11, 'fx_rates', array['from_currency', 'to_currency', 'valid_from', 'rate'], $j$[
    {"from_currency": "SAR", "to_currency": "USD", "valid_from": "2026-01-01", "rate": "0.2666666667"},
    {"from_currency": "AED", "to_currency": "SAR", "valid_from": "2026-01-01", "rate": "1.02"},
    {"from_currency": "EUR", "to_currency": "SAR", "valid_from": "2026-01-01", "rate": "4.1"}]$j$);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-a18000000001", "role": "authenticated", "email": "imp18-planner@test.local", "org_id": "00000000-0000-4000-8000-a18000000000"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-a18000000001';
select is(pg_temp.stage('00000000-0000-4000-8000-a180000b0001'), 'validated', 'M1: eleven master files stage and seal without errors');
select is(pg_temp.commit('00000000-0000-4000-8000-a180000b0001') ->> 'status', 'succeeded', 'M1: the commit succeeds');
reset role;

select results_eq(
  $$select status, commit_mode, error_count, warning_count from public.import_batches where id = '00000000-0000-4000-8000-a180000b0001'$$,
  $$values ('succeeded'::text, 'atomic'::text, 0, 11)$$,
  'M1: 33 rows commit atomically; the only warnings are the eleven missing originals'
);
select results_eq(
  $$select key, value from jsonb_each((select counts from public.import_batches where id = '00000000-0000-4000-8000-a180000b0001')) order by key$$,
  $$values
    ('brands'::text, '{"inserted": 1, "updated": 1, "unchanged": 1, "deleted": 0, "skipped": 0}'::jsonb),
    ('fx_rates', '{"inserted": 1, "updated": 1, "unchanged": 1, "deleted": 0, "skipped": 0}'),
    ('holiday_overrides', '{"inserted": 1, "updated": 1, "unchanged": 1, "deleted": 0, "skipped": 0}'),
    ('item_interchanges', '{"inserted": 1, "updated": 1, "unchanged": 1, "deleted": 0, "skipped": 0}'),
    ('item_supersessions', '{"inserted": 1, "updated": 1, "unchanged": 1, "deleted": 0, "skipped": 0}'),
    ('items', '{"inserted": 1, "updated": 1, "unchanged": 1, "deleted": 0, "skipped": 0}'),
    ('locations', '{"inserted": 1, "updated": 1, "unchanged": 1, "deleted": 0, "skipped": 0}'),
    ('network_links', '{"inserted": 1, "updated": 1, "unchanged": 1, "deleted": 0, "skipped": 0}'),
    ('supplier_items', '{"inserted": 1, "updated": 1, "unchanged": 1, "deleted": 0, "skipped": 0, "preferred_cleared": 0}'),
    ('suppliers', '{"inserted": 1, "updated": 1, "unchanged": 1, "deleted": 0, "skipped": 0}'),
    ('work_calendars', '{"inserted": 1, "updated": 1, "unchanged": 1, "deleted": 0, "skipped": 0}')$$,
  'M1: one insert, one update and one unchanged row for every entity'
);

-- Unchanged rows are not written; updated rows are.
select results_eq(
  $$select t, v, updated_at from pg_temp.m1_rows(false) order by t$$,
  $$select t, v, updated_at from fx_m1_unchanged order by t$$,
  'M1: the eleven identical rows keep their ctid and updated_at (no UPDATE touched them)'
);
select is(
  (select count(*)::int from pg_temp.m1_rows(true) where updated_at = now()),
  11,
  'M1: the eleven changed rows were updated (updated_at is now)'
);
select is(
  (select search_text from public.items where organization_id = '00000000-0000-4000-8000-a18000000000' and code = 'P-1'),
  (select search_text from fx_search where code = 'P-1'),
  'M1: the unchanged item keeps its search_text'
);
select ok(
  (select search_text like '%revised%' and search_text <> (select search_text from fx_search where code = 'P-2')
   from public.items where organization_id = '00000000-0000-4000-8000-a18000000000' and code = 'P-2'),
  'M1: the renamed item has its search_text recomputed'
);

-- Updates: provided columns change, unprovided columns keep their stored values.
select is(
  (select row(name_en, name_ar, country_code, weekend_days, observe_public_holidays, is_active)::text
   from public.work_calendars where organization_id = '00000000-0000-4000-8000-a18000000000' and code = 'CAL-2'),
  row('Calendar two (renamed)', 'تقويم', 'SA'::char(2), '{6,7}'::smallint[], false, false)::text,
  'work_calendars: the name changes; name_ar, weekend days, holidays flag and is_active are kept'
);
select is(
  (select row(ends_on, kind, name_en, name_ar, note)::text
   from public.holiday_overrides where organization_id = '00000000-0000-4000-8000-a18000000000' and country_code = 'SA' and starts_on = '2026-03-01'),
  row('2026-03-02'::date, 'closure', 'Stocktake', 'جرد', 'keep')::text,
  'holiday_overrides: the override is matched by (scope, start) and its end moves; name_ar and note are kept'
);
select is(
  (select row(name_en, location_type, name_ar, city, latitude, longitude, is_active, work_calendar_id = pg_temp.cal('CAL-1'))::text
   from public.locations where organization_id = '00000000-0000-4000-8000-a18000000000' and code = 'L-2'),
  row('Jeddah hub', 'hub', 'فرع جدة', 'Jeddah', 21.5::numeric(9,6), 39.2::numeric(9,6), true, true)::text,
  'locations: name and type change; name_ar, city, coordinates, is_active and calendar are kept'
);
select is(
  (select row(lead_time_days_p50, lead_time_days_p90, freight_basis, freight_cost, currency, is_active)::text
   from public.network_links where organization_id = '00000000-0000-4000-8000-a18000000000'
     and from_location_id = pg_temp.loc('L-1') and to_location_id = pg_temp.loc('L-2')),
  row(3, 5, 'per_unit', 1.5::numeric(18,3), 'SAR'::char(3), true)::text,
  'network_links: lead times change; the freight terms and is_active are kept'
);
select is(
  (select row(name_en, name_ar, brand_type, country_of_origin, is_active)::text
   from public.brands where organization_id = '00000000-0000-4000-8000-a18000000000' and code = 'BR-2'),
  row('Desert Gold', 'صحراء', 'aftermarket', 'SA'::char(2), false)::text,
  'brands: the name changes; name_ar, type, origin and is_active are kept'
);
select is(
  (select row(name_en, name_ar, brand_id = pg_temp.brand('BR-2'), status, introduced_on, discontinued_on)::text
   from public.items where organization_id = '00000000-0000-4000-8000-a18000000000' and code = 'P-2'),
  row('Part two (revised)', 'قطعة', true, 'phase_out', '2024-01-01'::date, null::date)::text,
  'items: the name changes; name_ar, brand, status and dates are kept'
);
select is(
  (select row(count(*), bool_and(successor_item_id = pg_temp.item('P-3')), min(quantity_factor), min(note))::text
   from public.item_supersessions where organization_id = '00000000-0000-4000-8000-a18000000000' and predecessor_item_id = pg_temp.item('P-1')),
  row(1::bigint, true, 2::numeric(18,3), 'keep')::text,
  'item_supersessions: the predecessor keeps one row whose successor is replaced; quantity factor and note are kept'
);
select is(
  (select row(count(*), bool_and(item_id = pg_temp.item('P-5') and alternate_item_id = pg_temp.item('P-4')), min(direction), min(priority), min(note))::text
   from public.item_interchanges where organization_id = '00000000-0000-4000-8000-a18000000000'
     and pg_temp.item('P-4') in (item_id, alternate_item_id)),
  row(1::bigint, true, 'one_way', 3::smallint, 'keep')::text,
  'item_interchanges: a reversed pair that maps direction rewrites the stored orientation; priority and note are kept'
);
select is(
  (select row(name_en, name_ar, is_active, work_calendar_id = pg_temp.cal('CAL-2'))::text
   from public.suppliers where organization_id = '00000000-0000-4000-8000-a18000000000' and code = 'S-2'),
  row('Supplier two (Seoul)', 'مورد', false, true)::text,
  'suppliers: the name changes; name_ar, is_active and calendar are kept'
);
select is(
  (select row(lead_time_days, lead_time_days_p90, supplier_part_number, min_order_quantity, pack_size, is_preferred, valid_from)::text
   from public.supplier_items where organization_id = '00000000-0000-4000-8000-a18000000000'
     and supplier_id = pg_temp.sup('S-2') and item_id = pg_temp.item('P-1')),
  row(20, 30, 'KR-77', 2::numeric(18,3), 5::numeric(18,3), false, '2025-01-01'::date)::text,
  'supplier_items: the lead time changes; p90, part number, order quantities, preferred flag and valid_from are kept'
);
select is(
  (select row(count(*), min(from_currency), min(to_currency), min(rate), min(note))::text
   from public.fx_rates where organization_id = '00000000-0000-4000-8000-a18000000000' and valid_from = '2026-01-01'
     and 'USD' in (from_currency, to_currency)),
  row(1::bigint, 'SAR'::char(3), 'USD'::char(3), 0.2666666667::numeric(20,10), 'keep')::text,
  'fx_rates: a reversed pair that maps rate rewrites the stored orientation and rate; the note is kept'
);

-- Inserts: the columns a file does not provide get the table defaults, the same as a row
-- inserted directly with the same columns (organization R).
select is(
  (select row(name_ar, weekend_days, observe_public_holidays, is_active)::text from public.work_calendars
   where organization_id = '00000000-0000-4000-8000-a18000000000' and code = 'CAL-3'),
  (select row(name_ar, weekend_days, observe_public_holidays, is_active)::text from public.work_calendars
   where organization_id = '00000000-0000-4000-8000-c18000000000' and code = 'REF'),
  'work_calendars: a new row gets the defaults of the columns the file does not provide'
);
select is(
  (select row(country_code, name_ar, note)::text from public.holiday_overrides
   where organization_id = '00000000-0000-4000-8000-a18000000000' and work_calendar_id = pg_temp.cal('CAL-1')),
  (select row(country_code, name_ar, note)::text from public.holiday_overrides
   where organization_id = '00000000-0000-4000-8000-c18000000000'),
  'holiday_overrides: a new row gets the defaults of the columns the file does not provide'
);
select is(
  (select row(name_ar, city, latitude, longitude, parent_location_id, is_active, work_calendar_id)::text from public.locations
   where organization_id = '00000000-0000-4000-8000-a18000000000' and code = 'L-3'),
  (select row(name_ar, city, latitude, longitude, parent_location_id, is_active, work_calendar_id)::text from public.locations
   where organization_id = '00000000-0000-4000-8000-c18000000000' and code = 'REF-1'),
  'locations: a new row gets the defaults of the columns the file does not provide'
);
select is(
  (select row(freight_basis, freight_cost, currency, is_active)::text from public.network_links
   where organization_id = '00000000-0000-4000-8000-a18000000000' and to_location_id = pg_temp.loc('L-3')),
  (select row(freight_basis, freight_cost, currency, is_active)::text from public.network_links
   where organization_id = '00000000-0000-4000-8000-c18000000000'),
  'network_links: a new row gets the defaults of the columns the file does not provide'
);
select is(
  (select row(name_ar, brand_type, country_of_origin, is_active)::text from public.brands
   where organization_id = '00000000-0000-4000-8000-a18000000000' and code = 'BR-3'),
  (select row(name_ar, brand_type, country_of_origin, is_active)::text from public.brands
   where organization_id = '00000000-0000-4000-8000-c18000000000' and code = 'REF'),
  'brands: a new row gets the defaults of the columns the file does not provide'
);
select is(
  (select row(name_ar, brand_id, status, introduced_on, discontinued_on, unit_cost)::text from public.items
   where organization_id = '00000000-0000-4000-8000-a18000000000' and code = 'P-NEW'),
  (select row(name_ar, brand_id, status, introduced_on, discontinued_on, unit_cost)::text from public.items
   where organization_id = '00000000-0000-4000-8000-c18000000000' and code = 'REF-1'),
  'items: a new row gets the defaults of the columns the file does not provide'
);
select is(
  (select row(quantity_factor, note)::text from public.item_supersessions
   where organization_id = '00000000-0000-4000-8000-a18000000000' and predecessor_item_id = pg_temp.item('P-10')),
  (select row(quantity_factor, note)::text from public.item_supersessions
   where organization_id = '00000000-0000-4000-8000-c18000000000'),
  'item_supersessions: a new row gets the defaults of the columns the file does not provide'
);
select is(
  (select row(direction, priority, note)::text from public.item_interchanges
   where organization_id = '00000000-0000-4000-8000-a18000000000' and pg_temp.item('P-6') in (item_id, alternate_item_id)),
  (select row(direction, priority, note)::text from public.item_interchanges
   where organization_id = '00000000-0000-4000-8000-c18000000000'),
  'item_interchanges: a new row gets the defaults of the columns the file does not provide'
);
select is(
  (select row(name_ar, is_active, work_calendar_id)::text from public.suppliers
   where organization_id = '00000000-0000-4000-8000-a18000000000' and code = 'S-3'),
  (select row(name_ar, is_active, work_calendar_id)::text from public.suppliers
   where organization_id = '00000000-0000-4000-8000-c18000000000' and code = 'REF'),
  'suppliers: a new row gets the defaults of the columns the file does not provide'
);
select is(
  (select row(supplier_part_number, lead_time_days_p90, min_order_quantity, pack_size, is_preferred, valid_from)::text
   from public.supplier_items where organization_id = '00000000-0000-4000-8000-a18000000000' and supplier_id = pg_temp.sup('S-3')),
  (select row(supplier_part_number, lead_time_days_p90, min_order_quantity, pack_size, is_preferred, valid_from)::text
   from public.supplier_items where organization_id = '00000000-0000-4000-8000-c18000000000'),
  'supplier_items: a new row gets the defaults of the columns the file does not provide'
);
select is(
  (select row(rate, note)::text from public.fx_rates
   where organization_id = '00000000-0000-4000-8000-a18000000000' and from_currency = 'EUR'),
  (select row(rate, note)::text from public.fx_rates
   where organization_id = '00000000-0000-4000-8000-c18000000000'),
  'fx_rates: a new row gets the defaults of the columns the file does not provide'
);

------------------------------------------------------------------------------------------------
-- M2: location parents defined later in the same file, the preferred-supplier switch, an empty
-- cell clearing a nullable column.
------------------------------------------------------------------------------------------------
insert into fx_files values
  ('00000000-0000-4000-8000-a180000b0002', 1, 'locations',
   array['location_code', 'name_en', 'location_type', 'country_code', 'timezone', 'parent_location_code'], $j$[
    {"location_code": "L-10", "name_en": "Khobar branch", "location_type": "branch", "country_code": "SA", "timezone": "Asia/Riyadh", "parent_location_code": "L-11"},
    {"location_code": "L-11", "name_en": "Eastern hub", "location_type": "hub", "country_code": "SA", "timezone": "Asia/Riyadh", "parent_location_code": "L-1"},
    {"location_code": "L-2", "name_en": "Jeddah hub", "location_type": "hub", "country_code": "SA", "timezone": "Asia/Riyadh", "parent_location_code": ""}]$j$),
  ('00000000-0000-4000-8000-a180000b0002', 2, 'items', array['item_code', 'name_ar'], $j$[
    {"item_code": "P-2", "name_ar": ""},
    {"item_code": "P-1", "name_ar": "قطعة ١"}]$j$),
  ('00000000-0000-4000-8000-a180000b0002', 3, 'supplier_items', array['supplier_code', 'item_code', 'is_preferred'], $j$[
    {"supplier_code": "S-2", "item_code": "P-1", "is_preferred": "true"},
    {"supplier_code": "S-3", "item_code": "P-NEW", "is_preferred": "false"}]$j$);

set local role authenticated;
select is(pg_temp.stage('00000000-0000-4000-8000-a180000b0002'), 'validated', 'M2: parents defined later in the file stage without errors');
select is(pg_temp.commit('00000000-0000-4000-8000-a180000b0002') ->> 'status', 'succeeded', 'M2: the commit succeeds');
reset role;

select results_eq(
  $$select key, value from jsonb_each((select counts from public.import_batches where id = '00000000-0000-4000-8000-a180000b0002')) order by key$$,
  $$values
    ('items'::text, '{"inserted": 0, "updated": 1, "unchanged": 1, "deleted": 0, "skipped": 0}'::jsonb),
    ('locations', '{"inserted": 2, "updated": 0, "unchanged": 1, "deleted": 0, "skipped": 0, "parents_set": 2}'),
    ('supplier_items', '{"inserted": 0, "updated": 1, "unchanged": 1, "deleted": 0, "skipped": 0, "preferred_cleared": 1}')$$,
  'M2: counts include the parents set in the second pass and the preferred row cleared'
);
select results_eq(
  $$select l.code, p.code from public.locations l left join public.locations p on p.id = l.parent_location_id
    where l.organization_id = '00000000-0000-4000-8000-a18000000000' and l.code in ('L-2', 'L-10', 'L-11') order by l.code$$,
  $$values ('L-10'::text, 'L-11'::text), ('L-11', 'L-1'), ('L-2', null)$$,
  'locations: a parent defined later in the same file is set; an empty parent stays empty'
);
select is(
  (select name_ar from public.items where organization_id = '00000000-0000-4000-8000-a18000000000' and code = 'P-2'),
  null,
  'items: an empty cell clears a nullable column'
);
select results_eq(
  $$select s.code, si.is_preferred from public.supplier_items si join public.suppliers s on s.id = si.supplier_id
    where si.organization_id = '00000000-0000-4000-8000-a18000000000' and si.item_id = pg_temp.item('P-1') order by s.code$$,
  $$values ('S-1'::text, false), ('S-2', true)$$,
  'supplier_items: a new preferred supplier clears the previous one'
);

------------------------------------------------------------------------------------------------
-- M3: the M1 files again change nothing.
------------------------------------------------------------------------------------------------
insert into fx_files
select '00000000-0000-4000-8000-a180000b0003', file_no, entity, columns, rows
from fx_files where batch_id = '00000000-0000-4000-8000-a180000b0001';
create temporary table fx_before_m3 on commit drop as
select pg_temp.versions('00000000-0000-4000-8000-a18000000000') as v;

set local role authenticated;
select is(pg_temp.stage('00000000-0000-4000-8000-a180000b0003'), 'validated', 'M3: the M1 files stage again');
select is(pg_temp.commit('00000000-0000-4000-8000-a180000b0003') ->> 'status', 'succeeded', 'M3: the commit succeeds');
reset role;

select is(
  (select count(*)::int from jsonb_each((select counts from public.import_batches where id = '00000000-0000-4000-8000-a180000b0003')) as c
   where (c.value ->> 'inserted')::int = 0 and (c.value ->> 'updated')::int = 0 and (c.value ->> 'unchanged')::int = 3),
  11,
  'M3: every entity reports 0 inserted, 0 updated, 3 unchanged'
);
select is(
  pg_temp.versions('00000000-0000-4000-8000-a18000000000'),
  (select v from fx_before_m3),
  'M3: no row of the organization was written (same ctid and updated_at everywhere)'
);

------------------------------------------------------------------------------------------------
-- D1, D2: demand upsert, 0/0 delete, unprovided quantities, zero rows for new keys.
------------------------------------------------------------------------------------------------
insert into fx_files values
  ('00000000-0000-4000-8000-a180000b0004', 1, 'demand_history', array['item_code', 'location_code', 'demand_date', 'quantity'], $j$[
    {"item_code": "P-1", "location_code": "L-1", "demand_date": "2024-01-01", "quantity": "5"},
    {"item_code": "P-1", "location_code": "L-1", "demand_date": "2024-01-02", "quantity": "4"},
    {"item_code": "P-1", "location_code": "L-1", "demand_date": "2024-01-03", "quantity": "0"},
    {"item_code": "P-1", "location_code": "L-1", "demand_date": "2024-01-04", "quantity": "0"},
    {"item_code": "P-1", "location_code": "L-1", "demand_date": "2024-01-05", "quantity": "6"},
    {"item_code": "P-1", "location_code": "L-1", "demand_date": "2024-01-06", "quantity": "0"}]$j$),
  ('00000000-0000-4000-8000-a180000b0005', 1, 'demand_history', array['item_code', 'location_code', 'demand_date', 'lost_sales_quantity'], $j$[
    {"item_code": "P-1", "location_code": "L-1", "demand_date": "2024-01-02", "lost_sales_quantity": "9"},
    {"item_code": "P-1", "location_code": "L-1", "demand_date": "2024-01-04", "lost_sales_quantity": "0"},
    {"item_code": "P-1", "location_code": "L-1", "demand_date": "2024-01-05", "lost_sales_quantity": "0"},
    {"item_code": "P-2", "location_code": "L-1", "demand_date": "2024-01-07", "lost_sales_quantity": "0"},
    {"item_code": "P-2", "location_code": "L-1", "demand_date": "2024-01-08", "lost_sales_quantity": "1.5"}]$j$);

set local role authenticated;
select is(pg_temp.stage('00000000-0000-4000-8000-a180000b0004'), 'validated', 'D1: the quantity-only demand file validates (warnings only)');
select is(pg_temp.commit('00000000-0000-4000-8000-a180000b0004') ->> 'status', 'succeeded', 'D1: the commit succeeds');
reset role;

select results_eq(
  $$select row_no, column_name, code, level from public.import_errors
    where batch_id = '00000000-0000-4000-8000-a180000b0004' and row_no > 0$$,
  $$values (6, ''::text, 'zero_row_new_key'::text, 'warning'::text)$$,
  'D1: a zero row for a key that does not exist is a warning'
);
select is(
  (select counts -> 'demand_history' from public.import_batches where id = '00000000-0000-4000-8000-a180000b0004'),
  '{"inserted": 1, "updated": 2, "unchanged": 1, "deleted": 1, "skipped": 1}'::jsonb,
  'D1: one insert, two updates, one unchanged, one 0/0 delete, one skipped zero row'
);
select results_eq(
  $$select demand_date, quantity, lost_sales_quantity from public.demand_history
    where organization_id = '00000000-0000-4000-8000-a18000000000' and item_id = pg_temp.item('P-1') order by demand_date$$,
  $$values ('2024-01-01'::date, 5::numeric, 0::numeric), ('2024-01-02', 4, 1), ('2024-01-04', 0, 2), ('2024-01-05', 6, 0)$$,
  'D1: quantities upserted; the unprovided lost sales kept; 0 with stored lost sales updates, 0/0 deletes; the zero new key is not inserted'
);
select is(
  (select lost_sales_quantity from public.demand_history
   where organization_id = '00000000-0000-4000-8000-a18000000000' and item_id = pg_temp.item('P-1') and demand_date = '2024-01-05'),
  (select lost_sales_quantity from public.demand_history where organization_id = '00000000-0000-4000-8000-c18000000000'),
  'D1: a new demand row gets the default lost sales, as a direct insert does'
);

set local role authenticated;
select is(pg_temp.stage('00000000-0000-4000-8000-a180000b0005'), 'validated', 'D2: the lost-sales-only demand file validates');
select is(pg_temp.commit('00000000-0000-4000-8000-a180000b0005') ->> 'status', 'succeeded', 'D2: the commit succeeds');
reset role;

select is(
  (select counts -> 'demand_history' from public.import_batches where id = '00000000-0000-4000-8000-a180000b0005'),
  '{"inserted": 1, "updated": 1, "unchanged": 1, "deleted": 1, "skipped": 1}'::jsonb,
  'D2: one insert, one update, one unchanged, one 0/0 delete, one skipped zero row'
);
select results_eq(
  $$select i.code, d.demand_date, d.quantity, d.lost_sales_quantity from public.demand_history d join public.items i on i.id = d.item_id
    where d.organization_id = '00000000-0000-4000-8000-a18000000000' order by i.code, d.demand_date$$,
  $$values ('P-1'::text, '2024-01-01'::date, 5::numeric, 0::numeric), ('P-1', '2024-01-02', 4, 9), ('P-1', '2024-01-05', 6, 0), ('P-2', '2024-01-08', 0, 1.5)$$,
  'D2: lost sales upserted while the unprovided quantity keeps its stored value; 0/0 deletes'
);

------------------------------------------------------------------------------------------------
-- F1: atomic failure. A supersession planted after validation turns the file's P-7 -> P-8 into a
-- cycle; the brands and items merged before it are rolled back too.
------------------------------------------------------------------------------------------------
insert into fx_files values
  ('00000000-0000-4000-8000-a180000b0006', 1, 'brands', array['brand_code', 'name_en'], $j$[
    {"brand_code": "BR-F1", "name_en": "Failed brand"}]$j$),
  ('00000000-0000-4000-8000-a180000b0006', 2, 'items',
   array['item_code', 'name_en', 'product_group', 'unit_of_measure', 'unit_cost', 'currency'], $j$[
    {"item_code": "P-F1", "name_en": "Failed part", "product_group": "misc", "unit_of_measure": "EA", "unit_cost": "1", "currency": "SAR"},
    {"item_code": "P-3", "name_en": "Part three renamed", "product_group": "misc", "unit_of_measure": "EA", "unit_cost": "1", "currency": "SAR"}]$j$),
  ('00000000-0000-4000-8000-a180000b0006', 3, 'item_supersessions',
   array['predecessor_item_code', 'successor_item_code', 'effective_on'], $j$[
    {"predecessor_item_code": "P-7", "successor_item_code": "P-8", "effective_on": "2025-06-01"}]$j$);

set local role authenticated;
select is(pg_temp.stage('00000000-0000-4000-8000-a180000b0006'), 'validated', 'F1: the batch validates');
reset role;

insert into public.item_supersessions (organization_id, predecessor_item_id, successor_item_id, effective_on)
values ('00000000-0000-4000-8000-a18000000000', pg_temp.item('P-8'), pg_temp.item('P-7'), '2025-06-01');
create temporary table fx_before_f1 on commit drop as
select pg_temp.versions('00000000-0000-4000-8000-a18000000000') as v;

set local role authenticated;
select is(pg_temp.commit('00000000-0000-4000-8000-a180000b0006') ->> 'status', 'invalid', 'F1: the failed atomic commit returns the batch to invalid');
reset role;

select results_eq(
  $$select status, commit_mode, failure_code from public.import_batches where id = '00000000-0000-4000-8000-a180000b0006'$$,
  $$values ('invalid'::text, 'atomic'::text, 'supersession_cycle'::text)$$,
  'F1: the failure is recorded as supersession_cycle'
);
select results_eq(
  $$select file_no::int, row_no, code, level, detail ->> 'phase', detail ->> 'sqlstate' from public.import_errors
    where batch_id = '00000000-0000-4000-8000-a180000b0006' and level = 'error'$$,
  $$values (3, 0, 'supersession_cycle'::text, 'error'::text, 'commit'::text, 'MQ422'::text)$$,
  'F1: one file-level error on the supersession file, from the commit phase'
);
select is(
  pg_temp.versions('00000000-0000-4000-8000-a18000000000'),
  (select v from fx_before_f1),
  'F1: every target table is unchanged (the brand and item merged before the failure are rolled back)'
);
select results_eq(
  $$select (select count(*)::int from public.brands where organization_id = '00000000-0000-4000-8000-a18000000000' and code = 'BR-F1'),
           (select count(*)::int from public.items where organization_id = '00000000-0000-4000-8000-a18000000000' and code = 'P-F1'),
           (select name_en from public.items where organization_id = '00000000-0000-4000-8000-a18000000000' and code = 'P-3')$$,
  $$values (0, 0, 'Part 3'::text)$$,
  'F1: no new brand or item and the renamed item keeps its name'
);

set local role authenticated;
select throws_ok(
  $$select public.import_commit_step('00000000-0000-4000-8000-a180000b0006')$$,
  'MQ409', 'the import is invalid',
  'F1: an invalid batch cannot be committed again'
);
select is(
  public.import_cancel_step('00000000-0000-4000-8000-a180000b0006') ->> 'status',
  'canceled',
  'F1: the invalid batch is canceled'
);

------------------------------------------------------------------------------------------------
-- P1: a staged row rewritten to carry organization B's id (and a B-only code) is ignored by the
-- commit-phase checks and the merge.
------------------------------------------------------------------------------------------------
reset role;
insert into fx_files values
  ('00000000-0000-4000-8000-a180000b0007', 1, 'items',
   array['item_code', 'name_en', 'product_group', 'unit_of_measure', 'unit_cost', 'currency'], $j$[
    {"item_code": "P-1", "name_en": "Part one", "product_group": "battery", "unit_of_measure": "EA", "unit_cost": "10", "currency": "SAR"},
    {"item_code": "P-20", "name_en": "Part twenty", "product_group": "misc", "unit_of_measure": "EA", "unit_cost": "1", "currency": "SAR"},
    {"item_code": "P-21", "name_en": "Part twenty-one", "product_group": "misc", "unit_of_measure": "EA", "unit_cost": "1", "currency": "SAR"}]$j$);

set local role authenticated;
select is(pg_temp.stage('00000000-0000-4000-8000-a180000b0007'), 'validated', 'P1: the batch validates');
reset role;

update ingest.staged_rows
set organization_id = '00000000-0000-4000-8000-b18000000000', nk = 'P-B', cells[1] = 'P-B', cells[2] = 'Hijacked'
where batch_id = '00000000-0000-4000-8000-a180000b0007' and file_no = 1 and row_no = 2;

set local role authenticated;
select is(pg_temp.commit('00000000-0000-4000-8000-a180000b0007') ->> 'status', 'succeeded', 'P1: the commit succeeds');
reset role;

select is(
  (select counts -> 'items' from public.import_batches where id = '00000000-0000-4000-8000-a180000b0007'),
  '{"inserted": 1, "updated": 0, "unchanged": 1, "deleted": 0, "skipped": 0}'::jsonb,
  'P1: only the two rows of the organization are merged'
);
select results_eq(
  $$select code from public.items where organization_id = '00000000-0000-4000-8000-a18000000000' and code in ('P-20', 'P-21', 'P-B') order by code$$,
  $$values ('P-21'::text)$$,
  'P1: the planted row reached neither organization A (no P-20, no P-B) ...'
);
select is(
  (select name_en from public.items where organization_id = '00000000-0000-4000-8000-b18000000000' and code = 'P-B'),
  'B only',
  'P1: ... nor organization B'
);

------------------------------------------------------------------------------------------------
-- S1: stepped commit of 6,000 demand rows in units of 3,000 (rows 3,001-6,000 are P-S2).
------------------------------------------------------------------------------------------------
insert into fx_files
select '00000000-0000-4000-8000-a180000b0008', 1, 'demand_history', array['item_code', 'location_code', 'demand_date', 'quantity'],
       jsonb_agg(jsonb_build_object(
         'item_code', case when g <= 3000 then 'P-S1' else 'P-S2' end,
         'location_code', 'L-' || (1 + ((g - 1) / 1000) % 3),
         'demand_date', (date '2023-01-01' + (g - 1) % 1000)::text,
         'quantity', '2') order by g)
from generate_series(1, 6000) as g;

set local role authenticated;
select is(pg_temp.stage('00000000-0000-4000-8000-a180000b0008', 10000), 'validated', 'S1: 6,000 demand rows validate');
reset role;

-- Deleted after validation: the unit with its rows fails, the unit before it stays applied.
delete from public.items where organization_id = '00000000-0000-4000-8000-a18000000000' and code = 'P-S2';

set local role authenticated;
select is(pg_temp.commit('00000000-0000-4000-8000-a180000b0008', 3000) ->> 'status', 'failed', 'S1: the stepped commit fails at the unit whose item is gone');
reset role;

select results_eq(
  $$select b.status, b.commit_mode, b.failure_code, b.progress ->> 'phase', (b.progress ->> 'through_row')::int, f.status, f.merged_through_row
    from public.import_batches b join public.import_files f on f.batch_id = b.id
    where b.id = '00000000-0000-4000-8000-a180000b0008'$$,
  $$values ('failed'::text, 'stepped'::text, 'changed_during_commit'::text, 'merge'::text, 3000, 'sealed'::text, 3000)$$,
  'S1: failed with changed_during_commit; the cursor stays after row 3,000'
);
select results_eq(
  $$select count(*)::int, min(row_no), max(row_no) from public.import_errors
    where batch_id = '00000000-0000-4000-8000-a180000b0008' and code = 'unknown_reference' and column_name = 'item_code'
      and value = 'P-S2' and detail ->> 'phase' = 'commit'$$,
  $$values (3000, 3001, 6000)$$,
  'S1: every row of the failed unit is reported as unknown_reference in the commit phase'
);
select is(
  (select count(*)::int from public.demand_history
   where organization_id = '00000000-0000-4000-8000-a18000000000' and item_id = pg_temp.item('P-S1')),
  3000,
  'S1: the first unit (rows 1-3,000) stays applied'
);

set local role authenticated;
select throws_ok(
  $$select public.import_commit_step('00000000-0000-4000-8000-a180000b0008', 3000)$$,
  'MQ409', 'the import is failed',
  'S1: a failed batch takes no further steps until it is resumed'
);
reset role;

insert into public.items (organization_id, code, name_en, product_group, unit_of_measure, unit_cost, currency)
values ('00000000-0000-4000-8000-a18000000000', 'P-S2', 'Stepped P-S2 again', 'misc', 'EA', 1, 'SAR');
update public.memberships set role = 'viewer'
where organization_id = '00000000-0000-4000-8000-a18000000000' and user_id = '00000000-0000-4000-8000-a18000000001';

set local role authenticated;
select throws_ok(
  $$select public.import_resume('00000000-0000-4000-8000-a180000b0008')$$,
  'MQ403', null,
  'S1: the creator, now a viewer, cannot resume'
);
reset role;
update public.memberships set role = 'planner'
where organization_id = '00000000-0000-4000-8000-a18000000000' and user_id = '00000000-0000-4000-8000-a18000000001';

set local role authenticated;
select is(
  public.import_resume('00000000-0000-4000-8000-a180000b0008') ->> 'status',
  'committing',
  'S1: a planner again, the creator resumes the commit'
);
reset role;
update public.memberships set role = 'viewer'
where organization_id = '00000000-0000-4000-8000-a18000000000' and user_id = '00000000-0000-4000-8000-a18000000001';

set local role authenticated;
select throws_ok(
  $$select public.import_commit_step('00000000-0000-4000-8000-a180000b0008', 3000)$$,
  'MQ403', null,
  'S1: demoted to viewer between steps, the creator gets MQ403 on the next step'
);
reset role;
update public.memberships set role = 'planner'
where organization_id = '00000000-0000-4000-8000-a18000000000' and user_id = '00000000-0000-4000-8000-a18000000001';

-- Deleted again while the batch is committing with its cursor after row 3,000.
delete from public.items where organization_id = '00000000-0000-4000-8000-a18000000000' and code = 'P-S2';

set local role authenticated;
select results_eq(
  $$select x ->> 'unit', x ->> 'status' from (select public.import_commit_step('00000000-0000-4000-8000-a180000b0008', 3000) as x) as s$$,
  $$values ('merge:demand_history:1:3001-6000'::text, 'failed'::text)$$,
  'S1: an item deleted between steps fails the next unit with the cursor kept'
);
reset role;

insert into public.items (organization_id, code, name_en, product_group, unit_of_measure, unit_cost, currency)
values ('00000000-0000-4000-8000-a18000000000', 'P-S2', 'Stepped P-S2 once more', 'misc', 'EA', 1, 'SAR');

set local role authenticated;
select lives_ok(
  $$select public.import_resume('00000000-0000-4000-8000-a180000b0008')$$,
  'S1: after the item is back, the commit resumes'
);
reset role;
select results_eq(
  $$select b.error_count, b.warning_count, f.error_count, f.errors_stored, f.error_counts,
           (select count(*)::int from public.import_errors e where e.batch_id = b.id and e.level = 'error')
    from public.import_batches b join public.import_files f on f.batch_id = b.id
    where b.id = '00000000-0000-4000-8000-a180000b0008'$$,
  $$values (0, 1, 0, 1, '{"source_missing": {"": 1}}'::jsonb, 0)$$,
  'S1: resuming clears the errors of the failed attempt and keeps the staging warning'
);
set local role authenticated;
select is(pg_temp.commit('00000000-0000-4000-8000-a180000b0008', 3000) ->> 'status', 'succeeded', 'S1: the resumed commit succeeds');
reset role;
select is(
  (select b.error_count from public.import_batches b where b.id = '00000000-0000-4000-8000-a180000b0008'),
  0,
  'S1: the succeeded import reports no errors'
);

select results_eq(
  $$select b.counts -> 'demand_history', f.status, f.merged_through_row,
           (select count(*)::int from public.demand_history
            where organization_id = '00000000-0000-4000-8000-a18000000000' and item_id = pg_temp.item('P-S2'))
    from public.import_batches b join public.import_files f on f.batch_id = b.id
    where b.id = '00000000-0000-4000-8000-a180000b0008'$$,
  $$values ('{"inserted": 6000, "updated": 0, "unchanged": 0, "deleted": 0, "skipped": 0}'::jsonb, 'merged'::text, 6000, 3000)$$,
  'S1: rows 3,001-6,000 are merged once after the resume; 6,000 inserts in total'
);
select is(
  app.import_batch_tables('00000000-0000-4000-8000-a180000b0008'),
  array['items', 'locations'],
  'S1: the tables a demand batch analyzes are its lookups, never the demand_history parent'
);

select is(
  pg_temp.versions('00000000-0000-4000-8000-b18000000000'),
  (select v from fx_b_before),
  'organization B: no row of any target table was written by organization A''s imports'
);

------------------------------------------------------------------------------------------------
-- app.import_prepare_stats. The suppliers table (a parent of supplier_items) is analyzed while
-- every row in it is deleted by this transaction: its statistics then claim zero rows over many
-- pages, the trap that once made a load 50 times slower.
------------------------------------------------------------------------------------------------
insert into public.suppliers (organization_id, code, name_en, country_code, currency, lead_time_days_p50, lead_time_days_p90)
select '00000000-0000-4000-8000-a18000000000', 'ST-' || lpad(g::text, 5, '0'), 'Statistics supplier ' || g, 'SA', 'SAR', 1, 2
from generate_series(1, 3000) as g;
-- Step 6 transaction feeds may already exist in a seeded local stack. This
-- statistics fixture empties suppliers only within this rolled-back transaction.
delete from public.open_orders;
delete from public.receipts;
delete from public.suppliers;
analyze public.suppliers;

select ok(
  (select reltuples = 0 and relpages > 8 from pg_class where oid = 'public.suppliers'::regclass),
  'stats: the statistics of suppliers claim zero rows over many pages'
);
select is(
  app.import_prepare_stats('00000000-0000-4000-8000-a180000b0007', array['suppliers', 'demand_history']),
  array['public.suppliers'],
  'stats: the zero-rows-over-pages parent is analyzed; the demand_history parent never is'
);

insert into public.suppliers (organization_id, code, name_en, country_code, currency, lead_time_days_p50, lead_time_days_p90)
select '00000000-0000-4000-8000-a18000000000', 'SU-' || lpad(g::text, 5, '0'), 'Statistics supplier ' || g, 'SA', 'SAR', 1, 2
from generate_series(1, 3000) as g;
select is(
  app.import_prepare_stats('00000000-0000-4000-8000-a180000b0007', array['suppliers']),
  array['public.suppliers'],
  'stats: rows loaded over statistics that claim none are analyzed'
);
select is(
  (select reltuples::int from pg_class where oid = 'public.suppliers'::regclass),
  3000,
  'stats: the statistics now count the 3,000 live rows'
);

do $$ begin perform pg_stat_clear_snapshot(); end $$;
select is(
  app.import_prepare_stats('00000000-0000-4000-8000-a180000b0007', array['suppliers']),
  '{}'::text[],
  'stats: fresh statistics are left alone'
);
update public.import_batches set counts = counts || '{"suppliers": {"inserted": 200}}'::jsonb
where id = '00000000-0000-4000-8000-a180000b0007';
select is(
  app.import_prepare_stats('00000000-0000-4000-8000-a180000b0007', array['suppliers']),
  '{}'::text[],
  'stats: a batch that inserted 200 of 3,000 rows (under 10 %) does not analyze'
);
update public.import_batches set counts = counts || '{"suppliers": {"inserted": 400}}'::jsonb
where id = '00000000-0000-4000-8000-a180000b0007';
select is(
  app.import_prepare_stats('00000000-0000-4000-8000-a180000b0007', array['suppliers']),
  array['public.suppliers'],
  'stats: a batch that inserted 400 of 3,000 rows (over 10 %) analyzes'
);

-- The merges pin nested loops, so a stepped unit first refreshes the statistics of its target:
-- 6,000 new brands commit in two units, and the second sees the 5,000 rows the first inserted.
insert into fx_files (batch_id, file_no, entity, columns, rows)
select '00000000-0000-4000-8000-a180000b0009', 1, 'brands', array['brand_code', 'name_en'],
       jsonb_agg(jsonb_build_object('brand_code', 'BS-' || lpad(g::text, 5, '0'), 'name_en', 'Statistics brand ' || g) order by g)
from generate_series(1, 6000) as g;
analyze public.brands;
set local role authenticated;
select is(pg_temp.stage('00000000-0000-4000-8000-a180000b0009'), 'validated', 'stats: 6,000 new brands validate');
select is(
  pg_temp.commit('00000000-0000-4000-8000-a180000b0009') ->> 'status',
  'succeeded',
  'stats: the 6,000 brands commit in steps'
);
reset role;
select cmp_ok(
  (select reltuples from pg_class where oid = 'public.brands'::regclass),
  '>=',
  5000::real,
  'stats: the second brands unit analyzed brands after the first inserted 5,000'
);

------------------------------------------------------------------------------------------------
-- M4: a reversed pair that does not map the value depending on its orientation (direction for
-- interchanges, rate for fx rates) keeps the stored orientation and value. After M1 the stored
-- rows are P-5 -> P-4 one_way and 1 SAR = 0.2666666667 USD.
------------------------------------------------------------------------------------------------
insert into fx_files values
  ('00000000-0000-4000-8000-a180000b000a', 1, 'item_interchanges', array['item_code', 'alternate_item_code', 'priority'], $j$[
    {"item_code": "P-4", "alternate_item_code": "P-5", "priority": "7"}]$j$),
  ('00000000-0000-4000-8000-a180000b000a', 2, 'fx_rates', array['from_currency', 'to_currency', 'valid_from', 'note'], $j$[
    {"from_currency": "USD", "to_currency": "SAR", "valid_from": "2026-01-01", "note": "note only"}]$j$);
set local role authenticated;
select is(pg_temp.stage('00000000-0000-4000-8000-a180000b000a'), 'validated', 'M4: reversed pairs without direction or rate validate');
select is(pg_temp.commit('00000000-0000-4000-8000-a180000b000a') ->> 'status', 'succeeded', 'M4: the commit succeeds');
reset role;
select is(
  (select row(count(*), bool_and(item_id = pg_temp.item('P-5') and alternate_item_id = pg_temp.item('P-4')), min(direction), min(priority))::text
   from public.item_interchanges where organization_id = '00000000-0000-4000-8000-a18000000000'
     and pg_temp.item('P-4') in (item_id, alternate_item_id)),
  row(1::bigint, true, 'one_way', 7::smallint)::text,
  'item_interchanges: a reversed pair without direction keeps the stored orientation and direction; the priority changes'
);
select is(
  (select row(count(*), min(from_currency), min(to_currency), min(rate), min(note))::text
   from public.fx_rates where organization_id = '00000000-0000-4000-8000-a18000000000' and valid_from = '2026-01-01'
     and 'USD' in (from_currency, to_currency)),
  row(1::bigint, 'SAR'::char(3), 'USD'::char(3), 0.2666666667::numeric(20,10), 'note only')::text,
  'fx_rates: a reversed pair without rate keeps the stored orientation and rate; the note changes'
);

------------------------------------------------------------------------------------------------
-- X1: a stepped commit (5,001 fx rows load last) in units of one row. The holiday file inserts a
-- closure into days its second row frees by shortening a stored one, and the supersession file
-- reverses a stored edge in its first row and replaces that edge in its second: the final data is
-- valid (checked at seal), but one row per unit would meet the old range or edge. Such files
-- merge in a single unit whatever max_rows asks for, so the commit succeeds.
------------------------------------------------------------------------------------------------
insert into public.items (organization_id, code, name_en, product_group, unit_of_measure, unit_cost, currency, updated_at)
select '00000000-0000-4000-8000-a18000000000', c, c, 'misc', 'EA', 1, 'SAR', '2020-01-01 00:00:00+00'
from unnest(array['P-X1', 'P-X2', 'P-X3']) as c;
insert into public.item_supersessions (organization_id, predecessor_item_id, successor_item_id, effective_on)
values ('00000000-0000-4000-8000-a18000000000', pg_temp.item('P-X1'), pg_temp.item('P-X2'), '2025-01-01');
insert into public.holiday_overrides (organization_id, country_code, starts_on, ends_on, kind, name_en)
values ('00000000-0000-4000-8000-a18000000000', 'SA', '2026-06-01', '2026-06-10', 'closure', 'Long closure');
insert into fx_files values
  ('00000000-0000-4000-8000-a180000b000b', 1, 'holiday_overrides',
   array['country_code', 'work_calendar_code', 'starts_on', 'ends_on', 'kind', 'name_en'], $j$[
    {"country_code": "SA", "starts_on": "2026-06-08", "ends_on": "2026-06-12", "kind": "closure", "name_en": "New closure"},
    {"country_code": "SA", "starts_on": "2026-06-01", "ends_on": "2026-06-05", "kind": "closure", "name_en": "Long closure"}]$j$),
  ('00000000-0000-4000-8000-a180000b000b', 2, 'item_supersessions',
   array['predecessor_item_code', 'successor_item_code', 'effective_on'], $j$[
    {"predecessor_item_code": "P-X2", "successor_item_code": "P-X1", "effective_on": "2026-01-01"},
    {"predecessor_item_code": "P-X1", "successor_item_code": "P-X3", "effective_on": "2026-01-01"}]$j$);
insert into fx_files
select '00000000-0000-4000-8000-a180000b000b', 3, 'fx_rates', array['from_currency', 'to_currency', 'valid_from', 'rate'],
       jsonb_agg(jsonb_build_object('from_currency', 'EUR', 'to_currency', 'KWD',
                                    'valid_from', to_char(date '2000-01-01' + g, 'YYYY-MM-DD'), 'rate', '0.33') order by g)
from generate_series(1, 5001) as g;

-- One-row steps until the supersession file is merged, then the rest at the default size.
create function pg_temp.commit_split(p_batch uuid) returns jsonb language plpgsql as $$
declare
  v jsonb;
  i integer := 0;
begin
  loop
    v := public.import_commit_step(p_batch, 1);
    i := i + 1;
    exit when v ->> 'status' <> 'committing' or i >= 100
      or (select f.status from public.import_files f where f.batch_id = p_batch and f.entity = 'item_supersessions') = 'merged';
  end loop;
  if v ->> 'status' = 'committing' then
    v := pg_temp.commit(p_batch);
  end if;
  return v;
end;
$$;

set local role authenticated;
select is(pg_temp.stage('00000000-0000-4000-8000-a180000b000b'), 'validated', 'X1: the files validate (the final holidays and supersessions are valid)');
select is(
  (select format('%s %s %s', r ->> 'status', r ->> 'commit_mode', coalesce(r ->> 'failure_code', '-'))
   from pg_temp.commit_split('00000000-0000-4000-8000-a180000b000b') as r),
  'succeeded stepped -',
  'X1: the stepped commit with max_rows 1 succeeds'
);
reset role;
select results_eq(
  $$select t.v ->> 'unit' from public.import_batches x cross join lateral jsonb_array_elements(x.progress -> 'timings') as t(v)
    where x.id = '00000000-0000-4000-8000-a180000b000b' and t.v ->> 'unit' ~ '^merge:(holiday_overrides|item_supersessions):'
    order by 1$$,
  $$values ('merge:holiday_overrides:1:1-2'::text), ('merge:item_supersessions:2:1-2')$$,
  'X1: the holiday and supersession files each merged in a single unit despite max_rows 1'
);
select results_eq(
  $$select starts_on, ends_on, name_en from public.holiday_overrides
    where organization_id = '00000000-0000-4000-8000-a18000000000' and starts_on between '2026-06-01' and '2026-06-30' order by starts_on$$,
  $$values ('2026-06-01'::date, '2026-06-05'::date, 'Long closure'::text), ('2026-06-08', '2026-06-12', 'New closure')$$,
  'X1: the stored closure is shortened and the new one fills the freed days'
);
select results_eq(
  $$select p.code, n.code from public.item_supersessions s
    join public.items p on p.id = s.predecessor_item_id join public.items n on n.id = s.successor_item_id
    where s.organization_id = '00000000-0000-4000-8000-a18000000000' and p.code like 'P-X%' order by p.code$$,
  $$values ('P-X1'::text, 'P-X3'::text), ('P-X2', 'P-X1')$$,
  'X1: the stored edge is replaced and the reversed edge inserted'
);

select * from finish();

rollback;
