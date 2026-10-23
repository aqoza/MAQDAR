-- Step 4 master data guards:
-- * supersessions: one successor per predecessor (23505) and no cycles (MQ422, hint
--   successor_item_code); a self-loop is the existing 23514 check;
-- * location parents: no cycles (MQ422, hint parent_location_id);
-- * the demand delete guard: items and locations with demand_history cannot be deleted (MQ409) by
--   an editor or by postgres, unless the session sets zeespare.demand_guard = 'off' (the loader);
--   rows without demand delete fine and an item delete cascades its interchanges; the guard takes
--   the shared import lock zeespare.import:<organization> (Step 5a), held until the transaction ends;
-- * brands and calendars in use cannot be deleted (23503);
-- * one preferred supplier per item (23505);
-- * deleting an organization that still has demand is MQ409; after its demand is deleted the
--   organization delete cascades through every master-data table.
begin;

select plan(58);

-- Reports "<sqlstate> <hint>" for a statement that is expected to fail (run as postgres).
create function pg_temp.sqlstate_and_hint(statement text)
returns text
language plpgsql
as $$
declare
  v_state text;
  v_hint text;
begin
  execute statement;
  return 'no error';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
  return v_state || ' ' || coalesce(v_hint, '');
end;
$$;

-- The advisory locks this session holds on zeespare.import:<organization> (the key the import commit
-- steps take exclusively), as "mode:granted" ('-' when none).
create function pg_temp.import_locks(p_organization_id uuid)
returns text
language sql
as $$
  select coalesce(string_agg(l.mode || ':' || l.granted::text, ',' order by l.mode), '-')
  from pg_locks l
  cross join (select hashtextextended('zeespare.import:' || p_organization_id::text, 0) as key) as k
  where l.locktype = 'advisory'
    and l.pid = pg_backend_pid()
    and l.database = (select oid from pg_database where datname = current_database())
    and l.classid::bigint = (k.key >> 32) & 4294967295
    and l.objid::bigint = k.key & 4294967295
    and l.objsubid = 1;
$$;

------------------------------------------------------------------------------------------------
-- Fixture (as postgres). Organization A: owner and planner, items I1-I8, locations LD (demand),
-- LE (demand, location calendar), LP1-LP3 (parent chain), LX (spare); calendars CL (used by LE),
-- CS (used by supplier S2), CO (overrides only); one brand, lane, fx rate, overrides and
-- interchanges. Demand on (I4, LD) and (I8, LE). Organization B: one item, location and demand row.
------------------------------------------------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at)
values
  ('00000000-0000-4000-8000-a15000000001', 'md15-owner-a@test.local', now()),
  ('00000000-0000-4000-8000-a15000000002', 'md15-planner-a@test.local', now());
insert into public.organizations (id, slug, name)
values
  ('00000000-0000-4000-8000-a15000000000', 'md15-org-a', 'Org A'),
  ('00000000-0000-4000-8000-b15000000000', 'md15-org-b', 'Org B');
insert into public.memberships (organization_id, user_id, role)
values
  ('00000000-0000-4000-8000-a15000000000', '00000000-0000-4000-8000-a15000000001', 'owner'),
  ('00000000-0000-4000-8000-a15000000000', '00000000-0000-4000-8000-a15000000002', 'planner');

insert into public.work_calendars (id, organization_id, code, name_en, country_code, weekend_days)
values
  ('00000000-0000-4000-8000-a15050000001', '00000000-0000-4000-8000-a15000000000', 'CAL-LOC', 'Location calendar', 'SA', '{5,6}'),
  ('00000000-0000-4000-8000-a15050000002', '00000000-0000-4000-8000-a15000000000', 'CAL-SUP', 'Supplier calendar', 'SA', '{5,6}'),
  ('00000000-0000-4000-8000-a15050000003', '00000000-0000-4000-8000-a15000000000', 'CAL-OVR', 'Override-only calendar', 'SA', '{5,6}');
