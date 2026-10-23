-- REST API bulk upsert (Step 5b): public.api_upsert over the Step 5a validators and merges.
-- * Wizard parity: every single-file case of supabase/tests/fixtures/import_cells.json (the 0017
--   fixtures) is sent as JSON records and must give the same errors and warnings as the wizard
--   (record + 1 = row, field = column, code, level; value, value_length and detail where the
--   fixture gives them). Cells become JSON as an integration would send them: strings stay strings,
--   '' becomes null, true/false become booleans and weekday lists integer arrays. A case with a
--   cell JSON cannot carry ("yes" for a boolean, "5,6" for weekdays) is refused with MQ422
--   records {invalid_type, record, field} for its first such cell, and runs again with those
--   cells patched (false, null) and their expectations left out. Cases with parent files are
--   skipped (the API sends one entity per request).
-- * Basic flow: inserts, a repeat that changes nothing (recorded false, no batch, rows untouched),
--   the recorded batch and file, staging cleared, the import-creation ledger untouched.
-- * Failures leave nothing: pointers, duplicate_key first_record, complete error_counts, at most
--   1,000 errors with errors_truncated; no batch, file, error, pending error or staged row remains.
-- * Values: null and "" clear, absent fields stay, weekdays sorted, 3.0 for an integer, exact
--   decimals (number or string, a 20-digit fx rate), too_many_decimals, updated_at ignored, an
--   absent holiday scope field counts as empty.
-- * The MQ422 records backstop, MQ404 resource, MQ422 request_id; demand 0/0 deletes, zero rows for
--   new keys and the history window; scopes; the another_commit slot and the daily cap of recorded
--   writes; a commit-time failure (planted trigger) without sqlstate, message or phase in the
--   result; cross-tenant codes; a demoted creator; the function configuration and the
--   zeespare.import_analyze setting, restored after every call.
-- Fixtures are created as postgres; api_upsert runs as service_role. pg_temp.api_dry runs a call
-- in a subtransaction that it rolls back, so dry cases stay independent. The fixture file is read
-- by psql (pg_prove runs this file with psql in supabase/tests).
begin;

\set fixture `cat fixtures/import_cells.json 2>/dev/null || cat supabase/tests/fixtures/import_cells.json`
create temp table fixture (doc jsonb not null) on commit drop;
insert into fixture values (:'fixture');

------------------------------------------------------------------------------------------------
-- Planted triggers (as postgres), created before any write so that this transaction never
-- upgrades a lock on items or brands (DROP TRIGGER would, and deadlocked with a concurrent
-- session): while api23.trip = on, pg_temp.trip raises 23503 for the item API-TRIP; while
-- api23.record = on, pg_temp.record_setting records zeespare.import_analyze for every new brand.
------------------------------------------------------------------------------------------------
create temp table analyze_settings (code text, setting text) on commit drop;
create function pg_temp.trip()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('api23.trip', true), '') = 'on' and new.code = 'API-TRIP' then
    raise exception using errcode = '23503', message = 'planted: insert or update violates foreign key constraint',
      detail = 'secret detail', hint = 'secret hint';
  end if;
  return new;
end;
$$;
create function pg_temp.record_setting()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('api23.record', true), '') = 'on' then
    insert into pg_temp.analyze_settings values (new.code, current_setting('zeespare.import_analyze', true));
  end if;
  return new;
end;
$$;
create trigger api23_trip before insert or update on public.items for each row execute function pg_temp.trip();
create trigger api23_record after insert on public.brands for each row execute function pg_temp.record_setting();

------------------------------------------------------------------------------------------------
-- Fixture data (as postgres): the seed of 0017 for organizations A and B (see "seed" in the
-- fixture file), plus an owner per organization and the API keys.
------------------------------------------------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at)
values
  ('00000000-0000-4000-8000-a23000000001', 'api23-planner-a@test.local', now()),
  ('00000000-0000-4000-8000-a23000000002', 'api23-owner-a@test.local', now()),
  ('00000000-0000-4000-8000-b23000000001', 'api23-owner-b@test.local', now());
insert into public.organizations (id, slug, name)
values
  ('00000000-0000-4000-8000-a23000000000', 'api23-org-a', 'Org A'),
  ('00000000-0000-4000-8000-b23000000000', 'api23-org-b', 'Org B');
insert into public.memberships (organization_id, user_id, role)
values
  ('00000000-0000-4000-8000-a23000000000', '00000000-0000-4000-8000-a23000000001', 'planner'),
  ('00000000-0000-4000-8000-a23000000000', '00000000-0000-4000-8000-a23000000002', 'owner'),
  ('00000000-0000-4000-8000-b23000000000', '00000000-0000-4000-8000-b23000000001', 'owner');

insert into public.work_calendars (id, organization_id, code, name_en, country_code, weekend_days, observe_public_holidays)
values
  ('00000000-0000-4000-8000-a23050000001', '00000000-0000-4000-8000-a23000000000', 'CAL-A', 'Calendar A', 'SA', '{5,6}', true),
  ('00000000-0000-4000-8000-a23050000002', '00000000-0000-4000-8000-a23000000000', 'CAL-NOCTRY', 'No country', null, '{5,6}', false);
insert into public.holiday_overrides (organization_id, country_code, starts_on, ends_on, kind, name_en)
values ('00000000-0000-4000-8000-a23000000000', 'SA', '2026-03-20', '2026-03-22', 'closure', 'Stored closure');
insert into public.locations (id, organization_id, code, name_en, location_type, country_code, timezone, parent_location_id)
values
  ('00000000-0000-4000-8000-a23010000001', '00000000-0000-4000-8000-a23000000000', 'LOC-A1', 'Riyadh DC', 'central', 'SA', 'Asia/Riyadh', null),
  ('00000000-0000-4000-8000-a23010000002', '00000000-0000-4000-8000-a23000000000', 'LOC-A2', 'Jeddah branch', 'branch', 'SA', 'Asia/Riyadh', '00000000-0000-4000-8000-a23010000001'),
  ('00000000-0000-4000-8000-b23010000001', '00000000-0000-4000-8000-b23000000000', 'LOC-B-ONLY', 'Location of B', 'branch', 'SA', 'Asia/Riyadh', null);
insert into public.brands (id, organization_id, code, name_en)
values
  ('00000000-0000-4000-8000-a23030000001', '00000000-0000-4000-8000-a23000000000', 'BR-A', 'Brand A'),
  ('00000000-0000-4000-8000-b23030000001', '00000000-0000-4000-8000-b23000000000', 'BR-B-ONLY', 'Brand of B');
insert into public.items (id, organization_id, code, name_en, product_group, unit_of_measure, unit_cost, currency, introduced_on, discontinued_on)
values
  ('00000000-0000-4000-8000-a23020000001', '00000000-0000-4000-8000-a23000000000', 'P-1', 'Part one', 'battery', 'EA', 10, 'SAR', '2024-01-01', null),
  ('00000000-0000-4000-8000-a23020000002', '00000000-0000-4000-8000-a23000000000', 'P-2', 'Part two', 'battery', 'EA', 10, 'SAR', null, '2025-01-01'),
  ('00000000-0000-4000-8000-a23020000003', '00000000-0000-4000-8000-a23000000000', 'P-3', 'Part three', 'battery', 'EA', 10, 'SAR', null, null),
  ('00000000-0000-4000-8000-a23020000004', '00000000-0000-4000-8000-a23000000000', 'P/4', 'Part four', 'battery', 'EA', 10, 'SAR', null, null),
  ('00000000-0000-4000-8000-b23020000001', '00000000-0000-4000-8000-b23000000000', 'P-B-ONLY', 'Part of B', 'battery', 'EA', 1, 'KWD', null, null);
insert into public.item_supersessions (organization_id, predecessor_item_id, successor_item_id, effective_on)
values ('00000000-0000-4000-8000-a23000000000', '00000000-0000-4000-8000-a23020000002', '00000000-0000-4000-8000-a23020000003', '2025-01-01');
insert into public.suppliers (id, organization_id, code, name_en, country_code, currency, lead_time_days_p50, lead_time_days_p90)
values ('00000000-0000-4000-8000-a23040000001', '00000000-0000-4000-8000-a23000000000', 'SUP-A', 'Supplier A', 'SA', 'SAR', 10, 20);
insert into public.supplier_items (organization_id, supplier_id, item_id, lead_time_days, lead_time_days_p90, unit_price, currency)
values
  ('00000000-0000-4000-8000-a23000000000', '00000000-0000-4000-8000-a23040000001', '00000000-0000-4000-8000-a23020000001', 10, 20, 5, 'SAR'),
  ('00000000-0000-4000-8000-a23000000000', '00000000-0000-4000-8000-a23040000001', '00000000-0000-4000-8000-a23020000002', 10, null, 5, 'SAR');
insert into public.demand_history (organization_id, item_id, location_id, demand_date, quantity)
values ('00000000-0000-4000-8000-a23000000000', '00000000-0000-4000-8000-a23020000001', '00000000-0000-4000-8000-a23010000001', '2024-07-15', 3);

------------------------------------------------------------------------------------------------
-- Helpers (as postgres; pg_temp functions run with the privileges of the calling role)
------------------------------------------------------------------------------------------------

-- A sample key named n (zeespare_sk_ + 43 + 6 characters) and its SHA-256, as the Worker sends it.
create function pg_temp.h(n text)
returns bytea
language sql
immutable
as $$
  select sha256(convert_to('zeespare_sk_' || rpad(n, 43, 'x') || 'Ab12Cd', 'UTF8'));
$$;

