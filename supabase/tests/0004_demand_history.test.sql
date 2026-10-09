-- Demand history: monthly partitioning, tenant isolation through the parent and the checks.
begin;

select plan(13);

select is(
  (select relkind from pg_class where oid = 'public.demand_history'::regclass),
  'p',
  'demand_history is a partitioned table'
);
select is(
  (select partstrat from pg_partitioned_table where partrelid = 'public.demand_history'::regclass),
  'r',
  'demand_history is partitioned by range'
);
select ok(
  to_regclass('partitions.demand_history_202310') is not null
    and to_regclass('partitions.demand_history_202609') is not null
    and to_regclass('partitions.demand_history_202712') is not null,
  'monthly partitions exist for the whole 2023-2027 range'
);
select is(
  app.ensure_demand_history_partitions('2024-01-01', '2024-03-31'),
  0,
  'ensure_demand_history_partitions is idempotent for existing months'
);
select is(
  app.ensure_demand_history_partitions('2028-01-15', '2028-02-01'),
  2,
  'ensure_demand_history_partitions creates missing months'
);

-- Fixture.
insert into auth.users (id, email)
values
  ('00000000-0000-4000-8000-00000000a001', 'owner-a@test.local'),
  ('00000000-0000-4000-8000-00000000b001', 'viewer-b@test.local');
insert into public.organizations (id, slug, name)
values
  ('00000000-0000-4000-8000-0000000000aa', 'org-a', 'Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'org-b', 'Org B');
insert into public.memberships (organization_id, user_id, role)
values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000a001', 'owner'),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000b001', 'viewer');
insert into public.locations (id, organization_id, code, name_en, location_type, country_code, timezone)
values
  ('00000000-0000-4000-8000-00000000aa10', '00000000-0000-4000-8000-0000000000aa', 'RUH-DC', 'Riyadh DC', 'central', 'SA', 'Asia/Riyadh'),
  ('00000000-0000-4000-8000-00000000bb10', '00000000-0000-4000-8000-0000000000bb', 'RUH-DC', 'Riyadh DC', 'central', 'SA', 'Asia/Riyadh');
insert into public.items (id, organization_id, code, name_en, product_group, unit_of_measure, unit_cost, currency)
values
  ('00000000-0000-4000-8000-00000000aa20', '00000000-0000-4000-8000-0000000000aa', 'P-1', 'Battery', 'battery', 'EA', 420, 'SAR'),
  ('00000000-0000-4000-8000-00000000bb20', '00000000-0000-4000-8000-0000000000bb', 'P-1', 'Battery', 'battery', 'EA', 1, 'KWD');
insert into public.demand_history (organization_id, item_id, location_id, demand_date, quantity, lost_sales_quantity)
values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000aa20', '00000000-0000-4000-8000-00000000aa10', '2024-07-15', 3, 0),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000bb20', '00000000-0000-4000-8000-00000000bb10', '2024-07-15', 5, 1);

select is(
  (select count(*)::int from partitions.demand_history_202407
   where organization_id in ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000bb')),
  2,
  'rows land in the partition of their month'
);

select throws_ok(
  $$insert into public.demand_history (organization_id, item_id, location_id, demand_date, quantity, lost_sales_quantity)
    values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000aa20', '00000000-0000-4000-8000-00000000aa10', '2024-07-16', 0, 0)$$,
  '23514',
  null,
  'a row needs demand or lost sales'
);
select throws_ok(
  $$insert into public.demand_history (organization_id, item_id, location_id, demand_date, quantity)
    values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000aa20', '00000000-0000-4000-8000-00000000aa10', '2024-07-16', -1)$$,
  '23514',
  null,
  'negative quantities are rejected'
);
-- No foreign keys by design (bulk-load performance); the import path checks references.
select is(
  (select count(*)::int from pg_constraint where conrelid = 'public.demand_history'::regclass and contype = 'f'),
  0,
  'demand_history carries no foreign keys'
);

-- As the owner of organization A, through the parent table.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000a001';

select results_eq(
  'select quantity::text from public.demand_history',
  $$values ('3.000')$$,
  'owner A sees only organization A demand'
);
select lives_ok(
  $$insert into public.demand_history (organization_id, item_id, location_id, demand_date, quantity)
    values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000aa20', '00000000-0000-4000-8000-00000000aa10', '2024-07-16', 2)$$,
  'owner A can insert demand for organization A'
);
select throws_ok(
  $$insert into public.demand_history (organization_id, item_id, location_id, demand_date, quantity)
    values ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000bb20', '00000000-0000-4000-8000-00000000bb10', '2024-07-16', 2)$$,
  '42501',
  null,
  'owner A cannot insert demand for organization B'
);
select throws_ok(
  'select count(*) from partitions.demand_history_202407',
  '42501',
  null,
  'partitions are not readable directly'
);
reset role;

select * from finish();

rollback;