insert into public.locations (id, organization_id, code, name_en, location_type, country_code, timezone, work_calendar_id)
values
  ('00000000-0000-4000-8000-a15010000001', '00000000-0000-4000-8000-a15000000000', 'L-DEMAND', 'Demand branch', 'branch', 'SA', 'Asia/Riyadh', null),
  ('00000000-0000-4000-8000-a15010000002', '00000000-0000-4000-8000-a15000000000', 'L-CAL', 'Calendar branch', 'branch', 'SA', 'Asia/Riyadh', '00000000-0000-4000-8000-a15050000001'),
  ('00000000-0000-4000-8000-a15010000003', '00000000-0000-4000-8000-a15000000000', 'L-P1', 'Chain one', 'hub', 'SA', 'Asia/Riyadh', null),
  ('00000000-0000-4000-8000-a15010000004', '00000000-0000-4000-8000-a15000000000', 'L-P2', 'Chain two', 'hub', 'SA', 'Asia/Riyadh', null),
  ('00000000-0000-4000-8000-a15010000005', '00000000-0000-4000-8000-a15000000000', 'L-P3', 'Chain three', 'branch', 'SA', 'Asia/Riyadh', null),
  ('00000000-0000-4000-8000-a15010000006', '00000000-0000-4000-8000-a15000000000', 'L-SPARE', 'Spare branch', 'branch', 'SA', 'Asia/Riyadh', null),
  ('00000000-0000-4000-8000-b15010000001', '00000000-0000-4000-8000-b15000000000', 'L-DEMAND', 'Demand branch', 'branch', 'SA', 'Asia/Riyadh', null);
insert into public.brands (id, organization_id, code, name_en)
values ('00000000-0000-4000-8000-a15030000001', '00000000-0000-4000-8000-a15000000000', 'FALCON', 'Falcon');
insert into public.items (id, organization_id, code, name_en, product_group, unit_of_measure, unit_cost, currency, brand_id)
values
  ('00000000-0000-4000-8000-a15020000001', '00000000-0000-4000-8000-a15000000000', 'P-1', 'Part one', 'battery', 'EA', 10, 'SAR', '00000000-0000-4000-8000-a15030000001'),
  ('00000000-0000-4000-8000-a15020000002', '00000000-0000-4000-8000-a15000000000', 'P-2', 'Part two', 'battery', 'EA', 10, 'SAR', null),
  ('00000000-0000-4000-8000-a15020000003', '00000000-0000-4000-8000-a15000000000', 'P-3', 'Part three', 'battery', 'EA', 10, 'SAR', null),
  ('00000000-0000-4000-8000-a15020000004', '00000000-0000-4000-8000-a15000000000', 'P-4', 'Part four (demand)', 'battery', 'EA', 10, 'SAR', null),
  ('00000000-0000-4000-8000-a15020000005', '00000000-0000-4000-8000-a15000000000', 'P-5', 'Part five', 'battery', 'EA', 10, 'SAR', null),
  ('00000000-0000-4000-8000-a15020000006', '00000000-0000-4000-8000-a15000000000', 'P-6', 'Part six', 'battery', 'EA', 10, 'SAR', null),
  ('00000000-0000-4000-8000-a15020000007', '00000000-0000-4000-8000-a15000000000', 'P-7', 'Part seven', 'battery', 'EA', 10, 'SAR', null),
  ('00000000-0000-4000-8000-a15020000008', '00000000-0000-4000-8000-a15000000000', 'P-8', 'Part eight (demand)', 'battery', 'EA', 10, 'SAR', null),
  ('00000000-0000-4000-8000-b15020000001', '00000000-0000-4000-8000-b15000000000', 'P-1', 'Part one', 'battery', 'EA', 1, 'KWD', null);
insert into public.suppliers (id, organization_id, code, name_en, country_code, currency, lead_time_days_p50, lead_time_days_p90, work_calendar_id)
values
  ('00000000-0000-4000-8000-a15040000001', '00000000-0000-4000-8000-a15000000000', 'S-1', 'Supplier one', 'JP', 'JPY', 30, 45, null),
  ('00000000-0000-4000-8000-a15040000002', '00000000-0000-4000-8000-a15000000000', 'S-2', 'Supplier two', 'KR', 'USD', 20, 30, '00000000-0000-4000-8000-a15050000002');
insert into public.supplier_items (organization_id, supplier_id, item_id, lead_time_days, unit_price, currency, is_preferred)
values ('00000000-0000-4000-8000-a15000000000', '00000000-0000-4000-8000-a15040000001', '00000000-0000-4000-8000-a15020000001', 30, 1000, 'JPY', true);
insert into public.item_interchanges (id, organization_id, item_id, alternate_item_id)
values
  ('00000000-0000-4000-8000-a15060000001', '00000000-0000-4000-8000-a15000000000', '00000000-0000-4000-8000-a15020000005', '00000000-0000-4000-8000-a15020000006'),
  ('00000000-0000-4000-8000-a15060000002', '00000000-0000-4000-8000-a15000000000', '00000000-0000-4000-8000-a15020000001', '00000000-0000-4000-8000-a15020000002');
