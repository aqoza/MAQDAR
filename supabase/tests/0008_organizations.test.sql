-- Organizations and members: the Step 3 RPCs proven by SQLSTATE. create_organization and its
-- 24-hour limit, update_organization_settings, set_active_organization, user_settings isolation,
-- set_member_locations, organization_members, set_member_role and remove_member. Fixtures run as
-- postgres; every block impersonates one user through the JWT claims and returns with reset role.
begin;

select plan(73);

-- Fixture: U1 will create organizations. Organization X has an owner U2, an admin U3, a planner
-- U4, a viewer U5 and a branch user U6, plus two locations. Organization Y holds a foreign location.
insert into auth.users (id, email, email_confirmed_at)
values
  ('00000000-0000-4000-8000-000000000001', 'creator@test.local', now()),
  ('00000000-0000-4000-8000-000000000002', 'owner-x@test.local', now()),
  ('00000000-0000-4000-8000-000000000003', 'admin-x@test.local', now()),
  ('00000000-0000-4000-8000-000000000004', 'planner-x@test.local', now()),
  ('00000000-0000-4000-8000-000000000005', 'viewer-x@test.local', now()),
  ('00000000-0000-4000-8000-000000000006', 'branch-x@test.local', now());
insert into public.organizations (id, slug, name)
values
  ('00000000-0000-4000-8000-0000000000a0', 'org-x', 'Org X'),
  ('00000000-0000-4000-8000-0000000000b0', 'org-y', 'Org Y');
insert into public.memberships (organization_id, user_id, role)
values
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000002', 'owner'),
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000003', 'admin'),
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000004', 'planner'),
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000005', 'viewer'),
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000006', 'branch_user');
insert into public.locations (id, organization_id, code, name_en, location_type, country_code, timezone)
values
  ('00000000-0000-4000-8000-00000000a010', '00000000-0000-4000-8000-0000000000a0', 'RUH-DC', 'Riyadh DC', 'central', 'SA', 'Asia/Riyadh'),
  ('00000000-0000-4000-8000-00000000a011', '00000000-0000-4000-8000-0000000000a0', 'JED-BR', 'Jeddah branch', 'branch', 'SA', 'Asia/Riyadh'),
  ('00000000-0000-4000-8000-00000000b010', '00000000-0000-4000-8000-0000000000b0', 'RUH-DC', 'Riyadh DC', 'central', 'SA', 'Asia/Riyadh');
-- U5 already points at X (written as postgres, the way tooling would).
insert into public.user_settings (user_id, active_organization_id)
values ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000a0');

