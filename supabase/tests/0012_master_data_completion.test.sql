-- Step 4 master data: the six new tables (brands, item_interchanges, network_links, fx_rates,
-- work_calendars, holiday_overrides) proven for tenant isolation, roles, composite tenant foreign
-- keys, natural keys, checks and the holiday overlap exclusion; column types, the items.brand ->
-- brand_id change, updated_at triggers, the organizations display preferences, stored search_text
-- and the app.normalize_search fixtures shared with the web app
-- (supabase/tests/fixtures/normalize_search.json). Guards (cycles, delete guard, organization
-- delete) live in 0015_master_data_guards.
begin;

select plan(125);

------------------------------------------------------------------------------------------------
-- Fixture (as postgres). Organization A (Arabic off): owner, planner, viewer. Organization B
-- (Arabic on): owner. One row per new table in each organization, with an old updated_at so the
-- trigger test below can see it move.
------------------------------------------------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at)
values
  ('00000000-0000-4000-8000-a12000000001', 'md12-owner-a@test.local', now()),
  ('00000000-0000-4000-8000-a12000000002', 'md12-planner-a@test.local', now()),
  ('00000000-0000-4000-8000-a12000000003', 'md12-viewer-a@test.local', now()),
  ('00000000-0000-4000-8000-b12000000001', 'md12-owner-b@test.local', now());
insert into public.organizations (id, slug, name, arabic_enabled)
values
  ('00000000-0000-4000-8000-a12000000000', 'md12-org-a', 'Org A', false),
  ('00000000-0000-4000-8000-b12000000000', 'md12-org-b', 'Org B', true);
insert into public.memberships (organization_id, user_id, role)
values
  ('00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12000000001', 'owner'),
  ('00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12000000002', 'planner'),
  ('00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12000000003', 'viewer'),
  ('00000000-0000-4000-8000-b12000000000', '00000000-0000-4000-8000-b12000000001', 'owner');

insert into public.locations (id, organization_id, code, name_en, location_type, country_code, timezone, city)
values
  ('00000000-0000-4000-8000-a12010000001', '00000000-0000-4000-8000-a12000000000', 'RUH-DC', 'Riyadh DC', 'central', 'SA', 'Asia/Riyadh', 'Riyadh'),
  ('00000000-0000-4000-8000-a12010000002', '00000000-0000-4000-8000-a12000000000', 'JED-01', 'Jeddah branch', 'branch', 'SA', 'Asia/Riyadh', 'Jeddah'),
  ('00000000-0000-4000-8000-a12010000003', '00000000-0000-4000-8000-a12000000000', 'DMM-01', 'Dammam branch', 'branch', 'SA', 'Asia/Riyadh', 'Dammam'),
  ('00000000-0000-4000-8000-b12010000001', '00000000-0000-4000-8000-b12000000000', 'RUH-DC', 'Riyadh DC', 'central', 'SA', 'Asia/Riyadh', 'Riyadh'),
  ('00000000-0000-4000-8000-b12010000002', '00000000-0000-4000-8000-b12000000000', 'JED-01', 'Jeddah branch', 'branch', 'SA', 'Asia/Riyadh', 'Jeddah');
insert into public.brands (id, organization_id, code, name_en, brand_type, country_of_origin, updated_at)
values
  ('00000000-0000-4000-8000-a12030000001', '00000000-0000-4000-8000-a12000000000', 'FALCON', 'Falcon', 'oem', 'JP', '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-b12030000001', '00000000-0000-4000-8000-b12000000000', 'FALCON', 'Falcon', 'oem', 'JP', '2000-01-01T00:00:00Z');
insert into public.items (id, organization_id, code, name_en, product_group, unit_of_measure, unit_cost, currency, brand_id)
values
  ('00000000-0000-4000-8000-a12020000001', '00000000-0000-4000-8000-a12000000000', 'P-1', 'Battery', 'battery', 'EA', 420, 'SAR', '00000000-0000-4000-8000-a12030000001'),
  ('00000000-0000-4000-8000-a12020000002', '00000000-0000-4000-8000-a12000000000', 'P-2', 'Battery II', 'battery', 'EA', 430, 'SAR', '00000000-0000-4000-8000-a12030000001'),
  ('00000000-0000-4000-8000-a12020000003', '00000000-0000-4000-8000-a12000000000', 'P-3', 'Oil filter', 'oil_filter', 'EA', 22, 'SAR', null),
  ('00000000-0000-4000-8000-b12020000001', '00000000-0000-4000-8000-b12000000000', 'P-1', 'Battery', 'battery', 'EA', 1, 'KWD', '00000000-0000-4000-8000-b12030000001'),
  ('00000000-0000-4000-8000-b12020000002', '00000000-0000-4000-8000-b12000000000', 'P-2', 'Battery II', 'battery', 'EA', 1, 'KWD', '00000000-0000-4000-8000-b12030000001'),
  ('00000000-0000-4000-8000-b12020000003', '00000000-0000-4000-8000-b12000000000', 'P-3', 'Oil filter', 'oil_filter', 'EA', 1, 'KWD', null);
