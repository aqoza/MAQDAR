-- Import validation (Step 5a): every cell error code and every row and set rule of the contract,
-- driven by supabase/tests/fixtures/import_cells.json. Each fixture case is one import of
-- organization A made by its planner through the RPCs (parent files staged and sealed first, then
-- the case file); the errors and warnings of the import must equal the expected set, and the
-- batch must end invalid when an error is expected, validated otherwise. Two coverage checks fail
-- when an error code or a contract rule has no fixture. Then: validation changes no target row of
-- A or B (injection-shaped values included), the 10,000 stored details per file with complete
-- error_counts, and injection-shaped free text committed verbatim.
-- The fixture file is read by psql (pg_prove runs this file with psql in supabase/tests).
begin;

\set fixture `cat fixtures/import_cells.json 2>/dev/null || cat supabase/tests/fixtures/import_cells.json`
create temp table fixture (doc jsonb not null) on commit drop;
insert into fixture values (:'fixture');

select plan((select jsonb_array_length(doc -> 'cases') from fixture) + 17);

------------------------------------------------------------------------------------------------
-- Fixture data (as postgres). Organization A and its planner; organization B owns codes A must
-- not resolve. See "seed" in the fixture file.
------------------------------------------------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at)
values ('00000000-0000-4000-8000-a17000000001', 'imp17-planner-a@test.local', now());
insert into public.organizations (id, slug, name)
values
  ('00000000-0000-4000-8000-a17000000000', 'imp17-org-a', 'Org A'),
  ('00000000-0000-4000-8000-b17000000000', 'imp17-org-b', 'Org B');
insert into public.memberships (organization_id, user_id, role)
values ('00000000-0000-4000-8000-a17000000000', '00000000-0000-4000-8000-a17000000001', 'planner');

insert into public.work_calendars (id, organization_id, code, name_en, country_code, weekend_days, observe_public_holidays)
values
  ('00000000-0000-4000-8000-a17050000001', '00000000-0000-4000-8000-a17000000000', 'CAL-A', 'Calendar A', 'SA', '{5,6}', true),
  ('00000000-0000-4000-8000-a17050000002', '00000000-0000-4000-8000-a17000000000', 'CAL-NOCTRY', 'No country', null, '{5,6}', false);
insert into public.holiday_overrides (organization_id, country_code, starts_on, ends_on, kind, name_en)
values ('00000000-0000-4000-8000-a17000000000', 'SA', '2026-03-20', '2026-03-22', 'closure', 'Stored closure');
insert into public.locations (id, organization_id, code, name_en, location_type, country_code, timezone, parent_location_id)
values
  ('00000000-0000-4000-8000-a17010000001', '00000000-0000-4000-8000-a17000000000', 'LOC-A1', 'Riyadh DC', 'central', 'SA', 'Asia/Riyadh', null),
  ('00000000-0000-4000-8000-a17010000002', '00000000-0000-4000-8000-a17000000000', 'LOC-A2', 'Jeddah branch', 'branch', 'SA', 'Asia/Riyadh', '00000000-0000-4000-8000-a17010000001'),
  ('00000000-0000-4000-8000-b17010000001', '00000000-0000-4000-8000-b17000000000', 'LOC-B-ONLY', 'Location of B', 'branch', 'SA', 'Asia/Riyadh', null);
insert into public.brands (id, organization_id, code, name_en)
values
  ('00000000-0000-4000-8000-a17030000001', '00000000-0000-4000-8000-a17000000000', 'BR-A', 'Brand A'),
  ('00000000-0000-4000-8000-b17030000001', '00000000-0000-4000-8000-b17000000000', 'BR-B-ONLY', 'Brand of B');
