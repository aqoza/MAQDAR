-- Tenancy core: organizations, memberships and the RLS helper functions.
begin;

select plan(14);

select has_table('public', 'organizations', 'organizations table exists');
select has_table('public', 'memberships', 'memberships table exists');
select has_function('app', 'is_member', array['uuid'], 'app.is_member(uuid) exists');
select has_function('app', 'can_edit', array['uuid'], 'app.can_edit(uuid) exists');

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

-- Fixture: two users, two organizations, one membership each.
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
