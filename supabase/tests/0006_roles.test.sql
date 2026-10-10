-- Roles: what each of the six roles sees and may write, the set helpers behind the policies,
-- the restrictive branch-scoping policies on locations and demand_history, and the read-only
-- membership_locations table. No org_id claim anywhere in this file: every helper falls back to
-- all memberships.
begin;

select plan(93);

-- Fixture: organization A with one member per role, organization B with its own owner.
insert into auth.users (id, email, email_confirmed_at)
values
  ('00000000-0000-4000-8000-000000000001', 'owner-a@test.local', now()),
  ('00000000-0000-4000-8000-000000000002', 'admin-a@test.local', now()),
  ('00000000-0000-4000-8000-000000000003', 'planner-a@test.local', now()),
  ('00000000-0000-4000-8000-000000000004', 'approver-a@test.local', now()),
  ('00000000-0000-4000-8000-000000000005', 'branch-a@test.local', now()),
  ('00000000-0000-4000-8000-000000000006', 'viewer-a@test.local', now()),
  ('00000000-0000-4000-8000-000000000011', 'owner-b@test.local', now());
insert into public.organizations (id, slug, name)
values
  ('00000000-0000-4000-8000-0000000000aa', 'org-a', 'Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'org-b', 'Org B');
insert into public.memberships (organization_id, user_id, role)
values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-000000000002', 'admin'),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-000000000003', 'planner'),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-000000000004', 'approver'),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-000000000005', 'branch_user'),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-000000000006', 'viewer'),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-000000000011', 'owner');

-- Two locations in A (L1 central, L2 branch), one in B.
insert into public.locations (id, organization_id, code, name_en, location_type, country_code, timezone)
values
  ('00000000-0000-4000-8000-00000000aa10', '00000000-0000-4000-8000-0000000000aa', 'RUH-DC', 'Riyadh DC', 'central', 'SA', 'Asia/Riyadh'),
  ('00000000-0000-4000-8000-00000000aa11', '00000000-0000-4000-8000-0000000000aa', 'JED-01', 'Jeddah branch', 'branch', 'SA', 'Asia/Riyadh'),
  ('00000000-0000-4000-8000-00000000bb10', '00000000-0000-4000-8000-0000000000bb', 'RUH-DC', 'Riyadh DC', 'central', 'SA', 'Asia/Riyadh');
-- Two items in A, one in B.
insert into public.items (id, organization_id, code, name_en, product_group, unit_of_measure, unit_cost, currency)
values
  ('00000000-0000-4000-8000-00000000aa20', '00000000-0000-4000-8000-0000000000aa', 'P-1', 'Battery', 'battery', 'EA', 420, 'SAR'),
  ('00000000-0000-4000-8000-00000000aa21', '00000000-0000-4000-8000-0000000000aa', 'P-2', 'Battery II', 'battery', 'EA', 430, 'SAR'),
  ('00000000-0000-4000-8000-00000000bb20', '00000000-0000-4000-8000-0000000000bb', 'P-1', 'Battery', 'battery', 'EA', 1, 'KWD');
-- Demand: two rows on L1, one on L2, one in B.
insert into public.demand_history (organization_id, item_id, location_id, demand_date, quantity)
values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000aa20', '00000000-0000-4000-8000-00000000aa10', '2024-07-15', 3),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000aa21', '00000000-0000-4000-8000-00000000aa10', '2024-07-16', 4),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000aa20', '00000000-0000-4000-8000-00000000aa11', '2024-07-15', 5),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000bb20', '00000000-0000-4000-8000-00000000bb10', '2024-07-15', 7);
-- The branch_user of A is assigned L1 only.
insert into public.membership_locations (organization_id, user_id, location_id)
values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-00000000aa10');

------------------------------------------------------------------------------------------------
-- Policy structure (as postgres)
------------------------------------------------------------------------------------------------

select policies_are(
  'public', 'locations',
  array['members read', 'editors insert', 'editors update', 'editors delete', 'branch users see assigned locations'],
  'locations carries the four Step 2 policies plus the branch-scoping policy'
);
select policies_are(
  'public', 'demand_history',
  array['members read', 'editors insert', 'editors update', 'editors delete', 'branch users see assigned locations'],
  'demand_history carries the four Step 2 policies plus the branch-scoping policy'
);
select is(
  (select permissive from pg_policies where schemaname = 'public' and tablename = 'locations' and policyname = 'branch users see assigned locations'),
  'RESTRICTIVE',
  'the locations branch policy is restrictive'
);
select is(
  (select permissive from pg_policies where schemaname = 'public' and tablename = 'demand_history' and policyname = 'branch users see assigned locations'),
  'RESTRICTIVE',
  'the demand_history branch policy is restrictive'
);
select policy_cmd_is('public', 'locations', 'branch users see assigned locations', 'SELECT', 'the locations branch policy applies to select');
select policy_cmd_is('public', 'demand_history', 'branch users see assigned locations', 'SELECT', 'the demand_history branch policy applies to select');
select policy_roles_are('public', 'locations', 'branch users see assigned locations', array['authenticated'], 'the locations branch policy targets authenticated');
select policy_roles_are('public', 'demand_history', 'branch users see assigned locations', array['authenticated'], 'the demand_history branch policy targets authenticated');