insert into public.items (id, organization_id, code, name_en, product_group, unit_of_measure, unit_cost, currency, introduced_on, discontinued_on)
values
  ('00000000-0000-4000-8000-a17020000001', '00000000-0000-4000-8000-a17000000000', 'P-1', 'Part one', 'battery', 'EA', 10, 'SAR', '2024-01-01', null),
  ('00000000-0000-4000-8000-a17020000002', '00000000-0000-4000-8000-a17000000000', 'P-2', 'Part two', 'battery', 'EA', 10, 'SAR', null, '2025-01-01'),
  ('00000000-0000-4000-8000-a17020000003', '00000000-0000-4000-8000-a17000000000', 'P-3', 'Part three', 'battery', 'EA', 10, 'SAR', null, null),
  ('00000000-0000-4000-8000-a17020000004', '00000000-0000-4000-8000-a17000000000', 'P/4', 'Part four', 'battery', 'EA', 10, 'SAR', null, null),
  ('00000000-0000-4000-8000-b17020000001', '00000000-0000-4000-8000-b17000000000', 'P-B-ONLY', 'Part of B', 'battery', 'EA', 1, 'KWD', null, null);
insert into public.item_supersessions (organization_id, predecessor_item_id, successor_item_id, effective_on)
values ('00000000-0000-4000-8000-a17000000000', '00000000-0000-4000-8000-a17020000002', '00000000-0000-4000-8000-a17020000003', '2025-01-01');
insert into public.suppliers (id, organization_id, code, name_en, country_code, currency, lead_time_days_p50, lead_time_days_p90)
values ('00000000-0000-4000-8000-a17040000001', '00000000-0000-4000-8000-a17000000000', 'SUP-A', 'Supplier A', 'SA', 'SAR', 10, 20);
insert into public.supplier_items (organization_id, supplier_id, item_id, lead_time_days, lead_time_days_p90, unit_price, currency)
values
  ('00000000-0000-4000-8000-a17000000000', '00000000-0000-4000-8000-a17040000001', '00000000-0000-4000-8000-a17020000001', 10, 20, 5, 'SAR'),
  ('00000000-0000-4000-8000-a17000000000', '00000000-0000-4000-8000-a17040000001', '00000000-0000-4000-8000-a17020000002', 10, null, 5, 'SAR');
insert into public.demand_history (organization_id, item_id, location_id, demand_date, quantity)
values ('00000000-0000-4000-8000-a17000000000', '00000000-0000-4000-8000-a17020000001', '00000000-0000-4000-8000-a17010000001', '2024-07-15', 3);

------------------------------------------------------------------------------------------------
-- Helpers (as postgres)
------------------------------------------------------------------------------------------------

-- A fixture cell: a string, {"repeat": s, "times": n} or {"today_plus": n}. today_plus counts from
-- the end of app.demand_history_window() (exclusive, normally current_date + 2), so 1 is the last
-- accepted demand day and 2 the first refused one even when the partitions end sooner.
create function pg_temp.cell(p_cell jsonb)
returns jsonb
language sql
stable
as $$
  select case jsonb_typeof(p_cell)
    when 'string' then p_cell
    when 'object' then case
      when p_cell ? 'repeat' then to_jsonb(repeat(p_cell ->> 'repeat', (p_cell ->> 'times')::integer))
      when p_cell ? 'today_plus' then
        to_jsonb(to_char(upper(app.demand_history_window()) - 2 + (p_cell ->> 'today_plus')::integer, 'YYYY-MM-DD'))
    end
  end;
$$;

-- A chunk (rows 1..n) in contract order: [row_no, cell_1 .. cell_n], null for unmapped columns.
create function pg_temp.chunk(p_entity text, p_columns text[], p_rows jsonb)
returns text
language sql
stable
as $$
  select jsonb_agg(
           jsonb_build_array(r.ord) || (
             select jsonb_agg(case when array_position(p_columns, c.name) is null then 'null'::jsonb
                                   else pg_temp.cell(r.cells -> (array_position(p_columns, c.name) - 1)) end
                              order by c.position)
             from ingest.contract_columns c
             where c.entity = p_entity)
           order by r.ord)::text
  from jsonb_array_elements(p_rows) with ordinality as r(cells, ord);
$$;

-- One row per fixture case with its files (parents first) ready to stage.
create temp table cases on commit drop as
select k.ord::integer as case_no, k.doc ->> 'name' as name, k.doc ->> 'entity' as entity, k.doc -> 'expected' as expected,
       f.files, jsonb_array_length(f.files) as file_count