-- Keys of A: full (every scope), read (both reads), master (master_data:write), tx
-- (transactions:write); of B: b-full. Created by the owners.
insert into public.api_keys (id, organization_id, name, display_prefix, last4, key_hash, scopes, created_by, expires_at)
select v.id::uuid, v.org::uuid, v.name, 'zeespare_sk_Test', 'Ab12', pg_temp.h(v.name), v.scopes, v.creator::uuid, now() + interval '90 days'
from (values
  ('00000000-0000-4000-8000-a23c00000001', '00000000-0000-4000-8000-a23000000000', 'full',
   array['master_data:read', 'master_data:write', 'transactions:read', 'transactions:write'], '00000000-0000-4000-8000-a23000000002'),
  ('00000000-0000-4000-8000-a23c00000002', '00000000-0000-4000-8000-a23000000000', 'read',
   array['master_data:read', 'transactions:read'], '00000000-0000-4000-8000-a23000000002'),
  ('00000000-0000-4000-8000-a23c00000003', '00000000-0000-4000-8000-a23000000000', 'master',
   array['master_data:write'], '00000000-0000-4000-8000-a23000000002'),
  ('00000000-0000-4000-8000-a23c00000004', '00000000-0000-4000-8000-a23000000000', 'tx',
   array['transactions:write'], '00000000-0000-4000-8000-a23000000002'),
  ('00000000-0000-4000-8000-b23c00000001', '00000000-0000-4000-8000-b23000000000', 'b-full',
   array['master_data:read', 'master_data:write', 'transactions:read', 'transactions:write'], '00000000-0000-4000-8000-b23000000001')
) as v (id, org, name, scopes, creator);

-- One api_upsert call rolled back afterwards: its result, or {refused: "<sqlstate> <hint>",
-- detail: the error detail as JSON (MQ422 records) or null}.
create function pg_temp.api_dry(p_key text, p_entity text, p_body jsonb, p_request_id uuid default gen_random_uuid())
returns jsonb
language plpgsql
as $$
declare
  v_result jsonb;
  v_state text;
  v_hint text;
  v_detail text;
begin
  begin
    v_result := public.api_upsert(pg_temp.h(p_key), p_entity, p_body, p_request_id);
    raise exception using errcode = 'MQ998', message = 'dry run';
  exception
    when sqlstate 'MQ998' then
      null;
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint, v_detail = pg_exception_detail;
      v_result := jsonb_build_object(
        'refused', rtrim(v_state || ' ' || coalesce(v_hint, '')),
        'detail', case when pg_input_is_valid(v_detail, 'jsonb') then v_detail::jsonb end);
  end;
  return v_result;
end;
$$;

-- The refusal of a dry call ("<sqlstate> <hint>"), or its result field.
create function pg_temp.refusal(p_key text, p_entity text, p_body jsonb)
returns text
language sql
as $$
  select coalesce(r ->> 'refused', 'result ' || (r ->> 'result')) from pg_temp.api_dry(p_key, p_entity, p_body) as r;
$$;

-- "result recorded inserted updated unchanged deleted skipped" of an upsert result.
create function pg_temp.brief(r jsonb)
returns text
language sql
immutable
as $$
  select format('%s %s %s %s %s %s %s', r ->> 'result', coalesce(r ->> 'recorded', '-'), r -> 'counts' ->> 'inserted',
                r -> 'counts' ->> 'updated', r -> 'counts' ->> 'unchanged', r -> 'counts' ->> 'deleted', r -> 'counts' ->> 'skipped');
$$;

-- Errors of a failed result as "pointer code [value]", in result order.
create function pg_temp.errors(r jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(rtrim(format('%s %s %s', e ->> 'pointer', e ->> 'code', coalesce(e ->> 'value', ''))) order by o), '{}')
  from jsonb_array_elements(coalesce(r -> 'errors', '[]'::jsonb)) with ordinality as x(e, o);
$$;

-- Every row of the organization's target tables, hashed (as in 0017).
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

-- "batches/files/errors/pending/staged/chunks" of an organization's imports and staging.
create function pg_temp.leftovers(p_organization uuid)
returns text
language sql
stable
as $$
  select format('%s/%s/%s/%s/%s/%s',
    (select count(*) from public.import_batches b where b.organization_id = p_organization),
    (select count(*) from public.import_files f where f.organization_id = p_organization),
    (select count(*) from public.import_errors e where e.organization_id = p_organization),
    (select count(*) from ingest.pending_errors e where e.organization_id = p_organization),
    (select count(*) from ingest.staged_rows s where s.organization_id = p_organization),
    (select count(*) from ingest.staged_chunks c where c.organization_id = p_organization));
$$;

create temp table results (name text primary key, result jsonb) on commit drop;
grant select, insert on pg_temp.results to service_role;
grant select on pg_temp.results to authenticated;

create temp table fingerprints (name text primary key, value text not null) on commit drop;
insert into fingerprints
values
  ('A', pg_temp.fingerprint('00000000-0000-4000-8000-a23000000000')),
  ('B', pg_temp.fingerprint('00000000-0000-4000-8000-b23000000000'));

------------------------------------------------------------------------------------------------
-- Wizard parity: the fixture cases as JSON records
------------------------------------------------------------------------------------------------

-- A fixture cell as text: a string, {"repeat": s, "times": n} or {"today_plus": n} (as in 0017).
create function pg_temp.cell(p_cell jsonb)
returns text
language sql
stable
as $$
  select case jsonb_typeof(p_cell)
    when 'string' then p_cell #>> '{}'
    when 'object' then case
      when p_cell ? 'repeat' then repeat(p_cell ->> 'repeat', (p_cell ->> 'times')::integer)
      when p_cell ? 'today_plus' then
        to_char(upper(app.demand_history_window()) - 2 + (p_cell ->> 'today_plus')::integer, 'YYYY-MM-DD')
    end
  end;
$$;

-- Whether JSON can carry a cell exactly: booleans only as true/false, weekdays only as a ;-list
-- of plain integers (each one a JSON number), anything else as a string; '' as null.
create function pg_temp.representable(p_kind text, p_cell text)
returns boolean
language sql
immutable
as $$
  select p_cell = ''
         or case p_kind
              when 'boolean' then p_cell in ('true', 'false')
              when 'weekdays' then p_cell ~ '^(0|[1-9][0-9]{0,8})(;(0|[1-9][0-9]{0,8}))*$'
              else true
            end;
$$;

-- The JSON value of a cell. A cell JSON cannot carry stays a string (so the backstop refuses it)
-- or, patched, becomes false (boolean) or null (weekdays).
create function pg_temp.json_value(p_kind text, p_cell text, p_patch boolean)
returns jsonb
language sql
immutable
as $$
  select case
    when p_cell = '' then 'null'::jsonb
    when not pg_temp.representable(p_kind, p_cell) then
      case when not p_patch then to_jsonb(p_cell) when p_kind = 'boolean' then 'false'::jsonb else 'null'::jsonb end
    when p_kind = 'boolean' then to_jsonb(p_cell::boolean)
    when p_kind = 'weekdays' then
      (select jsonb_agg(u.d::integer order by u.o) from unnest(string_to_array(p_cell, ';')) with ordinality as u(d, o))
    else to_jsonb(p_cell)
  end;
$$;

create temp table cases on commit drop as
select k.ord::integer as case_no, k.doc ->> 'name' as name, k.doc ->> 'entity' as entity, k.doc -> 'expected' as expected,
       k.doc, jsonb_array_length(coalesce(k.doc -> 'parents', '[]'::jsonb)) > 0 as has_parents
from fixture x
cross join jsonb_array_elements(x.doc -> 'cases') with ordinality as k(doc, ord);

-- One row per cell of the single-file cases.
create temp table case_cells on commit drop as
select k.case_no, r.ord::integer as row_no, c.name, c.kind, c.position,
       pg_temp.cell(r.cells -> (array_position(array(select jsonb_array_elements_text(k.doc -> 'columns')), c.name) - 1)) as cell
from cases k
cross join jsonb_array_elements(k.doc -> 'rows') with ordinality as r(cells, ord)
join ingest.contract_columns c
  on c.entity = k.entity and c.name in (select jsonb_array_elements_text(k.doc -> 'columns'))
where not k.has_parents;

-- Per case: the request body, the patched body, the expected refusal (first cell JSON cannot
-- carry, by record and contract position) and the patched cells.
create temp table case_bodies on commit drop as
select k.case_no, k.entity,
       (select jsonb_build_object('records', jsonb_agg(x.rec order by x.row_no))
        from (select c.row_no, jsonb_object_agg(c.name, pg_temp.json_value(c.kind, c.cell, false)) as rec
              from case_cells c where c.case_no = k.case_no group by c.row_no) as x) as body,
       (select jsonb_build_object('records', jsonb_agg(x.rec order by x.row_no))
        from (select c.row_no, jsonb_object_agg(c.name, pg_temp.json_value(c.kind, c.cell, true)) as rec
              from case_cells c where c.case_no = k.case_no group by c.row_no) as x) as patched,
       (select jsonb_build_object('refused', 'MQ422 records',
                                  'detail', jsonb_build_object('code', 'invalid_type', 'record', c.row_no - 1, 'field', c.name))
        from case_cells c
        where c.case_no = k.case_no and not pg_temp.representable(c.kind, c.cell)
        order by c.row_no, c.position
        limit 1) as refusal,
       coalesce((select jsonb_agg(jsonb_build_object('row_no', c.row_no, 'column_name', c.name))
                 from case_cells c
                 where c.case_no = k.case_no and not pg_temp.representable(c.kind, c.cell)), '[]'::jsonb) as patched_cells
from cases k
where not k.has_parents;
grant select on pg_temp.cases, pg_temp.case_bodies to service_role;