insert into public.network_links (id, organization_id, from_location_id, to_location_id, lead_time_days_p50, lead_time_days_p90)
values ('00000000-0000-4000-8000-a15070000001', '00000000-0000-4000-8000-a15000000000', '00000000-0000-4000-8000-a15010000002', '00000000-0000-4000-8000-a15010000003', 1, 2);
insert into public.fx_rates (id, organization_id, from_currency, to_currency, valid_from, rate)
values ('00000000-0000-4000-8000-a15080000001', '00000000-0000-4000-8000-a15000000000', 'USD', 'SAR', '2026-01-01', 3.75);
insert into public.holiday_overrides (id, organization_id, work_calendar_id, country_code, starts_on, ends_on, kind, name_en)
values
  ('00000000-0000-4000-8000-a15090000001', '00000000-0000-4000-8000-a15000000000', '00000000-0000-4000-8000-a15050000001', null, '2026-03-01', '2026-03-01', 'closure', 'Stocktake'),
  ('00000000-0000-4000-8000-a15090000002', '00000000-0000-4000-8000-a15000000000', '00000000-0000-4000-8000-a15050000003', null, '2026-03-01', '2026-03-01', 'closure', 'Stocktake'),
  ('00000000-0000-4000-8000-a15090000003', '00000000-0000-4000-8000-a15000000000', null, 'SA', '2026-04-01', '2026-04-02', 'working_day', 'Extra day');
insert into public.demand_history (organization_id, item_id, location_id, demand_date, quantity)
values
  ('00000000-0000-4000-8000-a15000000000', '00000000-0000-4000-8000-a15020000004', '00000000-0000-4000-8000-a15010000001', '2024-07-15', 3),
  ('00000000-0000-4000-8000-a15000000000', '00000000-0000-4000-8000-a15020000008', '00000000-0000-4000-8000-a15010000002', '2024-07-15', 5),
  ('00000000-0000-4000-8000-b15000000000', '00000000-0000-4000-8000-b15020000001', '00000000-0000-4000-8000-b15010000001', '2024-07-15', 7);

------------------------------------------------------------------------------------------------
-- As the planner of A: supersessions, location parents, deletes and preferred supplier items
------------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-a15000000002", "role": "authenticated", "email": "md15-planner-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-a15000000002';

-- Supersessions: P-1 -> P-2 -> P-3, then P-3 -> P-1 would close a cycle.
select lives_ok(
  $$insert into public.item_supersessions (organization_id, predecessor_item_id, successor_item_id, effective_on)
    values ('00000000-0000-4000-8000-a15000000000', '00000000-0000-4000-8000-a15020000001', '00000000-0000-4000-8000-a15020000002', '2025-01-01')$$,
  'a predecessor gets its first successor'
);
select throws_ok(
  $$insert into public.item_supersessions (organization_id, predecessor_item_id, successor_item_id, effective_on)
    values ('00000000-0000-4000-8000-a15000000000', '00000000-0000-4000-8000-a15020000001', '00000000-0000-4000-8000-a15020000003', '2025-02-01')$$,
  '23505', null, 'a predecessor cannot have a second successor'
);
select lives_ok(
  $$insert into public.item_supersessions (organization_id, predecessor_item_id, successor_item_id, effective_on)
    values ('00000000-0000-4000-8000-a15000000000', '00000000-0000-4000-8000-a15020000002', '00000000-0000-4000-8000-a15020000003', '2025-03-01')$$,
  'the chain continues P-2 -> P-3'
);
select throws_ok(
  $$insert into public.item_supersessions (organization_id, predecessor_item_id, successor_item_id, effective_on)
    values ('00000000-0000-4000-8000-a15000000000', '00000000-0000-4000-8000-a15020000003', '00000000-0000-4000-8000-a15020000001', '2025-04-01')$$,
  'MQ422', 'this supersession would create a cycle', 'P-3 -> P-1 closes a cycle and is MQ422'
);
select throws_ok(
  $$update public.item_supersessions set successor_item_id = '00000000-0000-4000-8000-a15020000001'
    where predecessor_item_id = '00000000-0000-4000-8000-a15020000002'$$,
  'MQ422', 'this supersession would create a cycle', 'redirecting P-2 to P-1 by update is MQ422 too'
);
select throws_ok(
  $$insert into public.item_supersessions (organization_id, predecessor_item_id, successor_item_id, effective_on)
    values ('00000000-0000-4000-8000-a15000000000', '00000000-0000-4000-8000-a15020000004', '00000000-0000-4000-8000-a15020000004', '2025-04-01')$$,
  '23514', null, 'a self-loop is refused by the existing check'
);
select lives_ok(
  $$insert into public.item_supersessions (organization_id, predecessor_item_id, successor_item_id, effective_on)
    values ('00000000-0000-4000-8000-a15000000000', '00000000-0000-4000-8000-a15020000003', '00000000-0000-4000-8000-a15020000004', '2025-05-01')$$,
  'extending the path P-3 -> P-4 lives'
);
select results_eq(
  $$select count(*)::int from public.item_supersessions where organization_id = '00000000-0000-4000-8000-a15000000000'$$,
  $$values (3)$$,
  'organization A holds exactly the path P-1 -> P-2 -> P-3 -> P-4'
);

