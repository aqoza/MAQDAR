-- Custom access-token hook (Step 3): catalogue shape, who may execute it, the org_id/org_role
-- claims it adds (active organization, else the earliest membership, else JSON nulls), its
-- failure behaviour (it never raises, so sign-in is never blocked) and a round trip of its output
-- through auth.uid(), app.active_organization_claim() and the claim-aware set helpers.
begin;

select plan(44);

------------------------------------------------------------------------------------------------
-- Shape
------------------------------------------------------------------------------------------------

select has_function('app', 'custom_access_token_hook', array['jsonb'], 'app.custom_access_token_hook(jsonb) exists');
select is(
  (select prosecdef from pg_proc where oid = 'app.custom_access_token_hook(jsonb)'::regprocedure),
  true,
  'the hook is security definer (the auth role needs no table privileges)'
);
select is(
  (select proconfig from pg_proc where oid = 'app.custom_access_token_hook(jsonb)'::regprocedure),
  array['search_path=""', 'lock_timeout=300ms'],
  'the hook runs with an empty search_path and a lock timeout below the 2 s statement timeout'
);
select is(
  (select l.lanname::text from pg_proc p join pg_language l on l.oid = p.prolang
   where p.oid = 'app.custom_access_token_hook(jsonb)'::regprocedure),
  'plpgsql',
  'the hook is plpgsql'
);
select is(
  (select provolatile::text from pg_proc where oid = 'app.custom_access_token_hook(jsonb)'::regprocedure),
  's',
  'the hook is stable'
);
select is(
  (select prorettype::regtype::text from pg_proc where oid = 'app.custom_access_token_hook(jsonb)'::regprocedure),
  'jsonb',
  'the hook returns jsonb'
);

------------------------------------------------------------------------------------------------
-- Privileges: only Supabase Auth (supabase_auth_admin) executes it, and it can reach schema app.
-- has_function_privilege() has no spelling for PUBLIC, so the public grant is checked on the ACL
-- itself; a null ACL would mean the default grant to PUBLIC is still in place.
------------------------------------------------------------------------------------------------

select ok(
  has_function_privilege('supabase_auth_admin', 'app.custom_access_token_hook(jsonb)', 'execute'),
  'supabase_auth_admin can execute the hook'
);
select ok(
  not has_function_privilege('anon', 'app.custom_access_token_hook(jsonb)', 'execute'),
  'anon cannot execute the hook'
);
select ok(
  not has_function_privilege('authenticated', 'app.custom_access_token_hook(jsonb)', 'execute'),
  'authenticated cannot execute the hook'
);
select ok(
  not has_function_privilege('service_role', 'app.custom_access_token_hook(jsonb)', 'execute'),
  'service_role cannot execute the hook'
);
select ok(
  (select p.proacl is not null
      and not exists (select 1 from aclexplode(p.proacl) where grantee = 0)
   from pg_proc p
   where p.oid = 'app.custom_access_token_hook(jsonb)'::regprocedure),
  'public has no execute grant on the hook (the default grant is revoked)'
);
select ok(has_schema_privilege('supabase_auth_admin', 'app', 'usage'), 'supabase_auth_admin has usage on schema app');
select ok(not has_schema_privilege('anon', 'app', 'usage'), 'anon has no usage on schema app');
select ok(has_schema_privilege('authenticated', 'app', 'usage'), 'authenticated keeps usage on schema app (set helpers)');

------------------------------------------------------------------------------------------------
-- Fixture: U1 joined A a day ago as owner and B today as viewer, and has B active. U2 belongs
-- nowhere. C exists but U1 is not a member of it.
------------------------------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at)
values
  ('00000000-0000-4000-8000-000000000001', 'hook-u1@test.local', now()),
  ('00000000-0000-4000-8000-000000000002', 'hook-nobody@test.local', now());
insert into public.organizations (id, slug, name)
values
  ('00000000-0000-4000-8000-0000000000aa', 'hook-org-a', 'Hook Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'hook-org-b', 'Hook Org B'),
  ('00000000-0000-4000-8000-0000000000cc', 'hook-org-c', 'Hook Org C');
insert into public.memberships (organization_id, user_id, role, created_at)
values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-000000000001', 'owner', now() - interval '1 day'),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-000000000001', 'viewer', now());
insert into public.user_settings (user_id, active_organization_id)
values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000bb');