insert into public.suppliers (id, organization_id, code, name_en, country_code, currency, lead_time_days_p50, lead_time_days_p90)
values ('00000000-0000-4000-8000-a12040000001', '00000000-0000-4000-8000-a12000000000', 'S-1', 'Falcon Japan', 'JP', 'JPY', 45, 70);
insert into public.work_calendars (id, organization_id, code, name_en, name_ar, country_code, weekend_days, observe_public_holidays, updated_at)
values
  ('00000000-0000-4000-8000-a12050000001', '00000000-0000-4000-8000-a12000000000', 'SA-STD', 'Saudi standard', 'التقويم السعودي', 'SA', '{5,6}', true, '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-b12050000001', '00000000-0000-4000-8000-b12000000000', 'SA-STD', 'Saudi standard', null, 'SA', '{5,6}', true, '2000-01-01T00:00:00Z');
insert into public.item_interchanges (id, organization_id, item_id, alternate_item_id, direction, priority, updated_at)
values
  ('00000000-0000-4000-8000-a12060000001', '00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12020000001', '00000000-0000-4000-8000-a12020000002', 'two_way', 1, '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-b12060000001', '00000000-0000-4000-8000-b12000000000', '00000000-0000-4000-8000-b12020000001', '00000000-0000-4000-8000-b12020000002', 'one_way', 2, '2000-01-01T00:00:00Z');
insert into public.network_links (id, organization_id, from_location_id, to_location_id, lead_time_days_p50, lead_time_days_p90, freight_basis, freight_cost, currency, updated_at)
values
  ('00000000-0000-4000-8000-a12070000001', '00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12010000001', '00000000-0000-4000-8000-a12010000002', 2, 4, 'per_unit', 1.5, 'SAR', '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-b12070000001', '00000000-0000-4000-8000-b12000000000', '00000000-0000-4000-8000-b12010000001', '00000000-0000-4000-8000-b12010000002', 1, 3, 'none', null, null, '2000-01-01T00:00:00Z');
insert into public.fx_rates (id, organization_id, from_currency, to_currency, valid_from, rate, updated_at)
values
  ('00000000-0000-4000-8000-a12080000001', '00000000-0000-4000-8000-a12000000000', 'USD', 'SAR', '2026-01-01', 3.75, '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-b12080000001', '00000000-0000-4000-8000-b12000000000', 'USD', 'KWD', '2026-01-01', 0.307, '2000-01-01T00:00:00Z');
insert into public.holiday_overrides (id, organization_id, work_calendar_id, country_code, starts_on, ends_on, kind, name_en, updated_at)
values
  ('00000000-0000-4000-8000-a12090000001', '00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12050000001', null, '2026-03-01', '2026-03-03', 'closure', 'Stocktake', '2000-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-b12090000001', '00000000-0000-4000-8000-b12000000000', '00000000-0000-4000-8000-b12050000001', null, '2026-03-01', '2026-03-03', 'closure', 'Stocktake', '2000-01-01T00:00:00Z');

------------------------------------------------------------------------------------------------
-- Structure
------------------------------------------------------------------------------------------------
select col_type_is('public', 'network_links', 'freight_cost', 'numeric(18,3)', 'network_links.freight_cost is numeric(18,3)');
select col_type_is('public', 'network_links', 'currency', 'character(3)', 'network_links.currency is char(3)');
select col_type_is('public', 'fx_rates', 'rate', 'numeric(20,10)', 'fx_rates.rate is numeric(20,10)');
select hasnt_column('public', 'items', 'brand', 'items.brand (free text) no longer exists');
select col_type_is('public', 'items', 'brand_id', 'uuid', 'items.brand_id exists and is a uuid');
select is(
  array(
    select c.relname::text
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      and a.attname = 'search_text' and a.attgenerated = 's' and not a.attisdropped
    order by 1
  ),
  array['brands', 'items', 'locations', 'suppliers', 'work_calendars'],
  'search_text is a stored generated column on brands, items, locations, suppliers and work_calendars'
);
select is(
  (select attgenerated::text from pg_attribute where attrelid = 'public.holiday_overrides'::regclass and attname = 'scope_key'),
  's',
  'holiday_overrides.scope_key is a stored generated column'
);
select is(
  (select scope_key from public.holiday_overrides where id = '00000000-0000-4000-8000-a12090000001'),
  'calendar:00000000-0000-4000-8000-a12050000001',
  'a calendar override has scope_key calendar:<id>'
);

------------------------------------------------------------------------------------------------
-- Owner of A: sees only A rows, cannot write into B
------------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-a12000000001", "role": "authenticated", "email": "md12-owner-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-a12000000001';

select results_eq($$select organization_id, count(*)::int from public.brands group by 1$$, $$values ('00000000-0000-4000-8000-a12000000000'::uuid, 1)$$, 'owner A sees only A brands');
select results_eq($$select organization_id, count(*)::int from public.item_interchanges group by 1$$, $$values ('00000000-0000-4000-8000-a12000000000'::uuid, 1)$$, 'owner A sees only A interchanges');
select results_eq($$select organization_id, count(*)::int from public.network_links group by 1$$, $$values ('00000000-0000-4000-8000-a12000000000'::uuid, 1)$$, 'owner A sees only A network links');
select results_eq($$select organization_id, count(*)::int from public.fx_rates group by 1$$, $$values ('00000000-0000-4000-8000-a12000000000'::uuid, 1)$$, 'owner A sees only A fx rates');
select results_eq($$select organization_id, count(*)::int from public.work_calendars group by 1$$, $$values ('00000000-0000-4000-8000-a12000000000'::uuid, 1)$$, 'owner A sees only A work calendars');
select results_eq($$select organization_id, count(*)::int from public.holiday_overrides group by 1$$, $$values ('00000000-0000-4000-8000-a12000000000'::uuid, 1)$$, 'owner A sees only A holiday overrides');