-- Location parents: L-P1 under L-P2, then L-P2 under L-P1 (two-node) or L-P3 (three-node) is a cycle.
select lives_ok(
  $$update public.locations set parent_location_id = '00000000-0000-4000-8000-a15010000004' where id = '00000000-0000-4000-8000-a15010000003'$$,
  'L-P1 gets parent L-P2'
);
select throws_ok(
  $$update public.locations set parent_location_id = '00000000-0000-4000-8000-a15010000003' where id = '00000000-0000-4000-8000-a15010000004'$$,
  'MQ422', 'this parent would create a cycle', 'L-P2 under L-P1 is a two-node cycle and MQ422'
);
select lives_ok(
  $$update public.locations set parent_location_id = '00000000-0000-4000-8000-a15010000003' where id = '00000000-0000-4000-8000-a15010000005'$$,
  'L-P3 gets parent L-P1'
);
select throws_ok(
  $$update public.locations set parent_location_id = '00000000-0000-4000-8000-a15010000005' where id = '00000000-0000-4000-8000-a15010000004'$$,
  'MQ422', 'this parent would create a cycle', 'L-P2 under L-P3 is a three-node cycle and MQ422'
);
select throws_ok(
  $$update public.locations set parent_location_id = '00000000-0000-4000-8000-a15010000004' where id = '00000000-0000-4000-8000-a15010000004'$$,
  '23514', null, 'a location cannot be its own parent (existing check)'
);
select lives_ok(
  $$insert into public.locations (id, organization_id, code, name_en, location_type, country_code, timezone, parent_location_id)
    values ('00000000-0000-4000-8000-a15010000007', '00000000-0000-4000-8000-a15000000000', 'L-P4', 'Chain four', 'branch', 'SA', 'Asia/Riyadh', '00000000-0000-4000-8000-a15010000005')$$,
  'a new location under the chain lives'
);

-- Delete guard: rows with demand cannot be deleted; rows without demand can.
select is(pg_temp.import_locks('00000000-0000-4000-8000-a15000000000'), '-', 'no import lock is held before the first delete');
select throws_ok(
  $$delete from public.items where id = '00000000-0000-4000-8000-a15020000004'$$,
  'MQ409', null, 'an editor cannot delete an item with demand history'
);
select throws_ok(
  $$delete from public.locations where id = '00000000-0000-4000-8000-a15010000001'$$,
  'MQ409', null, 'an editor cannot delete a location with demand history'
);
select throws_ok(
  $$delete from public.items where id in ('00000000-0000-4000-8000-a15020000004', '00000000-0000-4000-8000-a15020000007')$$,
  'MQ409', null, 'a statement deleting an item with demand and one without is refused as a whole'
);
select is(
  (select count(*)::int from public.items where id = '00000000-0000-4000-8000-a15020000007'),
  1,
  'the refused statement deleted nothing'
);
select is(
  (select count(*)::int from public.item_interchanges where id = '00000000-0000-4000-8000-a15060000001'),
  1,
  'P-5 has an interchange before its delete'
);
select lives_ok(
  $$delete from public.items where id = '00000000-0000-4000-8000-a15020000005'$$,
  'an editor deletes an item without demand history'
);
select is(
  pg_temp.import_locks('00000000-0000-4000-8000-a15000000000'),
  'ShareLock:true',
  'the delete guard took zeespare.import:<organization> in share mode and holds it until the transaction ends'
);
select is(
  pg_temp.import_locks('00000000-0000-4000-8000-b15000000000'),
  '-',
  'the guard locks only the organizations of the deleted rows'
);
select is(
  (select count(*)::int from public.item_interchanges
   where '00000000-0000-4000-8000-a15020000005' in (item_id, alternate_item_id)),
  0,
  'deleting an item cascades its interchanges'
);
select lives_ok(
  $$delete from public.locations where id = '00000000-0000-4000-8000-a15010000006'$$,
  'an editor deletes a location without demand history'
);