------------------------------------------------------------------------------------------------
-- create_organization, as U1 (no memberships yet)
------------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "creator@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select ok(
  public.create_organization('acme-parts', 'Acme Parts') is not null,
  'create_organization returns a uuid'
);
select results_eq(
  $$select created_by::text, base_currency::text, home_country::text, arabic_enabled
    from public.organizations where slug = 'acme-parts'$$,
  $$values ('00000000-0000-4000-8000-000000000001', 'SAR', 'SA', false)$$,
  'the new organization records its creator and the SAR/SA defaults'
);
select is(
  (select m.role from public.memberships m
   join public.organizations o on o.id = m.organization_id
   where o.slug = 'acme-parts' and m.user_id = '00000000-0000-4000-8000-000000000001'),
  'owner',
  'the creator gets an owner membership'
);
select is(
  (select active_organization_id from public.user_settings where user_id = '00000000-0000-4000-8000-000000000001'),
  (select id from public.organizations where slug = 'acme-parts'),
  'the new organization becomes the active one in user_settings'
);
select results_eq(
  $$select slug, role, is_active from public.my_organizations()$$,
  $$values ('acme-parts', 'owner', true)$$,
  'my_organizations shows the new organization with role owner and is_active true'
);
select throws_ok(
  $$select public.create_organization('acme-parts', 'Acme Parts again')$$,
  '23505',
  null,
  'a second organization with the same slug is a unique violation'
);
select throws_ok(
  $$select public.create_organization('acme-xxx', 'Acme XXX', 'XXX')$$,
  '23503',
  null,
  'an unknown base currency is a foreign key violation'
);
select lives_ok(
  $$select public.create_organization('acme-arabic', 'Acme Arabic', 'SAR', 'SA', true)$$,
  'creating with p_arabic_enabled true succeeds'
);
select is(
  (select arabic_enabled from public.organizations where slug = 'acme-arabic'),
  true,
  'p_arabic_enabled true sets the flag'
);
select results_eq(
  $$select slug from public.my_organizations() where is_active$$,
  $$values ('acme-arabic')$$,
  'the most recently created organization is the active one'
);
select lives_ok($$select public.create_organization('acme-3', 'Acme 3')$$, 'the third organization in 24 hours is allowed');
select lives_ok($$select public.create_organization('acme-4', 'Acme 4')$$, 'the fourth organization in 24 hours is allowed');
select lives_ok($$select public.create_organization('acme-5', 'Acme 5')$$, 'the fifth organization in 24 hours is allowed');
select is(
  (select count(*)::int from public.organizations where created_by = '00000000-0000-4000-8000-000000000001'),
  5,
  'five organizations were created by U1 in this transaction'
);
select throws_ok(
  $$select public.create_organization('acme-6', 'Acme 6')$$,
  'MQ429',
  null,
  'the sixth organization within 24 hours is MQ429'
);
select is(
  (select count(*)::int from public.organizations where created_by = '00000000-0000-4000-8000-000000000001'),
  5,
  'the rejected sixth organization was not created'
);

-- user_settings isolation: U1 and U5 both have rows, U1 sees only their own; no direct writes.
select is((select count(*)::int from public.user_settings), 1, 'a user sees only their own user_settings row');
select throws_ok(
  $$insert into public.user_settings (user_id, active_organization_id) values ('00000000-0000-4000-8000-000000000002', null)$$,
  '42501',
  null,
  'user_settings cannot be inserted directly'
);
select throws_ok(
  $$update public.user_settings set active_organization_id = null where user_id = '00000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'user_settings cannot be updated directly'
);
select throws_ok(
  $$delete from public.user_settings where user_id = '00000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'user_settings cannot be deleted directly'
);
reset role;
-- Scoped to the fixture users: a local stack that has run the app or e2e has other settings rows.
select is((select count(*)::int from public.user_settings where user_id in ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005')), 2, 'postgres sees both fixture settings rows (U1 and U5), so the count of 1 above was isolation');

------------------------------------------------------------------------------------------------
-- Not signed in: authenticated without a sub claim is MQ401; anon has no execute privilege.
------------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"role": "authenticated"}';
set local request.jwt.claim.sub = '';
select throws_ok(
  $$select public.create_organization('ghost', 'Ghost')$$,
  'MQ401',
  null,
  'create_organization without a sub claim is MQ401'
);
reset role;
set local role anon;
select throws_ok(
  $$select public.create_organization('ghost', 'Ghost')$$,
  '42501',
  null,
  'anon cannot execute create_organization at all'
);
reset role;

------------------------------------------------------------------------------------------------
-- update_organization_settings
------------------------------------------------------------------------------------------------
-- As U3 (admin of X).
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "role": "authenticated", "email": "admin-x@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
select lives_ok(
  $$select public.update_organization_settings('00000000-0000-4000-8000-0000000000a0', '  Org X Renamed  ', 'AED', 'AE', true)$$,
  'an admin updates the organization settings'
);
select results_eq(
  $$select name, base_currency::text, home_country::text, arabic_enabled
    from public.organizations where id = '00000000-0000-4000-8000-0000000000a0'$$,
  $$values ('Org X Renamed', 'AED', 'AE', true)$$,
  'the settings row changed including arabic_enabled, and the name is trimmed'
);
reset role;

-- As U4 (planner of X).
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000004", "role": "authenticated", "email": "planner-x@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';
select throws_ok(
  $$select public.update_organization_settings('00000000-0000-4000-8000-0000000000a0', 'Nope', 'SAR', 'SA', false)$$,
  'MQ403',
  null,
  'a planner cannot update the organization settings'
);
reset role;

------------------------------------------------------------------------------------------------
-- set_active_organization (and the other admin RPCs) seen from a non-member, then a member
------------------------------------------------------------------------------------------------
-- As U1 (not a member of X).
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "creator@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.update_organization_settings('00000000-0000-4000-8000-0000000000a0', 'Nope', 'SAR', 'SA', false)$$,
  'MQ403',
  null,
  'a non-member cannot update the organization settings'
);
select throws_ok(
  $$select public.set_active_organization('00000000-0000-4000-8000-0000000000a0')$$,
  'MQ403',
  null,
  'a non-member cannot activate an organization'
);
select throws_ok(
  $$select * from public.organization_members('00000000-0000-4000-8000-0000000000a0')$$,
  'MQ403',
  null,
  'a non-member cannot list members'
);
reset role;