-- Events shaped like the payload Supabase Auth sends for a password sign-in. Stored once so the
-- random session_id is the same on the input and output sides of every comparison.
create function pg_temp.hook_event(p_user_id text, p_email text)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'user_id', p_user_id,
    'claims', jsonb_build_object(
      'sub', p_user_id,
      'role', 'authenticated',
      'aal', 'aal1',
      'session_id', gen_random_uuid(),
      'email', p_email,
      'phone', '',
      'is_anonymous', false,
      'iss', 'http://127.0.0.1:54321/auth/v1',
      'aud', 'authenticated',
      'exp', 1900000000),
    'authentication_method', 'password');
$$;

create temporary table hook_events (name text primary key, event jsonb not null) on commit drop;
insert into hook_events (name, event)
values
  ('u1', pg_temp.hook_event('00000000-0000-4000-8000-000000000001', 'hook-u1@test.local')),
  ('nobody', pg_temp.hook_event('00000000-0000-4000-8000-000000000002', 'hook-nobody@test.local')),
  ('unknown', pg_temp.hook_event('00000000-0000-4000-8000-0000000000ff', 'hook-ghost@test.local')),
  ('nope', pg_temp.hook_event('nope', 'hook-nope@test.local')),
  ('no-claims', jsonb_build_object('user_id', '00000000-0000-4000-8000-000000000001'));

------------------------------------------------------------------------------------------------
-- Which organization goes into the token (as postgres)
------------------------------------------------------------------------------------------------

-- The active organization wins over the earlier membership.
select is(
  (select app.custom_access_token_hook(event) -> 'claims' ->> 'org_id' from hook_events where name = 'u1'),
  '00000000-0000-4000-8000-0000000000bb',
  'org_id is the active organization from user_settings'
);
select is(
  (select app.custom_access_token_hook(event) -> 'claims' ->> 'org_role' from hook_events where name = 'u1'),
  'viewer',
  'org_role is the role in the active organization'
);

-- No settings row: the earliest membership by created_at.
delete from public.user_settings where user_id = '00000000-0000-4000-8000-000000000001';
select is(
  (select app.custom_access_token_hook(event) -> 'claims' ->> 'org_id' from hook_events where name = 'u1'),
  '00000000-0000-4000-8000-0000000000aa',
  'without settings, org_id is the earliest membership'
);
select is(
  (select app.custom_access_token_hook(event) -> 'claims' ->> 'org_role' from hook_events where name = 'u1'),
  'owner',
  'without settings, org_role follows the earliest membership'
);

-- Settings pointing at an organization the user is not a member of: same fallback.
insert into public.user_settings (user_id, active_organization_id)
values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000cc');
select is(
  (select app.custom_access_token_hook(event) -> 'claims' ->> 'org_id' from hook_events where name = 'u1'),
  '00000000-0000-4000-8000-0000000000aa',
  'settings pointing at an organization the user left fall back to the earliest membership'
);
select is(
  (select app.custom_access_token_hook(event) -> 'claims' ->> 'org_role' from hook_events where name = 'u1'),
  'owner',
  'the fallback org_role matches the fallback organization'
);

-- No memberships at all: both keys are present as JSON null (never missing).
select is(
  (select app.custom_access_token_hook(event) -> 'claims' -> 'org_id' from hook_events where name = 'nobody'),
  'null'::jsonb,
  'a user without memberships gets org_id = null'
);
select is(
  (select app.custom_access_token_hook(event) -> 'claims' -> 'org_role' from hook_events where name = 'nobody'),
  'null'::jsonb,
  'a user without memberships gets org_role = null'
);

------------------------------------------------------------------------------------------------
-- Failure behaviour: never an exception, always nulls
------------------------------------------------------------------------------------------------

select lives_ok(
  $$select app.custom_access_token_hook(event) from hook_events where name = 'unknown'$$,
  'an unknown user id does not raise'
);
select is(
  (select (r -> 'claims' -> 'org_id' = 'null'::jsonb) and (r -> 'claims' -> 'org_role' = 'null'::jsonb)
   from (select app.custom_access_token_hook(event) as r from hook_events where name = 'unknown') s),
  true,
  'an unknown user id yields org_id = null and org_role = null'
);

-- The uuid cast is inside the guarded block; the hook logs a warning and degrades to nulls.
set local client_min_messages = error;
select lives_ok(
  $$select app.custom_access_token_hook(event) from hook_events where name = 'nope'$$,
  'a non-uuid user_id does not raise'
);
select is(
  (select (r -> 'claims' -> 'org_id' = 'null'::jsonb) and (r -> 'claims' -> 'org_role' = 'null'::jsonb)
   from (select app.custom_access_token_hook(event) as r from hook_events where name = 'nope') s),
  true,
  'a non-uuid user_id yields org_id = null and org_role = null'
);
reset client_min_messages;