-- Brands and calendars in use.
select throws_ok(
  $$delete from public.brands where id = '00000000-0000-4000-8000-a15030000001'$$,
  '23503', null, 'a brand used by an item cannot be deleted'
);
select throws_ok(
  $$delete from public.work_calendars where id = '00000000-0000-4000-8000-a15050000001'$$,
  '23503', null, 'a calendar used by a location cannot be deleted'
);
select throws_ok(
  $$delete from public.work_calendars where id = '00000000-0000-4000-8000-a15050000002'$$,
  '23503', null, 'a calendar used by a supplier cannot be deleted'
);
select lives_ok(
  $$delete from public.work_calendars where id = '00000000-0000-4000-8000-a15050000003'$$,
  'a calendar with only overrides can be deleted'
);
select is(
  (select count(*)::int from public.holiday_overrides where id = '00000000-0000-4000-8000-a15090000002'),
  0,
  'deleting a calendar cascades its overrides'
);

-- One preferred supplier per item.
select throws_ok(
  $$insert into public.supplier_items (organization_id, supplier_id, item_id, lead_time_days, unit_price, currency, is_preferred)
    values ('00000000-0000-4000-8000-a15000000000', '00000000-0000-4000-8000-a15040000002', '00000000-0000-4000-8000-a15020000001', 20, 9, 'USD', true)$$,
  '23505', null, 'a second preferred supplier for the same item is refused'
);
select lives_ok(
  $$insert into public.supplier_items (organization_id, supplier_id, item_id, lead_time_days, unit_price, currency, is_preferred)
    values ('00000000-0000-4000-8000-a15000000000', '00000000-0000-4000-8000-a15040000002', '00000000-0000-4000-8000-a15020000001', 20, 9, 'USD', false)$$,
  'a second, non-preferred supplier for the item lives'
);
select lives_ok(
  $$insert into public.supplier_items (organization_id, supplier_id, item_id, lead_time_days, unit_price, currency, is_preferred)
    values ('00000000-0000-4000-8000-a15000000000', '00000000-0000-4000-8000-a15040000002', '00000000-0000-4000-8000-a15020000002', 20, 9, 'USD', true)$$,
  'the same supplier can be preferred for another item'
);
reset role;

------------------------------------------------------------------------------------------------
-- As postgres: hints, the delete guard and its loader switch
------------------------------------------------------------------------------------------------
select is(
  pg_temp.sqlstate_and_hint($$insert into public.item_supersessions (organization_id, predecessor_item_id, successor_item_id, effective_on)
    values ('00000000-0000-4000-8000-a15000000000', '00000000-0000-4000-8000-a15020000004', '00000000-0000-4000-8000-a15020000001', '2025-06-01')$$),
  'MQ422 successor_item_code',
  'the supersession cycle error carries hint successor_item_code (P-4 -> P-1 closes the path)'
);
select is(
  pg_temp.sqlstate_and_hint($$update public.locations set parent_location_id = '00000000-0000-4000-8000-a15010000007' where id = '00000000-0000-4000-8000-a15010000004'$$),
  'MQ422 parent_location_id',
  'the location cycle error carries hint parent_location_id'
);
select throws_ok(
  $$delete from public.items where id = '00000000-0000-4000-8000-a15020000004'$$,
  'MQ409', null, 'postgres cannot delete an item with demand history either'
);
select throws_ok(
  $$delete from public.locations where id = '00000000-0000-4000-8000-a15010000001'$$,
  'MQ409', null, 'postgres cannot delete a location with demand history either'
);

set local zeespare.demand_guard = 'off';
select lives_ok(
  $$delete from public.items where id = '00000000-0000-4000-8000-a15020000004'$$,
  'with zeespare.demand_guard off the item with demand deletes'
);
select lives_ok(
  $$delete from public.locations where id = '00000000-0000-4000-8000-a15010000001'$$,
  'with zeespare.demand_guard off the location with demand deletes'
);
set local zeespare.demand_guard = 'on';
select throws_ok(
  $$delete from public.items where id = '00000000-0000-4000-8000-a15020000008'$$,
  'MQ409', null, 'the guard is back once the setting is no longer off'
);