-- As U4 (planner of X).
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000004", "role": "authenticated", "email": "planner-x@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';
select lives_ok(
  $$select public.set_active_organization('00000000-0000-4000-8000-0000000000a0')$$,
  'a member activates their organization'
);
select is(
  (select active_organization_id from public.user_settings where user_id = '00000000-0000-4000-8000-000000000004'),
  '00000000-0000-4000-8000-0000000000a0'::uuid,
  'set_active_organization writes the caller''s user_settings row'
);
reset role;

------------------------------------------------------------------------------------------------
-- set_member_locations
------------------------------------------------------------------------------------------------
-- As U3 (admin of X).
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "role": "authenticated", "email": "admin-x@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
select throws_ok(
  $$select public.set_member_locations('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000004',
      array['00000000-0000-4000-8000-00000000a010']::uuid[])$$,
  'MQ422',
  null,
  'location assignments are only for branch users (planner target is MQ422)'
);
select throws_ok(
  $$select public.set_member_locations('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000006',
      array['00000000-0000-4000-8000-00000000b010']::uuid[])$$,
  'MQ422',
  null,
  'a location of another organization is MQ422'
);
select throws_ok(
  $$select public.set_member_locations('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000006',
      array['00000000-0000-4000-8000-00000000a010', '00000000-0000-4000-8000-00000000b010']::uuid[])$$,
  'MQ422',
  null,
  'a list mixing own and foreign locations is rejected as a whole'
);
select throws_ok(
  $$select public.set_member_locations('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000001',
      array['00000000-0000-4000-8000-00000000a010']::uuid[])$$,
  'MQ404',
  null,
  'assigning locations to a non-member is MQ404'
);
select lives_ok(
  $$select public.set_member_locations('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000006',
      array['00000000-0000-4000-8000-00000000a010']::uuid[])$$,
  'an admin assigns a location to a branch user'
);
select results_eq(
  $$select location_id::text from public.membership_locations where user_id = '00000000-0000-4000-8000-000000000006'$$,
  $$values ('00000000-0000-4000-8000-00000000a010')$$,
  'the assignment is present and readable by an admin'
);
select lives_ok(
  $$select public.set_member_locations('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000006',
      array['00000000-0000-4000-8000-00000000a011', '00000000-0000-4000-8000-00000000a011']::uuid[])$$,
  'a second call replaces the assignments'
);
select results_eq(
  $$select location_id::text from public.membership_locations where user_id = '00000000-0000-4000-8000-000000000006' order by 1$$,
  $$values ('00000000-0000-4000-8000-00000000a011')$$,
  'the old assignment is gone, the new one is present once (duplicates collapsed)'
);
select throws_ok(
  $$insert into public.membership_locations (organization_id, user_id, location_id)
    values ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-00000000a010')$$,
  '42501',
  null,
  'membership_locations cannot be inserted directly'
);
reset role;