select is(
  has_table_privilege('authenticated', 'public.membership_locations', 'INSERT'),
  false,
  'authenticated has no insert privilege on membership_locations'
);
select is(
  has_table_privilege('authenticated', 'public.membership_locations', 'UPDATE')
    or has_table_privilege('authenticated', 'public.membership_locations', 'DELETE'),
  false,
  'authenticated has no update or delete privilege on membership_locations'
);

------------------------------------------------------------------------------------------------
-- Owner of A
------------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "owner-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select is((select count(*)::int from public.locations), 2, 'owner sees both A locations');
select is((select count(*)::int from public.items), 2, 'owner sees both A items');
select is((select count(*)::int from public.demand_history), 3, 'owner sees all A demand');

select is(array(select app.member_organizations()), array['00000000-0000-4000-8000-0000000000aa']::uuid[], 'owner: member_organizations = {A}');
select is(array(select app.editable_organizations()), array['00000000-0000-4000-8000-0000000000aa']::uuid[], 'owner: editable_organizations = {A}');
select is(array(select app.admin_organizations()), array['00000000-0000-4000-8000-0000000000aa']::uuid[], 'owner: admin_organizations = {A}');
select is(array(select app.approving_organizations()), array['00000000-0000-4000-8000-0000000000aa']::uuid[], 'owner: approving_organizations = {A}');
select is(array(select app.unscoped_organizations()), array['00000000-0000-4000-8000-0000000000aa']::uuid[], 'owner: unscoped_organizations = {A}');
select is(array(select app.scoped_locations()), '{}'::uuid[], 'owner: scoped_locations is empty');

select lives_ok(
  $$insert into public.items (organization_id, code, name_en, product_group, unit_of_measure, unit_cost, currency)
    values ('00000000-0000-4000-8000-0000000000aa', 'P-OWNER', 'Owner part', 'battery', 'EA', 1, 'SAR')$$,
  'owner can insert an item'
);
with d as (
  update public.items set name_en = 'Tampered' where organization_id = '00000000-0000-4000-8000-0000000000bb' returning 1
)
select is(count(*)::int, 0, 'owner of A updating B items affects 0 rows') from d;
with d as (
  delete from public.items where organization_id = '00000000-0000-4000-8000-0000000000bb' returning 1
)
select is(count(*)::int, 0, 'owner of A deleting B items affects 0 rows') from d;

------------------------------------------------------------------------------------------------
-- Admin of A
------------------------------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated", "email": "admin-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';

select is((select count(*)::int from public.locations), 2, 'admin sees both A locations');
select is((select count(*)::int from public.items), 3, 'admin sees all A items (two seeded plus the owner''s)');
select is((select count(*)::int from public.demand_history), 3, 'admin sees all A demand');

select is(array(select app.member_organizations()), array['00000000-0000-4000-8000-0000000000aa']::uuid[], 'admin: member_organizations = {A}');
select is(array(select app.editable_organizations()), array['00000000-0000-4000-8000-0000000000aa']::uuid[], 'admin: editable_organizations = {A}');
select is(array(select app.admin_organizations()), array['00000000-0000-4000-8000-0000000000aa']::uuid[], 'admin: admin_organizations = {A}');
select is(array(select app.approving_organizations()), array['00000000-0000-4000-8000-0000000000aa']::uuid[], 'admin: approving_organizations = {A}');
select is(array(select app.unscoped_organizations()), array['00000000-0000-4000-8000-0000000000aa']::uuid[], 'admin: unscoped_organizations = {A}');
select is(array(select app.scoped_locations()), '{}'::uuid[], 'admin: scoped_locations is empty');

select lives_ok(
  $$insert into public.items (organization_id, code, name_en, product_group, unit_of_measure, unit_cost, currency)
    values ('00000000-0000-4000-8000-0000000000aa', 'P-ADMIN', 'Admin part', 'battery', 'EA', 1, 'SAR')$$,
  'admin can insert an item'
);
select is(
  (select count(*)::int from public.membership_locations),
  1,
  'admin reads the branch assignment row'
);
select throws_ok(
  $$insert into public.membership_locations (organization_id, user_id, location_id)
    values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-00000000aa11')$$,
  '42501',
  null,
  'admin cannot write membership_locations directly'
);

------------------------------------------------------------------------------------------------
-- Planner of A
------------------------------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "role": "authenticated", "email": "planner-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';