create temp table case_results (case_no integer not null, variant text not null, result jsonb, primary key (case_no, variant))
  on commit drop;
grant select, insert on pg_temp.case_results to service_role;

-- Runs every single-file case with the full key of A (rolled back each time).
create function pg_temp.run_cases()
returns integer
language plpgsql
as $$
declare
  v_case record;
  v_count integer := 0;
begin
  for v_case in select b.* from pg_temp.case_bodies b order by b.case_no loop
    if v_case.refusal is null then
      insert into pg_temp.case_results values (v_case.case_no, 'as sent', pg_temp.api_dry('full', v_case.entity, v_case.body));
    else
      insert into pg_temp.case_results values (v_case.case_no, 'refused', pg_temp.api_dry('full', v_case.entity, v_case.body));
      insert into pg_temp.case_results values (v_case.case_no, 'patched', pg_temp.api_dry('full', v_case.entity, v_case.patched));
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- '' when the result's errors and warnings equal the fixture's expectations (without the patched
-- cells) and its result fits (invalid with errors, succeeded otherwise); otherwise the differences.
-- The wizard's detail {first_row, first_file_no, stored} is the API's {first_record, stored}.
create function pg_temp.diff(p_expected jsonb, p_result jsonb, p_skip jsonb)
returns text
language plpgsql
stable
as $$
declare
  v_expected jsonb;
  v_actual jsonb;
  v_lines text[] := '{}';
  v_item jsonb;
  v_detail jsonb;
  v_pointer text;
  v_want text;
begin
  if p_result is null then
    return 'not run';
  elsif p_result ? 'refused' then
    return 'refused: ' || p_result::text;
  end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_expected
  from jsonb_array_elements(p_expected) as x
  where not exists (select 1 from jsonb_array_elements(p_skip) as s
                    where (s ->> 'row_no')::integer = (x ->> 'row_no')::integer and s ->> 'column_name' = x ->> 'column_name');
  select coalesce(jsonb_agg(a.item), '[]'::jsonb) into v_actual
  from (
    select jsonb_build_object('row_no', coalesce((e ->> 'record')::integer + 1, 0), 'column_name', coalesce(e ->> 'field', ''),
                              'code', e ->> 'code', 'level', 'error', 'value', e -> 'value', 'detail', e -> 'detail',
                              'pointer', e ->> 'pointer') as item
    from jsonb_array_elements(coalesce(p_result -> 'errors', '[]'::jsonb)) as e
    union all
    select jsonb_build_object('row_no', coalesce((w ->> 'record')::integer + 1, 0), 'column_name', '',
                              'code', w ->> 'code', 'level', 'warning', 'value', null, 'detail', null,
                              'pointer', w ->> 'pointer')
    from jsonb_array_elements(coalesce(p_result -> 'warnings', '[]'::jsonb)) as w
  ) as a;

  for v_item in select x from jsonb_array_elements(v_expected) as x loop
    v_detail := case when jsonb_typeof(v_item -> 'detail') = 'object' then
      nullif(jsonb_strip_nulls(jsonb_build_object(
        'first_record', case when jsonb_typeof(v_item -> 'detail' -> 'first_row') = 'number'
                             then (v_item -> 'detail' ->> 'first_row')::integer - 1 end,
        'stored', case when jsonb_typeof(v_item -> 'detail' -> 'stored') = 'object' then v_item -> 'detail' -> 'stored' end)),
        '{}'::jsonb) end;
    if not exists (
      select 1 from jsonb_array_elements(v_actual) as y
      where (y ->> 'row_no')::integer = (v_item ->> 'row_no')::integer
        and y ->> 'column_name' = v_item ->> 'column_name'
        and y ->> 'code' = v_item ->> 'code'
        and y ->> 'level' = v_item ->> 'level'
        and (not (v_item ? 'value') or coalesce(y ->> 'value', '') = coalesce(v_item ->> 'value', ''))
        and (not (v_item ? 'value_length') or char_length(coalesce(y ->> 'value', '')) = (v_item ->> 'value_length')::integer)
        and (not (v_item ? 'detail') or coalesce(y -> 'detail', 'null'::jsonb) = coalesce(v_detail, 'null'::jsonb))) then
      v_lines := v_lines || ('missing ' || v_item::text);
    end if;
  end loop;
  for v_item in select y from jsonb_array_elements(v_actual) as y loop
    if not exists (
      select 1 from jsonb_array_elements(v_expected) as x
      where (x ->> 'row_no')::integer = (v_item ->> 'row_no')::integer
        and x ->> 'column_name' = v_item ->> 'column_name'
        and x ->> 'code' = v_item ->> 'code'
        and x ->> 'level' = v_item ->> 'level') then
      v_lines := v_lines || ('unexpected ' || left(v_item::text, 400));
    end if;
    v_pointer := '#/records'
      || case when (v_item ->> 'row_no')::integer > 0 then '/' || ((v_item ->> 'row_no')::integer - 1) else '' end
      || case when v_item ->> 'column_name' <> '' and v_item ->> 'level' = 'error' then '/' || (v_item ->> 'column_name') else '' end;
    if (v_item ->> 'pointer') is distinct from v_pointer then
      v_lines := v_lines || ('pointer ' || left(v_item::text, 400));
    end if;
  end loop;

  v_want := case when exists (select 1 from jsonb_array_elements(v_expected) as x where x ->> 'level' = 'error')
                 then 'invalid' else 'succeeded' end;
  if p_result ->> 'result' is distinct from v_want then
    v_lines := v_lines || format('result %s, expected %s', p_result ->> 'result', v_want);
  end if;
  if v_want = 'invalid' and (p_result ->> 'error_count')::integer is distinct from
     (select sum(n.v::integer)::integer from jsonb_each(p_result -> 'error_counts') as o
      cross join lateral jsonb_each_text(o.value) as n(k, v)) then
    v_lines := v_lines || ('error_counts do not add up to error_count: ' || (p_result -> 'error_counts')::text);
  end if;
  return array_to_string(v_lines, '; ');
end;
$$;

-- One assertion per case (two for a case with cells JSON cannot carry), in case order.
create function pg_temp.check_cases()
returns setof text
language plpgsql
as $$
declare
  v_case record;
begin
  for v_case in
    select k.case_no, k.name, k.expected, b.refusal, b.patched_cells, r.result, f.result as refused
    from pg_temp.cases k
    join pg_temp.case_bodies b on b.case_no = k.case_no
    left join pg_temp.case_results r on r.case_no = k.case_no and r.variant in ('as sent', 'patched')
    left join pg_temp.case_results f on f.case_no = k.case_no and f.variant = 'refused'
    order by k.case_no
  loop
    if v_case.refusal is not null then
      return next is(v_case.refused, v_case.refusal,
                     format('fixture %s: JSON cannot carry %s of record %s, refused with MQ422 records invalid_type', v_case.case_no,
                            v_case.refusal -> 'detail' ->> 'field', v_case.refusal -> 'detail' ->> 'record'));
    end if;
    return next is(pg_temp.diff(v_case.expected, v_case.result, v_case.patched_cells), '',
                   format('fixture %s%s: %s', v_case.case_no,
                          case when v_case.refusal is not null then ' (those cells patched)' else '' end, v_case.name));
  end loop;
end;
$$;

select plan(
  (select count(*)::integer from pg_temp.case_bodies)
  + (select count(*)::integer from pg_temp.case_bodies where refusal is not null)
  + 88
);

select ok(
  (select count(*) from pg_temp.case_bodies) >= 25,
  'at least 25 single-file fixture cases are sent as JSON records'
);
select ok(
  (select count(*) from pg_temp.case_bodies where refusal is not null) between 1 and 5,
  'a few of them hold cells JSON cannot carry'
);

set local role service_role;
select is(
  pg_temp.run_cases(),
  (select count(*)::integer from pg_temp.cases where not has_parents),
  'every single-file fixture case ran (cases with parent files are skipped)'
);
reset role;
select * from pg_temp.check_cases();

select is(
  pg_temp.leftovers('00000000-0000-4000-8000-a23000000000'),
  '0/0/0/0/0/0',
  'the dry runs left no batch, file, error, pending error or staged row'
);
select is(
  array[pg_temp.fingerprint('00000000-0000-4000-8000-a23000000000'), pg_temp.fingerprint('00000000-0000-4000-8000-b23000000000')],
  array[(select f.value from fingerprints f where f.name = 'A'), (select f.value from fingerprints f where f.name = 'B')],
  'and changed no row of A or B'
);

------------------------------------------------------------------------------------------------
-- Basic flow: brands, then items; a repeat is not recorded
------------------------------------------------------------------------------------------------
set local role service_role;
insert into pg_temp.results values ('brands', public.api_upsert(pg_temp.h('full'), 'brands',
  '{"records": [{"brand_code": "API-BR-1", "name_en": "Api brand one", "brand_type": "oem"},
                {"brand_code": "API-BR-2", "name_en": "Api brand two", "brand_type": null}]}',
  '00000000-0000-4000-8000-a23e00000001'));
insert into pg_temp.results values ('items', public.api_upsert(pg_temp.h('full'), 'items',
  '{"records": [
     {"item_code": "API-1", "name_en": "Api item one", "brand_code": "API-BR-1", "product_group": "filters", "unit_of_measure": "EA", "unit_cost": 1.5, "currency": "SAR"},
     {"item_code": "API-2", "name_en": "Api item two", "brand_code": "API-BR-2", "product_group": "brakes", "unit_of_measure": "SET", "unit_cost": "12.5", "currency": "SAR"},
     {"item_code": "API-3", "name_en": "Api item three", "brand_code": null, "product_group": "fluids", "unit_of_measure": "L", "unit_cost": 100, "currency": "KWD"}]}',
  '00000000-0000-4000-8000-a23e00000002'));
