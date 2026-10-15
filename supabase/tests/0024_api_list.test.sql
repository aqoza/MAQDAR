-- REST API lists (Step 5b): public.api_list, public.api_list_demand and public.api_organization,
-- called as service_role with the SHA-256 of a key, the way the /api/v1 route handlers call them.
-- * Record shape: every entity's records carry the contract columns in position order (plus
--   updated_at for master data); decimals and money are canonical strings, integers and booleans
--   native, weekdays sorted integer arrays, dates ISO strings, references codes; the holiday scope
--   has one side null and pairs keep their stored orientation.
-- * Paging: a cursor walk over 2,503 items returns every row once in id order, next_cursor is null
--   on the last page and as_of travels in the cursor; updated_since filters; cursors are checked
--   against the entity and filters they were issued for, and malformed or forged ones are MQ422
--   cursor; limits outside 1-1000 are MQ422 limit; a key never sees another organization's rows,
--   even with that organization's ids planted in a cursor.
-- * Round trip: every listed record of every master entity (and demand), sent back without
--   updated_at, is a no-op write: recorded false, all unchanged, no batch kept.
-- * Demand: the four modes walked with limits 1, 2, 3 and 1000 (a page break after every row,
--   across the January/February partition boundary and between rows tied on the leading sort key)
--   return the range in key order; range, limit, code and scope rules; unknown codes give an empty
--   page.
-- * api_organization: fields, key order, demand_window and the limits fixture shared with
--   apps/web/src/lib/api/limits.ts.
-- * Drift guard: the 12 ingest.api_record_<entity> types match the contract, and
--   app.api_record_type_drift() names any type that stops matching.
-- Fixtures and assertions run as postgres; every API call runs as service_role and writes its
-- result to a temporary table granted to service_role.
begin;

select plan(91);

\set api_limits `cat fixtures/api_limits.json 2>/dev/null || cat supabase/tests/fixtures/api_limits.json`

-- Helpers ---------------------------------------------------------------------------------------
-- The SHA-256 the Worker sends for a sample key named n (maqdar_sk_ + 43 characters + a checksum).
create function pg_temp.h(n text) returns bytea language sql immutable as $$
  select sha256(convert_to('maqdar_sk_' || rpad(n, 43, 'x') || 'Ab12Cd', 'UTF8'));
$$;
create function pg_temp.up(p_key text, p_entity text, p_body jsonb) returns jsonb language sql as $$
  select public.api_upsert(pg_temp.h(p_key), p_entity, p_body, gen_random_uuid());
$$;
-- 'ok', or the SQLSTATE and hint of the error the statement raises.
create function pg_temp.fails(p_sql text) returns text language plpgsql as $$
declare
  v_state text;
  v_hint text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
  return v_state || ' ' || coalesce(v_hint, '');
end;
$$;
-- A cursor as the API encodes one (unpadded base64url of JSON), for forged and malformed cursors.
create function pg_temp.b64url(p text) returns text language sql immutable as $$
  select translate(encode(convert_to(p, 'UTF8'), 'base64'), E'+/=\n', '-_');
$$;
-- Elements of a JSON array in a stable order, for comparing record sets.
create function pg_temp.sorted(p jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(x order by x::text), '[]'::jsonb) from jsonb_array_elements(p) as x;
$$;
-- Records of a list page without updated_at.
create function pg_temp.records(p json) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(r::jsonb - 'updated_at' order by o), '[]'::jsonb)
  from json_array_elements(p -> 'data') with ordinality as x (r, o);
$$;
-- Every page of a list, following next_cursor from the first page.
create function pg_temp.walk(p_key text, p_entity text, p_limit integer, p_since timestamptz default null)
returns table (page integer, body json) language plpgsql as $$
declare
  v_cursor text;
begin
  page := 0;
  loop
    page := page + 1;
    body := public.api_list(pg_temp.h(p_key), p_entity, v_cursor, p_limit, p_since);
    return next;
    v_cursor := body ->> 'next_cursor';
    exit when v_cursor is null or page >= 1000;
  end loop;
end;
$$;
create function pg_temp.walk_demand(p_key text, p_from date, p_to date, p_item text, p_location text, p_limit integer)
returns table (page integer, body json) language plpgsql as $$
declare
  v_cursor text;
begin
  page := 0;
  loop
    page := page + 1;
    body := public.api_list_demand(pg_temp.h(p_key), p_from, p_to, p_item, p_location, v_cursor, p_limit);
    return next;
    v_cursor := body ->> 'next_cursor';
    exit when v_cursor is null or page >= 1000;
  end loop;
end;
$$;
-- Lists every page of an entity and sends each page back without updated_at; one result per page.
create function pg_temp.round_trip(p_key text, p_entity text) returns table (page integer, records integer, result jsonb)
language plpgsql as $$
declare
  v_body json;
  v_cursor text;
begin
  page := 0;
  loop
    page := page + 1;
    if p_entity = 'demand_history' then
      v_body := public.api_list_demand(pg_temp.h(p_key), '2026-01-01', '2026-02-28', null, null, v_cursor, 1000);
    else
      v_body := public.api_list(pg_temp.h(p_key), p_entity, v_cursor, 1000);
    end if;
    records := json_array_length(v_body -> 'data');
    result := public.api_upsert(pg_temp.h(p_key), p_entity, jsonb_build_object('records', pg_temp.records(v_body)), gen_random_uuid());
    return next;
    v_cursor := v_body ->> 'next_cursor';
    exit when v_cursor is null or page >= 100;
  end loop;
end;
$$;

-- API results, written as service_role and read back as postgres.
create temporary table lists (k text primary key, body json not null) on commit drop;
create temporary table pages (walk text not null, page integer not null, body json not null, primary key (walk, page)) on commit drop;
create temporary table trips (entity text not null, page integer not null, records integer not null, result jsonb not null,
                              primary key (entity, page)) on commit drop;
create temporary table probes (k text primary key, outcome text) on commit drop;
-- Cursors and ids prepared as postgres for the service_role calls.
create temporary table cursors (k text primary key, v text not null) on commit drop;
grant select, insert on lists, pages, trips, probes to service_role;
grant select on cursors to service_role;

create temporary table expected_keys on commit drop as
select e.entity,
       array_agg(c.name order by c.position) || case when e.entity = 'demand_history' then '{}'::text[] else array['updated_at'] end as keys
from ingest.contract_entities e
join ingest.contract_columns c on c.entity = e.entity
group by e.entity;