select throws_ok(
  $$insert into public.brands (organization_id, code, name_en) values ('00000000-0000-4000-8000-b12000000000', 'HIJACK', 'Hijack')$$,
  '42501', null, 'owner A cannot insert a brand into B'
);
select throws_ok(
  $$insert into public.item_interchanges (organization_id, item_id, alternate_item_id)
    values ('00000000-0000-4000-8000-b12000000000', '00000000-0000-4000-8000-b12020000001', '00000000-0000-4000-8000-b12020000003')$$,
  '42501', null, 'owner A cannot insert an interchange into B'
);
select throws_ok(
  $$insert into public.network_links (organization_id, from_location_id, to_location_id, lead_time_days_p50, lead_time_days_p90)
    values ('00000000-0000-4000-8000-b12000000000', '00000000-0000-4000-8000-b12010000002', '00000000-0000-4000-8000-b12010000001', 1, 2)$$,
  '42501', null, 'owner A cannot insert a network link into B'
);
select throws_ok(
  $$insert into public.fx_rates (organization_id, from_currency, to_currency, valid_from, rate)
    values ('00000000-0000-4000-8000-b12000000000', 'EUR', 'KWD', '2026-01-01', 0.33)$$,
  '42501', null, 'owner A cannot insert an fx rate into B'
);
select throws_ok(
  $$insert into public.work_calendars (organization_id, code, name_en, weekend_days, observe_public_holidays)
    values ('00000000-0000-4000-8000-b12000000000', 'HIJACK', 'Hijack', '{}', false)$$,
  '42501', null, 'owner A cannot insert a work calendar into B'
);
select throws_ok(
  $$insert into public.holiday_overrides (organization_id, work_calendar_id, starts_on, ends_on, kind, name_en)
    values ('00000000-0000-4000-8000-b12000000000', '00000000-0000-4000-8000-b12050000001', '2026-05-01', '2026-05-01', 'closure', 'Hijack')$$,
  '42501', null, 'owner A cannot insert a holiday override into B'
);

with d as (update public.brands set name_en = 'Hijacked' where organization_id = '00000000-0000-4000-8000-b12000000000' returning 1)
select is(count(*)::int, 0, 'owner A updating B brands affects 0 rows') from d;
with d as (update public.item_interchanges set priority = 99 where organization_id = '00000000-0000-4000-8000-b12000000000' returning 1)
select is(count(*)::int, 0, 'owner A updating B interchanges affects 0 rows') from d;
with d as (update public.network_links set lead_time_days_p50 = 0 where organization_id = '00000000-0000-4000-8000-b12000000000' returning 1)
select is(count(*)::int, 0, 'owner A updating B network links affects 0 rows') from d;
with d as (update public.fx_rates set rate = 1 where organization_id = '00000000-0000-4000-8000-b12000000000' returning 1)
select is(count(*)::int, 0, 'owner A updating B fx rates affects 0 rows') from d;
with d as (update public.work_calendars set name_en = 'Hijacked' where organization_id = '00000000-0000-4000-8000-b12000000000' returning 1)
select is(count(*)::int, 0, 'owner A updating B work calendars affects 0 rows') from d;
with d as (update public.holiday_overrides set name_en = 'Hijacked' where organization_id = '00000000-0000-4000-8000-b12000000000' returning 1)
select is(count(*)::int, 0, 'owner A updating B holiday overrides affects 0 rows') from d;

with d as (delete from public.holiday_overrides where organization_id = '00000000-0000-4000-8000-b12000000000' returning 1)
select is(count(*)::int, 0, 'owner A deleting B holiday overrides affects 0 rows') from d;
with d as (delete from public.fx_rates where organization_id = '00000000-0000-4000-8000-b12000000000' returning 1)
select is(count(*)::int, 0, 'owner A deleting B fx rates affects 0 rows') from d;
with d as (delete from public.network_links where organization_id = '00000000-0000-4000-8000-b12000000000' returning 1)
select is(count(*)::int, 0, 'owner A deleting B network links affects 0 rows') from d;
with d as (delete from public.item_interchanges where organization_id = '00000000-0000-4000-8000-b12000000000' returning 1)
select is(count(*)::int, 0, 'owner A deleting B interchanges affects 0 rows') from d;
with d as (delete from public.work_calendars where organization_id = '00000000-0000-4000-8000-b12000000000' returning 1)
select is(count(*)::int, 0, 'owner A deleting B work calendars affects 0 rows') from d;
with d as (delete from public.brands where organization_id = '00000000-0000-4000-8000-b12000000000' returning 1)
select is(count(*)::int, 0, 'owner A deleting B brands affects 0 rows') from d;

------------------------------------------------------------------------------------------------
-- Owner of B: sees only B rows
------------------------------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-b12000000001", "role": "authenticated", "email": "md12-owner-b@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-b12000000001';

select results_eq($$select organization_id, count(*)::int from public.brands group by 1$$, $$values ('00000000-0000-4000-8000-b12000000000'::uuid, 1)$$, 'owner B sees only B brands');
select results_eq($$select organization_id, count(*)::int from public.item_interchanges group by 1$$, $$values ('00000000-0000-4000-8000-b12000000000'::uuid, 1)$$, 'owner B sees only B interchanges');
select results_eq($$select organization_id, count(*)::int from public.network_links group by 1$$, $$values ('00000000-0000-4000-8000-b12000000000'::uuid, 1)$$, 'owner B sees only B network links');
select results_eq($$select organization_id, count(*)::int from public.fx_rates group by 1$$, $$values ('00000000-0000-4000-8000-b12000000000'::uuid, 1)$$, 'owner B sees only B fx rates');
select results_eq($$select organization_id, count(*)::int from public.work_calendars group by 1$$, $$values ('00000000-0000-4000-8000-b12000000000'::uuid, 1)$$, 'owner B sees only B work calendars');
select results_eq($$select organization_id, count(*)::int from public.holiday_overrides group by 1$$, $$values ('00000000-0000-4000-8000-b12000000000'::uuid, 1)$$, 'owner B sees only B holiday overrides');