from fixture x
cross join jsonb_array_elements(x.doc -> 'cases') with ordinality as k(doc, ord)
cross join lateral (
  select jsonb_agg(jsonb_build_object(
           'file_no', p.ord, 'entity', p.file ->> 'entity', 'columns', p.file -> 'columns',
           'rows_total', jsonb_array_length(p.file -> 'rows'),
           'chunk', pg_temp.chunk(p.file ->> 'entity', array(select jsonb_array_elements_text(p.file -> 'columns')), p.file -> 'rows'))
         order by p.ord) as files
  from jsonb_array_elements(
         coalesce(k.doc -> 'parents', '[]'::jsonb)
         || jsonb_build_array(jsonb_build_object('entity', k.doc -> 'entity', 'columns', k.doc -> 'columns', 'rows', k.doc -> 'rows')))
       with ordinality as p(file, ord)
) as f;
grant select on pg_temp.cases to authenticated;

create temp table case_results (case_no integer primary key, result jsonb not null) on commit drop;
grant select, insert on pg_temp.case_results to authenticated;

create temp table results (name text primary key, result jsonb) on commit drop;
grant select, insert on pg_temp.results to authenticated;

-- Runs one case as the calling role: create, stage and seal every file, read the errors (without
-- source_missing), then cancel and delete the import so the next case has room.
create function pg_temp.run_case(p_case_no integer)
returns jsonb
language plpgsql
as $$
declare
  v_files jsonb;
  v_batch uuid := gen_random_uuid();
  v_file jsonb;
  v_actual jsonb;
  v_status text;
  v_state text;
  v_message text;
  v_hint text;
begin
  select k.files into v_files from pg_temp.cases k where k.case_no = p_case_no;
  begin
    perform public.import_create_batch(v_batch, '00000000-0000-4000-8000-a17000000000', (
      select jsonb_agg(jsonb_build_object(
               'file_no', f -> 'file_no', 'entity', f -> 'entity', 'original_name', (f ->> 'entity') || '.csv',
               'extension', 'csv', 'size_bytes', 1,
               'sha256', encode(sha256(convert_to(v_batch::text || ':' || (f ->> 'file_no'), 'UTF8')), 'hex'),
               'rows_total', f -> 'rows_total', 'columns', f -> 'columns')
             order by (f ->> 'file_no')::integer)
      from jsonb_array_elements(v_files) as f));
    for v_file in select f from jsonb_array_elements(v_files) as f order by (f ->> 'file_no')::integer loop
      perform public.import_stage_chunk(v_batch, (v_file ->> 'file_no')::smallint, 1, v_file ->> 'chunk');
      perform public.import_seal_file(v_batch, (v_file ->> 'file_no')::smallint, (v_file ->> 'rows_total')::integer);
    end loop;
    select b.status into v_status from public.import_batches b where b.id = v_batch;
    select coalesce(jsonb_agg(jsonb_build_object(
             'file_no', e.file_no, 'row_no', e.row_no, 'column_name', e.column_name, 'code', e.code,
             'level', e.level, 'value', e.value, 'detail', e.detail)
             order by e.file_no, e.row_no, e.column_name, e.code), '[]'::jsonb)
      into v_actual
    from public.import_errors e
    where e.batch_id = v_batch and e.code <> 'source_missing';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_hint = pg_exception_hint;
    v_actual := jsonb_build_object('exception', format('%s %s: %s', v_state, coalesce(v_hint, ''), v_message));
  end;
  begin
    perform public.import_cancel_step(v_batch);
    perform public.import_delete(v_batch);
  exception when others then
    null;
  end;
  return jsonb_build_object('actual', v_actual, 'status', v_status);
end;
$$;

create function pg_temp.run_all()
returns integer
language plpgsql
as $$
declare
  v_case integer;
  v_count integer := 0;
begin
  for v_case in select k.case_no from pg_temp.cases k order by k.case_no loop
    insert into pg_temp.case_results values (v_case, pg_temp.run_case(v_case));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- '' when the import's errors equal the expected set (value, value_length and detail compared
-- when given) and its status fits; otherwise the differences.
create function pg_temp.diff(p_expected jsonb, p_result jsonb, p_case_file integer)
returns text
language plpgsql
stable
as $$
declare
  v_actual jsonb := p_result -> 'actual';
  v_lines text[] := '{}';
  v_want_status text;
  v_item jsonb;
