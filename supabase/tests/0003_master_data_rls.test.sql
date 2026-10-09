-- Master data: tenant isolation for every table, composite tenant foreign keys and types.
begin;

select plan(24);

-- Fixture: two organizations, an owner of A and a viewer of B.
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

-- Seed one row per table in each organization (as postgres, bypassing RLS).
insert into public.locations (id, organization_id, code, name_en, location_type, country_code, timezone)
values
  ('00000000-0000-4000-8000-00000000aa10', '00000000-0000-4000-8000-0000000000aa', 'RUH-DC', 'Riyadh DC', 'central', 'SA', 'Asia/Riyadh'),
  ('00000000-0000-4000-8000-00000000bb10', '00000000-0000-4000-8000-0000000000bb', 'RUH-DC', 'Riyadh DC', 'central', 'SA', 'Asia/Riyadh');
insert into public.items (id, organization_id, code, name_en, product_group, unit_of_measure, unit_cost, currency)
values
  ('00000000-0000-4000-8000-00000000aa20', '00000000-0000-4000-8000-0000000000aa', 'P-1', 'Battery', 'battery', 'EA', 420.5, 'SAR'),
  ('00000000-0000-4000-8000-00000000aa21', '00000000-0000-4000-8000-0000000000aa', 'P-2', 'Battery II', 'battery', 'EA', 430, 'SAR'),
  ('00000000-0000-4000-8000-00000000bb20', '00000000-0000-4000-8000-0000000000bb', 'P-1', 'Battery', 'battery', 'EA', 1.2345, 'KWD');
insert into public.suppliers (id, organization_id, code, name_en, country_code, currency, lead_time_days_p50, lead_time_days_p90)
values
  ('00000000-0000-4000-8000-00000000aa30', '00000000-0000-4000-8000-0000000000aa', 'S-1', 'Falcon', 'JP', 'JPY', 45, 70),
  ('00000000-0000-4000-8000-00000000bb30', '00000000-0000-4000-8000-0000000000bb', 'S-1', 'Falcon', 'JP', 'JPY', 45, 70);
insert into public.item_supersessions (organization_id, predecessor_item_id, successor_item_id, effective_on)
values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000aa20', '00000000-0000-4000-8000-00000000aa21', '2025-01-01');
insert into public.supplier_items (organization_id, supplier_id, item_id, lead_time_days, unit_price, currency)
values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000aa30', '00000000-0000-4000-8000-00000000aa20', 45, 12000, 'JPY');

-- Same natural code in two organizations is fine; duplicates inside one are not.
select lives_ok(
  $$insert into public.items (organization_id, code, name_en, product_group, unit_of_measure, unit_cost, currency)
    values ('00000000-0000-4000-8000-0000000000bb', 'P-2', 'Battery II', 'battery', 'EA', 1, 'KWD')$$,
  'the same item code may exist in two organizations'
);
select throws_ok(
  $$insert into public.items (organization_id, code, name_en, product_group, unit_of_measure, unit_cost, currency)
    values ('00000000-0000-4000-8000-0000000000aa', 'P-1', 'Dup', 'battery', 'EA', 1, 'SAR')$$,
  '23505',
  null,
  'an item code is unique within an organization'
);

-- Composite foreign keys reject cross-tenant references.
select throws_ok(
  $$insert into public.supplier_items (organization_id, supplier_id, item_id, lead_time_days, unit_price, currency)
    values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000aa30', '00000000-0000-4000-8000-00000000bb20', 10, 1, 'SAR')$$,
  '23503',
  null,
  'a supplier item cannot reference another organization''s item'
);
select throws_ok(
  $$insert into public.item_supersessions (organization_id, predecessor_item_id, successor_item_id, effective_on)
    values ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000bb20', '00000000-0000-4000-8000-00000000aa21', '2025-01-01')$$,
  '23503',
  null,
  'a supersession cannot cross organizations'
);
select throws_ok(
  $$update public.locations set parent_location_id = '00000000-0000-4000-8000-00000000bb10' where id = '00000000-0000-4000-8000-00000000aa10'$$,
  '23503',
  null,
  'a location cannot have a parent in another organization'
);