------------------------------------------------------------------------------------------------
-- Viewer of A: reads, cannot insert. Planner of A: the same rows insert fine.
------------------------------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-a12000000003", "role": "authenticated", "email": "md12-viewer-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-a12000000003';

select throws_ok(
  $$insert into public.brands (id, organization_id, code, name_en) values ('00000000-0000-4000-8000-a12030000002', '00000000-0000-4000-8000-a12000000000', 'BOSCH', 'Bosch')$$,
  '42501', null, 'a viewer cannot insert a brand'
);
select throws_ok(
  $$insert into public.item_interchanges (id, organization_id, item_id, alternate_item_id)
    values ('00000000-0000-4000-8000-a12060000002', '00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12020000002', '00000000-0000-4000-8000-a12020000003')$$,
  '42501', null, 'a viewer cannot insert an interchange'
);
select throws_ok(
  $$insert into public.network_links (id, organization_id, from_location_id, to_location_id, lead_time_days_p50, lead_time_days_p90)
    values ('00000000-0000-4000-8000-a12070000002', '00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12010000002', '00000000-0000-4000-8000-a12010000001', 1, 2)$$,
  '42501', null, 'a viewer cannot insert a network link'
);
select throws_ok(
  $$insert into public.fx_rates (id, organization_id, from_currency, to_currency, valid_from, rate)
    values ('00000000-0000-4000-8000-a12080000002', '00000000-0000-4000-8000-a12000000000', 'EUR', 'SAR', '2026-01-01', 4.1)$$,
  '42501', null, 'a viewer cannot insert an fx rate'
);
select throws_ok(
  $$insert into public.work_calendars (id, organization_id, code, name_en, weekend_days, observe_public_holidays)
    values ('00000000-0000-4000-8000-a12050000002', '00000000-0000-4000-8000-a12000000000', 'NO-WEEKEND', 'Seven-day site', '{}', false)$$,
  '42501', null, 'a viewer cannot insert a work calendar'
);
select throws_ok(
  $$insert into public.holiday_overrides (id, organization_id, work_calendar_id, starts_on, ends_on, kind, name_en)
    values ('00000000-0000-4000-8000-a12090000002', '00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12050000001', '2026-05-01', '2026-05-01', 'working_day', 'Open day')$$,
  '42501', null, 'a viewer cannot insert a holiday override'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-a12000000002", "role": "authenticated", "email": "md12-planner-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-a12000000002';

select lives_ok(
  $$insert into public.brands (id, organization_id, code, name_en) values ('00000000-0000-4000-8000-a12030000002', '00000000-0000-4000-8000-a12000000000', 'BOSCH', 'Bosch')$$,
  'a planner inserts a brand'
);
select lives_ok(
  $$insert into public.item_interchanges (id, organization_id, item_id, alternate_item_id)
    values ('00000000-0000-4000-8000-a12060000002', '00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12020000002', '00000000-0000-4000-8000-a12020000003')$$,
  'a planner inserts an interchange'
);
select lives_ok(
  $$insert into public.network_links (id, organization_id, from_location_id, to_location_id, lead_time_days_p50, lead_time_days_p90)
    values ('00000000-0000-4000-8000-a12070000002', '00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12010000002', '00000000-0000-4000-8000-a12010000001', 1, 2)$$,
  'a planner inserts a network link (freight_basis defaults to none)'
);
select lives_ok(
  $$insert into public.fx_rates (id, organization_id, from_currency, to_currency, valid_from, rate)
    values ('00000000-0000-4000-8000-a12080000002', '00000000-0000-4000-8000-a12000000000', 'EUR', 'SAR', '2026-01-01', 4.1)$$,
  'a planner inserts an fx rate'
);
select lives_ok(
  $$insert into public.work_calendars (id, organization_id, code, name_en, weekend_days, observe_public_holidays)
    values ('00000000-0000-4000-8000-a12050000002', '00000000-0000-4000-8000-a12000000000', 'NO-WEEKEND', 'Seven-day site', '{}', false)$$,
  'a planner inserts a work calendar (no weekend, no country)'
);
select lives_ok(
  $$insert into public.holiday_overrides (id, organization_id, work_calendar_id, starts_on, ends_on, kind, name_en)
    values ('00000000-0000-4000-8000-a12090000002', '00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12050000001', '2026-05-01', '2026-05-01', 'working_day', 'Open day')$$,
  'a planner inserts a holiday override'
);

------------------------------------------------------------------------------------------------
-- Composite tenant foreign keys: owner A tries to point A rows at B rows
------------------------------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-a12000000001", "role": "authenticated", "email": "md12-owner-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-a12000000001';

select throws_ok(
  $$insert into public.items (organization_id, code, name_en, product_group, unit_of_measure, unit_cost, currency, brand_id)
    values ('00000000-0000-4000-8000-a12000000000', 'P-9', 'Starter', 'starter', 'EA', 10, 'SAR', '00000000-0000-4000-8000-b12030000001')$$,
  '23503', null, 'an item in A cannot use a brand from B'
);
select throws_ok(
  $$insert into public.item_interchanges (organization_id, item_id, alternate_item_id)
    values ('00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12020000003', '00000000-0000-4000-8000-b12020000001')$$,
  '23503', null, 'an interchange in A cannot reference an item from B'
);
select throws_ok(
  $$insert into public.network_links (organization_id, from_location_id, to_location_id, lead_time_days_p50, lead_time_days_p90)
    values ('00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-b12010000001', '00000000-0000-4000-8000-a12010000003', 1, 2)$$,
  '23503', null, 'a lane in A cannot start at a location in B'
);
select throws_ok(
  $$update public.locations set work_calendar_id = '00000000-0000-4000-8000-b12050000001' where id = '00000000-0000-4000-8000-a12010000001'$$,
  '23503', null, 'a location in A cannot use a calendar from B'
);
select throws_ok(
  $$update public.suppliers set work_calendar_id = '00000000-0000-4000-8000-b12050000001' where id = '00000000-0000-4000-8000-a12040000001'$$,
  '23503', null, 'a supplier in A cannot use a calendar from B'
);
select throws_ok(
  $$insert into public.holiday_overrides (organization_id, work_calendar_id, starts_on, ends_on, kind, name_en)
    values ('00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-b12050000001', '2026-07-01', '2026-07-01', 'closure', 'Foreign')$$,
  '23503', null, 'an override in A cannot reference a calendar from B'
);
reset role;

select results_eq(
  $$select
      (select count(*)::int from public.brands where organization_id = '00000000-0000-4000-8000-b12000000000' and name_en = 'Falcon'),
      (select count(*)::int from public.item_interchanges where organization_id = '00000000-0000-4000-8000-b12000000000' and priority = 2),
      (select count(*)::int from public.network_links where organization_id = '00000000-0000-4000-8000-b12000000000' and lead_time_days_p50 = 1),
      (select count(*)::int from public.fx_rates where organization_id = '00000000-0000-4000-8000-b12000000000' and rate = 0.307),
      (select count(*)::int from public.work_calendars where organization_id = '00000000-0000-4000-8000-b12000000000' and name_en = 'Saudi standard'),
      (select count(*)::int from public.holiday_overrides where organization_id = '00000000-0000-4000-8000-b12000000000' and name_en = 'Stocktake')$$,
  $$values (1, 1, 1, 1, 1, 1)$$,
  'organization B rows are intact and unchanged after the cross-tenant attempts'
);

------------------------------------------------------------------------------------------------
-- Natural keys (as postgres)
------------------------------------------------------------------------------------------------
select throws_ok(
  $$insert into public.brands (organization_id, code, name_en) values ('00000000-0000-4000-8000-a12000000000', 'FALCON', 'Falcon again')$$,
  '23505', null, 'a brand code is unique within an organization'
);
select throws_ok(
  $$insert into public.work_calendars (organization_id, code, name_en, weekend_days, observe_public_holidays)
    values ('00000000-0000-4000-8000-a12000000000', 'SA-STD', 'Duplicate', '{}', false)$$,
  '23505', null, 'a calendar code is unique within an organization'
);
select throws_ok(
  $$insert into public.network_links (organization_id, from_location_id, to_location_id, lead_time_days_p50, lead_time_days_p90)
    values ('00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12010000001', '00000000-0000-4000-8000-a12010000002', 3, 5)$$,
  '23505', null, 'a lane (from, to) is unique within an organization'
);
select throws_ok(
  $$insert into public.item_interchanges (organization_id, item_id, alternate_item_id)
    values ('00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12020000002', '00000000-0000-4000-8000-a12020000001')$$,
  '23505', null, 'the reversed interchange pair is a duplicate (one row per unordered pair)'
);
select throws_ok(
  $$insert into public.fx_rates (organization_id, from_currency, to_currency, valid_from, rate)
    values ('00000000-0000-4000-8000-a12000000000', 'USD', 'SAR', '2026-01-01', 3.76)$$,
  '23505', null, 'an fx rate is unique per (from, to, valid_from)'
);
select throws_ok(
  $$insert into public.fx_rates (organization_id, from_currency, to_currency, valid_from, rate)
    values ('00000000-0000-4000-8000-a12000000000', 'SAR', 'USD', '2026-01-01', 0.2666666667)$$,
  '23505', null, 'the reverse fx pair cannot be entered for the same date'
);
select lives_ok(
  $$insert into public.fx_rates (organization_id, from_currency, to_currency, valid_from, rate)
    values ('00000000-0000-4000-8000-a12000000000', 'SAR', 'USD', '2026-02-01', 0.2666666667)$$,
  'the reverse fx pair on another date lives'
);
select throws_ok(
  $$insert into public.holiday_overrides (organization_id, work_calendar_id, starts_on, ends_on, kind, name_en)
    values ('00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12050000001', '2026-03-01', '2026-03-01', 'working_day', 'Same start')$$,
  '23505', null, 'an override with the same scope and start is a duplicate'
);

------------------------------------------------------------------------------------------------
-- Checks (as postgres)
------------------------------------------------------------------------------------------------
select throws_ok(
  $$insert into public.item_interchanges (organization_id, item_id, alternate_item_id)
    values ('00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12020000001', '00000000-0000-4000-8000-a12020000001')$$,
  '23514', null, 'an item cannot be its own interchange'
);
select throws_ok(
  $$insert into public.item_interchanges (organization_id, item_id, alternate_item_id, priority)
    values ('00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12020000001', '00000000-0000-4000-8000-a12020000003', 0)$$,
  '23514', null, 'interchange priority is 1 to 99'
);
select throws_ok(
  $$insert into public.network_links (organization_id, from_location_id, to_location_id, lead_time_days_p50, lead_time_days_p90)
    values ('00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12010000001', '00000000-0000-4000-8000-a12010000001', 1, 2)$$,
  '23514', null, 'a lane cannot link a location to itself'
);
select throws_ok(
  $$insert into public.network_links (organization_id, from_location_id, to_location_id, lead_time_days_p50, lead_time_days_p90)
    values ('00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12010000001', '00000000-0000-4000-8000-a12010000003', 5, 3)$$,
  '23514', null, 'lane p90 cannot be below p50'
);
select throws_ok(
  $$insert into public.network_links (organization_id, from_location_id, to_location_id, lead_time_days_p50, lead_time_days_p90, freight_basis, freight_cost, currency)
    values ('00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12010000001', '00000000-0000-4000-8000-a12010000003', 1, 2, 'none', 10, null)$$,
  '23514', null, 'freight_basis none cannot carry a cost'
);
select throws_ok(
  $$insert into public.network_links (organization_id, from_location_id, to_location_id, lead_time_days_p50, lead_time_days_p90, freight_basis, freight_cost, currency)
    values ('00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12010000001', '00000000-0000-4000-8000-a12010000003', 1, 2, 'none', null, 'SAR')$$,
  '23514', null, 'freight_basis none cannot carry a currency'
);
select throws_ok(
  $$insert into public.network_links (organization_id, from_location_id, to_location_id, lead_time_days_p50, lead_time_days_p90, freight_basis, freight_cost, currency)
    values ('00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12010000001', '00000000-0000-4000-8000-a12010000003', 1, 2, 'per_unit', 10, null)$$,
  '23514', null, 'freight_basis per_unit needs a currency'
);
select throws_ok(
  $$insert into public.network_links (organization_id, from_location_id, to_location_id, lead_time_days_p50, lead_time_days_p90, freight_basis, freight_cost, currency)
    values ('00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12010000001', '00000000-0000-4000-8000-a12010000003', 1, 2, 'per_shipment', -1, 'SAR')$$,
  '23514', null, 'freight cost cannot be negative'
);
select throws_ok(
  $$insert into public.fx_rates (organization_id, from_currency, to_currency, valid_from, rate)
    values ('00000000-0000-4000-8000-a12000000000', 'SAR', 'SAR', '2026-01-01', 1)$$,
  '23514', null, 'an fx rate cannot convert a currency to itself'
);
select throws_ok(
  $$insert into public.fx_rates (organization_id, from_currency, to_currency, valid_from, rate)
    values ('00000000-0000-4000-8000-a12000000000', 'EUR', 'USD', '2026-01-01', 0)$$,
  '23514', null, 'an fx rate must be positive'
);
select throws_ok(
  $$insert into public.brands (organization_id, code, name_en, brand_type) values ('00000000-0000-4000-8000-a12000000000', 'GENERIC', 'Generic', 'generic')$$,
  '23514', null, 'brand_type is oem or aftermarket'
);
select throws_ok(
  $$insert into public.work_calendars (organization_id, code, name_en, weekend_days, observe_public_holidays)
    values ('00000000-0000-4000-8000-a12000000000', 'BAD-8', 'Bad day', '{8}', false)$$,
  '23514', null, 'weekend_days only holds ISO weekdays 1-7'
);
select throws_ok(
  $$insert into public.work_calendars (organization_id, code, name_en, weekend_days, observe_public_holidays)
    values ('00000000-0000-4000-8000-a12000000000', 'BAD-7', 'All weekend', '{1,2,3,4,5,6,7}', false)$$,
  '23514', null, 'a calendar cannot have seven weekend days'
);
select throws_ok(
  $$insert into public.work_calendars (organization_id, code, name_en, weekend_days, observe_public_holidays)
    values ('00000000-0000-4000-8000-a12000000000', 'BAD-2D', 'Two-dimensional', '{{5,6}}', false)$$,
  '23514', null, 'weekend_days must be one-dimensional'
);
select throws_ok(
  $$insert into public.work_calendars (organization_id, code, name_en, weekend_days, observe_public_holidays)
    values ('00000000-0000-4000-8000-a12000000000', 'BAD-LB', 'Lower bound', '[0:1]={5,6}', false)$$,
  '23514', null, 'weekend_days must start at index 1'
);
select throws_ok(
  $$insert into public.work_calendars (organization_id, code, name_en, weekend_days, observe_public_holidays)
    values ('00000000-0000-4000-8000-a12000000000', 'NO-COUNTRY', 'No country', '{5,6}', true)$$,
  '23514', null, 'observe_public_holidays needs a country'
);
select throws_ok(
  $$insert into public.holiday_overrides (organization_id, work_calendar_id, country_code, starts_on, ends_on, kind, name_en)
    values ('00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12050000001', 'SA', '2026-08-01', '2026-08-01', 'closure', 'Both')$$,
  '23514', null, 'an override cannot have both a calendar and a country'
);
select throws_ok(
  $$insert into public.holiday_overrides (organization_id, work_calendar_id, country_code, starts_on, ends_on, kind, name_en)
    values ('00000000-0000-4000-8000-a12000000000', null, null, '2026-08-01', '2026-08-01', 'closure', 'Neither')$$,
  '23514', null, 'an override needs a calendar or a country'
);
select throws_ok(
  $$insert into public.holiday_overrides (organization_id, work_calendar_id, starts_on, ends_on, kind, name_en)
    values ('00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12050000001', '2026-08-02', '2026-08-01', 'closure', 'Backwards')$$,
  '23514', null, 'an override cannot end before it starts'
);
select throws_ok(
  $$insert into public.holiday_overrides (organization_id, country_code, starts_on, ends_on, kind, name_en)
    values ('00000000-0000-4000-8000-a12000000000', 'AE', '2026-01-01', '2027-01-02', 'closure', 'Too long')$$,
  '23514', null, 'an override spans fewer than 366 days'
);

------------------------------------------------------------------------------------------------
-- Organizations: display preferences (as postgres)
------------------------------------------------------------------------------------------------
select lives_ok(
  $$update public.organizations set default_locale = 'ar' where id = '00000000-0000-4000-8000-a12000000000'$$,
  'setting default_locale ar while Arabic is off does not fail (the trigger steps in)'
);
select is(
  (select default_locale from public.organizations where id = '00000000-0000-4000-8000-a12000000000'),
  'en',
  'the trigger resets default_locale to en while Arabic is off'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.organizations'::regclass
      and conname = 'organizations_default_locale_requires_arabic'
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%arabic_enabled%'
  ),
  'the default_locale-requires-Arabic check backs the trigger'
);
select lives_ok(
  $$update public.organizations set default_locale = 'ar' where id = '00000000-0000-4000-8000-b12000000000'$$,
  'default_locale ar is accepted while Arabic is on'
);
select is(
  (select default_locale from public.organizations where id = '00000000-0000-4000-8000-b12000000000'),
  'ar',
  'default_locale ar is stored while Arabic is on'
);
select throws_ok(
  $$update public.organizations set default_locale = 'fr' where id = '00000000-0000-4000-8000-b12000000000'$$,
  '23514', null, 'default_locale is en or ar'
);
select throws_ok(
  $$update public.organizations set numbering_system = 'hanidec' where id = '00000000-0000-4000-8000-b12000000000'$$,
  '23514', null, 'numbering_system is latn or arab'
);
select throws_ok(
  $$update public.organizations set time_zone = '' where id = '00000000-0000-4000-8000-b12000000000'$$,
  '23514', null, 'time_zone is null or a non-empty name'
);
update public.organizations set arabic_enabled = false where id = '00000000-0000-4000-8000-b12000000000';
select is(
  (select default_locale from public.organizations where id = '00000000-0000-4000-8000-b12000000000'),
  'en',
  'turning Arabic off resets default_locale to en'
);
insert into public.organizations (id, slug, name, arabic_enabled, default_locale)
values ('00000000-0000-4000-8000-c12000000000', 'md12-org-c', 'Org C', false, 'ar');
select is(
  (select default_locale || '/' || numbering_system || '/' || coalesce(time_zone, 'null') from public.organizations where id = '00000000-0000-4000-8000-c12000000000'),
  'en/latn/null',
  'a new organization without Arabic stores en, latn and a null time zone'
);