-- Fixture ---------------------------------------------------------------------------------------
-- A keeps its time zone null (the home country's applies); B sets one other than its country's.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-5b2400000001', 'api24-owner-a@test.local', now()),
  ('00000000-0000-4000-8000-5b2400000002', 'api24-owner-b@test.local', now());
insert into public.organizations (id, slug, name, home_country, base_currency, time_zone) values
  ('00000000-0000-4000-8000-5b24000000aa', 'api24-a', 'API list A', 'SA', 'SAR', null),
  ('00000000-0000-4000-8000-5b24000000bb', 'api24-b', 'API list B', 'AE', 'AED', 'Asia/Riyadh');
insert into public.memberships (organization_id, user_id, role) values
  ('00000000-0000-4000-8000-5b24000000aa', '00000000-0000-4000-8000-5b2400000001', 'owner'),
  ('00000000-0000-4000-8000-5b24000000bb', '00000000-0000-4000-8000-5b2400000002', 'owner');
insert into public.api_keys (id, organization_id, name, display_prefix, last4, key_hash, scopes, created_by, expires_at)
select v.id::uuid, v.org::uuid, v.name, 'maqdar_sk_' || v.prefix, 'Cd12', pg_temp.h(v.name), v.scopes, v.creator::uuid,
       now() + interval '90 days'
from (values
  ('00000000-0000-4000-8000-5b2400000c01', '00000000-0000-4000-8000-5b24000000aa', 'a-full', 'AFul',
   array['master_data:read', 'master_data:write', 'transactions:read', 'transactions:write'], '00000000-0000-4000-8000-5b2400000001'),
  ('00000000-0000-4000-8000-5b2400000c02', '00000000-0000-4000-8000-5b24000000aa', 'a-master', 'AMas',
   array['master_data:read', 'master_data:write'], '00000000-0000-4000-8000-5b2400000001'),
  ('00000000-0000-4000-8000-5b2400000c03', '00000000-0000-4000-8000-5b24000000aa', 'a-tx', 'ATxr',
   array['transactions:read'], '00000000-0000-4000-8000-5b2400000001'),
  ('00000000-0000-4000-8000-5b2400000c04', '00000000-0000-4000-8000-5b24000000bb', 'b-full', 'BFul',
   array['master_data:read', 'master_data:write', 'transactions:read', 'transactions:write'], '00000000-0000-4000-8000-5b2400000002')
) as v (id, org, name, prefix, scopes, creator);

-- Master data and demand of A and B, written through the API itself.
set local role service_role;
insert into lists (k, body)
select format('upsert:%s:%s:%s', v.key, lpad(v.n::text, 2, '0'), v.e), pg_temp.up(v.key, v.e, v.b::jsonb)::json
from (values
  (1, 'a-full', 'work_calendars', '{"records": [
     {"work_calendar_code": "WC-KSA", "name_en": "Saudi week", "name_ar": "أسبوع", "country_code": "SA", "weekend_days": [6, 5], "observe_public_holidays": true, "is_active": true},
     {"work_calendar_code": "WC-NONE", "name_en": "No weekend", "name_ar": null, "country_code": null, "weekend_days": [], "observe_public_holidays": false, "is_active": false}]}'),
  (2, 'a-full', 'holiday_overrides', '{"records": [
     {"country_code": "SA", "starts_on": "2026-03-01", "ends_on": "2026-03-02", "kind": "closure", "name_en": "Stock count", "name_ar": null, "note": "yearly"},
     {"work_calendar_code": "WC-KSA", "starts_on": "2026-04-01", "ends_on": "2026-04-01", "kind": "closure", "name_en": "Audit", "name_ar": "تدقيق", "note": null}]}'),
  (3, 'a-full', 'locations', '{"records": [
     {"location_code": "RUH-B1", "name_en": "Riyadh branch", "name_ar": null, "location_type": "branch", "country_code": "SA", "city": "Riyadh", "latitude": "24.713600", "longitude": 46.6753, "timezone": "Asia/Riyadh", "parent_location_code": "RUH-C", "is_active": true, "work_calendar_code": "WC-KSA"},
     {"location_code": "RUH-C", "name_en": "Riyadh central", "name_ar": "المركز", "location_type": "central", "country_code": "SA", "city": null, "latitude": null, "longitude": null, "timezone": "Asia/Riyadh", "parent_location_code": null, "is_active": true, "work_calendar_code": null}]}'),
  (4, 'a-full', 'network_links', '{"records": [
     {"from_location_code": "RUH-C", "to_location_code": "RUH-B1", "lead_time_days_p50": 1, "lead_time_days_p90": 3.0, "freight_basis": "per_unit", "freight_cost": 0.750, "currency": "SAR", "is_active": true},
     {"from_location_code": "RUH-B1", "to_location_code": "RUH-C", "lead_time_days_p50": 2, "lead_time_days_p90": 4, "freight_basis": "none", "freight_cost": null, "currency": null, "is_active": false}]}'),
  (5, 'a-full', 'brands', '{"records": [
     {"brand_code": "BOSCH", "name_en": "Bosch", "name_ar": null, "brand_type": "aftermarket", "country_of_origin": "DE", "is_active": true},
     {"brand_code": "DENSO", "name_en": "Denso", "name_ar": "دنسو", "brand_type": null, "country_of_origin": null, "is_active": false}]}'),
  (6, 'a-full', 'items', '{"records": [
     {"item_code": "P-1", "name_en": "Filter", "name_ar": null, "brand_code": "BOSCH", "product_group": "filters", "unit_of_measure": "EA", "unit_cost": 1.50, "currency": "SAR", "status": "active", "introduced_on": "2024-01-15", "discontinued_on": null},
     {"item_code": "P-2", "name_en": "Pad", "name_ar": "وسادة", "brand_code": null, "product_group": "brakes", "unit_of_measure": "SET", "unit_cost": "12.500", "currency": "KWD", "status": "phase_out", "introduced_on": null, "discontinued_on": "2027-01-01"},
     {"item_code": "P-3", "name_en": "Oil", "name_ar": null, "brand_code": "DENSO", "product_group": "fluids", "unit_of_measure": "L", "unit_cost": 1e2, "currency": "SAR", "status": "new", "introduced_on": null, "discontinued_on": null}]}'),
  (7, 'a-full', 'item_supersessions', '{"records": [
     {"predecessor_item_code": "P-1", "successor_item_code": "P-3", "effective_on": "2026-02-01", "quantity_factor": "2.000", "note": null}]}'),
  (8, 'a-full', 'item_interchanges', '{"records": [
     {"item_code": "P-2", "alternate_item_code": "P-1", "direction": "one_way", "priority": 2, "note": "fits"}]}'),
  (9, 'a-full', 'suppliers', '{"records": [
     {"supplier_code": "S1", "name_en": "Supplier one", "name_ar": null, "country_code": "DE", "currency": "EUR", "lead_time_days_p50": 30, "lead_time_days_p90": 45, "is_active": true, "work_calendar_code": "WC-KSA"},
     {"supplier_code": "S2", "name_en": "Supplier two", "name_ar": "مورد", "country_code": "SA", "currency": "SAR", "lead_time_days_p50": 5, "lead_time_days_p90": 9, "is_active": false, "work_calendar_code": null}]}'),
  (10, 'a-full', 'supplier_items', '{"records": [
     {"supplier_code": "S1", "item_code": "P-1", "supplier_part_number": "B-0001", "lead_time_days": 30, "lead_time_days_p90": null, "min_order_quantity": "10", "pack_size": 2.5, "unit_price": "0.125", "currency": "EUR", "is_preferred": true, "valid_from": "2026-01-01"},
     {"supplier_code": "S2", "item_code": "P-1", "supplier_part_number": null, "lead_time_days": 5, "lead_time_days_p90": 8, "min_order_quantity": 0, "pack_size": "1.000", "unit_price": 7, "currency": "SAR", "is_preferred": false, "valid_from": null}]}'),
  (11, 'a-full', 'fx_rates', '{"records": [
     {"from_currency": "EUR", "to_currency": "SAR", "valid_from": "2026-01-01", "rate": "4.0512345678", "note": null},
     {"from_currency": "KWD", "to_currency": "SAR", "valid_from": "2026-01-01", "rate": "1234567890.0123456789", "note": "20 digits"},
     {"from_currency": "USD", "to_currency": "SAR", "valid_from": "2026-01-01", "rate": 3.75000, "note": null},
     {"from_currency": "SAR", "to_currency": "BHD", "valid_from": "2026-01-01", "rate": "0.10", "note": null}]}'),
  (12, 'b-full', 'brands', '{"records": [{"brand_code": "B-ONLY", "name_en": "B brand"}]}'),
  (13, 'b-full', 'items', '{"records": [
     {"item_code": "P-1", "name_en": "B filter", "product_group": "b", "unit_of_measure": "EA", "unit_cost": 99, "currency": "AED"},
     {"item_code": "Q-1", "name_en": "B only", "product_group": "b", "unit_of_measure": "EA", "unit_cost": 1, "currency": "AED"}]}'),
  (14, 'b-full', 'locations', '{"records": [
     {"location_code": "RUH-C", "name_en": "B central", "location_type": "central", "country_code": "AE", "timezone": "Asia/Dubai", "is_active": true},
     {"location_code": "B-L1", "name_en": "B branch", "location_type": "branch", "country_code": "AE", "timezone": "Asia/Dubai", "is_active": true}]}'),
  (15, 'b-full', 'demand_history', '{"records": [
     {"item_code": "P-1", "location_code": "RUH-C", "demand_date": "2026-01-30", "quantity": 9},
     {"item_code": "P-1", "location_code": "RUH-C", "demand_date": "2026-01-31", "quantity": 9},
     {"item_code": "P-1", "location_code": "RUH-C", "demand_date": "2026-02-01", "quantity": 9},
     {"item_code": "P-1", "location_code": "RUH-C", "demand_date": "2026-02-02", "quantity": 9},
     {"item_code": "Q-1", "location_code": "B-L1", "demand_date": "2026-01-31", "quantity": 9}]}')
) as v (n, key, e, b)
order by v.n;

-- A's demand: 3 items x 2 locations x 2026-01-30..2026-02-02 (two months, two partitions) less three
-- rows, plus P-1/RUH-B1 on 2026-01-29 and 2026-02-03 just outside the range the lists use.
-- Quantities by day, lost sales by item, sent as JSON numbers and strings with trailing zeros.
insert into lists (k, body)
select 'upsert:a-full:16:demand_history', pg_temp.up('a-full', 'demand_history', jsonb_build_object('records', jsonb_agg(
         jsonb_build_object(
           'item_code', i, 'location_code', l, 'demand_date', d::text,
           'quantity', case extract(day from d)::integer
                         when 30 then to_jsonb('1.500'::text) when 31 then to_jsonb(2) when 1 then to_jsonb(0.25)
                         when 2 then to_jsonb('10'::text) else to_jsonb(5) end,
           'lost_sales_quantity', case i when 'P-1' then to_jsonb('0.125'::text) when 'P-2' then to_jsonb(0) else to_jsonb('0.000'::text) end)
         order by i, l, d)))::json
from unnest(array['P-1', 'P-2', 'P-3']) as i
cross join unnest(array['RUH-B1', 'RUH-C']) as l
cross join unnest(array[date '2026-01-29', '2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02', '2026-02-03']) as d
where (d between '2026-01-30' and '2026-02-02' or (i = 'P-1' and l = 'RUH-B1'))
  and (i, l, d) not in (('P-2', 'RUH-C', date '2026-01-31'), ('P-3', 'RUH-B1', date '2026-02-01'), ('P-1', 'RUH-C', date '2026-01-30'));
reset role;