reset role;

select is(
  (select pg_temp.brief(r.result) from pg_temp.results r where r.name = 'brands'),
  'succeeded true 2 0 0 0 0',
  'two brands are inserted and the write is recorded'
);
select is(
  (select r.result - 'import_id' from pg_temp.results r where r.name = 'items'),
  '{"result": "succeeded", "recorded": true, "entity": "items", "records": 3,
    "counts": {"inserted": 3, "updated": 0, "unchanged": 0, "deleted": 0, "skipped": 0},
    "warning_count": 0, "warnings": [], "warnings_truncated": false}'::jsonb,
  'three items are inserted: the full success result'
);
select is(
  (select format('%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s', b.source, b.status, b.commit_mode, b.api_key_id, b.api_request_id,
                 b.created_by is null, b.expires_at is null, b.rows_total, b.file_count, b.error_count, b.counts)
   from public.import_batches b
   where b.id = (select (r.result ->> 'import_id')::uuid from pg_temp.results r where r.name = 'items')),
  'api|succeeded|atomic|00000000-0000-4000-8000-a23c00000001|00000000-0000-4000-8000-a23e00000002|t|t|3|1|0|'
    || '{"items": {"deleted": 0, "skipped": 0, "updated": 0, "inserted": 3, "unchanged": 0}}',
  'the recorded batch: source api, succeeded, atomic, its key and request id, no creator, no expiry, 3 rows'
);
select is(
  (select format('%s|%s|%s|%s|%s|%s|%s|%s|%s', f.file_no, f.entity, f.extension, f.content_type, f.original_name,
                 f.storage_path = f.organization_id || '/' || f.batch_id || '/1.json', f.source_stored, f.status, f.columns)
   from public.import_files f
   where f.batch_id = (select (r.result ->> 'import_id')::uuid from pg_temp.results r where r.name = 'items')),
  '1|items|json|application/json|POST /api/v1/items:upsert|t|f|merged|{item_code,name_en,brand_code,product_group,unit_of_measure,unit_cost,currency}',
  'its one file: json at <org>/<batch>/1.json, not stored, merged, with the provided columns in contract order'
);
select is(
  (select format('%s %s', count(*) filter (where b.staging_cleared_at is not null), count(*))
   from public.import_batches b where b.organization_id = '00000000-0000-4000-8000-a23000000000'),
  '2 2',
  'both recorded batches have their staging cleared'
);
select is(
  substr(pg_temp.leftovers('00000000-0000-4000-8000-a23000000000'), 5),
  '0/0/0/0',
  'no error, pending error, staged row or chunk remains'
);
select is(
  (select count(*)::integer from ingest.import_creations c where c.organization_id = '00000000-0000-4000-8000-a23000000000'),
  0,
  'API writes do not count against the wizard''s import-creation ledger'
);
select is(
  (select format('%s %s %s', i.unit_cost, i.currency, b.code) from public.items i
   left join public.brands b on b.organization_id = i.organization_id and b.id = i.brand_id
   where i.organization_id = '00000000-0000-4000-8000-a23000000000' and i.code = 'API-1'),
  '1.500 SAR API-BR-1',
  'the item references its brand by code'
);

create temp table item_versions on commit drop as
select i.code, i.xmin::text as row_xmin, i.ctid::text as row_ctid, i.updated_at, i.search_text
from public.items i
where i.organization_id = '00000000-0000-4000-8000-a23000000000' and i.code like 'API-_';

set local role service_role;
insert into pg_temp.results values ('items again', public.api_upsert(pg_temp.h('full'), 'items',
  '{"records": [
     {"item_code": "API-1", "name_en": "Api item one", "brand_code": "API-BR-1", "product_group": "filters", "unit_of_measure": "EA", "unit_cost": "1.50", "currency": "SAR"},
     {"item_code": "API-2", "name_en": "Api item two", "brand_code": "API-BR-2", "product_group": "brakes", "unit_of_measure": "SET", "unit_cost": 12.500, "currency": "SAR"},
     {"item_code": "API-3", "name_en": "Api item three", "brand_code": "", "product_group": "fluids", "unit_of_measure": "L", "unit_cost": "100", "currency": "KWD"}]}',
  gen_random_uuid()));
reset role;
select is(
  (select format('%s import_id=%s', pg_temp.brief(r.result), coalesce(r.result ->> 'import_id', 'null'))
   from pg_temp.results r where r.name = 'items again'),
  'succeeded false 0 0 3 0 0 import_id=null',
  'the same items again (decimals as other spellings, "" for a null brand): unchanged, not recorded, no import id'
);
select is(
  (select count(*)::integer from public.import_batches b where b.organization_id = '00000000-0000-4000-8000-a23000000000'),
  2,
  'no batch was created for it'
);
select is(
  (select count(*)::integer from ingest.api_writes where organization_id = '00000000-0000-4000-8000-a23000000000'),
  2,
  'only the two changed writes consumed quota; dry failures and unchanged replay did not'
);
select ok(
  (select relrowsecurity and relpersistence = 'p' from pg_class where oid = 'ingest.api_writes'::regclass),
  'the quota ledger has RLS and survives crash recovery'
);
select is(
  (select count(*)::integer from item_versions v
   join public.items i on i.organization_id = '00000000-0000-4000-8000-a23000000000' and i.code = v.code
   where i.xmin::text = v.row_xmin and i.ctid::text = v.row_ctid and i.updated_at = v.updated_at and i.search_text = v.search_text),
  3,
  'the three items keep their xmin, ctid, updated_at and search_text'
);

set local role service_role;
insert into pg_temp.results values ('items partial', public.api_upsert(pg_temp.h('full'), 'items',
  '{"records": [{"item_code": "API-1", "name_en": "Oil filter"}, {"item_code": "API-2", "name_en": "Api item two"}]}',
  gen_random_uuid()));
reset role;
select is(
  (select pg_temp.brief(r.result) from pg_temp.results r where r.name = 'items partial'),
  'succeeded true 0 1 1 0 0',
  'a partial write (name_en only) updates one item and leaves the other unchanged'
);
select is(
  (select format('%s|%s|%s|%s', i.name_en, i.product_group, i.unit_cost, i.xmin::text = v.row_xmin)
   from public.items i join item_versions v on v.code = i.code
   where i.organization_id = '00000000-0000-4000-8000-a23000000000' and i.code in ('API-1', 'API-2')
   order by i.code limit 1),
  'Oil filter|filters|1.500|f',
  'API-1 has the new name and keeps the fields the write did not send'
);
select is(
  (select count(*)::integer from item_versions v
   join public.items i on i.organization_id = '00000000-0000-4000-8000-a23000000000' and i.code = v.code
   where v.code in ('API-2', 'API-3') and i.xmin::text = v.row_xmin and i.ctid::text = v.row_ctid),
  2,
  'API-2 (sent, unchanged) and API-3 (not sent) are not rewritten'
);
select is(
  (select format('%s %s', k.last_used_at = now(), k.updated_at = now()) from public.api_keys k where k.name = 'full'),
  't t',
  'the key records its use'
);

------------------------------------------------------------------------------------------------
-- Failures leave nothing
------------------------------------------------------------------------------------------------
create temp table import_counts_before on commit drop as
select pg_temp.leftovers('00000000-0000-4000-8000-a23000000000') as value;

set local role service_role;
insert into pg_temp.results values ('invalid items', public.api_upsert(pg_temp.h('full'), 'items',
  '{"records": [
     {"item_code": "API-F1", "name_en": "Fine", "product_group": "filters", "unit_of_measure": "EA", "unit_cost": 1, "currency": "SAR"},
     {"item_code": "API-F2", "name_en": "", "product_group": "filters", "unit_of_measure": "EA", "unit_cost": 1, "currency": "SAR"},
     {"item_code": "API-F1", "name_en": "Again", "product_group": "filters", "unit_of_measure": "EA", "unit_cost": 1, "currency": "SAR"}]}',
  gen_random_uuid()));
insert into pg_temp.results values ('many errors', public.api_upsert(pg_temp.h('full'), 'brands',
  (select jsonb_build_object('records', jsonb_agg(jsonb_build_object('brand_code', 'MANY-' || i, 'name_en', '', 'brand_type', 'nope') order by i))
   from generate_series(1, 600) as i),
  gen_random_uuid()));
reset role;

select is(
  (select r.result from pg_temp.results r where r.name = 'invalid items'),
  '{"result": "invalid", "failure_code": null, "error_count": 2,
    "error_counts": {"required": {"name_en": 1}, "duplicate_key": {"": 1}},
    "errors": [
      {"pointer": "#/records/1/name_en", "record": 1, "field": "name_en", "code": "required", "value": null, "detail": null},
      {"pointer": "#/records/2", "record": 2, "field": null, "code": "duplicate_key", "value": "API-F1", "detail": {"first_record": 0}}],
    "errors_truncated": false, "warning_count": 0, "warnings": [], "warnings_truncated": false}'::jsonb,
  'an invalid write: pointers per field and per record, duplicate_key with first_record, complete error_counts'
);
select is(
  (select format('%s %s %s %s', r.result ->> 'error_count', jsonb_array_length(r.result -> 'errors'), r.result ->> 'errors_truncated',
                 r.result -> 'error_counts')
   from pg_temp.results r where r.name = 'many errors'),
  '1200 1000 true {"required": {"name_en": 600}, "invalid_enum": {"brand_type": 600}}',
  '1,200 errors: the first 1,000 are listed, errors_truncated is set and error_counts is complete'
);
select is(
  (select array[r.result -> 'errors' -> 0 ->> 'pointer', r.result -> 'errors' -> 999 ->> 'pointer']
   from pg_temp.results r where r.name = 'many errors'),
  array['#/records/0/brand_type', '#/records/499/name_en'],
  'in record and field order'
);
select is(
  pg_temp.leftovers('00000000-0000-4000-8000-a23000000000'),
  (select value from import_counts_before),
  'the failed writes left no batch, file, error, pending error or staged row'
);
select is(
  (select count(*)::integer from public.items i
   where i.organization_id = '00000000-0000-4000-8000-a23000000000' and i.code like 'API-F%')
  + (select count(*)::integer from public.brands b
     where b.organization_id = '00000000-0000-4000-8000-a23000000000' and b.code like 'MANY-%'),
  0,
  'and wrote no row, not even the valid record'
);