------------------------------------------------------------------------------------------------
-- Organization delete (as postgres)
------------------------------------------------------------------------------------------------
select ok(
  exists (select 1 from public.brands where organization_id = '00000000-0000-4000-8000-a15000000000')
  and exists (select 1 from public.items where organization_id = '00000000-0000-4000-8000-a15000000000')
  and exists (select 1 from public.work_calendars where organization_id = '00000000-0000-4000-8000-a15000000000')
  and exists (select 1 from public.locations where organization_id = '00000000-0000-4000-8000-a15000000000')
  and exists (select 1 from public.network_links where organization_id = '00000000-0000-4000-8000-a15000000000')
  and exists (select 1 from public.holiday_overrides where organization_id = '00000000-0000-4000-8000-a15000000000')
  and exists (select 1 from public.item_interchanges where organization_id = '00000000-0000-4000-8000-a15000000000')
  and exists (select 1 from public.fx_rates where organization_id = '00000000-0000-4000-8000-a15000000000')
  and exists (select 1 from public.suppliers where organization_id = '00000000-0000-4000-8000-a15000000000')
  and exists (select 1 from public.supplier_items where organization_id = '00000000-0000-4000-8000-a15000000000')
  and exists (select 1 from public.item_supersessions where organization_id = '00000000-0000-4000-8000-a15000000000')
  and exists (select 1 from public.demand_history where organization_id = '00000000-0000-4000-8000-a15000000000'),
  'before the organization delete, A has rows in every master-data table and demand'
);
select throws_ok(
  $$delete from public.organizations where id = '00000000-0000-4000-8000-a15000000000'$$,
  'MQ409', null, 'deleting an organization that still has demand is MQ409'
);
select is(
  (select count(*)::int from public.items where organization_id = '00000000-0000-4000-8000-a15000000000'),
  6,
  'the refused organization delete left its items in place'
);

delete from public.demand_history where organization_id = '00000000-0000-4000-8000-a15000000000';
select lives_ok(
  $$delete from public.organizations where id = '00000000-0000-4000-8000-a15000000000'$$,
  'after its demand is deleted, the organization delete lives'
);
select is((select count(*)::int from public.organizations where id = '00000000-0000-4000-8000-a15000000000'), 0, 'organization A is gone');
select is((select count(*)::int from public.brands where organization_id = '00000000-0000-4000-8000-a15000000000'), 0, 'A brands are gone');
select is((select count(*)::int from public.items where organization_id = '00000000-0000-4000-8000-a15000000000'), 0, 'A items are gone');
select is((select count(*)::int from public.work_calendars where organization_id = '00000000-0000-4000-8000-a15000000000'), 0, 'A work calendars are gone');
select is((select count(*)::int from public.locations where organization_id = '00000000-0000-4000-8000-a15000000000'), 0, 'A locations are gone');
select is((select count(*)::int from public.network_links where organization_id = '00000000-0000-4000-8000-a15000000000'), 0, 'A network links are gone');
select is((select count(*)::int from public.holiday_overrides where organization_id = '00000000-0000-4000-8000-a15000000000'), 0, 'A holiday overrides are gone');
select is((select count(*)::int from public.item_interchanges where organization_id = '00000000-0000-4000-8000-a15000000000'), 0, 'A interchanges are gone');
select is((select count(*)::int from public.fx_rates where organization_id = '00000000-0000-4000-8000-a15000000000'), 0, 'A fx rates are gone');
select is((select count(*)::int from public.suppliers where organization_id = '00000000-0000-4000-8000-a15000000000'), 0, 'A suppliers are gone');
select is((select count(*)::int from public.supplier_items where organization_id = '00000000-0000-4000-8000-a15000000000'), 0, 'A supplier items are gone');
select is((select count(*)::int from public.item_supersessions where organization_id = '00000000-0000-4000-8000-a15000000000'), 0, 'A supersessions are gone');
select is((select count(*)::int from public.memberships where organization_id = '00000000-0000-4000-8000-a15000000000'), 0, 'A memberships are gone');
select results_eq(
  $$select
      (select count(*)::int from public.items where organization_id = '00000000-0000-4000-8000-b15000000000'),
      (select count(*)::int from public.locations where organization_id = '00000000-0000-4000-8000-b15000000000'),
      (select count(*)::int from public.demand_history where organization_id = '00000000-0000-4000-8000-b15000000000')$$,
  $$values (1, 1, 1)$$,
  'organization B and its demand are untouched'
);

select * from finish();

rollback;