-- 2,500 more items of A, last changed two days ago (2,503 in all).
insert into public.items (organization_id, code, name_en, brand_id, product_group, unit_of_measure, unit_cost, currency, created_at, updated_at)
select '00000000-0000-4000-8000-5b24000000aa', 'BULK-' || lpad(g::text, 5, '0'), 'Bulk item ' || g,
       case when g % 2 = 0 then (select b.id from public.brands b where b.organization_id = '00000000-0000-4000-8000-5b24000000aa' and b.code = 'BOSCH') end,
       'bulk', 'EA', (g % 1000) + 0.25, 'SAR', now() - interval '2 days', now() - interval '2 days'
from generate_series(1, 2500) as g;

select is(
  (select array_agg(k order by k collate "C") from lists where k like 'upsert:%' and not (body ->> 'result' = 'succeeded' and (body ->> 'recorded')::boolean)),
  null,
  'fixture: every upsert of A''s and B''s master data and demand succeeded and was recorded'
);

-- Lists of A as service_role -------------------------------------------------------------------
set local role service_role;
insert into lists (k, body)
select 'list:' || e, public.api_list(pg_temp.h('a-full'), e, null, 1000)
from unnest(array['work_calendars', 'holiday_overrides', 'locations', 'network_links', 'brands', 'items', 'item_supersessions',
                  'item_interchanges', 'suppliers', 'supplier_items', 'fx_rates']) as e;
insert into lists (k, body) values
  ('list:demand_history', public.api_list_demand(pg_temp.h('a-full'), '2026-01-30', '2026-02-02', null, null, null, 1000)),
  ('list:items:since-now', public.api_list(pg_temp.h('a-full'), 'items', null, null, now())),
  ('list:items:since-future', public.api_list(pg_temp.h('a-full'), 'items', null, null, now() + interval '1 day')),
  ('list:items:default-limit', public.api_list(pg_temp.h('a-full'), 'items')),
  ('list:items:b', public.api_list(pg_temp.h('b-full'), 'items')),
  ('list:demand:both', public.api_list_demand(pg_temp.h('a-full'), '2026-01-30', '2026-02-02', 'P-1', 'RUH-B1')),
  ('list:demand:both-wide', public.api_list_demand(pg_temp.h('a-full'), '2026-01-29', '2026-02-03', 'P-1', 'RUH-B1')),
  ('list:demand:both-one-day', public.api_list_demand(pg_temp.h('a-full'), '2026-01-31', '2026-01-31', 'P-1', 'RUH-B1')),
  ('list:demand:b-both', public.api_list_demand(pg_temp.h('b-full'), '2026-01-30', '2026-02-02', 'P-1', 'RUH-C')),
  ('list:demand:unknown-item', public.api_list_demand(pg_temp.h('a-full'), '2026-01-30', '2026-02-02', 'NOPE')),
  ('list:demand:unknown-location', public.api_list_demand(pg_temp.h('a-full'), '2026-01-30', '2026-02-02', null, 'NOPE')),
  ('list:demand:unknown-pair', public.api_list_demand(pg_temp.h('a-full'), '2026-01-30', '2026-02-02', 'P-1', 'NOPE')),
  ('list:demand:other-org-code', public.api_list_demand(pg_temp.h('a-full'), '2026-01-30', '2026-02-02', 'Q-1')),
  ('org:a', public.api_organization(pg_temp.h('a-full'))),
  ('org:b', public.api_organization(pg_temp.h('b-full')));
insert into pages (walk, page, body)
select 'items:' || l, w.page, w.body
from unnest(array[1000, 100]) as l
cross join lateral pg_temp.walk('a-full', 'items', l) as w;
insert into pages (walk, page, body)
select 'items:since-now:1', w.page, w.body from pg_temp.walk('a-full', 'items', 1, now()) as w;
insert into pages (walk, page, body)
select format('demand:%s:%s', m.mode, l.lim), w.page, w.body
from (values ('all', null, null), ('item', 'P-2', null), ('location', null, 'RUH-C'), ('both', 'P-1', 'RUH-B1')) as m (mode, item, location)
cross join (values (1), (2), (3), (1000)) as l (lim)
cross join lateral pg_temp.walk_demand('a-full', '2026-01-30', '2026-02-02', m.item, m.location, l.lim) as w;
reset role;

------------------------------------------------------------------------------------------------
-- Record shape
------------------------------------------------------------------------------------------------
select is(
  (select format('%s records, %s with other keys', count(*), count(*) filter (where array(select json_object_keys(r)) is distinct from x.keys))
   from lists l
   cross join json_array_elements(l.body -> 'data') as r
   where l.k = 'list:' || x.entity),
  format('%s records, 0 with other keys', n.records),
  x.entity || ': every record has the contract columns in position order'
    || case when x.entity = 'demand_history' then '' else ', then updated_at' end
)
from expected_keys x
join (values ('work_calendars', 2), ('holiday_overrides', 2), ('locations', 2), ('network_links', 2), ('brands', 2), ('items', 1000),
             ('item_supersessions', 1), ('item_interchanges', 1), ('suppliers', 2), ('supplier_items', 2), ('fx_rates', 4),
             ('demand_history', 21)) as n (entity, records) on n.entity = x.entity
order by x.entity;

select is(pg_temp.sorted(pg_temp.records((select body from lists where k = 'list:work_calendars'))), pg_temp.sorted($$[
  {"work_calendar_code": "WC-KSA", "name_en": "Saudi week", "name_ar": "أسبوع", "country_code": "SA", "weekend_days": [5, 6], "observe_public_holidays": true, "is_active": true},
  {"work_calendar_code": "WC-NONE", "name_en": "No weekend", "name_ar": null, "country_code": null, "weekend_days": [], "observe_public_holidays": false, "is_active": false}]$$),
  'work_calendars: weekdays are sorted integer arrays (never null), booleans native, null kept');
select is(pg_temp.sorted(pg_temp.records((select body from lists where k = 'list:holiday_overrides'))), pg_temp.sorted($$[
  {"country_code": "SA", "work_calendar_code": null, "starts_on": "2026-03-01", "ends_on": "2026-03-02", "kind": "closure", "name_en": "Stock count", "name_ar": null, "note": "yearly"},
  {"country_code": null, "work_calendar_code": "WC-KSA", "starts_on": "2026-04-01", "ends_on": "2026-04-01", "kind": "closure", "name_en": "Audit", "name_ar": "تدقيق", "note": null}]$$),
  'holiday_overrides: one side of the scope is null, the calendar is a code, dates are ISO strings');
select is(pg_temp.sorted(pg_temp.records((select body from lists where k = 'list:locations'))), pg_temp.sorted($$[
  {"location_code": "RUH-B1", "name_en": "Riyadh branch", "name_ar": null, "location_type": "branch", "country_code": "SA", "city": "Riyadh", "latitude": "24.7136", "longitude": "46.6753", "timezone": "Asia/Riyadh", "parent_location_code": "RUH-C", "is_active": true, "work_calendar_code": "WC-KSA"},
  {"location_code": "RUH-C", "name_en": "Riyadh central", "name_ar": "المركز", "location_type": "central", "country_code": "SA", "city": null, "latitude": null, "longitude": null, "timezone": "Asia/Riyadh", "parent_location_code": null, "is_active": true, "work_calendar_code": null}]$$),
  'locations: coordinates are canonical decimal strings, parent and calendar resolve to codes');
select is(pg_temp.sorted(pg_temp.records((select body from lists where k = 'list:network_links'))), pg_temp.sorted($$[
  {"from_location_code": "RUH-C", "to_location_code": "RUH-B1", "lead_time_days_p50": 1, "lead_time_days_p90": 3, "freight_basis": "per_unit", "freight_cost": "0.75", "currency": "SAR", "is_active": true},
  {"from_location_code": "RUH-B1", "to_location_code": "RUH-C", "lead_time_days_p50": 2, "lead_time_days_p90": 4, "freight_basis": "none", "freight_cost": null, "currency": null, "is_active": false}]$$),
  'network_links: integers are JSON numbers, money is a canonical string, both ends resolve to codes');
select is(pg_temp.sorted(pg_temp.records((select body from lists where k = 'list:brands'))), pg_temp.sorted($$[
  {"brand_code": "BOSCH", "name_en": "Bosch", "name_ar": null, "brand_type": "aftermarket", "country_of_origin": "DE", "is_active": true},
  {"brand_code": "DENSO", "name_en": "Denso", "name_ar": "دنسو", "brand_type": null, "country_of_origin": null, "is_active": false}]$$),
  'brands: values as stored');
select is(pg_temp.sorted(pg_temp.records((select body from lists where k = 'list:items:since-now'))), pg_temp.sorted($$[
  {"item_code": "P-1", "name_en": "Filter", "name_ar": null, "brand_code": "BOSCH", "product_group": "filters", "unit_of_measure": "EA", "unit_cost": "1.5", "currency": "SAR", "status": "active", "introduced_on": "2024-01-15", "discontinued_on": null},
  {"item_code": "P-2", "name_en": "Pad", "name_ar": "وسادة", "brand_code": null, "product_group": "brakes", "unit_of_measure": "SET", "unit_cost": "12.5", "currency": "KWD", "status": "phase_out", "introduced_on": null, "discontinued_on": "2027-01-01"},
  {"item_code": "P-3", "name_en": "Oil", "name_ar": null, "brand_code": "DENSO", "product_group": "fluids", "unit_of_measure": "L", "unit_cost": "100", "currency": "SAR", "status": "new", "introduced_on": null, "discontinued_on": null}]$$),
  'items: money is a canonical string (1.50 -> "1.5", "12.500" -> "12.5", 1e2 -> "100"); updated_since now() keeps only today''s items');