begin
  if p_result is null then
    return 'not run';
  elsif jsonb_typeof(v_actual) <> 'array' then
    return coalesce(v_actual ->> 'exception', 'no result');
  end if;
  for v_item in select x from jsonb_array_elements(p_expected) as x loop
    if not exists (
      select 1 from jsonb_array_elements(v_actual) as y
      where (y ->> 'file_no')::integer = coalesce((v_item ->> 'file_no')::integer, p_case_file)
        and (y ->> 'row_no')::integer = (v_item ->> 'row_no')::integer
        and y ->> 'column_name' = v_item ->> 'column_name'
        and y ->> 'code' = v_item ->> 'code'
        and y ->> 'level' = v_item ->> 'level'
        and (not (v_item ? 'value') or (y -> 'value') = (v_item -> 'value'))
        and (not (v_item ? 'value_length') or char_length(y ->> 'value') = (v_item ->> 'value_length')::integer)
        and (not (v_item ? 'detail') or (y -> 'detail') = (v_item -> 'detail'))) then
      v_lines := v_lines || ('missing ' || v_item::text);
    end if;
  end loop;
  for v_item in select y from jsonb_array_elements(v_actual) as y loop
    if not exists (
      select 1 from jsonb_array_elements(p_expected) as x
      where coalesce((x ->> 'file_no')::integer, p_case_file) = (v_item ->> 'file_no')::integer
        and (x ->> 'row_no')::integer = (v_item ->> 'row_no')::integer
        and x ->> 'column_name' = v_item ->> 'column_name'
        and x ->> 'code' = v_item ->> 'code'
        and x ->> 'level' = v_item ->> 'level') then
      v_lines := v_lines || ('unexpected ' || left(v_item::text, 400));
    end if;
  end loop;
  v_want_status := case when exists (select 1 from jsonb_array_elements(p_expected) as x where x ->> 'level' = 'error')
                        then 'invalid' else 'validated' end;
  if p_result ->> 'status' is distinct from v_want_status then
    v_lines := v_lines || format('status %s, expected %s', p_result ->> 'status', v_want_status);
  end if;
  return array_to_string(v_lines, '; ');
end;
$$;

-- One assertion per case, in case order.
create function pg_temp.check_cases()
returns setof text
language plpgsql
as $$
declare
  v_case record;
begin
  for v_case in
    select k.case_no, k.name, k.expected, k.file_count, r.result
    from pg_temp.cases k
    left join pg_temp.case_results r on r.case_no = k.case_no
    order by k.case_no
  loop
    return next is(pg_temp.diff(v_case.expected, v_case.result, v_case.file_count), '',
                   format('fixture %s: %s', v_case.case_no, v_case.name));
  end loop;
end;
$$;

-- Every row of the organization's target tables, hashed.
create function pg_temp.fingerprint(p_organization uuid)
returns text
language sql
stable
as $$
  select md5(coalesce(string_agg(t.r, E'\n' order by t.r), ''))
  from (
    select 'work_calendars ' || x::text as r from public.work_calendars x where x.organization_id = p_organization
    union all select 'holiday_overrides ' || x::text from public.holiday_overrides x where x.organization_id = p_organization
    union all select 'locations ' || x::text from public.locations x where x.organization_id = p_organization
    union all select 'network_links ' || x::text from public.network_links x where x.organization_id = p_organization
    union all select 'brands ' || x::text from public.brands x where x.organization_id = p_organization
    union all select 'items ' || x::text from public.items x where x.organization_id = p_organization
    union all select 'item_supersessions ' || x::text from public.item_supersessions x where x.organization_id = p_organization
    union all select 'item_interchanges ' || x::text from public.item_interchanges x where x.organization_id = p_organization
    union all select 'suppliers ' || x::text from public.suppliers x where x.organization_id = p_organization
    union all select 'supplier_items ' || x::text from public.supplier_items x where x.organization_id = p_organization
    union all select 'fx_rates ' || x::text from public.fx_rates x where x.organization_id = p_organization
    union all select 'demand_history ' || x::text from public.demand_history x where x.organization_id = p_organization
  ) as t;
$$;