-- As U4 (planner of X).
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000004", "role": "authenticated", "email": "planner-x@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';
select throws_ok(
  $$select public.set_member_locations('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000006',
      array['00000000-0000-4000-8000-00000000a010']::uuid[])$$,
  'MQ403',
  null,
  'a planner cannot assign locations'
);
select is((select count(*)::int from public.membership_locations), 0, 'a planner reads no assignments (admins only)');
reset role;

------------------------------------------------------------------------------------------------
-- organization_members
------------------------------------------------------------------------------------------------
-- As U5 (viewer of X).
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "role": "authenticated", "email": "viewer-x@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000005';
select throws_ok(
  $$select * from public.organization_members('00000000-0000-4000-8000-0000000000a0')$$,
  'MQ403',
  null,
  'a viewer cannot list members'
);
reset role;

-- As U6 (branch user of X).
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000006", "role": "authenticated", "email": "branch-x@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000006';
select throws_ok(
  $$select * from public.organization_members('00000000-0000-4000-8000-0000000000a0')$$,
  'MQ403',
  null,
  'a branch user cannot list members'
);
reset role;

-- As U3 (admin of X).
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "role": "authenticated", "email": "admin-x@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
select results_eq(
  $$select user_id::text, email, role, location_ids::text from public.organization_members('00000000-0000-4000-8000-0000000000a0')$$,
  $$values ('00000000-0000-4000-8000-000000000002', 'owner-x@test.local', 'owner', '{}'),
           ('00000000-0000-4000-8000-000000000003', 'admin-x@test.local', 'admin', '{}'),
           ('00000000-0000-4000-8000-000000000004', 'planner-x@test.local', 'planner', '{}'),
           ('00000000-0000-4000-8000-000000000005', 'viewer-x@test.local', 'viewer', '{}'),
           ('00000000-0000-4000-8000-000000000006', 'branch-x@test.local', 'branch_user', '{00000000-0000-4000-8000-00000000a011}')$$,
  'an admin sees every member with e-mail, role and assigned location ids'
);

------------------------------------------------------------------------------------------------
-- set_member_role
------------------------------------------------------------------------------------------------
-- Still U3 (admin of X).
select throws_ok(
  $$select public.set_member_role('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000004', 'owner')$$,
  'MQ403',
  null,
  'an admin cannot grant the owner role'
);
select throws_ok(
  $$select public.set_member_role('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000002', 'admin')$$,
  'MQ403',
  null,
  'an admin cannot change an owner''s role'
);
select lives_ok(
  $$select public.set_member_role('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000005', 'approver')$$,
  'an admin changes a non-owner role'
);
select is(
  (select role from public.memberships
   where organization_id = '00000000-0000-4000-8000-0000000000a0' and user_id = '00000000-0000-4000-8000-000000000005'),
  'approver',
  'the viewer is now an approver'
);
select lives_ok(
  $$select public.set_member_role('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000005', 'viewer')$$,
  'an admin sets the role back to viewer'
);
reset role;