------------------------------------------------------------------------------------------------
-- Value handling
------------------------------------------------------------------------------------------------
set local role service_role;
insert into pg_temp.results values ('v insert', public.api_upsert(pg_temp.h('full'), 'items',
  '{"records": [{"item_code": "API-V1", "name_en": "Value one", "name_ar": "قيمة", "product_group": "filters", "unit_of_measure": "EA",
                 "unit_cost": 2, "currency": "SAR", "introduced_on": "2025-01-01"}]}', gen_random_uuid()));
insert into pg_temp.results values ('v clear', public.api_upsert(pg_temp.h('full'), 'items',
  '{"records": [{"item_code": "API-V1", "name_ar": null, "introduced_on": ""}]}', gen_random_uuid()));
reset role;
select is(
  (select format('%s|%s', pg_temp.brief(r1.result), pg_temp.brief(r2.result))
   from pg_temp.results r1, pg_temp.results r2 where r1.name = 'v insert' and r2.name = 'v clear'),
  'succeeded true 1 0 0 0 0|succeeded true 0 1 0 0 0',
  'an item is inserted, then updated with null and "" values'
);
select is(
  (select format('%s|%s|%s|%s|%s|%s', i.name_en, i.name_ar is null, i.introduced_on is null, i.product_group, i.unit_cost, i.currency)
   from public.items i where i.organization_id = '00000000-0000-4000-8000-a23000000000' and i.code = 'API-V1'),
  'Value one|t|t|filters|2.000|SAR',
  'null and "" clear their columns; the fields the write did not send keep their values'
);

set local role service_role;
insert into pg_temp.results values ('v updated_at', public.api_upsert(pg_temp.h('full'), 'items',
  '{"records": [{"item_code": "API-V1", "name_en": "Value one renamed", "updated_at": "1999-01-01T00:00:00.000000Z"}]}', gen_random_uuid()));
insert into pg_temp.results values ('v updated_at again', public.api_upsert(pg_temp.h('full'), 'items',
  '{"records": [{"item_code": "API-V1", "name_en": "Value one renamed", "updated_at": "2000-01-01T00:00:00Z"}]}', gen_random_uuid()));
reset role;
select is(
  (select format('%s|%s|%s', pg_temp.brief(r1.result), pg_temp.brief(r2.result), i.updated_at = now())
   from pg_temp.results r1, pg_temp.results r2, public.items i
   where r1.name = 'v updated_at' and r2.name = 'v updated_at again'
     and i.organization_id = '00000000-0000-4000-8000-a23000000000' and i.code = 'API-V1'),
  'succeeded true 0 1 0 0 0|succeeded false 0 0 1 0 0|t',
  'updated_at in a record is ignored: it neither sets the column nor counts as a change'
);

set local role service_role;
insert into pg_temp.results values ('v weekdays', public.api_upsert(pg_temp.h('full'), 'work_calendars',
  '{"records": [{"work_calendar_code": "API-CAL-1", "name_en": "Api calendar", "country_code": "SA", "weekend_days": [6, 5], "observe_public_holidays": true},
                {"work_calendar_code": "API-CAL-2", "name_en": "No weekend", "country_code": "SA", "weekend_days": [], "observe_public_holidays": false}]}',
  gen_random_uuid()));
reset role;
select is(
  array(select format('%s %s %s', w.code, w.weekend_days, w.observe_public_holidays) from public.work_calendars w
        where w.organization_id = '00000000-0000-4000-8000-a23000000000' and w.code like 'API-CAL-%' order by w.code),
  array['API-CAL-1 {5,6} t', 'API-CAL-2 {} f'],
  'weekdays [6,5] are stored as {5,6} and [] as no weekend; JSON booleans are stored'
);

set local role service_role;
insert into pg_temp.results values ('v integer', public.api_upsert(pg_temp.h('full'), 'suppliers',
  '{"records": [{"supplier_code": "API-SUP", "name_en": "Api supplier", "country_code": "SA", "currency": "SAR",
                 "lead_time_days_p50": 3.0, "lead_time_days_p90": 7}]}', gen_random_uuid()));
reset role;
select is(
  (select format('%s %s %s', pg_temp.brief(r.result), s.lead_time_days_p50, s.lead_time_days_p90)
   from pg_temp.results r, public.suppliers s
   where r.name = 'v integer' and s.organization_id = '00000000-0000-4000-8000-a23000000000' and s.code = 'API-SUP'),
  'succeeded true 1 0 0 0 0 3 7',
  'an integral JSON number (3.0) is accepted for an integer'
);
set local role service_role;
select is(
  array[
    pg_temp.errors(pg_temp.api_dry('full', 'suppliers', '{"records": [{"supplier_code": "API-SUP", "lead_time_days_p50": 3.5, "lead_time_days_p90": 7}]}')),
    pg_temp.errors(pg_temp.api_dry('full', 'suppliers', '{"records": [{"supplier_code": "API-SUP", "lead_time_days_p50": "3.0", "lead_time_days_p90": 7}]}'))],
  array[array['#/records/0/lead_time_days_p50 invalid_integer 3.5'], array['#/records/0/lead_time_days_p50 invalid_integer 3.0']],
  'a fractional number (3.5) and the string "3.0" are invalid_integer'
);

insert into pg_temp.results values ('v decimals', public.api_upsert(pg_temp.h('full'), 'items',
  '{"records": [
     {"item_code": "API-V2", "name_en": "Number", "product_group": "filters", "unit_of_measure": "EA", "unit_cost": 1.50, "currency": "SAR"},
     {"item_code": "API-V3", "name_en": "String", "product_group": "filters", "unit_of_measure": "EA", "unit_cost": "1.50", "currency": "SAR"},
     {"item_code": "API-V4", "name_en": "Fifteen digits", "product_group": "filters", "unit_of_measure": "EA", "unit_cost": 123456789012.345, "currency": "KWD"}]}',
  gen_random_uuid()));
insert into pg_temp.results values ('v fx', public.api_upsert(pg_temp.h('full'), 'fx_rates',
  '{"records": [{"from_currency": "USD", "to_currency": "SAR", "valid_from": "2026-01-01", "rate": "1234567890.1234567891"},
                {"from_currency": "EUR", "to_currency": "SAR", "valid_from": "2026-01-01", "rate": 1234567890.1234567891},
                {"from_currency": "JPY", "to_currency": "SAR", "valid_from": "2026-01-01", "rate": 0.0000000001}]}',
  gen_random_uuid()));
select is(
  pg_temp.errors(pg_temp.api_dry('full', 'items',
    '{"records": [{"item_code": "API-V5", "name_en": "Float", "product_group": "filters", "unit_of_measure": "EA",
                   "unit_cost": 0.30000000000000004, "currency": "SAR"}]}')),
  array['#/records/0/unit_cost too_many_decimals 0.30000000000000004'],
  '0.30000000000000004 keeps its digits and is too_many_decimals'
);
reset role;
select is(
  array(select format('%s %s', i.code, i.unit_cost) from public.items i
        where i.organization_id = '00000000-0000-4000-8000-a23000000000' and i.code in ('API-V2', 'API-V3', 'API-V4') order by i.code),
  array['API-V2 1.500', 'API-V3 1.500', 'API-V4 123456789012.345'],
  'decimals are exact whether sent as numbers (1.50, 123456789012.345) or strings ("1.50")'
);
select is(
  array(select format('%s/%s %s', x.from_currency, x.to_currency, x.rate) from public.fx_rates x
        where x.organization_id = '00000000-0000-4000-8000-a23000000000' order by x.from_currency),
  array['EUR/SAR 1234567890.1234567891', 'JPY/SAR 0.0000000001', 'USD/SAR 1234567890.1234567891'],
  'a 20-digit fx rate stays exact as a string and as a JSON number (and so does the smallest rate, 0.0000000001)'
);

set local role service_role;
insert into pg_temp.results values ('v holiday country', public.api_upsert(pg_temp.h('full'), 'holiday_overrides',
  '{"records": [{"country_code": "SA", "starts_on": "2026-11-01", "ends_on": "2026-11-02", "kind": "closure", "name_en": "Api closure"}]}',
  gen_random_uuid()));
insert into pg_temp.results values ('v holiday calendar', public.api_upsert(pg_temp.h('full'), 'holiday_overrides',
  '{"records": [{"work_calendar_code": "CAL-A", "starts_on": "2026-11-05", "ends_on": "2026-11-05", "kind": "closure", "name_en": "Calendar closure"}]}',
  gen_random_uuid()));