create temp table fingerprints (organization_id uuid primary key, value text not null) on commit drop;
insert into fingerprints
values
  ('00000000-0000-4000-8000-a17000000000', pg_temp.fingerprint('00000000-0000-4000-8000-a17000000000')),
  ('00000000-0000-4000-8000-b17000000000', pg_temp.fingerprint('00000000-0000-4000-8000-b17000000000'));

------------------------------------------------------------------------------------------------
-- The fixture covers every staging error code and every contract rule
------------------------------------------------------------------------------------------------
select ok(
  (select jsonb_array_length(doc -> 'cases') from fixture) >= 20,
  'the fixture file is loaded with its cases'
);
select is(
  array(select m[1]
        from pg_constraint c
        cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z0-9_]+)''::text', 'g') as m
        where c.conname = 'import_errors_code_check'
          and m[1] not in ('source_missing', 'source_size_mismatch', 'changed_during_commit', 'concurrent_change')
          and not exists (select 1
                          from fixture f
                          cross join jsonb_array_elements(f.doc -> 'cases') as k
                          cross join jsonb_array_elements(k -> 'expected') as e
                          where e ->> 'code' = m[1])
        order by 1),
  '{}'::text[],
  'every error code checked while staging and sealing has a fixture (file and commit codes: 0016, 0018)'
);
select is(
  array(select e.entity || ':' || r.rule
        from ingest.contract_entities e
        cross join lateral unnest(e.row_rules || e.set_rules) as r(rule)
        where not exists (select 1
                          from fixture f
                          cross join jsonb_array_elements(f.doc -> 'cases') as k
                          cross join jsonb_array_elements(k -> 'expected') as x
                          where k ->> 'entity' = e.entity and x ->> 'code' = r.rule)
        order by e.load_order, r.rule),
  '{}'::text[],
  'every row and set rule of the contract has a fixture on its entity'
);

------------------------------------------------------------------------------------------------
-- The fixture cases, as the planner of A
------------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-a17000000001", "role": "authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-a17000000001';

select is(pg_temp.run_all(), (select count(*)::integer from pg_temp.cases), 'every fixture case ran');
select is((select count(*)::integer from public.import_batches), 0, 'every fixture import was canceled and deleted');

reset role;
select * from pg_temp.check_cases();

select is(
  pg_temp.fingerprint('00000000-0000-4000-8000-a17000000000'),
  (select f.value from fingerprints f where f.organization_id = '00000000-0000-4000-8000-a17000000000'),
  'staging and sealing the fixtures (injection-shaped values included) changed no target row of A'
);
select is(
  pg_temp.fingerprint('00000000-0000-4000-8000-b17000000000'),
  (select f.value from fingerprints f where f.organization_id = '00000000-0000-4000-8000-b17000000000'),
  'and none of B'
);

------------------------------------------------------------------------------------------------
-- At most 10,000 error details are stored per file; error_count and error_counts stay complete
------------------------------------------------------------------------------------------------
set local role authenticated;

-- 2,510 new items, each with five cell errors: name_en and product_group empty, unit_of_measure,
-- unit_cost and currency invalid.
create function pg_temp.cap_rows(p_first integer, p_last integer)
returns text
language sql
immutable
as $$
  select jsonb_agg(jsonb_build_array(i, 'CAP-' || i, '', null, null, '', 'XX', 'abc', 'zzz', null, null, null) order by i)::text
  from generate_series(p_first, p_last) as i;
$$;