-- As U2 (owner of X).
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated", "email": "owner-x@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select throws_ok(
  $$select public.set_member_role('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000002', 'admin')$$,
  'MQ409',
  null,
  'the sole owner cannot demote themselves'
);
select lives_ok(
  $$select public.set_member_role('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000004', 'admin')$$,
  'an owner promotes a planner to admin'
);
select is(
  (select role from public.memberships
   where organization_id = '00000000-0000-4000-8000-0000000000a0' and user_id = '00000000-0000-4000-8000-000000000004'),
  'admin',
  'the planner is now an admin'
);
select lives_ok(
  $$select public.set_member_role('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000004', 'planner')$$,
  'an owner demotes the admin back to planner'
);
select throws_ok(
  $$select public.set_member_role('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000005', 'superuser')$$,
  'MQ422',
  null,
  'an unknown role is MQ422'
);
select throws_ok(
  $$select public.set_member_role('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000001', 'viewer')$$,
  'MQ404',
  null,
  'changing the role of a non-member is MQ404'
);
select is(
  (select count(*)::int from public.membership_locations where user_id = '00000000-0000-4000-8000-000000000006'),
  1,
  'the branch user still has one assignment before the role change'
);
select lives_ok(
  $$select public.set_member_role('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000006', 'viewer')$$,
  'an owner turns the branch user into a viewer'
);
select is(
  (select count(*)::int from public.membership_locations where user_id = '00000000-0000-4000-8000-000000000006'),
  0,
  'leaving the branch_user role deletes the location assignments'
);
reset role;

------------------------------------------------------------------------------------------------
-- remove_member
------------------------------------------------------------------------------------------------
-- As U4 (planner of X).
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000004", "role": "authenticated", "email": "planner-x@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';
select throws_ok(
  $$select public.set_member_role('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000005', 'planner')$$,
  'MQ403',
  null,
  'a planner cannot change roles'
);
select throws_ok(
  $$select public.remove_member('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000005')$$,
  'MQ403',
  null,
  'a planner cannot remove another member'
);
reset role;

-- As U3 (admin of X).
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "role": "authenticated", "email": "admin-x@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
select throws_ok(
  $$select public.remove_member('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000002')$$,
  'MQ403',
  null,
  'an admin cannot remove an owner'
);
select throws_ok(
  $$select public.remove_member('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000001')$$,
  'MQ404',
  null,
  'removing a non-member is MQ404'
);
select lives_ok(
  $$select public.remove_member('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000005')$$,
  'an admin removes a viewer'
);
select is(
  (select count(*)::int from public.memberships
   where organization_id = '00000000-0000-4000-8000-0000000000a0' and user_id = '00000000-0000-4000-8000-000000000005'),
  0,
  'the removed viewer''s membership is gone'
);
reset role;
select is(
  (select active_organization_id is null from public.user_settings where user_id = '00000000-0000-4000-8000-000000000005'),
  true,
  'removal clears the removed member''s active organization (it pointed at X)'
);

-- As U2 (owner of X, still the only owner).
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated", "email": "owner-x@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select throws_ok(
  $$select public.remove_member('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000002')$$,
  'MQ409',
  null,
  'the sole owner cannot leave'
);
reset role;

-- As U4 (planner of X), leaving.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000004", "role": "authenticated", "email": "planner-x@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';
select lives_ok(
  $$select public.remove_member('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000004')$$,
  'a member leaves the organization with their own id'
);
reset role;
select is(
  (select active_organization_id is null from public.user_settings where user_id = '00000000-0000-4000-8000-000000000004'),
  true,
  'leaving clears the active organization set earlier with set_active_organization'
);
select is(
  (select count(*)::int from public.memberships where user_id = '00000000-0000-4000-8000-000000000004'),
  0,
  'the leaving member''s membership is gone'
);

-- As U2 (owner of X): hand over, then leave.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated", "email": "owner-x@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select lives_ok(
  $$select public.set_member_role('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000003', 'owner')$$,
  'an owner promotes the admin to owner'
);
select lives_ok(
  $$select public.remove_member('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000002')$$,
  'with a second owner in place the first owner can leave'
);
reset role;
select results_eq(
  $$select user_id::text, role from public.memberships
    where organization_id = '00000000-0000-4000-8000-0000000000a0' order by user_id$$,
  $$values ('00000000-0000-4000-8000-000000000003', 'owner'),
           ('00000000-0000-4000-8000-000000000006', 'viewer')$$,
  'organization X keeps its remaining owner and viewer'
);

select * from finish();

rollback;