select is(pg_temp.records((select body from lists where k = 'list:item_supersessions')), $$[
  {"predecessor_item_code": "P-1", "successor_item_code": "P-3", "effective_on": "2026-02-01", "quantity_factor": "2", "note": null}]$$::jsonb,
  'item_supersessions: decimals are canonical strings ("2.000" -> "2")');
select is(pg_temp.records((select body from lists where k = 'list:item_interchanges')), $$[
  {"item_code": "P-2", "alternate_item_code": "P-1", "direction": "one_way", "priority": 2, "note": "fits"}]$$::jsonb,
  'item_interchanges: the pair comes back in its stored orientation, priority is a JSON number');
select is(pg_temp.sorted(pg_temp.records((select body from lists where k = 'list:suppliers'))), pg_temp.sorted($$[
  {"supplier_code": "S1", "name_en": "Supplier one", "name_ar": null, "country_code": "DE", "currency": "EUR", "lead_time_days_p50": 30, "lead_time_days_p90": 45, "is_active": true, "work_calendar_code": "WC-KSA"},
  {"supplier_code": "S2", "name_en": "Supplier two", "name_ar": "مورد", "country_code": "SA", "currency": "SAR", "lead_time_days_p50": 5, "lead_time_days_p90": 9, "is_active": false, "work_calendar_code": null}]$$),
  'suppliers: values as stored, the calendar resolves to a code');
select is(pg_temp.sorted(pg_temp.records((select body from lists where k = 'list:supplier_items'))), pg_temp.sorted($$[
  {"supplier_code": "S1", "item_code": "P-1", "supplier_part_number": "B-0001", "lead_time_days": 30, "lead_time_days_p90": null, "min_order_quantity": "10", "pack_size": "2.5", "unit_price": "0.125", "currency": "EUR", "is_preferred": true, "valid_from": "2026-01-01"},
  {"supplier_code": "S2", "item_code": "P-1", "supplier_part_number": null, "lead_time_days": 5, "lead_time_days_p90": 8, "min_order_quantity": "0", "pack_size": "1", "unit_price": "7", "currency": "SAR", "is_preferred": false, "valid_from": null}]$$),
  'supplier_items: decimals and money are canonical strings, supplier and item resolve to codes');
select is(pg_temp.sorted(pg_temp.records((select body from lists where k = 'list:fx_rates'))), pg_temp.sorted($$[
  {"from_currency": "EUR", "to_currency": "SAR", "valid_from": "2026-01-01", "rate": "4.0512345678", "note": null},
  {"from_currency": "KWD", "to_currency": "SAR", "valid_from": "2026-01-01", "rate": "1234567890.0123456789", "note": "20 digits"},
  {"from_currency": "USD", "to_currency": "SAR", "valid_from": "2026-01-01", "rate": "3.75", "note": null},
  {"from_currency": "SAR", "to_currency": "BHD", "valid_from": "2026-01-01", "rate": "0.1", "note": null}]$$),
  'fx_rates: 20-digit rates survive as strings, pairs keep their stored orientation');
select is(pg_temp.records((select body from lists where k = 'list:demand:both')), $$[
  {"item_code": "P-1", "location_code": "RUH-B1", "demand_date": "2026-01-30", "quantity": "1.5", "lost_sales_quantity": "0.125"},
  {"item_code": "P-1", "location_code": "RUH-B1", "demand_date": "2026-01-31", "quantity": "2", "lost_sales_quantity": "0.125"},
  {"item_code": "P-1", "location_code": "RUH-B1", "demand_date": "2026-02-01", "quantity": "0.25", "lost_sales_quantity": "0.125"},
  {"item_code": "P-1", "location_code": "RUH-B1", "demand_date": "2026-02-02", "quantity": "10", "lost_sales_quantity": "0.125"}]$$::jsonb,
  'demand_history: the five contract fields, quantities as canonical strings, in date order');
select is(
  (select count(*)::int
   from lists l
   cross join json_array_elements(l.body -> 'data') as r
   where l.k in ('list:work_calendars', 'list:holiday_overrides', 'list:locations', 'list:network_links', 'list:brands',
                 'list:item_supersessions', 'list:item_interchanges', 'list:suppliers', 'list:supplier_items', 'list:fx_rates',
                 'list:items:since-now')
     and not (r ->> 'updated_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
              and (r ->> 'updated_at')::timestamptz = now())),
  0,
  'updated_at is a UTC timestamp with microseconds and a Z, equal to the stored value'
);

------------------------------------------------------------------------------------------------
-- Paging over 2,503 items
------------------------------------------------------------------------------------------------
create temporary table walked on commit drop as
select p.walk, p.page, x.o as pos, x.r, p.body ->> 'next_cursor' as next_cursor, p.body ->> 'as_of' as as_of
from pages p
cross join json_array_elements(p.body -> 'data') with ordinality as x (r, o);