select is(
  (public.import_create_batch('00000000-0000-4000-8000-a17b00000001', '00000000-0000-4000-8000-a17000000000',
    jsonb_build_array(jsonb_build_object(
      'file_no', 1, 'entity', 'items', 'original_name', 'items.csv', 'extension', 'csv', 'size_bytes', 1,
      'sha256', encode(sha256('cap'::bytea), 'hex'), 'rows_total', 2510,
      'columns', jsonb_build_array('item_code', 'name_en', 'product_group', 'unit_of_measure', 'unit_cost', 'currency'))))) ->> 'status',
  'staging',
  'an import of 2,510 faulty items is created'
);
insert into pg_temp.results
values ('cap1', public.import_stage_chunk('00000000-0000-4000-8000-a17b00000001', 1::smallint, 1, pg_temp.cap_rows(1, 2500)));
select is(
  (select format('%s %s %s', r.result ->> 'errors_added', r.result -> 'file' ->> 'error_count', r.result -> 'file' ->> 'errors_stored')
   from pg_temp.results r where r.name = 'cap1'),
  '12500 12500 10000',
  'a chunk with 12,500 errors counts them all and stores 10,000'
);
insert into pg_temp.results
values ('cap2', public.import_stage_chunk('00000000-0000-4000-8000-a17b00000001', 1::smallint, 2501, pg_temp.cap_rows(2501, 2510)));
select is(
  (select format('%s %s %s', r.result ->> 'errors_added', r.result -> 'file' ->> 'error_count', r.result -> 'file' ->> 'errors_stored')
   from pg_temp.results r where r.name = 'cap2'),
  '50 12550 10000',
  'the next chunk adds its 50 errors to the counts and stores none'
);
select is(
  (select f.error_counts from public.import_files f where f.batch_id = '00000000-0000-4000-8000-a17b00000001'),
  '{"required": {"name_en": 2510, "product_group": 2510}, "invalid_enum": {"unit_of_measure": 2510},
    "invalid_decimal": {"unit_cost": 2510}, "unknown_currency": {"currency": 2510}}'::jsonb,
  'error_counts is complete by code and column'
);
select is(
  (select format('%s %s %s', count(*), min(e.row_no), max(e.row_no))
   from public.import_errors e where e.batch_id = '00000000-0000-4000-8000-a17b00000001'),
  '10000 1 2000',
  'the stored details are the first 10,000 by row (rows 1 to 2,000)'
);
select is(
  (select format('%s %s %s %s %s', r ->> 'warning_count', r ->> 'errors_stored', r -> 'error_counts' -> 'source_missing',
                 r -> 'batch' ->> 'status', r -> 'batch' ->> 'error_count')
   from public.import_seal_file('00000000-0000-4000-8000-a17b00000001', 1::smallint, 2510) as r),
  '1 10000 {"": 1} invalid 12550',
  'sealing counts the source_missing warning beyond the cap and the batch is invalid with 12,550 errors'
);

------------------------------------------------------------------------------------------------
-- Injection-shaped free text is only text: it validates, commits and is stored verbatim
------------------------------------------------------------------------------------------------
select is(
  (public.import_create_batch('00000000-0000-4000-8000-a17b00000002', '00000000-0000-4000-8000-a17000000000',
    jsonb_build_array(jsonb_build_object(
      'file_no', 1, 'entity', 'brands', 'original_name', 'brands.csv', 'extension', 'csv', 'size_bytes', 1,
      'sha256', encode(sha256('inj'::bytea), 'hex'), 'rows_total', 2,
      'columns', jsonb_build_array('brand_code', 'name_en', 'name_ar'))))) ->> 'status',
  'staging',
  'an import of brands with injection-shaped names is created'
);
insert into pg_temp.results
values ('inj_stage', public.import_stage_chunk('00000000-0000-4000-8000-a17b00000002', 1::smallint, 1,
  jsonb_build_array(
    jsonb_build_array(1, 'INJ-1', '''); drop table brands; --', '%I $$ \ .* (a+)+$', null, null, null),
    jsonb_build_array(2, 'INJ-2', 'Robert''); drop table items;--', 'نص', null, null, null))::text));
select is(
  (select format('%s %s', r.result ->> 'errors_added', s -> 'batch' ->> 'status')
   from pg_temp.results r
   cross join public.import_seal_file('00000000-0000-4000-8000-a17b00000002', 1::smallint, 2) as s
   where r.name = 'inj_stage'),
  '0 validated',
  'they stage without errors and the import is validated'
);
select is(
  (select format('%s %s', r ->> 'status', r -> 'counts' -> 'brands' ->> 'inserted')
   from public.import_commit_step('00000000-0000-4000-8000-a17b00000002') as r),
  'succeeded 2',
  'the import commits'
);
select is(
  array(select b.name_en || ' | ' || b.name_ar from public.brands b where b.code in ('INJ-1', 'INJ-2') order by b.code),
  array['''); drop table brands; -- | %I $$ \ .* (a+)+$', 'Robert''); drop table items;-- | نص'],
  'the names are stored verbatim'
);

select * from finish();

rollback;