-- An event without a claims object still comes back with one.
select ok(
  (select (r ? 'claims') and ((r -> 'claims') ?& array['org_id', 'org_role'])
   from (select app.custom_access_token_hook(event) as r from hook_events where name = 'no-claims') s),
  'an event without claims still yields a claims object with both keys'
);
select is(
  (select app.custom_access_token_hook(event) -> 'claims' ->> 'org_id' from hook_events where name = 'no-claims'),
  '00000000-0000-4000-8000-0000000000aa',
  'an event without claims still resolves the organization'
);

------------------------------------------------------------------------------------------------
-- Input claims survive untouched: the hook only adds two keys
------------------------------------------------------------------------------------------------

select ok(
  (select (r -> 'claims') ?& array['sub', 'role', 'aal', 'session_id', 'email', 'phone', 'is_anonymous', 'iss', 'aud', 'exp']
   from (select app.custom_access_token_hook(event) as r from hook_events where name = 'u1') s),
  'every input claim key survives'
);
select ok(
  (select (r -> 'claims') @> (event -> 'claims')
   from (select event, app.custom_access_token_hook(event) as r from hook_events where name = 'u1') s),
  'every input claim value is unchanged'
);
select is(
  (select app.custom_access_token_hook(event) -> 'claims' -> 'sub' from hook_events where name = 'u1'),
  (select event -> 'claims' -> 'sub' from hook_events where name = 'u1'),
  'sub is unchanged'
);
select is(
  (select count(*)::int
   from jsonb_object_keys((select app.custom_access_token_hook(event) -> 'claims' from hook_events where name = 'u1'))),
  12,
  'the hook adds exactly org_id and org_role to the ten input claims'
);
select is(
  (select array_agg(k order by k)
   from jsonb_object_keys((select app.custom_access_token_hook(event) from hook_events where name = 'u1')) as k),
  array['claims'],
  'the hook returns only the claims object'
);

------------------------------------------------------------------------------------------------
-- Round trip: the hook output, installed as the request claims, drives the Step 3 helpers
------------------------------------------------------------------------------------------------

update public.user_settings
set active_organization_id = '00000000-0000-4000-8000-0000000000bb'
where user_id = '00000000-0000-4000-8000-000000000001';

select ok(
  set_config(
    'request.jwt.claims',
    (select (app.custom_access_token_hook(event) -> 'claims')::text from hook_events where name = 'u1'),
    true
  ) is not null,
  'the hook output is installed as request.jwt.claims for the rest of the transaction'
);

set local role authenticated;

select is(
  (select auth.uid()),
  '00000000-0000-4000-8000-000000000001'::uuid,
  'auth.uid() reads the sub the hook preserved'
);
select is(
  app.active_organization_claim(),
  '00000000-0000-4000-8000-0000000000bb',
  'active_organization_claim() reads the org_id the hook added'
);
select results_eq(
  'select org::text from app.member_organizations() as org',
  $$values ('00000000-0000-4000-8000-0000000000bb')$$,
  'member_organizations() is narrowed to the active organization'
);
select is_empty(
  'select * from app.editable_organizations()',
  'editable_organizations() is empty: U1 is only a viewer in the active organization'
);
select results_eq(
  'select slug from public.organizations',
  $$values ('hook-org-b')$$,
  'row level security through the claim shows only the active organization'
);
select is(
  (select count(*)::int from public.my_organizations()),
  2,
  'my_organizations() still lists every membership regardless of the claim'
);
select is(
  (select is_active from public.my_organizations() where id = '00000000-0000-4000-8000-0000000000bb'),
  true,
  'my_organizations() marks the active organization'
);
select is(
  app.is_member('00000000-0000-4000-8000-0000000000aa'),
  true,
  'is_member() ignores the claim'
);
select throws_ok(
  $$select app.custom_access_token_hook('{}'::jsonb)$$,
  '42501',
  null,
  'authenticated cannot call the hook'
);

reset role;
set local role anon;
select throws_ok(
  $$select app.custom_access_token_hook('{}'::jsonb)$$,
  '42501',
  null,
  'anon cannot call the hook'
);
reset role;

select * from finish();

rollback;