------------------------------------------------------------------------------------------------
-- Holiday override overlaps (as postgres)
------------------------------------------------------------------------------------------------
select throws_ok(
  $$insert into public.holiday_overrides (organization_id, work_calendar_id, starts_on, ends_on, kind, name_en)
    values ('00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12050000001', '2026-03-03', '2026-03-05', 'closure', 'Overlap')$$,
  '23P01', null, 'an override overlapping another in the same calendar is refused'
);
select lives_ok(
  $$insert into public.holiday_overrides (id, organization_id, country_code, starts_on, ends_on, kind, name_en)
    values ('00000000-0000-4000-8000-a12090000003', '00000000-0000-4000-8000-a12000000000', 'SA', '2026-03-01', '2026-03-03', 'closure', 'Country stocktake')$$,
  'the same dates in a country scope live'
);
select lives_ok(
  $$insert into public.holiday_overrides (organization_id, work_calendar_id, starts_on, ends_on, kind, name_en)
    values ('00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12050000002', '2026-03-01', '2026-03-03', 'closure', 'Other calendar')$$,
  'the same dates in another calendar live'
);
select lives_ok(
  $$insert into public.holiday_overrides (organization_id, work_calendar_id, starts_on, ends_on, kind, name_en)
    values ('00000000-0000-4000-8000-a12000000000', '00000000-0000-4000-8000-a12050000001', '2026-03-04', '2026-03-05', 'closure', 'Adjacent')$$,
  'an adjacent range in the same calendar lives (ranges are inclusive)'
);
select throws_ok(
  $$insert into public.holiday_overrides (organization_id, country_code, starts_on, ends_on, kind, name_en)
    values ('00000000-0000-4000-8000-a12000000000', 'SA', '2026-02-25', '2026-03-10', 'closure', 'Covering')$$,
  '23P01', null, 'an override covering another in the same country is refused'
);
select is(
  (select scope_key from public.holiday_overrides where id = '00000000-0000-4000-8000-a12090000003'),
  'country:SA',
  'a country override has scope_key country:<code>'
);