reset role;
select is(
  array(select format('%s %s %s', coalesce(h.country_code, '-'), coalesce(w.code, '-'), h.name_en)
        from public.holiday_overrides h
        left join public.work_calendars w on w.organization_id = h.organization_id and w.id = h.work_calendar_id
        where h.organization_id = '00000000-0000-4000-8000-a23000000000' and h.starts_on >= '2026-11-01'
        order by h.starts_on),
  array['SA - Api closure', '- CAL-A Calendar closure'],
  'a holiday override without work_calendar_code (or without country_code) takes the absent scope field as empty'
);

------------------------------------------------------------------------------------------------
-- MQ422 records: the request-shape backstop (Worker checks repeated in SQL)
------------------------------------------------------------------------------------------------
set local role service_role;
select is(pg_temp.api_dry('full', 'brands', '[]'),
  '{"refused": "MQ422 records", "detail": {"code": "not_an_object"}}'::jsonb, 'a body that is not an object');
select is(pg_temp.api_dry('full', 'brands', '{"records": [{"brand_code": "X", "name_en": "X"}], "extra": 1}'),
  '{"refused": "MQ422 records", "detail": {"code": "unknown_field", "field": "extra"}}'::jsonb, 'an extra top-level member');
select is(
  array[pg_temp.api_dry('full', 'brands', '{}'), pg_temp.api_dry('full', 'brands', '{"records": []}'),
        pg_temp.api_dry('full', 'brands', '{"records": {"brand_code": "X"}}')],
  array['{"refused": "MQ422 records", "detail": {"code": "missing_records"}}'::jsonb,
        '{"refused": "MQ422 records", "detail": {"code": "missing_records"}}'::jsonb,
        '{"refused": "MQ422 records", "detail": {"code": "missing_records"}}'::jsonb],
  'no records member, 0 records, records not an array');
select is(
  pg_temp.api_dry('full', 'brands',
    (select jsonb_build_object('records', jsonb_agg(jsonb_build_object('brand_code', 'CAP-' || i, 'name_en', 'Cap')))
     from generate_series(1, 1001) as i)),
  '{"refused": "MQ422 records", "detail": {"code": "too_many_records", "limit": 1000}}'::jsonb,
  '1,001 master-data records');
select is(
  pg_temp.api_dry('full', 'demand_history',
    (select jsonb_build_object('records', jsonb_agg(jsonb_build_object('item_code', 'P-1', 'location_code', 'LOC-A1',
                                                                       'demand_date', '2024-01-01'::date + i, 'quantity', 1)))
     from generate_series(1, 2501) as i)),
  '{"refused": "MQ422 records", "detail": {"code": "too_many_records", "limit": 2500}}'::jsonb,
  '2,501 demand records');
select is(pg_temp.api_dry('full', 'brands', '{"records": [{"brand_code": "X", "name_en": "X"}, "Y"]}'),
  '{"refused": "MQ422 records", "detail": {"code": "not_an_object", "record": 1}}'::jsonb, 'a record that is not an object');
select is(pg_temp.api_dry('full', 'brands', '{"records": [{"brand_code": "X", "name_en": "X"}, {"brand_code": "Y"}]}'),
  '{"refused": "MQ422 records", "detail": {"code": "inconsistent_fields", "record": 1, "field": "name_en"}}'::jsonb,
  'records with different fields');
select is(pg_temp.api_dry('full', 'brands', '{"records": [{"brand_code": "X", "colour": "red"}]}'),
  '{"refused": "MQ422 records", "detail": {"code": "unknown_field", "record": 0, "field": "colour"}}'::jsonb, 'an unknown field');
select is(pg_temp.api_dry('full', 'demand_history',
    '{"records": [{"item_code": "P-1", "location_code": "LOC-A1", "demand_date": "2024-07-15", "quantity": 1, "updated_at": "x"}]}'),
  '{"refused": "MQ422 records", "detail": {"code": "unknown_field", "record": 0, "field": "updated_at"}}'::jsonb,
  'updated_at is an unknown field of demand history');
select is(pg_temp.api_dry('full', 'brands', '{"records": [{"name_en": "X"}]}'),
  '{"refused": "MQ422 records", "detail": {"code": "missing_key_field", "record": 0, "field": "brand_code"}}'::jsonb,
  'a missing key field');
select is(pg_temp.api_dry('full', 'items', '{"records": [{"item_code": "X", "unit_cost": 1}]}'),
  '{"refused": "MQ422 records", "detail": {"code": "incomplete_group", "record": 0, "field": "currency"}}'::jsonb,
  'an incomplete column group (unit_cost without currency)');
select is(pg_temp.api_dry('full', 'demand_history', '{"records": [{"item_code": "P-1", "location_code": "LOC-A1", "demand_date": "2024-07-15"}]}'),
  '{"refused": "MQ422 records", "detail": {"code": "value_field_required", "record": 0, "field": "quantity"}}'::jsonb,
  'demand without quantity or lost_sales_quantity');
select is(
  array[
    pg_temp.api_dry('full', 'brands', '{"records": [{"brand_code": "X", "name_en": {"en": "X"}}]}'),
    pg_temp.api_dry('full', 'brands', '{"records": [{"brand_code": "X", "name_en": ["X"]}]}'),
    pg_temp.api_dry('full', 'brands', '{"records": [{"brand_code": "X", "name_en": "X", "is_active": "true"}]}'),
    pg_temp.api_dry('full', 'brands', '{"records": [{"brand_code": 123, "name_en": "X"}]}'),
    pg_temp.api_dry('full', 'work_calendars', '{"records": [{"work_calendar_code": "X", "weekend_days": ["5"]}]}'),
    pg_temp.api_dry('full', 'brands', '{"records": [{"brand_code": "A", "name_en": "A"}, {"brand_code": "B", "name_en": "B"}, {"brand_code": "C", "name_en": 3}]}')],
  array[
    '{"refused": "MQ422 records", "detail": {"code": "invalid_type", "record": 0, "field": "name_en"}}'::jsonb,
    '{"refused": "MQ422 records", "detail": {"code": "invalid_type", "record": 0, "field": "name_en"}}'::jsonb,
    '{"refused": "MQ422 records", "detail": {"code": "invalid_type", "record": 0, "field": "is_active"}}'::jsonb,
    '{"refused": "MQ422 records", "detail": {"code": "invalid_type", "record": 0, "field": "brand_code"}}'::jsonb,
    '{"refused": "MQ422 records", "detail": {"code": "invalid_type", "record": 0, "field": "weekend_days"}}'::jsonb,
    '{"refused": "MQ422 records", "detail": {"code": "invalid_type", "record": 2, "field": "name_en"}}'::jsonb],
  'invalid_type: an object, an array outside weekdays, a string boolean, a number for a code, a string weekday; the first offending record');
select is(
  array[pg_temp.api_dry('no-such-key', 'widgets', '{"records": []}'),
        pg_temp.api_dry('full', 'demand-history', '{"records": []}'),
        pg_temp.api_dry('full', null, '{"records": []}')],
  array['{"refused": "MQ404 resource", "detail": null}'::jsonb, '{"refused": "MQ404 resource", "detail": null}'::jsonb,
        '{"refused": "MQ404 resource", "detail": null}'::jsonb],
  'an unknown entity (or a resource name instead of the entity) is MQ404 resource, checked before the key'
);
reset role;
select is(
  pg_temp.api_dry('full', 'brands', '{"records": [{"brand_code": "X", "name_en": "X"}]}', null),
  '{"refused": "MQ422 request_id", "detail": null}'::jsonb,
  'a null request id is MQ422 request_id'
);
select is(
  array[
    cardinality(app.api_check_fields('demand_history',
      (select jsonb_build_object('records', jsonb_agg(jsonb_build_object('item_code', 'P-1', 'location_code', 'LOC-A1',
                                                                         'demand_date', '2024-01-01'::date + i, 'quantity', 1)))
       from generate_series(1, (app.api_limits() -> 'upsert_records' ->> 'demand_history')::integer) as i))),
    cardinality(app.api_check_fields('brands',
      (select jsonb_build_object('records', jsonb_agg(jsonb_build_object('brand_code', 'CAP-' || i, 'name_en', 'Cap')))
       from generate_series(1, (app.api_limits() -> 'upsert_records' ->> 'master_data')::integer) as i)))],
  array[4, 2],
  'the caps themselves pass (2,500 demand and 1,000 master-data records, from app.api_limits())'
);

------------------------------------------------------------------------------------------------
-- Demand history
------------------------------------------------------------------------------------------------
set local role service_role;
insert into pg_temp.results values ('d insert', public.api_upsert(pg_temp.h('tx'), 'demand_history',
  '{"records": [{"item_code": "P-1", "location_code": "LOC-A1", "demand_date": "2024-08-01", "quantity": "5", "lost_sales_quantity": 0}]}',
  gen_random_uuid()));
reset role;
select is(
  (select format('%s|%s', pg_temp.brief(r.result), d.quantity)
   from pg_temp.results r, public.demand_history d
   where r.name = 'd insert' and d.organization_id = '00000000-0000-4000-8000-a23000000000' and d.demand_date = '2024-08-01'),
  'succeeded true 1 0 0 0 0|5.000',
  'a demand row is inserted (with a transactions:write key)'
);
set local role service_role;
insert into pg_temp.results values ('d delete', public.api_upsert(pg_temp.h('tx'), 'demand_history',
  '{"records": [{"item_code": "P-1", "location_code": "LOC-A1", "demand_date": "2024-08-01", "quantity": 0, "lost_sales_quantity": "0"}]}',
  gen_random_uuid()));
insert into pg_temp.results values ('d zero new', public.api_upsert(pg_temp.h('tx'), 'demand_history',
  '{"records": [{"item_code": "P-1", "location_code": "LOC-A1", "demand_date": "2024-08-02", "quantity": 0, "lost_sales_quantity": 0}]}',
  gen_random_uuid()));