select is((select count(*)::int from public.locations), 2, 'planner sees both A locations');
select is((select count(*)::int from public.items), 4, 'planner sees all A items');
select is((select count(*)::int from public.demand_history), 3, 'planner sees all A demand');

select is(array(select app.member_organizations()), array['00000000-0000-4000-8000-0000000000aa']::uuid[], 'planner: member_organizations = {A}');
select is(array(select app.editable_organizations()), array['00000000-0000-4000-8000-0000000000aa']::uuid[], 'planner: editable_organizations = {A}');
select is(array(select app.admin_organizations()), '{}'::uuid[], 'planner: admin_organizations is empty');
select is(array(select app.approving_organizations()), '{}'::uuid[], 'planner: approving_organizations is empty');
select is(array(select app.unscoped_organizations()), array['00000000-0000-4000-8000-0000000000aa']::uuid[], 'planner: unscoped_organizations = {A}');
select is(array(select app.scoped_locations()), '{}'::uuid[], 'planner: scoped_locations is empty');

select lives_ok(
  $$insert into public.items (organization_id, code, name_en, product_group, unit_of_measure, unit_cost, currency)
    values ('00000000-0000-4000-8000-0000000000aa', 'P-PLANNER', 'Planner part', 'battery', 'EA', 1, 'SAR')$$,
  'planner can insert an item'
);
select is(
  (select count(*)::int from public.membership_locations),
  0,
  'planner reads no membership_locations rows'
);

------------------------------------------------------------------------------------------------
-- Approver of A
------------------------------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000004", "role": "authenticated", "email": "approver-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';

select is((select count(*)::int from public.locations), 2, 'approver sees both A locations');
select is((select count(*)::int from public.items), 5, 'approver sees all A items');
select is((select count(*)::int from public.demand_history), 3, 'approver sees all A demand');

select is(array(select app.member_organizations()), array['00000000-0000-4000-8000-0000000000aa']::uuid[], 'approver: member_organizations = {A}');
select is(array(select app.editable_organizations()), '{}'::uuid[], 'approver: editable_organizations is empty');
select is(array(select app.admin_organizations()), '{}'::uuid[], 'approver: admin_organizations is empty');
select is(array(select app.approving_organizations()), array['00000000-0000-4000-8000-0000000000aa']::uuid[], 'approver: approving_organizations = {A}');
select is(array(select app.unscoped_organizations()), array['00000000-0000-4000-8000-0000000000aa']::uuid[], 'approver: unscoped_organizations = {A}');
select is(array(select app.scoped_locations()), '{}'::uuid[], 'approver: scoped_locations is empty');

select throws_ok(
  $$insert into public.items (organization_id, code, name_en, product_group, unit_of_measure, unit_cost, currency)
    values ('00000000-0000-4000-8000-0000000000aa', 'P-APPROVER', 'Approver part', 'battery', 'EA', 1, 'SAR')$$,
  '42501',
  null,
  'approver cannot insert an item'
);
with d as (
  update public.items set name_en = 'Tampered' where organization_id = '00000000-0000-4000-8000-0000000000aa' returning 1
)
select is(count(*)::int, 0, 'approver update of A items affects 0 rows') from d;
with d as (
  delete from public.items where organization_id = '00000000-0000-4000-8000-0000000000aa' returning 1
)
select is(count(*)::int, 0, 'approver delete of A items affects 0 rows') from d;

------------------------------------------------------------------------------------------------
-- Branch user of A (assigned L1 only)
------------------------------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "role": "authenticated", "email": "branch-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000005';

select is((select count(*)::int from public.locations), 1, 'branch user sees one location');
select is((select count(*)::int from public.items), 5, 'branch user sees the whole A catalogue');
select is((select count(*)::int from public.demand_history), 2, 'branch user sees only L1 demand');
select results_eq(
  'select id::text from public.locations',
  $$values ('00000000-0000-4000-8000-00000000aa10')$$,
  'the visible location is L1'
);
select is(
  (select count(*)::int from public.demand_history where location_id <> '00000000-0000-4000-8000-00000000aa10'),
  0,
  'no demand row from another location is visible to the branch user'
);

select is(array(select app.member_organizations()), array['00000000-0000-4000-8000-0000000000aa']::uuid[], 'branch user: member_organizations = {A}');
select is(array(select app.editable_organizations()), '{}'::uuid[], 'branch user: editable_organizations is empty');
select is(array(select app.admin_organizations()), '{}'::uuid[], 'branch user: admin_organizations is empty');
select is(array(select app.approving_organizations()), '{}'::uuid[], 'branch user: approving_organizations is empty');
select is(array(select app.unscoped_organizations()), '{}'::uuid[], 'branch user: unscoped_organizations is empty');
select is(array(select app.scoped_locations()), array['00000000-0000-4000-8000-00000000aa10']::uuid[], 'branch user: scoped_locations = {L1}');