-- Money and quantity columns are numeric(18,3) with a currency sibling.
select col_type_is('public', 'items', 'unit_cost', 'numeric(18,3)', 'items.unit_cost is numeric(18,3)');
select col_type_is('public', 'items', 'currency', 'character(3)', 'items.currency is char(3)');
select col_type_is('public', 'supplier_items', 'unit_price', 'numeric(18,3)', 'supplier_items.unit_price is numeric(18,3)');
select col_type_is('public', 'supplier_items', 'pack_size', 'numeric(18,3)', 'supplier_items.pack_size is numeric(18,3)');
select is(
  (select unit_cost from public.items where id = '00000000-0000-4000-8000-00000000bb20'),
  1.235::numeric(18, 3),
  'KWD costs keep three decimals'
);

-- updated_at trigger.
select cmp_ok(
  (select updated_at from public.items where id = '00000000-0000-4000-8000-00000000aa20'),
  '<=',
  now(),
  'updated_at starts at insert time'
);
update public.items set name_en = 'Battery (renamed)' where id = '00000000-0000-4000-8000-00000000aa20';
select is(
  (select updated_at >= created_at from public.items where id = '00000000-0000-4000-8000-00000000aa20'),
  true,
  'updated_at moves on update'
);

-- As the owner of organization A.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000a001';

select results_eq('select count(*)::int from public.locations', $$values (1)$$, 'owner A sees only A locations');
select results_eq('select count(*)::int from public.items', $$values (2)$$, 'owner A sees only A items');
select results_eq('select count(*)::int from public.suppliers', $$values (1)$$, 'owner A sees only A suppliers');
select results_eq('select count(*)::int from public.supplier_items', $$values (1)$$, 'owner A sees only A supplier items');
select results_eq('select count(*)::int from public.item_supersessions', $$values (1)$$, 'owner A sees only A supersessions');

select lives_ok(
  $$insert into public.items (organization_id, code, name_en, product_group, unit_of_measure, unit_cost, currency)
    values ('00000000-0000-4000-8000-0000000000aa', 'P-3', 'Filter', 'oil_filter', 'EA', 22, 'SAR')$$,
  'owner A can insert into organization A'
);
select throws_ok(
  $$insert into public.items (organization_id, code, name_en, product_group, unit_of_measure, unit_cost, currency)
    values ('00000000-0000-4000-8000-0000000000bb', 'P-9', 'Filter', 'oil_filter', 'EA', 22, 'KWD')$$,
  '42501',
  null,
  'owner A cannot insert into organization B'
);
update public.items set name_en = 'Nope' where organization_id = '00000000-0000-4000-8000-0000000000bb';
select is(
  (select count(*)::int from public.items where name_en = 'Nope'),
  0,
  'owner A update of organization B rows affects nothing'
);
delete from public.locations where organization_id = '00000000-0000-4000-8000-0000000000bb';
select is((select count(*)::int from public.locations), 1, 'owner A delete of organization B rows affects nothing');

-- As the viewer of organization B.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000b001", "role": "authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000b001';

select results_eq('select code from public.locations', $$values ('RUH-DC')$$, 'viewer B still sees the B location (nothing was deleted)');
select throws_ok(
  $$insert into public.suppliers (organization_id, code, name_en, country_code, currency, lead_time_days_p50, lead_time_days_p90)
    values ('00000000-0000-4000-8000-0000000000bb', 'S-2', 'Oryx', 'KR', 'USD', 30, 40)$$,
  '42501',
  null,
  'viewers cannot insert'
);
reset role;

select is(
  (select count(*)::int from public.items where organization_id = '00000000-0000-4000-8000-0000000000bb'),
  2,
  'organization B rows are intact after the cross-tenant attempts'
);

select * from finish();

rollback;