------------------------------------------------------------------------------------------------
-- updated_at triggers (as postgres): fixture rows start in 2000, an update moves them to now()
------------------------------------------------------------------------------------------------
select is(
  (select count(*)::int from (
     select updated_at from public.brands where id = '00000000-0000-4000-8000-a12030000001'
     union all select updated_at from public.item_interchanges where id = '00000000-0000-4000-8000-a12060000001'
     union all select updated_at from public.network_links where id = '00000000-0000-4000-8000-a12070000001'
     union all select updated_at from public.fx_rates where id = '00000000-0000-4000-8000-a12080000001'
     union all select updated_at from public.work_calendars where id = '00000000-0000-4000-8000-a12050000001'
     union all select updated_at from public.holiday_overrides where id = '00000000-0000-4000-8000-a12090000001'
   ) t where updated_at = '2000-01-01T00:00:00Z'),
  6,
  'the six fixture rows of A still carry their old updated_at'
);
update public.brands set is_active = is_active where id = '00000000-0000-4000-8000-a12030000001';
update public.item_interchanges set priority = priority where id = '00000000-0000-4000-8000-a12060000001';
update public.network_links set is_active = is_active where id = '00000000-0000-4000-8000-a12070000001';
update public.fx_rates set note = 'checked' where id = '00000000-0000-4000-8000-a12080000001';
update public.work_calendars set is_active = is_active where id = '00000000-0000-4000-8000-a12050000001';
update public.holiday_overrides set note = 'checked' where id = '00000000-0000-4000-8000-a12090000001';
select is((select updated_at from public.brands where id = '00000000-0000-4000-8000-a12030000001'), now(), 'updated_at moves on brands');
select is((select updated_at from public.item_interchanges where id = '00000000-0000-4000-8000-a12060000001'), now(), 'updated_at moves on item_interchanges');
select is((select updated_at from public.network_links where id = '00000000-0000-4000-8000-a12070000001'), now(), 'updated_at moves on network_links');
select is((select updated_at from public.fx_rates where id = '00000000-0000-4000-8000-a12080000001'), now(), 'updated_at moves on fx_rates');
select is((select updated_at from public.work_calendars where id = '00000000-0000-4000-8000-a12050000001'), now(), 'updated_at moves on work_calendars');
select is((select updated_at from public.holiday_overrides where id = '00000000-0000-4000-8000-a12090000001'), now(), 'updated_at moves on holiday_overrides');

