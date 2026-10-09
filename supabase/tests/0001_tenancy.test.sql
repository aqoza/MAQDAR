-- Tenancy core: organizations, memberships and the RLS helper functions.
begin;

select plan(31);

select has_table('public', 'organizations', 'organizations table exists');
select has_table('public', 'memberships', 'memberships table exists');
select has_function('app', 'is_member', array['uuid'], 'app.is_member(uuid) exists');
select has_function('app', 'can_edit', array['uuid'], 'app.can_edit(uuid) exists');
select has_function('app', 'member_organizations', '{}'::name[], 'app.member_organizations() exists');
select has_function('app', 'editable_organizations', '{}'::name[], 'app.editable_organizations() exists');

select is(
  (select prosecdef from pg_proc where oid = 'app.is_member(uuid)'::regprocedure),
  true,
  'is_member is security definer'
);
select is(
  (select proconfig from pg_proc where oid = 'app.is_member(uuid)'::regprocedure),
  array['search_path=""'],
  'is_member runs with an empty search_path'
);
select is(
  (select prosecdef from pg_proc where oid = 'app.member_organizations()'::regprocedure),
  true,
  'member_organizations is security definer'
);
select is(
  (select proconfig from pg_proc where oid = 'app.member_organizations()'::regprocedure),
  array['search_path=""'],
  'member_organizations runs with an empty search_path'
);
select is(
  (select prosecdef from pg_proc where oid = 'app.editable_organizations()'::regprocedure),
  true,
  'editable_organizations is security definer'
);
select is(
  (select proconfig from pg_proc where oid = 'app.editable_organizations()'::regprocedure),
  array['search_path=""'],
  'editable_organizations runs with an empty search_path'
);
select ok(
  has_function_privilege('authenticated', 'app.member_organizations()', 'execute'),
  'authenticated can execute member_organizations'
);
select ok(
  has_function_privilege('authenticated', 'app.editable_organizations()', 'execute'),
  'authenticated can execute editable_organizations'
);
select ok(
  not has_function_privilege('anon', 'app.member_organizations()', 'execute'),
  'anon cannot execute member_organizations'
);
select ok(
  not has_function_privilege('anon', 'app.editable_organizations()', 'execute'),
  'anon cannot execute editable_organizations'
);

-- Fixture: three users, two organizations; A owns org A, B views org B, C belongs nowhere.
insert into auth.users (id, email)
values
  ('00000000-0000-4000-8000-00000000a001', 'owner-a@test.local'),
  ('00000000-0000-4000-8000-00000000b001', 'viewer-b@test.local'),
  ('00000000-0000-4000-8000-00000000c001', 'nobody-c@test.local');

insert into public.organizations (id, slug, name)
values
  ('00000000-0000-4000-8000-0000000000aa', 'org-a', 'Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'org-b', 'Org B');

insert into public.memberships (organization_id, user_id, role)
values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000a001', 'owner'),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000b001', 'viewer');

-- As user A (owner of org A).
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000a001';

select results_eq(
  'select slug from public.organizations order by slug',
  $$values ('org-a')$$,
  'a member sees only their own organization'
);
select results_eq(
  'select organization_id::text from public.memberships',
  $$values ('00000000-0000-4000-8000-0000000000aa')$$,
  'a member sees only memberships of their organization'
);
select is(app.is_member('00000000-0000-4000-8000-0000000000aa'), true, 'is_member is true for own organization');
select is(app.is_member('00000000-0000-4000-8000-0000000000bb'), false, 'is_member is false for another organization');
select is(app.can_edit('00000000-0000-4000-8000-0000000000aa'), true, 'owners can edit');
select results_eq(
  'select org::text from app.member_organizations() as org',
  $$values ('00000000-0000-4000-8000-0000000000aa')$$,
  'member_organizations lists the organizations the user belongs to'
);
select results_eq(
  'select org::text from app.editable_organizations() as org',
  $$values ('00000000-0000-4000-8000-0000000000aa')$$,
  'editable_organizations lists the organizations an owner may edit'
);

select throws_ok(
  $$insert into public.organizations (slug, name) values ('org-c', 'Org C')$$,
  '42501',
  null,
  'organizations cannot be created through the API in Step 2'
);

-- As user B (viewer of org B).
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000b001", "role": "authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000b001';

select is(app.can_edit('00000000-0000-4000-8000-0000000000bb'), false, 'viewers cannot edit');
select results_eq(
  'select org::text from app.member_organizations() as org',
  $$values ('00000000-0000-4000-8000-0000000000bb')$$,
  'member_organizations includes organizations where the user is a viewer'
);
select is_empty(
  'select * from app.editable_organizations()',
  'editable_organizations is empty for a viewer'
);

-- As user C (no memberships at all).
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000c001", "role": "authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000c001';

select is_empty(
  'select * from app.member_organizations()',
  'member_organizations is empty for a user without memberships'
);
select is_empty(
  'select * from app.editable_organizations()',
  'editable_organizations is empty for a user without memberships'
);
select is(
  (select count(*)::int from public.organizations),
  0,
  'a user without memberships sees no organizations'
);

-- Anonymous visitors have no privileges at all.
reset role;
set local role anon;
select throws_ok(
  'select count(*) from public.organizations',
  '42501',
  null,
  'anon cannot read organizations'
);
reset role;

select * from finish();

rollback;