select is(
  (select array_agg(json_array_length(body -> 'data') || case when body ->> 'next_cursor' is null then ' last' else ' more' end order by page)
   from pages where walk = 'items:1000'),
  array['1000 more', '1000 more', '503 last'],
  'a walk with limit 1000 takes three pages, and only the last has no next_cursor'
);
select is(
  (select array_agg(w.r ->> 'item_code' order by w.page, w.pos) from walked w where w.walk = 'items:1000'),
  (select array_agg(i.code order by i.id) from public.items i where i.organization_id = '00000000-0000-4000-8000-5b24000000aa'),
  'the walk returns each of A''s 2,503 items exactly once, in id order across pages'
);
select is(
  (select array[count(*), count(distinct w.r ->> 'item_code'), count(distinct w.as_of), count(*) filter (where w.as_of <> to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))]
   from walked w where w.walk = 'items:1000'),
  array[2503::bigint, 2503, 1, 0],
  'every page carries the first page''s as_of'
);
select is(
  (select array[count(distinct w.page), count(*), count(distinct w.r ->> 'item_code')]
   from walked w where w.walk = 'items:100'),
  array[26::bigint, 2503, 2503],
  'a walk with limit 100 takes 26 pages and returns each item once'
);
select is(
  (select count(*)::int
   from walked w
   left join public.items i on i.organization_id = '00000000-0000-4000-8000-5b24000000aa' and i.code = w.r ->> 'item_code'
   where w.walk = 'items:1000'
     and (i.id is null or (w.r ->> 'updated_at')::timestamptz is distinct from i.updated_at
          or w.r ->> 'unit_cost' is distinct from trim_scale(i.unit_cost)::text)),
  0,
  'every walked item matches its stored row (updated_at, canonical unit_cost)'
);
select is(
  (select array[json_array_length(body -> 'data'), (body ->> 'next_cursor' is not null)::int] from lists where k = 'list:items:default-limit'),
  array[100, 1],
  'limit defaults to 100'
);
select is(
  app.api_cursor_decode((select body ->> 'next_cursor' from pages where walk = 'items:1000' and page = 1), 'items'),
  jsonb_build_object('v', 1, 'k', 'items',
                     'a', (select i.id from public.items i where i.organization_id = '00000000-0000-4000-8000-5b24000000aa' order by i.id offset 999 limit 1),
                     'u', null, 't', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
  'next_cursor is base64url JSON {v, k, a: the last id of the page, u: updated_since, t: as_of}'
);
select is(
  (select array_agg(json_array_length(body -> 'data') || ' ' || coalesce(body -> 'data' -> 0 ->> 'item_code', '-')
                    || case when body ->> 'next_cursor' is null then ' last' else ' more' end order by page)
   from pages where walk = 'items:since-now:1'),
  (select array_agg('1 ' || x.code || case when x.n = 3 then ' last' else ' more' end order by x.n)
   from (select i.code, row_number() over (order by i.id) as n from public.items i
         where i.organization_id = '00000000-0000-4000-8000-5b24000000aa' and i.code in ('P-1', 'P-2', 'P-3')) as x),
  'updated_since keeps only rows changed since then, and its cursor walk ends with next_cursor null'
);
select is(
  (select body::jsonb - 'as_of' from lists where k = 'list:items:since-future'),
  '{"data": [], "next_cursor": null}'::jsonb,
  'updated_since in the future gives an empty page without a cursor'
);

-- Cursors prepared as postgres: A's real cursors, forged ones and malformed ones.
insert into cursors (k, v)
select 'items', body ->> 'next_cursor' from pages where walk = 'items:1000' and page = 1
union all
select 'since', body ->> 'next_cursor' from pages where walk = 'items:since-now:1' and page = 1
union all
select 'demand-all', body ->> 'next_cursor' from pages where walk = 'demand:all:2' and page = 1
union all
select 'demand-item', body ->> 'next_cursor' from pages where walk = 'demand:item:2' and page = 1
union all
select 'demand-location', body ->> 'next_cursor' from pages where walk = 'demand:location:2' and page = 1
union all
select 'carried-as-of', pg_temp.b64url('{"v": 1, "k": "items", "a": "00000000-0000-0000-0000-000000000000", "u": null, "t": "2020-01-02T03:04:05.000006Z"}')
union all
-- B's smallest item id planted in an items cursor; B's P-1/RUH-C ids in a demand cursor; and A's
-- smallest demand item with B's RUH-C id (A rows always follow that key).
select 'planted-items', pg_temp.b64url(json_build_object('v', 1, 'k', 'items', 'u', null, 't', '2026-01-01T00:00:00.000000Z',
         'a', (select min(i.id::text) from public.items i where i.organization_id = '00000000-0000-4000-8000-5b24000000bb'))::text)
union all
select 'planted-demand', pg_temp.b64url(json_build_object('v', 1, 'k', 'demand_history', 'm', 'all', 'f', '2026-01-30', 'e', '2026-02-02',
         'i', null, 'l', null, 't', '2026-01-01T00:00:00.000000Z',
         'a', json_build_array(
                (select i.id from public.items i where i.organization_id = '00000000-0000-4000-8000-5b24000000bb' and i.code = 'P-1'),
                (select l.id from public.locations l where l.organization_id = '00000000-0000-4000-8000-5b24000000bb' and l.code = 'RUH-C'),
                '2026-01-01'))::text)
union all
select 'planted-demand-location', pg_temp.b64url(json_build_object('v', 1, 'k', 'demand_history', 'm', 'all', 'f', '2026-01-30', 'e', '2026-02-02',
         'i', null, 'l', null, 't', '2026-01-01T00:00:00.000000Z',
         'a', json_build_array(
                (select min(d.item_id::text) from public.demand_history d where d.organization_id = '00000000-0000-4000-8000-5b24000000aa'),
                (select l.id from public.locations l where l.organization_id = '00000000-0000-4000-8000-5b24000000bb' and l.code = 'RUH-C'),
                '2026-01-01'))::text)
union all
select 'bad-charset', (select body ->> 'next_cursor' from pages where walk = 'items:1000' and page = 1) || '!'
union all
select 'padded', pg_temp.b64url('{"v": 1, "k": "items", "a": "00000000-0000-0000-0000-000000000000", "u": null, "t": "2020-01-02T03:04:05.000006Z"}') || '=='
union all
select 'too-long', repeat('A', 1025)
union all
select 'not-json', pg_temp.b64url('hello')
union all
select 'array', pg_temp.b64url('[1, 2]')
union all
select 'version-2', pg_temp.b64url('{"v": 2, "k": "items", "a": "00000000-0000-0000-0000-000000000000", "u": null, "t": "2020-01-02T03:04:05.000006Z"}')
union all
select 'version-string', pg_temp.b64url('{"v": "1", "k": "items", "a": "00000000-0000-0000-0000-000000000000", "u": null, "t": "2020-01-02T03:04:05.000006Z"}')
union all
select 'id-not-uuid', pg_temp.b64url('{"v": 1, "k": "items", "a": "not-a-uuid", "u": null, "t": "2020-01-02T03:04:05.000006Z"}')
union all
select 'id-number', pg_temp.b64url('{"v": 1, "k": "items", "a": 7, "u": null, "t": "2020-01-02T03:04:05.000006Z"}')
union all
select 'no-since-member', pg_temp.b64url('{"v": 1, "k": "items", "a": "00000000-0000-0000-0000-000000000000", "t": "2020-01-02T03:04:05.000006Z"}')
union all
select 'since-number', pg_temp.b64url('{"v": 1, "k": "items", "a": "00000000-0000-0000-0000-000000000000", "u": 5, "t": "2020-01-02T03:04:05.000006Z"}')
union all
select 'as-of-format', pg_temp.b64url('{"v": 1, "k": "items", "a": "00000000-0000-0000-0000-000000000000", "u": null, "t": "2020-01-02"}')
union all
select 'as-of-missing', pg_temp.b64url('{"v": 1, "k": "items", "a": "00000000-0000-0000-0000-000000000000", "u": null}')
union all
select 'demand-short-key', pg_temp.b64url('{"v": 1, "k": "demand_history", "m": "all", "f": "2026-01-30", "e": "2026-02-02", "i": null, "l": null, "a": ["00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000000"], "t": "2020-01-02T03:04:05.000006Z"}')
union all
select 'demand-bad-date', pg_temp.b64url('{"v": 1, "k": "demand_history", "m": "all", "f": "2026-01-30", "e": "2026-02-02", "i": null, "l": null, "a": ["00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000000", "2026-13-01"], "t": "2020-01-02T03:04:05.000006Z"}');

set local role service_role;
insert into lists (k, body) values
  ('list:items:carried-as-of', public.api_list(pg_temp.h('a-full'), 'items', (select v from cursors where k = 'carried-as-of'), 1)),
  ('list:items:planted', public.api_list(pg_temp.h('a-full'), 'items', (select v from cursors where k = 'planted-items'), 1000)),
  ('list:items:b-with-a-cursor', public.api_list(pg_temp.h('b-full'), 'items', (select v from cursors where k = 'items'), 1000)),
  ('list:demand:planted', public.api_list_demand(pg_temp.h('a-full'), '2026-01-30', '2026-02-02', null, null,
                                                  (select v from cursors where k = 'planted-demand'), 1000)),
  ('list:demand:planted-location', public.api_list_demand(pg_temp.h('a-full'), '2026-01-30', '2026-02-02', null, null,
                                                           (select v from cursors where k = 'planted-demand-location'), 1000)),
  ('list:demand:b-with-a-location-cursor', public.api_list_demand(pg_temp.h('b-full'), '2026-01-30', '2026-02-02', null, 'RUH-C',
                                                                  (select v from cursors where k = 'demand-location'), 1000)),
  ('list:demand:b-with-a-cursor', public.api_list_demand(pg_temp.h('b-full'), '2026-01-30', '2026-02-02', null, null,
                                                          (select v from cursors where k = 'demand-all'), 1000));
insert into probes (k, outcome)
select x.k, pg_temp.fails(x.q)
from (values
  ('items cursor for brands', format('select public.api_list(pg_temp.h(%L), %L, %L, 1000)', 'a-full', 'brands', (select v from cursors where k = 'items'))),
  ('cursor without updated_since, now with', format('select public.api_list(pg_temp.h(%L), %L, %L, 1000, now())', 'a-full', 'items', (select v from cursors where k = 'items'))),
  ('cursor with updated_since, now without', format('select public.api_list(pg_temp.h(%L), %L, %L, 1)', 'a-full', 'items', (select v from cursors where k = 'since'))),
  ('cursor with another updated_since', format('select public.api_list(pg_temp.h(%L), %L, %L, 1, now() - interval %L)', 'a-full', 'items', (select v from cursors where k = 'since'), '1 second')),
  ('limit 0', $$select public.api_list(pg_temp.h('a-full'), 'items', null, 0)$$),
  ('limit -1', $$select public.api_list(pg_temp.h('a-full'), 'items', null, -1)$$),
  ('limit 1001', $$select public.api_list(pg_temp.h('a-full'), 'items', null, 1001)$$),
  ('limit 1000', $$select public.api_list(pg_temp.h('a-full'), 'items', null, 1000)$$),
  ('limit 1', $$select public.api_list(pg_temp.h('a-full'), 'items', null, 1)$$),
  ('updated_since infinity', $$select public.api_list(pg_temp.h('a-full'), 'items', null, null, 'infinity')$$),
  ('updated_since -infinity', $$select public.api_list(pg_temp.h('a-full'), 'items', null, null, '-infinity')$$),
  ('entity demand_history', $$select public.api_list(pg_temp.h('a-full'), 'demand_history')$$),
  ('entity unknown', $$select public.api_list(pg_temp.h('a-full'), 'nope')$$),
  ('entity null', $$select public.api_list(pg_temp.h('a-full'), null)$$),
  ('entity in the URL spelling', $$select public.api_list(pg_temp.h('a-full'), 'work-calendars')$$),
  ('unknown key, unknown entity', $$select public.api_list(sha256('nope'::bytea), 'nope')$$),
  ('unknown key, bad limit', $$select public.api_list(sha256('nope'::bytea), 'items', null, 0)$$),
  ('transactions key on a master list', $$select public.api_list(pg_temp.h('a-tx'), 'items')$$),
  ('master key on a demand list', $$select public.api_list_demand(pg_temp.h('a-master'), '2026-01-30', '2026-02-02')$$),
  ('master key, bad range', $$select public.api_list_demand(pg_temp.h('a-master'), '2026-02-02', '2026-01-30')$$),
  ('transactions key on a demand list', $$select public.api_list_demand(pg_temp.h('a-tx'), '2026-01-30', '2026-02-02')$$),
  ('to before from', $$select public.api_list_demand(pg_temp.h('a-full'), '2026-02-02', '2026-02-01')$$),
  ('367 days', $$select public.api_list_demand(pg_temp.h('a-full'), '2025-01-01', '2026-01-02')$$),
  ('366 days', $$select public.api_list_demand(pg_temp.h('a-full'), '2025-01-01', '2026-01-01')$$),
  ('one day', $$select public.api_list_demand(pg_temp.h('a-full'), '2026-01-31', '2026-01-31')$$),
  ('from null', $$select public.api_list_demand(pg_temp.h('a-full'), null, '2026-01-31')$$),
  ('from -infinity', $$select public.api_list_demand(pg_temp.h('a-full'), '-infinity', '2026-01-31')$$),
  ('to null', $$select public.api_list_demand(pg_temp.h('a-full'), '2026-01-31', null)$$),
  ('to infinity', $$select public.api_list_demand(pg_temp.h('a-full'), '2026-01-31', 'infinity')$$),
  ('demand limit 0', $$select public.api_list_demand(pg_temp.h('a-full'), '2026-01-30', '2026-02-02', null, null, null, 0)$$),
  ('demand limit 5001', $$select public.api_list_demand(pg_temp.h('a-full'), '2026-01-30', '2026-02-02', null, null, null, 5001)$$),
  ('demand limit 5000', $$select public.api_list_demand(pg_temp.h('a-full'), '2026-01-30', '2026-02-02', null, null, null, 5000)$$),
  ('item code with a space', $$select public.api_list_demand(pg_temp.h('a-full'), '2026-01-30', '2026-02-02', 'P 1')$$),
  ('item code of 65 characters', format('select public.api_list_demand(pg_temp.h(%L), %L, %L, %L)', 'a-full', '2026-01-30', '2026-02-02', repeat('P', 65))),
  ('item code with a slash', $$select public.api_list_demand(pg_temp.h('a-full'), '2026-01-30', '2026-02-02', 'P/1')$$),
  ('location code with a slash', $$select public.api_list_demand(pg_temp.h('a-full'), '2026-01-30', '2026-02-02', null, 'RUH/C')$$)
) as x (k, q);
insert into probes (k, outcome)
select 'cursor ' || c.k, pg_temp.fails(format('select public.api_list(pg_temp.h(%L), %L, %L, 10)', 'a-full', 'items', c.v))
from cursors c
where c.k in ('bad-charset', 'padded', 'too-long', 'not-json', 'array', 'version-2', 'version-string', 'id-not-uuid', 'id-number',
              'no-since-member', 'since-number', 'as-of-format', 'as-of-missing', 'demand-all');
insert into probes (k, outcome)
select x.k, pg_temp.fails(format('select public.api_list_demand(pg_temp.h(%L), %L, %L, %L, %L, %L, 2)', 'a-full', x.f, x.t, x.i, x.l,
                                 (select v from cursors where k = x.c)))
from (values
  ('demand cursor of mode all in mode item', 'demand-all', '2026-01-30', '2026-02-02', 'P-2', null),
  ('demand cursor with another from', 'demand-all', '2026-01-29', '2026-02-02', null, null),
  ('demand cursor with another to', 'demand-all', '2026-01-30', '2026-02-03', null, null),
  ('demand cursor of another item', 'demand-item', '2026-01-30', '2026-02-02', 'P-1', null),
  ('demand cursor of another location', 'demand-location', '2026-01-30', '2026-02-02', null, 'RUH-B1'),
  ('demand cursor of mode location in mode both', 'demand-location', '2026-01-30', '2026-02-02', 'P-1', 'RUH-C'),
  ('items cursor on demand', 'items', '2026-01-30', '2026-02-02', null, null),
  ('demand cursor with two key members', 'demand-short-key', '2026-01-30', '2026-02-02', null, null),
  ('demand cursor with an invalid date', 'demand-bad-date', '2026-01-30', '2026-02-02', null, null),
  ('demand cursor, too long', 'too-long', '2026-01-30', '2026-02-02', null, null),
  ('demand cursor, valid', 'demand-all', '2026-01-30', '2026-02-02', null, null)
) as x (k, c, f, t, i, l);
reset role;

select is(
  (select (body ->> 'as_of') || ' ' || (app.api_cursor_decode(body ->> 'next_cursor', 'items') ->> 't') from lists where k = 'list:items:carried-as-of'),
  '2020-01-02T03:04:05.000006Z 2020-01-02T03:04:05.000006Z',
  'as_of comes from the cursor, not the clock, and travels on to the next cursor'
);

------------------------------------------------------------------------------------------------
-- Request errors (master lists)
------------------------------------------------------------------------------------------------
select is(
  (select array_agg(k || ': ' || outcome order by k collate "C") from probes
   where k in ('items cursor for brands', 'cursor without updated_since, now with', 'cursor with updated_since, now without',
               'cursor with another updated_since')),
  array['cursor with another updated_since: MQ422 cursor', 'cursor with updated_since, now without: MQ422 cursor',
        'cursor without updated_since, now with: MQ422 cursor', 'items cursor for brands: MQ422 cursor'],
  'a cursor works only for the entity and updated_since it was issued for'
);
select is(
  (select array_agg(k || ': ' || outcome order by k collate "C") from probes where k like 'cursor %' and outcome <> 'MQ422 cursor'),
  null,
  'malformed and forged cursors are MQ422 cursor: bad characters, padding, over 1,024 characters, not JSON, not an object, another version, a non-uuid id, a missing or mistyped member, a demand cursor'
);
select is(
  (select array_agg(k || ': ' || outcome order by k collate "C") from probes where k like 'limit %'),
  array['limit -1: MQ422 limit', 'limit 0: MQ422 limit', 'limit 1: ok', 'limit 1000: ok', 'limit 1001: MQ422 limit'],
  'limit is 1 to 1000 for master data'
);
select is(
  (select array_agg(k || ': ' || outcome order by k collate "C") from probes where k like 'updated_since %'),
  array['updated_since -infinity: MQ422 updated_since', 'updated_since infinity: MQ422 updated_since'],
  'updated_since must be finite'
);
select is(
  (select array_agg(k || ': ' || outcome order by k collate "C") from probes where k like 'entity %'),
  array['entity demand_history: MQ404 resource', 'entity in the URL spelling: MQ404 resource', 'entity null: MQ404 resource',
        'entity unknown: MQ404 resource'],
  'api_list serves the 11 master entities by their contract names only'
);
select is(
  (select array_agg(k || ': ' || outcome order by k collate "C") from probes
   where k in ('unknown key, unknown entity', 'unknown key, bad limit', 'transactions key on a master list', 'master key on a demand list',
               'master key, bad range', 'transactions key on a demand list')),
  array['master key on a demand list: MQ403 scope', 'master key, bad range: MQ403 scope', 'transactions key on a demand list: ok',
        'transactions key on a master list: MQ403 scope', 'unknown key, bad limit: MQ401 api_key', 'unknown key, unknown entity: MQ401 api_key'],
  'the key is authorized before anything else: unknown keys get MQ401, keys without the read scope MQ403'
);

------------------------------------------------------------------------------------------------
-- Cross-tenant (master lists)
------------------------------------------------------------------------------------------------
select is(
  pg_temp.sorted(pg_temp.records((select body from lists where k = 'list:items:b'))),
  pg_temp.sorted($$[
    {"item_code": "P-1", "name_en": "B filter", "name_ar": null, "brand_code": null, "product_group": "b", "unit_of_measure": "EA", "unit_cost": "99", "currency": "AED", "status": "active", "introduced_on": null, "discontinued_on": null},
    {"item_code": "Q-1", "name_en": "B only", "name_ar": null, "brand_code": null, "product_group": "b", "unit_of_measure": "EA", "unit_cost": "1", "currency": "AED", "status": "active", "introduced_on": null, "discontinued_on": null}]$$),
  'B''s key lists B''s two items only (its own P-1, not A''s)'
);
select is(
  (select array_agg(r ->> 'item_code' order by o) from lists l cross join json_array_elements(l.body -> 'data') with ordinality as x (r, o)
   where l.k = 'list:items:planted'),
  (select array_agg(c order by id) from (
     select i.code as c, i.id from public.items i
     where i.organization_id = '00000000-0000-4000-8000-5b24000000aa'
       and i.id > (select min(b.id::text)::uuid from public.items b where b.organization_id = '00000000-0000-4000-8000-5b24000000bb')
     order by i.id limit 1000) as y),
  'A''s key with B''s id planted in a cursor gets A''s rows after that id, never B''s'
);
select is(
  (select array_agg(r ->> 'item_code' || ' ' || (r ->> 'unit_cost') order by o)
   from lists l cross join json_array_elements(l.body -> 'data') with ordinality as x (r, o)
   where l.k = 'list:items:b-with-a-cursor'),
  (select array_agg(i.code || ' ' || trim_scale(i.unit_cost)::text order by i.id) from public.items i
   where i.organization_id = '00000000-0000-4000-8000-5b24000000bb'
     and i.id > (app.api_cursor_decode((select v from cursors where k = 'items'), 'items') ->> 'a')::uuid),
  'B''s key with A''s cursor gets B''s rows after that id, never A''s'
);

------------------------------------------------------------------------------------------------
-- Round trip: listed records sent back change nothing
------------------------------------------------------------------------------------------------
create temporary table batches_before on commit drop as
select count(*) as n from public.import_batches where organization_id = '00000000-0000-4000-8000-5b24000000aa';

set local role service_role;
insert into trips (entity, page, records, result)
select e, t.page, t.records, t.result
from unnest(array['work_calendars', 'holiday_overrides', 'locations', 'network_links', 'brands', 'items', 'item_supersessions',
                  'item_interchanges', 'suppliers', 'supplier_items', 'fx_rates', 'demand_history']) as e
cross join lateral pg_temp.round_trip('a-full', e) as t;
reset role;

select is(
  (select format('%s pages, %s records, %s no-op results',
                 count(*), sum(t.records),
                 count(*) filter (where t.result ->> 'result' = 'succeeded' and t.result ->> 'recorded' = 'false'
                                    and t.result -> 'import_id' = 'null'::jsonb and (t.result ->> 'records')::int = t.records
                                    and (t.result -> 'counts' ->> 'unchanged')::int = t.records
                                    and coalesce((t.result -> 'counts' ->> 'inserted')::int, 0) + coalesce((t.result -> 'counts' ->> 'updated')::int, 0)
                                        + coalesce((t.result -> 'counts' ->> 'deleted')::int, 0) + coalesce((t.result -> 'counts' ->> 'parents_set')::int, 0)
                                        + coalesce((t.result -> 'counts' ->> 'preferred_cleared')::int, 0) = 0))
   from trips t where t.entity = x.entity),
  format('%s pages, %s records, %s no-op results', x.pages, x.records, x.pages),
  x.entity || ': every listed record sent back without updated_at is unchanged, and the write is not recorded'
)
from (values ('brands', 1, 2), ('demand_history', 1, 23), ('fx_rates', 1, 4), ('holiday_overrides', 1, 2), ('item_interchanges', 1, 1),
             ('item_supersessions', 1, 1), ('items', 3, 2503), ('locations', 1, 2), ('network_links', 1, 2), ('supplier_items', 1, 2),
             ('suppliers', 1, 2), ('work_calendars', 1, 2)) as x (entity, pages, records)
order by x.entity;
select is(
  (select count(*) from public.import_batches where organization_id = '00000000-0000-4000-8000-5b24000000aa'),
  (select n from batches_before),
  'the round trips left no import batch behind'
);

------------------------------------------------------------------------------------------------
-- Demand
------------------------------------------------------------------------------------------------
create temporary table demand_expected on commit drop as
select m.mode, array(
  select jsonb_build_object('item_code', i.code, 'location_code', l.code, 'demand_date', d.demand_date,
                            'quantity', trim_scale(d.quantity)::text, 'lost_sales_quantity', trim_scale(d.lost_sales_quantity)::text)
  from public.demand_history d
  join public.items i on i.organization_id = d.organization_id and i.id = d.item_id
  join public.locations l on l.organization_id = d.organization_id and l.id = d.location_id
  where d.organization_id = '00000000-0000-4000-8000-5b24000000aa' and d.demand_date between '2026-01-30' and '2026-02-02'
    and (m.item is null or i.code = m.item) and (m.location is null or l.code = m.location)
  order by case when m.mode = 'all' then d.item_id end,
           case when m.mode in ('all', 'item') then d.location_id end,
           d.demand_date,
           case when m.mode = 'location' then d.item_id end) as seq
from (values ('all', null, null), ('item', 'P-2', null), ('location', null, 'RUH-C'), ('both', 'P-1', 'RUH-B1')) as m (mode, item, location);

select is(
  (select array_agg(mode || ' ' || cardinality(seq) order by mode) from demand_expected),
  array['all 21', 'both 4', 'item 7', 'location 10'],
  'demand fixture: 21 rows in the range, 7 of P-2, 10 at RUH-C, 4 of P-1 at RUH-B1'
);
select is(
  (select array_agg(l.lim order by l.lim)
   from (values (1), (2), (3), (1000)) as l (lim)
   where array(select w.r::jsonb from walked w where w.walk = format('demand:%s:%s', e.mode, l.lim) order by w.page, w.pos)
         is distinct from e.seq),
  null,
  e.mode || ': walks with limits 1, 2, 3 and 1000 return every row of the range once, in key order'
)
from demand_expected e
order by e.mode;
select is(
  (select array_agg(l.lim order by l.lim)
   from (values (1), (2), (3), (1000)) as l (lim)
   where (select count(*) from pages p where p.walk = format('demand:%s:%s', e.mode, l.lim)) <> greatest(1, ceil(cardinality(e.seq)::numeric / l.lim))
      or exists (select 1 from pages p
                 where p.walk = format('demand:%s:%s', e.mode, l.lim)
                   and ((p.body ->> 'next_cursor') is null) <> (p.page = (select max(q.page) from pages q where q.walk = p.walk)))
      or exists (select 1 from pages p
                 where p.walk = format('demand:%s:%s', e.mode, l.lim)
                   and p.page < (select max(q.page) from pages q where q.walk = p.walk)
                   and json_array_length(p.body -> 'data') <> l.lim)),
  null,
  e.mode || ': full pages until the last, which alone has next_cursor null'
)
from demand_expected e
order by e.mode;
select is(
  app.api_cursor_decode((select v from cursors where k = 'demand-all'), 'demand_history') - 't',
  jsonb_build_object('v', 1, 'k', 'demand_history', 'm', 'all', 'f', '2026-01-30', 'e', '2026-02-02', 'i', null, 'l', null,
    'a', (select jsonb_build_array(d.item_id, d.location_id, d.demand_date) from public.demand_history d
          where d.organization_id = '00000000-0000-4000-8000-5b24000000aa' and d.demand_date between '2026-01-30' and '2026-02-02'
          order by d.item_id, d.location_id, d.demand_date offset 1 limit 1)),
  'a demand cursor carries the mode, the echoed filters and the key of the page''s last row'
);
select is(
  (select array_agg(k || ': ' || json_array_length(body -> 'data') order by k collate "C") from lists
   where k in ('list:demand:both', 'list:demand:both-wide', 'list:demand:both-one-day')),
  array['list:demand:both: 4', 'list:demand:both-one-day: 1', 'list:demand:both-wide: 6'],
  'from and to are both inclusive'
);
select is(
  (select array_agg(k order by k collate "C") from lists
   where k in ('list:demand:unknown-item', 'list:demand:unknown-location', 'list:demand:unknown-pair', 'list:demand:other-org-code')
     and (body::jsonb - 'as_of') = '{"data": [], "next_cursor": null}'::jsonb),
  array['list:demand:other-org-code', 'list:demand:unknown-item', 'list:demand:unknown-location', 'list:demand:unknown-pair'],
  'unknown codes, including another organization''s, give an empty page without a cursor'
);
select is(
  (select array_agg(k || ': ' || outcome order by k collate "C") from probes
   where k in ('to before from', '367 days', '366 days', 'one day', 'from null', 'from -infinity', 'to null', 'to infinity')),
  array['366 days: ok', '367 days: MQ422 to', 'from -infinity: MQ422 from', 'from null: MQ422 from', 'one day: ok',
        'to before from: MQ422 to', 'to infinity: MQ422 to', 'to null: MQ422 to'],
  'from and to are required finite dates, to on or after from and at most 365 days later (366 days inclusive)'
);
select is(
  (select array_agg(k || ': ' || outcome order by k collate "C") from probes where k like 'demand limit %' or k like '% code %'),
  array['demand limit 0: MQ422 limit', 'demand limit 5000: ok', 'demand limit 5001: MQ422 limit',
        'item code of 65 characters: MQ422 item_code', 'item code with a slash: ok', 'item code with a space: MQ422 item_code',
        'location code with a slash: MQ422 location_code'],
  'demand limit is 1 to 5000; item and location codes follow their patterns'
);
select is(
  (select array_agg(k || ': ' || outcome order by k collate "C") from probes where k like 'demand cursor%' or k = 'items cursor on demand'),
  array['demand cursor of another item: MQ422 cursor', 'demand cursor of another location: MQ422 cursor',
        'demand cursor of mode all in mode item: MQ422 cursor', 'demand cursor of mode location in mode both: MQ422 cursor',
        'demand cursor with an invalid date: MQ422 cursor', 'demand cursor with another from: MQ422 cursor',
        'demand cursor with another to: MQ422 cursor', 'demand cursor with two key members: MQ422 cursor',
        'demand cursor, too long: MQ422 cursor', 'demand cursor, valid: ok', 'items cursor on demand: MQ422 cursor'],
  'a demand cursor works only for its mode, range and codes; malformed ones are MQ422 cursor'
);
select is(
  (select array_agg(r::jsonb order by o)
   from lists l cross join json_array_elements(l.body -> 'data') with ordinality as y (r, o)
   where l.k = p.list),
  (select array_agg(jsonb_build_object('item_code', i.code, 'location_code', lo.code, 'demand_date', d.demand_date,
                                       'quantity', trim_scale(d.quantity)::text, 'lost_sales_quantity', trim_scale(d.lost_sales_quantity)::text)
                    order by d.item_id, d.location_id, d.demand_date)
   from public.demand_history d
   join public.items i on i.organization_id = d.organization_id and i.id = d.item_id
   join public.locations lo on lo.organization_id = d.organization_id and lo.id = d.location_id
   cross join lateral (select app.api_cursor_decode((select v from cursors where k = p.cursor), 'demand_history') -> 'a' as a) as c
   where d.organization_id = '00000000-0000-4000-8000-5b24000000aa' and d.demand_date between '2026-01-30' and '2026-02-02'
     and (d.item_id, d.location_id, d.demand_date) > ((c.a ->> 0)::uuid, (c.a ->> 1)::uuid, (c.a ->> 2)::date)),
  p.description
)
from (values
  ('list:demand:planted', 'planted-demand', 'A''s key with B''s item and location ids planted in a demand cursor gets A''s rows after that key, never B''s'),
  ('list:demand:planted-location', 'planted-demand-location', 'A''s key with B''s location id planted after A''s first item gets A''s rows after that key, never B''s')
) as p (list, cursor, description);
select is(
  (select array_agg(r ->> 'item_code' || ' ' || (r ->> 'location_code') || ' ' || (r ->> 'demand_date') || ' ' || (r ->> 'quantity') order by o)
   from lists l cross join json_array_elements(l.body -> 'data') with ordinality as x (r, o)
   where l.k = 'list:demand:b-both'),
  array['P-1 RUH-C 2026-01-30 9', 'P-1 RUH-C 2026-01-31 9', 'P-1 RUH-C 2026-02-01 9', 'P-1 RUH-C 2026-02-02 9'],
  'B''s key with the codes A uses gets B''s rows of those codes only'
);
select is(
  (select array_agg(r::jsonb order by o)
   from lists l cross join json_array_elements(l.body -> 'data') with ordinality as x (r, o)
   where l.k = 'list:demand:b-with-a-cursor'),
  (select array_agg(jsonb_build_object('item_code', i.code, 'location_code', lo.code, 'demand_date', d.demand_date,
                                       'quantity', '9', 'lost_sales_quantity', '0')
                    order by d.item_id, d.location_id, d.demand_date)
   from public.demand_history d
   join public.items i on i.organization_id = d.organization_id and i.id = d.item_id
   join public.locations lo on lo.organization_id = d.organization_id and lo.id = d.location_id
   cross join lateral (select app.api_cursor_decode((select v from cursors where k = 'demand-all'), 'demand_history') -> 'a' as a) as c
   where d.organization_id = '00000000-0000-4000-8000-5b24000000bb' and d.demand_date between '2026-01-30' and '2026-02-02'
     and (d.item_id, d.location_id, d.demand_date) > ((c.a ->> 0)::uuid, (c.a ->> 1)::uuid, (c.a ->> 2)::date)),
  'B''s key with A''s demand cursor gets B''s rows after that key, never A''s'
);
-- A's location cursor stops on 2026-01-30, so B's later RUH-C rows always follow it.
select is(
  (select array_agg(r ->> 'item_code' || ' ' || (r ->> 'location_code') || ' ' || (r ->> 'demand_date') || ' ' || (r ->> 'quantity') order by o)
   from lists l cross join json_array_elements(l.body -> 'data') with ordinality as x (r, o)
   where l.k = 'list:demand:b-with-a-location-cursor'),
  (select array_agg(i.code || ' RUH-C ' || d.demand_date || ' 9' order by d.demand_date, d.item_id)
   from public.demand_history d
   join public.items i on i.organization_id = d.organization_id and i.id = d.item_id
   cross join lateral (select app.api_cursor_decode((select v from cursors where k = 'demand-location'), 'demand_history') -> 'a' as a) as c
   where d.organization_id = '00000000-0000-4000-8000-5b24000000bb' and d.demand_date between '2026-01-30' and '2026-02-02'
     and d.location_id = (select lo.id from public.locations lo where lo.organization_id = d.organization_id and lo.code = 'RUH-C')
     and (d.demand_date, d.item_id) > ((c.a ->> 2)::date, (c.a ->> 0)::uuid)
   having count(*) >= 3),
  'B''s key with A''s location-mode cursor gets B''s RUH-C rows after that key (at least three), never A''s'
);

------------------------------------------------------------------------------------------------
-- api_organization
------------------------------------------------------------------------------------------------
select is(
  (select array[array_to_string(array(select json_object_keys(body)), ','),
                array_to_string(array(select json_object_keys(body -> 'organization')), ','),
                array_to_string(array(select json_object_keys(body -> 'key')), ','),
                array_to_string(array(select json_object_keys(body -> 'demand_window')), ',')]
   from lists where k = 'org:a'),
  array['organization,key,demand_window,limits', 'name,slug,base_currency,home_country,time_zone',
        'id,name,display,scopes,created_at,expires_at', 'from,until_exclusive'],
  'api_organization: keys in their documented order, and nothing secret about the key'
);
select is(
  (select array[(a.body -> 'organization')::jsonb, (b.body -> 'organization')::jsonb] from lists as a, lists as b where a.k = 'org:a' and b.k = 'org:b'),
  array['{"name": "API list A", "slug": "api24-a", "base_currency": "SAR", "home_country": "SA", "time_zone": "Asia/Riyadh"}'::jsonb,
        '{"name": "API list B", "slug": "api24-b", "base_currency": "AED", "home_country": "AE", "time_zone": "Asia/Riyadh"}'::jsonb],
  'api_organization: the organization of the key; time_zone is the organization''s, else its home country''s'
);
select is(
  (select (body -> 'key')::jsonb - 'created_at' - 'expires_at' from lists where k = 'org:a'),
  '{"id": "00000000-0000-4000-8000-5b2400000c01", "name": "a-full", "display": "maqdar_sk_AFul…Cd12", "scopes": ["master_data:read", "master_data:write", "transactions:read", "transactions:write"]}'::jsonb,
  'api_organization: the key with its display form (prefix, an ellipsis, last four) and scopes'
);
select is(
  (select count(*)::int from lists l join public.api_keys k on k.id = (l.body -> 'key' ->> 'id')::uuid
   where l.k in ('org:a', 'org:b')
     and l.body -> 'key' ->> 'created_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
     and l.body -> 'key' ->> 'expires_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
     and (l.body -> 'key' ->> 'created_at')::timestamptz = k.created_at
     and (l.body -> 'key' ->> 'expires_at')::timestamptz = k.expires_at),
  2,
  'api_organization: created_at and expires_at are the key''s, as UTC timestamps with microseconds'
);
select is(
  (select (body -> 'demand_window')::jsonb from lists where k = 'org:a'),
  jsonb_build_object('from', lower(app.demand_history_window()), 'until_exclusive', upper(app.demand_history_window())),
  'api_organization: demand_window is app.demand_history_window()'
);
select is(
  (select array[(body -> 'limits')::jsonb, app.api_limits()::jsonb] from lists where k = 'org:a'),
  array[:'api_limits'::jsonb, :'api_limits'::jsonb],
  'api_organization: limits equal app.api_limits() and supabase/tests/fixtures/api_limits.json'
);

------------------------------------------------------------------------------------------------
-- Drift guard of the record types (last: it alters them)
------------------------------------------------------------------------------------------------
select set_eq(
  $$select t.typname::text collate "default"
    from pg_type t join pg_class c on c.oid = t.typrelid and c.relkind = 'c'
    where t.typnamespace = 'ingest'::regnamespace and t.typname like 'api\_record\_%'$$,
  $$select 'api_record_' || entity from ingest.contract_entities$$,
  'one composite type ingest.api_record_<entity> per contract entity, no other'
);
select is(
  (select count(*)::int
   from pg_type t
   cross join unnest(array['public', 'anon', 'authenticated', 'service_role']) as r
   where t.typnamespace = 'ingest'::regnamespace and t.typname like 'api\_record\_%' and t.typtype = 'c'
     and has_type_privilege(r, t.oid, 'USAGE')),
  0,
  'no API role (nor PUBLIC) may use the record types'
);
select is(app.api_record_type_drift(), null, 'app.api_record_type_drift(): every record type matches the contract');
select lives_ok(
  $q$do $d$ begin if app.api_record_type_drift() is not null then raise exception 'drift: %', app.api_record_type_drift(); end if; end $d$$q$,
  'the migration''s drift check passes'
);

alter type ingest.api_record_brands alter attribute is_active type text;
select is(app.api_record_type_drift(), 'brands', 'a changed attribute type is drift');
select throws_ok(
  $q$do $d$ begin if app.api_record_type_drift() is not null then raise exception 'drift: %', app.api_record_type_drift(); end if; end $d$$q$,
  'P0001', 'drift: brands',
  'and the migration''s drift check fails on it'
);
alter type ingest.api_record_items drop attribute item_code, add attribute item_code text;
alter type ingest.api_record_fx_rates drop attribute note;
create type ingest.api_record_bogus as (x text);
select is(app.api_record_type_drift(), 'bogus, brands, fx_rates, items',
          'a moved attribute, a missing attribute and a type without an entity are drift too');

select * from finish();

rollback;