------------------------------------------------------------------------------------------------
-- Stored search_text (as postgres)
------------------------------------------------------------------------------------------------
insert into public.brands (id, organization_id, code, name_en, name_ar)
values ('00000000-0000-4000-8000-a12030000003', '00000000-0000-4000-8000-a12000000000', 'AR-1', 'Original Parts', 'قِطَعُ الأصلية');
select is(
  (select search_text from public.brands where id = '00000000-0000-4000-8000-a12030000003'),
  app.normalize_search('AR-1 Original Parts قِطَعُ الأصلية'),
  'brands.search_text is app.normalize_search(code, name_en, name_ar)'
);
select is(
  (select search_text from public.brands where id = '00000000-0000-4000-8000-a12030000003'),
  'ar 1 original parts قطع الاصليه',
  'brands.search_text is lower case with diacritics stripped and letters folded'
);
update public.brands set name_ar = 'مستشفى' where id = '00000000-0000-4000-8000-a12030000003';
select is(
  (select search_text from public.brands where id = '00000000-0000-4000-8000-a12030000003'),
  'ar 1 original parts مستشفي',
  'brands.search_text follows an update of name_ar'
);
select is(
  (select search_text from public.items where id = '00000000-0000-4000-8000-a12020000001'),
  'p 1 battery',
  'items.search_text folds code and name_en'
);
select is(
  (select search_text from public.locations where id = '00000000-0000-4000-8000-a12010000001'),
  'ruh dc riyadh dc riyadh',
  'locations.search_text includes the city'
);
select is(
  (select search_text from public.work_calendars where id = '00000000-0000-4000-8000-a12050000001'),
  'sa std saudi standard التقويم السعودي',
  'work_calendars.search_text includes the Arabic name'
);