select throws_ok(
  $$insert into public.items (organization_id, code, name_en, product_group, unit_of_measure, unit_cost, currency)
    values ('00000000-0000-4000-8000-0000000000aa', 'P-BRANCH', 'Branch part', 'battery', 'EA', 1, 'SAR')$$,
  '42501',
  null,
  'branch user cannot insert an item'
);
with d as (
  update public.items set name_en = 'Tampered' where organization_id = '00000000-0000-4000-8000-0000000000aa' returning 1
)
select is(count(*)::int, 0, 'branch user update of A items affects 0 rows') from d;
with d as (
  delete from public.items where organization_id = '00000000-0000-4000-8000-0000000000aa' returning 1
)
select is(count(*)::int, 0, 'branch user delete of A items affects 0 rows') from d;

------------------------------------------------------------------------------------------------
-- Viewer of A
------------------------------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000006", "role": "authenticated", "email": "viewer-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000006';

select is((select count(*)::int from public.locations), 2, 'viewer sees both A locations');
select is((select count(*)::int from public.items), 5, 'viewer sees all A items');
select is((select count(*)::int from public.demand_history), 3, 'viewer sees all A demand');

select is(array(select app.member_organizations()), array['00000000-0000-4000-8000-0000000000aa']::uuid[], 'viewer: member_organizations = {A}');
select is(array(select app.editable_organizations()), '{}'::uuid[], 'viewer: editable_organizations is empty');
select is(array(select app.admin_organizations()), '{}'::uuid[], 'viewer: admin_organizations is empty');
select is(array(select app.approving_organizations()), '{}'::uuid[], 'viewer: approving_organizations is empty');
select is(array(select app.unscoped_organizations()), array['00000000-0000-4000-8000-0000000000aa']::uuid[], 'viewer: unscoped_organizations = {A}');
select is(array(select app.scoped_locations()), '{}'::uuid[], 'viewer: scoped_locations is empty');

select throws_ok(
  $$insert into public.items (organization_id, code, name_en, product_group, unit_of_measure, unit_cost, currency)
    values ('00000000-0000-4000-8000-0000000000aa', 'P-VIEWER', 'Viewer part', 'battery', 'EA', 1, 'SAR')$$,
  '42501',
  null,
  'viewer cannot insert an item'
);
with d as (
  update public.items set name_en = 'Tampered' where organization_id = '00000000-0000-4000-8000-0000000000aa' returning 1
)
select is(count(*)::int, 0, 'viewer update of A items affects 0 rows') from d;
with d as (
  delete from public.items where organization_id = '00000000-0000-4000-8000-0000000000aa' returning 1
)
select is(count(*)::int, 0, 'viewer delete of A items affects 0 rows') from d;

------------------------------------------------------------------------------------------------
-- Owner of B: the boundary from the other side
------------------------------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000011", "role": "authenticated", "email": "owner-b@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000011';

select is((select count(*)::int from public.locations), 1, 'owner of B sees only the B location');
select is((select count(*)::int from public.items), 1, 'owner of B sees only the B item');
select is((select count(*)::int from public.demand_history), 1, 'owner of B sees only the B demand row');

------------------------------------------------------------------------------------------------
-- Back as postgres: nothing leaked, nothing was tampered with.
------------------------------------------------------------------------------------------------
reset role;
select is(
  (select name_en from public.items where id = '00000000-0000-4000-8000-00000000bb20'),
  'Battery',
  'the B item is untouched after the cross-tenant update'
);
select is(
  (select count(*)::int from public.items where organization_id = '00000000-0000-4000-8000-0000000000aa' and name_en = 'Tampered'),
  0,
  'no A item was renamed by a read-only role'
);
select is(
  (select count(*)::int from public.items where organization_id = '00000000-0000-4000-8000-0000000000aa'),
  5,
  'A has the two seeded items plus one per editing role'
);

------------------------------------------------------------------------------------------------
-- Fail closed: a branch_user whose assignment is gone sees no locations and no demand.
------------------------------------------------------------------------------------------------
delete from public.membership_locations
where organization_id = '00000000-0000-4000-8000-0000000000aa'
  and user_id = '00000000-0000-4000-8000-000000000005';

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "role": "authenticated", "email": "branch-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000005';

select is(array(select app.scoped_locations()), '{}'::uuid[], 'unassigned branch user: scoped_locations is empty');
select is((select count(*)::int from public.locations), 0, 'unassigned branch user sees no locations');
select is((select count(*)::int from public.demand_history), 0, 'unassigned branch user sees no demand');
select is((select count(*)::int from public.items), 5, 'unassigned branch user still reads the catalogue');
reset role;

select * from finish();

rollback;