insert into pg_temp.results values ('d keep', public.api_upsert(pg_temp.h('tx'), 'demand_history',
  '{"records": [{"item_code": "P-1", "location_code": "LOC-A1", "demand_date": "2024-07-15", "lost_sales_quantity": 2}]}',
  gen_random_uuid()));
reset role;
select is(
  (select format('%s|%s', pg_temp.brief(r.result),
                 (select count(*) from public.demand_history d
                  where d.organization_id = '00000000-0000-4000-8000-a23000000000' and d.demand_date = '2024-08-01'))
   from pg_temp.results r where r.name = 'd delete'),
  'succeeded true 0 0 0 1 0|0',
  'a 0/0 row deletes the day and the write is recorded'
);
select is(
  (select r.result from pg_temp.results r where r.name = 'd zero new'),
  '{"result": "succeeded", "import_id": null, "recorded": false, "entity": "demand_history", "records": 1,
    "counts": {"inserted": 0, "updated": 0, "unchanged": 0, "deleted": 0, "skipped": 1},
    "warning_count": 1, "warnings": [{"pointer": "#/records/0", "record": 0, "code": "zero_row_new_key"}],
    "warnings_truncated": false}'::jsonb,
  'a 0/0 row for a new key is skipped with the zero_row_new_key warning; on its own the write is not recorded'
);
select is(
  (select format('%s|%s %s', pg_temp.brief(r.result), d.quantity, d.lost_sales_quantity)
   from pg_temp.results r, public.demand_history d
   where r.name = 'd keep' and d.organization_id = '00000000-0000-4000-8000-a23000000000' and d.demand_date = '2024-07-15'),
  'succeeded true 0 1 0 0 0|3.000 2.000',
  'a row without quantity keeps the stored quantity'
);
insert into pg_temp.results values ('d window body', (
  select jsonb_build_object('records', jsonb_agg(jsonb_build_object('item_code', 'P-1', 'location_code', 'LOC-A1',
                                                                    'demand_date', d, 'quantity', 1) order by o))
  from unnest(array[lower(app.demand_history_window()) - 1, upper(app.demand_history_window()),
                    lower(app.demand_history_window()), upper(app.demand_history_window()) - 1]) with ordinality as u(d, o)));
insert into pg_temp.results values ('d window expected', (
  select to_jsonb(array['#/records/0/demand_date date_outside_history_window ' || (lower(w) - 1),
                        '#/records/1/demand_date date_outside_history_window ' || upper(w)])
  from (select app.demand_history_window() as w) as x));
set local role service_role;
select is(
  to_jsonb(pg_temp.errors(pg_temp.api_dry('tx', 'demand_history', (select r.result from pg_temp.results r where r.name = 'd window body')))),
  (select r.result from pg_temp.results r where r.name = 'd window expected'),
  'dates outside the history window are refused at both ends; its first and last days are accepted'
);
reset role;

------------------------------------------------------------------------------------------------
-- Scopes
------------------------------------------------------------------------------------------------
set local role service_role;
select is(
  array[
    pg_temp.refusal('read', 'brands', '{"records": [{"brand_code": "API-S", "name_en": "S"}]}'),
    pg_temp.refusal('tx', 'brands', '{"records": [{"brand_code": "API-S", "name_en": "S"}]}'),
    pg_temp.refusal('master', 'demand_history',
      '{"records": [{"item_code": "P-1", "location_code": "LOC-A1", "demand_date": "2024-08-03", "quantity": 1}]}'),
    pg_temp.refusal('read', 'demand_history',
      '{"records": [{"item_code": "P-1", "location_code": "LOC-A1", "demand_date": "2024-08-03", "quantity": 1}]}')],
  array['MQ403 scope', 'MQ403 scope', 'MQ403 scope', 'MQ403 scope'],
  'MQ403 scope: a read-only key, a transactions key on master data, a master-data key on demand'
);
select is(
  array[
    pg_temp.refusal('master', 'brands', '{"records": [{"brand_code": "API-S", "name_en": "S"}]}'),
    pg_temp.refusal('tx', 'demand_history',
      '{"records": [{"item_code": "P-1", "location_code": "LOC-A1", "demand_date": "2024-08-03", "quantity": 1}]}')],
  array['result succeeded', 'result succeeded'],
  'master_data:write writes brands and transactions:write writes demand'
);
reset role;

------------------------------------------------------------------------------------------------
-- Caps and slots
------------------------------------------------------------------------------------------------
-- A wizard batch committing (stepped, between two steps) holds the organization's commit slot.
insert into public.import_batches (id, organization_id, source, status, commit_mode, created_by, file_count, rows_total,
                                   validated_at, commit_started_at, last_step_at)
values ('00000000-0000-4000-8000-a23b00000001', '00000000-0000-4000-8000-a23000000000', 'wizard', 'committing', 'stepped',
        '00000000-0000-4000-8000-a23000000001', 1, 10000, now(), now(), now());
create temp table api_batches_before on commit drop as
select count(*)::integer as n from public.import_batches b
where b.organization_id = '00000000-0000-4000-8000-a23000000000' and b.source = 'api';
set local role service_role;
select is(
  pg_temp.refusal('full', 'brands', '{"records": [{"brand_code": "API-SLOT", "name_en": "Slot"}]}'),
  'MQ409 another_commit',
  'a write while a wizard commit is between steps gets MQ409 another_commit'
);
reset role;
select is(
  (select count(*)::integer from public.import_batches b
   where b.organization_id = '00000000-0000-4000-8000-a23000000000' and b.source = 'api')
  + (select count(*)::integer from public.brands b
     where b.organization_id = '00000000-0000-4000-8000-a23000000000' and b.code = 'API-SLOT'),
  (select n from api_batches_before),
  'and persists nothing'
);
delete from public.import_batches where id = '00000000-0000-4000-8000-a23b00000001';

-- 5,000 recorded API writes per organization in 24 hours: plant all but one.
insert into ingest.api_writes (batch_id, organization_id, created_at)
select gen_random_uuid(), '00000000-0000-4000-8000-a23000000000', now() - interval '23 hours'
from generate_series(1, 4999 - (select n from api_batches_before));
set local role service_role;
insert into pg_temp.results values ('cap 5000', public.api_upsert(pg_temp.h('full'), 'brands',
  '{"records": [{"brand_code": "API-CAP-1", "name_en": "Cap one"}]}', gen_random_uuid()));
select is(
  (select pg_temp.brief(r.result) from pg_temp.results r where r.name = 'cap 5000'),
  'succeeded true 1 0 0 0 0',
  'the 5,000th recorded write in 24 hours succeeds'
);
select is(
  array[
    pg_temp.refusal('full', 'brands', '{"records": [{"brand_code": "API-CAP-2", "name_en": "Cap two"}]}'),
    pg_temp.refusal('full', 'brands', '{"records": [{"brand_code": "API-CAP-1", "name_en": "Cap one"}]}'),
    pg_temp.refusal('b-full', 'brands', '{"records": [{"brand_code": "API-CAP-2", "name_en": "Cap two"}]}')],
  array['MQ429 api_writes_per_day', 'MQ429 api_writes_per_day', 'result succeeded'],
  'then any write of A (even one that would change nothing) gets MQ429 api_writes_per_day; B is not affected'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-a23000000001", "role": "authenticated"}';
select public.import_delete((select (result ->> 'import_id')::uuid from pg_temp.results where name = 'cap 5000'));
reset role;
set local request.jwt.claims = '';
set local role service_role;
select is(
  pg_temp.refusal('full', 'brands', '{"records": [{"brand_code": "API-CAP-3", "name_en": "Cap three"}]}'),
  'MQ429 api_writes_per_day',
  'deleting a recorded API import through the editor RPC does not restore daily quota'
);
reset role;
update ingest.api_writes set created_at = now() - interval '25 hours'
where organization_id = '00000000-0000-4000-8000-a23000000000' and created_at = now() - interval '23 hours';
set local role service_role;
select is(
  pg_temp.refusal('full', 'brands', '{"records": [{"brand_code": "API-CAP-2", "name_en": "Cap two"}]}'),
  'result succeeded',
  'writes older than 24 hours do not count'
);

-- Failed API calls never take the wizard's creation slots or leave a lock or a committing batch.
insert into pg_temp.results values ('failed 1', public.api_upsert(pg_temp.h('full'), 'brands', '{"records": [{"brand_code": "API F1", "name_en": "F"}]}', gen_random_uuid()));
insert into pg_temp.results values ('failed 2', public.api_upsert(pg_temp.h('full'), 'brands', '{"records": [{"brand_code": "API F2", "name_en": "F"}]}', gen_random_uuid()));
insert into pg_temp.results values ('failed 3', public.api_upsert(pg_temp.h('full'), 'brands', '{"records": [{"brand_code": "API F3", "name_en": "F"}]}', gen_random_uuid()));
reset role;
select is(
  (select array_agg(r.result ->> 'result' order by r.name) from pg_temp.results r where r.name like 'failed _'),
  array['invalid', 'invalid', 'invalid'],
  'three API writes fail'
);
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-a23000000001", "role": "authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-a23000000001';
select is(
  public.import_create_batch('00000000-0000-4000-8000-a23b00000002', '00000000-0000-4000-8000-a23000000000',
    jsonb_build_array(jsonb_build_object(
      'file_no', 1, 'entity', 'brands', 'original_name', 'brands.csv', 'extension', 'csv', 'size_bytes', 1,
      'sha256', encode(sha256('wizard'::bytea), 'hex'), 'rows_total', 1, 'columns', jsonb_build_array('brand_code', 'name_en'))))
    ->> 'status',
  'staging',
  'after them the planner still creates a wizard import'
);
reset role;
set local request.jwt.claims = '';
set local request.jwt.claim.sub = '';
select is(
  (select count(*)::integer from ingest.import_creations c where c.organization_id = '00000000-0000-4000-8000-a23000000000'),
  1,
  'the creation ledger counts only the wizard import'
);
delete from public.import_batches where id = '00000000-0000-4000-8000-a23b00000002';

------------------------------------------------------------------------------------------------
-- A failure at commit time (a planted trigger raises 23503 for one item): a conflict that keeps
-- the SQL error out of the result
------------------------------------------------------------------------------------------------
select set_config('api23.trip', 'on', true) as trip;
create temp table leftovers_before on commit drop as
select pg_temp.leftovers('00000000-0000-4000-8000-a23000000000') as value;

set local role service_role;
insert into pg_temp.results values ('commit failure', public.api_upsert(pg_temp.h('full'), 'items',
  '{"records": [
     {"item_code": "API-C1", "name_en": "Fine", "product_group": "filters", "unit_of_measure": "EA", "unit_cost": 1, "currency": "SAR"},
     {"item_code": "API-TRIP", "name_en": "Trips", "product_group": "filters", "unit_of_measure": "EA", "unit_cost": 1, "currency": "SAR"}]}',
  gen_random_uuid()));