------------------------------------------------------------------------------------------------
-- app.normalize_search fixtures, mirrored in supabase/tests/fixtures/normalize_search.json
------------------------------------------------------------------------------------------------
select is(app.normalize_search('FALCON-123'), 'falcon 123', 'normalize_search: lower case, punctuation to a space');
select is(app.normalize_search('قِطَعُ فالكون'), 'قطع فالكون', 'normalize_search: tashkeel is stripped');
select is(app.normalize_search('الأصلية'), 'الاصليه', 'normalize_search: alef with hamza folds to alef, ta marbuta to ha');
select is(app.normalize_search('مستشفى'), 'مستشفي', 'normalize_search: alef maqsura folds to ya');
select is(app.normalize_search('٤٥ ۶۷'), '45 67', 'normalize_search: Arabic-Indic and extended digits become ASCII');
select is(app.normalize_search('كـــتاب'), 'كتاب', 'normalize_search: tatweel is deleted');
select is(app.normalize_search('  A/B__c  '), 'a b c', 'normalize_search: separators collapse to one space and the ends are trimmed');
select is(app.normalize_search('ＦＡＬＣＯＮ　٧'), 'falcon 7', 'normalize_search: NFKC folds full-width letters and the ideographic space');
select is(app.normalize_search('ﻻمبة'), 'لامبه', 'normalize_search: NFKC splits the lam-alef ligature');
select is(app.normalize_search('إطار آمن'), 'اطار امن', 'normalize_search: alef with hamza below and madda fold to alef');
select is(app.normalize_search(null), '', 'normalize_search: null becomes the empty string');

select * from finish();

rollback;