reset role;
select set_config('api23.trip', '', true) as trip;

select is(
  (select r.result from pg_temp.results r where r.name = 'commit failure'),
  '{"result": "conflict", "failure_code": "changed_during_commit", "error_count": 1,
    "error_counts": {"changed_during_commit": {"": 1}},
    "errors": [{"pointer": "#/records", "record": null, "field": null, "code": "changed_during_commit", "value": null, "detail": null}],
    "errors_truncated": false, "warning_count": 0, "warnings": [], "warnings_truncated": false}'::jsonb,
  'a write failing at commit is a conflict with failure_code changed_during_commit and one request-level error'
);
select ok(
  (select not jsonb_path_exists(r.result, 'lax $.** ? (exists (@.sqlstate) || exists (@.message) || exists (@.phase) || exists (@.hint))')
          and r.result::text !~ '"(sqlstate|message|phase|hint)":'
          and r.result::text !~* 'planted|secret|23503'
   from pg_temp.results r where r.name = 'commit failure'),
  'no sqlstate, message, phase or hint key and no text of the SQL error anywhere in the result'
);
select is(
  pg_temp.leftovers('00000000-0000-4000-8000-a23000000000') || ' '
    || (select count(*) from public.items i
        where i.organization_id = '00000000-0000-4000-8000-a23000000000' and i.code in ('API-C1', 'API-TRIP')),
  (select value from leftovers_before) || ' 0',
  'nothing was persisted: no item, batch, file, error or staged row'
);

------------------------------------------------------------------------------------------------
-- Cross-tenant: the organization comes from the key only
------------------------------------------------------------------------------------------------
update fingerprints set value = pg_temp.fingerprint('00000000-0000-4000-8000-b23000000000') where name = 'B';
set local role service_role;
select is(
  pg_temp.errors(pg_temp.api_dry('full', 'items',
    '{"records": [{"item_code": "API-X1", "name_en": "X", "brand_code": "BR-B-ONLY", "product_group": "filters", "unit_of_measure": "EA", "unit_cost": 1, "currency": "SAR"}]}')),
  array['#/records/0/brand_code unknown_reference BR-B-ONLY'],
  'a key of A cannot reference a brand only B has (unknown_reference)'
);
select is(
  pg_temp.errors(pg_temp.api_dry('tx', 'demand_history',
    '{"records": [{"item_code": "P-B-ONLY", "location_code": "LOC-B-ONLY", "demand_date": "2024-08-05", "quantity": 1}]}')),
  array['#/records/0/item_code unknown_reference P-B-ONLY', '#/records/0/location_code unknown_reference LOC-B-ONLY'],
  'nor demand of B''s item and location'
);
insert into pg_temp.results values ('x same code', public.api_upsert(pg_temp.h('full'), 'brands',
  '{"records": [{"brand_code": "BR-B-ONLY", "name_en": "Same code in A"}]}', gen_random_uuid()));
reset role;
select is(
  (select pg_temp.brief(r.result) from pg_temp.results r where r.name = 'x same code'),
  'succeeded true 1 0 0 0 0',
  'a brand of A with the code of B''s brand is a new brand of A'
);
select is(
  pg_temp.fingerprint('00000000-0000-4000-8000-b23000000000'),
  (select f.value from fingerprints f where f.name = 'B'),
  'no row of B changed'
);
select is(
  (select format('%s in A, %s in B', count(*) filter (where t.organization_id = '00000000-0000-4000-8000-a23000000000'),
                 count(*) filter (where t.organization_id = '00000000-0000-4000-8000-b23000000000'))
   from (
     select b.organization_id from public.brands b where b.code like 'API-%' or b.name_en = 'Same code in A'
     union all select i.organization_id from public.items i where i.code like 'API-%'
     union all select w.organization_id from public.work_calendars w where w.code like 'API-%'
     union all select s.organization_id from public.suppliers s where s.code like 'API-%'
     union all select x.organization_id from public.fx_rates x where x.valid_from = '2026-01-01' and x.to_currency = 'SAR'
     union all select h.organization_id from public.holiday_overrides h where h.name_en like '%closure' and h.starts_on >= '2026-11-01'
   ) as t),
  '19 in A, 0 in B',
  'every row written with the keys of A is a row of A'
);
select is(
  (select count(*)::integer from public.import_batches b
   where b.api_key_id in (select k.id from public.api_keys k where k.organization_id = '00000000-0000-4000-8000-a23000000000')
     and b.organization_id <> '00000000-0000-4000-8000-a23000000000'),
  0,
  'and every batch recorded with a key of A belongs to A'
);

------------------------------------------------------------------------------------------------
-- A key stops with its creator's rights
------------------------------------------------------------------------------------------------
update public.memberships set role = 'planner'
where organization_id = '00000000-0000-4000-8000-a23000000000' and user_id = '00000000-0000-4000-8000-a23000000002';
set local role service_role;
select is(
  pg_temp.refusal('full', 'brands', '{"records": [{"brand_code": "API-CI", "name_en": "Creator"}]}'),
  'MQ401 creator_inactive',
  'once its creator is demoted to planner, the key gets MQ401 creator_inactive'
);
reset role;
update public.memberships set role = 'owner'
where organization_id = '00000000-0000-4000-8000-a23000000000' and user_id = '00000000-0000-4000-8000-a23000000002';

------------------------------------------------------------------------------------------------
-- Configuration: search_path only in the function, zeespare.import_analyze = skip_locked for the
-- call and restored after it; static SQL only
------------------------------------------------------------------------------------------------
select is(
  (select p.proconfig from pg_proc p where p.oid = 'public.api_upsert(bytea, text, jsonb, uuid)'::regprocedure),
  array['search_path=""'],
  'api_upsert sets only search_path (a non-superuser owner cannot put a custom setting in proconfig)'
);
select is(
  (select format('%s %s', p.prosecdef, p.provolatile) from pg_proc p where p.oid = 'public.api_upsert(bytea, text, jsonb, uuid)'::regprocedure),
  't v',
  'and is security definer and volatile'
);

select set_config('api23.record', 'on', true) as record;

set local role service_role;
select set_config('zeespare.import_analyze', 'before', true) as setting;
insert into pg_temp.results values ('cfg write', public.api_upsert(pg_temp.h('full'), 'brands',
  '{"records": [{"brand_code": "API-CFG", "name_en": "Config"}]}', gen_random_uuid()));
select is(current_setting('zeespare.import_analyze', true), 'before', 'after a recorded write the setting is restored');
insert into pg_temp.results values ('cfg invalid', public.api_upsert(pg_temp.h('full'), 'brands',
  '{"records": [{"brand_code": "API CFG", "name_en": "Config"}]}', gen_random_uuid()));
select is(current_setting('zeespare.import_analyze', true), 'before', 'and after an invalid write');
select set_config('zeespare.import_analyze', '', true) as setting;
insert into pg_temp.results values ('cfg unchanged', public.api_upsert(pg_temp.h('full'), 'brands',
  '{"records": [{"brand_code": "API-CFG", "name_en": "Config"}]}', gen_random_uuid()));
select is(current_setting('zeespare.import_analyze', true), '', 'and after a write that changed nothing');
reset role;
select set_config('api23.record', '', true) as record;
select is(
  (select array_agg(format('%s %s', s.code, s.setting)) from pg_temp.analyze_settings s),
  array['API-CFG skip_locked'],
  'during the write the 5a statistics helpers see zeespare.import_analyze = skip_locked'
);
select is(
  (select array_agg(r.result ->> 'result' || ' ' || coalesce(r.result ->> 'recorded', '-') order by r.name)
   from pg_temp.results r where r.name like 'cfg %'),
  array['invalid -', 'succeeded false', 'succeeded true'],
  '(the three writes: invalid, unchanged, recorded)'
);
select is(
  array(select p.oid::regprocedure::text
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'app') and p.proname like 'api\_%'
          and pg_get_functiondef(p.oid) ~* '\mexecute\M'
        order by 1),
  '{}'::text[],
  'no api_* function body runs dynamic SQL (EXECUTE)'
);
select ok(
  not exists (select 1 from pg_temp.results r where r.result::text ~ 'MQ499')
  and not exists (select 1 from pg_temp.case_results r where r.result::text ~ 'MQ499'),
  'the internal MQ499 never leaves api_upsert'
);

select * from finish();

rollback;
