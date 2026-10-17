-- REST API keys (Step 5b):
-- * structure: RLS with the one "admins read" policy, column-level SELECT for authenticated without
--   key_hash, no write privilege for authenticated, nothing at all for anon and service_role;
-- * isolation: owners and admins read their organization's keys; an admin of B, a planner and a
--   viewer of A read none of A's;
-- * create_api_key: owner and admin succeed (trimmed name, sorted distinct scopes, expiry in days);
--   planner, non-member and null organization MQ403, a stale active-organization claim MQ404,
--   signed out MQ401; MQ422 per field; MQ409 for the 21st active key (revoked and expired keys do
--   not count) and for a duplicate hash;
-- * revoke_api_key: the organization's admin revokes (revoked_by recorded), a repeat is a no-op,
--   an admin of B, a planner and unknown ids get MQ404;
-- * app.api_authorize through api_organization (as service_role): MQ401 api_key / revoked /
--   expired / creator_inactive (creator demoted, removed or gone), MQ403 scope, last_used_at at most
--   once a minute;
-- * execution rights: anon and authenticated cannot run api_*, service_role can and cannot run the
--   key RPCs, nobody but the owner can run app.api_*;
-- * the SHA-256 vector shared with apps/web/src/lib/api/keys.test.ts.
-- Everything runs in one transaction, so now() is fixed; expiry and "a minute ago" are simulated by
-- moving timestamps as postgres.
begin;

select plan(72);

------------------------------------------------------------------------------------------------
-- Helpers (created as postgres; pg_temp functions run with the privileges of the calling role)
------------------------------------------------------------------------------------------------

-- "<sqlstate> <hint>" of a statement that is expected to fail, or 'no error'.
create function pg_temp.err(statement text)
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
  return rtrim(v_state || ' ' || coalesce(v_hint, ''));
end;
$$;

-- A sample key named n (the Worker's format: maqdar_sk_ + 43 + 6 characters) and its SHA-256.
create function pg_temp.h(n text)
returns bytea
language sql
immutable
as $$
  select sha256(convert_to('maqdar_sk_' || rpad(n, 43, 'x') || 'Ab12Cd', 'UTF8'));
$$;

-- The sqlstate alone (privilege errors carry a server-specific hint).
create function pg_temp.state(statement text)
returns text
language sql
as $f$
  select split_part(pg_temp.err(statement), ' ', 1);
$f$;

-- Signs in as a user (null: signed out), optionally with an active-organization claim.
create function pg_temp.as_user(p_sub text, p_org text default null)
returns void
language sql
as $$
  select set_config('request.jwt.claims',
                    jsonb_strip_nulls(jsonb_build_object('sub', p_sub, 'role', 'authenticated', 'org_id', p_org))::text, true),
         set_config('request.jwt.claim.sub', coalesce(p_sub, ''), true);
$$;

-- create_api_key: 'ok' or "<sqlstate> <hint>".
create function pg_temp.create_key(p_org uuid, p_name text, p_scopes text[], p_days integer, p_hash bytea,
                                   p_prefix text default 'maqdar_sk_AbCd', p_last4 text default 'wxyz')
returns text
language plpgsql
as $$
declare
  v_state text;
  v_hint text;
begin
  perform public.create_api_key(p_org, p_name, p_scopes, p_days, p_hash, p_prefix, p_last4);
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
  return rtrim(v_state || ' ' || coalesce(v_hint, ''));
end;
$$;

-- api_organization: 'ok <slug> <key name>' or "<sqlstate> <hint>".
create function pg_temp.org_call(p_hash bytea)
returns text
language plpgsql
as $$
declare
  v_result json;
  v_state text;
  v_hint text;
begin
  v_result := public.api_organization(p_hash);
  return format('ok %s %s', v_result -> 'organization' ->> 'slug', v_result -> 'key' ->> 'name');
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
  return rtrim(v_state || ' ' || coalesce(v_hint, ''));
end;
$$;

------------------------------------------------------------------------------------------------
-- Fixture (as postgres). Organization A: owner, admin, planner, viewer, an admin of A and B (the
-- stale-claim case) and two admins whose keys lose their creator. Organization B: owner and admin.
-- Keys inserted directly: see the list below.
------------------------------------------------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at)
values
  ('00000000-0000-4000-8000-a22000000001', 'key22-owner-a@test.local', now()),
  ('00000000-0000-4000-8000-a22000000002', 'key22-admin-a@test.local', now()),
  ('00000000-0000-4000-8000-a22000000003', 'key22-planner-a@test.local', now()),
  ('00000000-0000-4000-8000-a22000000004', 'key22-viewer-a@test.local', now()),
  ('00000000-0000-4000-8000-a22000000005', 'key22-dual@test.local', now()),
  ('00000000-0000-4000-8000-a22000000006', 'key22-removed@test.local', now()),
  ('00000000-0000-4000-8000-a22000000007', 'key22-demoted@test.local', now()),
  ('00000000-0000-4000-8000-b22000000001', 'key22-owner-b@test.local', now()),
  ('00000000-0000-4000-8000-b22000000002', 'key22-admin-b@test.local', now());
insert into public.organizations (id, slug, name)
values
  ('00000000-0000-4000-8000-a22000000000', 'key22-org-a', 'Keys A'),
  ('00000000-0000-4000-8000-b22000000000', 'key22-org-b', 'Keys B');
insert into public.memberships (organization_id, user_id, role)
values
  ('00000000-0000-4000-8000-a22000000000', '00000000-0000-4000-8000-a22000000001', 'owner'),
  ('00000000-0000-4000-8000-a22000000000', '00000000-0000-4000-8000-a22000000002', 'admin'),
  ('00000000-0000-4000-8000-a22000000000', '00000000-0000-4000-8000-a22000000003', 'planner'),
  ('00000000-0000-4000-8000-a22000000000', '00000000-0000-4000-8000-a22000000004', 'viewer'),
  ('00000000-0000-4000-8000-a22000000000', '00000000-0000-4000-8000-a22000000005', 'admin'),
  ('00000000-0000-4000-8000-a22000000000', '00000000-0000-4000-8000-a22000000006', 'admin'),
  ('00000000-0000-4000-8000-a22000000000', '00000000-0000-4000-8000-a22000000007', 'admin'),
  ('00000000-0000-4000-8000-b22000000000', '00000000-0000-4000-8000-b22000000001', 'owner'),
  ('00000000-0000-4000-8000-b22000000000', '00000000-0000-4000-8000-b22000000002', 'admin'),
  ('00000000-0000-4000-8000-b22000000000', '00000000-0000-4000-8000-a22000000005', 'admin');

-- Keys of A: owner-all (every scope), admin-md-read (master_data:read), owner-tx-read
-- (transactions:read), revoked, expired (10 days ago), removed-creator, demoted-creator,
-- no-creator (created_by null, as after the user is deleted). Key of B: b-owner.
insert into public.api_keys (id, organization_id, name, display_prefix, last4, key_hash, scopes, created_by, created_at, expires_at)
select v.id::uuid, v.org::uuid, v.name, 'maqdar_sk_Test', 'Ab12', pg_temp.h(v.name), v.scopes, v.creator::uuid,
       v.created, v.created + interval '90 days'
from (values
  ('00000000-0000-4000-8000-a22c00000001', '00000000-0000-4000-8000-a22000000000', 'owner-all',
   array['master_data:read', 'master_data:write', 'transactions:read', 'transactions:write'],
   '00000000-0000-4000-8000-a22000000001', now()),
  ('00000000-0000-4000-8000-a22c00000002', '00000000-0000-4000-8000-a22000000000', 'admin-md-read',
   array['master_data:read'], '00000000-0000-4000-8000-a22000000002', now()),
  ('00000000-0000-4000-8000-a22c00000003', '00000000-0000-4000-8000-a22000000000', 'owner-tx-read',
   array['transactions:read'], '00000000-0000-4000-8000-a22000000001', now()),
  ('00000000-0000-4000-8000-a22c00000004', '00000000-0000-4000-8000-a22000000000', 'revoked',
   array['master_data:read'], '00000000-0000-4000-8000-a22000000001', now()),
  ('00000000-0000-4000-8000-a22c00000005', '00000000-0000-4000-8000-a22000000000', 'expired',
   array['master_data:read'], '00000000-0000-4000-8000-a22000000001', now() - interval '100 days'),
  ('00000000-0000-4000-8000-a22c00000006', '00000000-0000-4000-8000-a22000000000', 'removed-creator',
   array['master_data:read'], '00000000-0000-4000-8000-a22000000006', now()),
  ('00000000-0000-4000-8000-a22c00000007', '00000000-0000-4000-8000-a22000000000', 'demoted-creator',
   array['master_data:read'], '00000000-0000-4000-8000-a22000000007', now()),
  ('00000000-0000-4000-8000-a22c00000008', '00000000-0000-4000-8000-a22000000000', 'no-creator',
   array['master_data:read'], null, now()),
  ('00000000-0000-4000-8000-b22c00000001', '00000000-0000-4000-8000-b22000000000', 'b-owner',
   array['master_data:read', 'master_data:write', 'transactions:read', 'transactions:write'],
   '00000000-0000-4000-8000-b22000000001', now())
) as v (id, org, name, scopes, creator, created);
update public.api_keys set revoked_at = now(), revoked_by = '00000000-0000-4000-8000-a22000000001'
where id = '00000000-0000-4000-8000-a22c00000004';

------------------------------------------------------------------------------------------------
-- Structure (as postgres)
------------------------------------------------------------------------------------------------
select ok(
  (select c.relrowsecurity from pg_class c where c.oid = 'public.api_keys'::regclass),
  'api_keys has row-level security enabled'
);
select is(
  array(select format('%s %s %s', p.policyname, p.cmd, p.roles) from pg_policies p
        where p.schemaname = 'public' and p.tablename = 'api_keys'),
  array['admins read SELECT {authenticated}'],
  'api_keys has one policy: admins read, select, for authenticated'
);
select ok(
  (select p.qual ~ 'app\.admin_organizations\(\)' from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'api_keys'),
  'the policy is scoped by app.admin_organizations()'
);
select ok(
  not has_column_privilege('authenticated', 'public.api_keys', 'key_hash', 'SELECT'),
  'authenticated cannot select key_hash'
);
select is(
  array(select a.attname::text from pg_attribute a
        where a.attrelid = 'public.api_keys'::regclass and a.attnum > 0 and not a.attisdropped
          and not has_column_privilege('authenticated', 'public.api_keys', a.attname, 'SELECT')
        order by a.attnum),
  array['key_hash'],
  'authenticated can select every other column'
);
select ok(
  not has_table_privilege('authenticated', 'public.api_keys', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  and not has_any_column_privilege('authenticated', 'public.api_keys', 'INSERT, UPDATE, REFERENCES'),
  'authenticated has no table-level privilege and no column-level write privilege'
);
select is(
  array(select r from unnest(array['anon', 'service_role']) as r
        where has_table_privilege(r, 'public.api_keys', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
           or has_any_column_privilege(r, 'public.api_keys', 'SELECT, INSERT, UPDATE, REFERENCES')),
  '{}'::text[],
  'anon and service_role have no privilege on api_keys'
);

------------------------------------------------------------------------------------------------
-- Isolation (as authenticated)
------------------------------------------------------------------------------------------------
set local role authenticated;

select pg_temp.as_user('00000000-0000-4000-8000-a22000000001');
select is(
  (select format('%s %s', count(*) filter (where k.organization_id = '00000000-0000-4000-8000-a22000000000'),
                 count(*) filter (where k.organization_id <> '00000000-0000-4000-8000-a22000000000'))
   from public.api_keys k),
  '8 0',
  'the owner of A reads the 8 keys of A and none of B'
);
select is(
  pg_temp.state('select key_hash from public.api_keys'),
  '42501',
  'the owner of A cannot select key_hash'
);
select is(
  pg_temp.state('select * from public.api_keys'),
  '42501',
  'nor select * (it includes key_hash)'
);
select is(
  array[
    pg_temp.state($$insert into public.api_keys (organization_id, name, display_prefix, last4, key_hash, scopes, expires_at)
                  values ('00000000-0000-4000-8000-a22000000000', 'x', 'maqdar_sk_AbCd', 'wxyz', sha256('x'::bytea),
                          '{master_data:read}', now() + interval '1 day')$$),
    pg_temp.state($$update public.api_keys set revoked_at = now() where name = 'owner-all'$$),
    pg_temp.state($$delete from public.api_keys where name = 'owner-all'$$)],
  array['42501', '42501', '42501'],
  'the owner of A cannot insert, update or delete keys directly'
);

select pg_temp.as_user('00000000-0000-4000-8000-a22000000002');
select is(
  (select count(id)::integer from public.api_keys where organization_id = '00000000-0000-4000-8000-a22000000000'),
  8,
  'an admin of A reads the keys of A'
);

select pg_temp.as_user('00000000-0000-4000-8000-b22000000002');
select is(
  (select format('%s %s', count(*) filter (where k.organization_id = '00000000-0000-4000-8000-a22000000000'),
                 count(*) filter (where k.organization_id = '00000000-0000-4000-8000-b22000000000'))
   from public.api_keys k),
  '0 1',
  'an admin of B reads none of the keys of A (and the key of B)'
);

select pg_temp.as_user('00000000-0000-4000-8000-a22000000003');
select is((select count(id)::integer from public.api_keys), 0, 'a planner of A reads no keys');

select pg_temp.as_user('00000000-0000-4000-8000-a22000000004');
select is((select count(id)::integer from public.api_keys), 0, 'a viewer of A reads no keys');

-- The admin of A and B with the active organization B reads only the key of B.
select pg_temp.as_user('00000000-0000-4000-8000-a22000000005', '00000000-0000-4000-8000-b22000000000');
select is(
  array(select k.name from public.api_keys k order by k.name),
  array['b-owner'],
  'an admin of A and B reads only the keys of the active organization (B)'
);

------------------------------------------------------------------------------------------------
-- create_api_key
------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-a22000000001');
select is(
  pg_temp.create_key('00000000-0000-4000-8000-a22000000000', '  CI sync  ',
                     array['transactions:write', 'master_data:read', 'master_data:read'], 30, pg_temp.h('created-1'),
                     'maqdar_sk_Ci01', 'Zz99'),
  'ok',
  'the owner creates a key'
);
select is(
  (select format('%s|%s|%s|%s|%s|%s|%s|%s', k.name, k.scopes, k.display_prefix, k.last4, k.created_by,
                 k.expires_at = now() + interval '30 days', k.revoked_at is null, k.last_used_at is null)
   from public.api_keys k where k.display_prefix = 'maqdar_sk_Ci01'),
  'CI sync|{master_data:read,transactions:write}|maqdar_sk_Ci01|Zz99|00000000-0000-4000-8000-a22000000001|t|t|t',
  'the name is trimmed, scopes are stored sorted and distinct, the creator and the expiry are recorded'
);
reset role;
select is(
  (select k.key_hash from public.api_keys k where k.display_prefix = 'maqdar_sk_Ci01'),
  pg_temp.h('created-1'),
  'the hash is stored as sent (32 bytes)'
);
set local role authenticated;

select pg_temp.as_user('00000000-0000-4000-8000-a22000000002');
select is(
  pg_temp.create_key('00000000-0000-4000-8000-a22000000000', repeat('n', 80), array['master_data:write'], 366,
                     pg_temp.h('created-2'), 'maqdar_sk_Ad02', 'Zz98'),
  'ok',
  'an admin creates a key with an 80-character name that expires in 366 days'
);
select is(
  (select format('%s %s', k.created_by, k.expires_at - k.created_at) from public.api_keys k where k.display_prefix = 'maqdar_sk_Ad02'),
  '00000000-0000-4000-8000-a22000000002 366 days',
  'its creator is the admin and it expires 366 days after creation'
);

select pg_temp.as_user('00000000-0000-4000-8000-a22000000003');
select is(
  pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'x', array['master_data:read'], 30, pg_temp.h('planner')),
  'MQ403 role',
  'a planner gets MQ403 role'
);
select pg_temp.as_user('00000000-0000-4000-8000-b22000000002');
select is(
  array[
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'x', array['master_data:read'], 30, pg_temp.h('non-member')),
    pg_temp.create_key(null, 'x', array['master_data:read'], 30, pg_temp.h('null-org'))],
  array['MQ403 role', 'MQ403 role'],
  'a non-member (an admin of B) and a null organization get MQ403 role'
);
select pg_temp.as_user('00000000-0000-4000-8000-a22000000005', '00000000-0000-4000-8000-b22000000000');
select is(
  pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'x', array['master_data:read'], 30, pg_temp.h('stale')),
  'MQ404 organization_id',
  'an admin of A whose active organization is B gets MQ404 organization_id for A (stale tab)'
);
select pg_temp.as_user(null);
select is(
  pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'x', array['master_data:read'], 30, pg_temp.h('anonymous')),
  'MQ401',
  'signed out gets MQ401'
);

select pg_temp.as_user('00000000-0000-4000-8000-a22000000001');
select is(
  array[
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', '', array['master_data:read'], 30, pg_temp.h('v')),
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', '   ', array['master_data:read'], 30, pg_temp.h('v')),
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', repeat('n', 81), array['master_data:read'], 30, pg_temp.h('v')),
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'tab' || chr(9) || 'name', array['master_data:read'], 30, pg_temp.h('v')),
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'line' || chr(10) || 'break', array['master_data:read'], 30, pg_temp.h('v')),
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', null, array['master_data:read'], 30, pg_temp.h('v'))],
  array['MQ422 name', 'MQ422 name', 'MQ422 name', 'MQ422 name', 'MQ422 name', 'MQ422 name'],
  'MQ422 name: empty, blank, 81 characters, a tab, a line break, null'
);
select is(
  array[
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'x', '{}'::text[], 30, pg_temp.h('v')),
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'x', array['admin'], 30, pg_temp.h('v')),
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'x', array['MASTER_DATA:READ'], 30, pg_temp.h('v')),
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'x', array['master_data:read', null], 30, pg_temp.h('v')),
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'x', null, 30, pg_temp.h('v'))],
  array['MQ422 scopes', 'MQ422 scopes', 'MQ422 scopes', 'MQ422 scopes', 'MQ422 scopes'],
  'MQ422 scopes: empty, unknown, upper case, a null member, null'
);
select is(
  array[
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'x', array['master_data:read'], 0, pg_temp.h('v')),
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'x', array['master_data:read'], 367, pg_temp.h('v')),
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'x', array['master_data:read'], -1, pg_temp.h('v')),
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'x', array['master_data:read'], null, pg_temp.h('v'))],
  array['MQ422 expires_in_days', 'MQ422 expires_in_days', 'MQ422 expires_in_days', 'MQ422 expires_in_days'],
  'MQ422 expires_in_days: 0, 367, -1, null'
);
select is(
  array[
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'x', array['master_data:read'], 30, substring(pg_temp.h('v') from 1 for 31)),
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'x', array['master_data:read'], 30, pg_temp.h('v') || '\x00'::bytea),
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'x', array['master_data:read'], 30, ''::bytea),
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'x', array['master_data:read'], 30, null)],
  array['MQ422 key_hash', 'MQ422 key_hash', 'MQ422 key_hash', 'MQ422 key_hash'],
  'MQ422 key_hash: 31 bytes, 33 bytes, empty, null'
);
select is(
  array[
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'x', array['master_data:read'], 30, pg_temp.h('v'), 'maqdar_sk_Abc', 'wxyz'),
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'x', array['master_data:read'], 30, pg_temp.h('v'), 'maqdar_sk_Abcde', 'wxyz'),
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'x', array['master_data:read'], 30, pg_temp.h('v'), 'maqdar_pk_Abcd', 'wxyz'),
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'x', array['master_data:read'], 30, pg_temp.h('v'), 'maqdar_sk_Ab-d', 'wxyz'),
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'x', array['master_data:read'], 30, pg_temp.h('v'), null, 'wxyz')],
  array['MQ422 display_prefix', 'MQ422 display_prefix', 'MQ422 display_prefix', 'MQ422 display_prefix', 'MQ422 display_prefix'],
  'MQ422 display_prefix: 3 or 5 characters, another prefix, a dash, null'
);
select is(
  array[
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'x', array['master_data:read'], 30, pg_temp.h('v'), 'maqdar_sk_AbCd', 'wxy'),
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'x', array['master_data:read'], 30, pg_temp.h('v'), 'maqdar_sk_AbCd', 'wxyz1'),
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'x', array['master_data:read'], 30, pg_temp.h('v'), 'maqdar_sk_AbCd', 'wx_z'),
    pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'x', array['master_data:read'], 30, pg_temp.h('v'), 'maqdar_sk_AbCd', null)],
  array['MQ422 last4', 'MQ422 last4', 'MQ422 last4', 'MQ422 last4'],
  'MQ422 last4: 3 or 5 characters, an underscore, null'
);
select is(
  pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'again', array['master_data:read'], 30, pg_temp.h('created-1')),
  'MQ409 key_hash',
  'a duplicate hash gets MQ409 key_hash'
);
select is(
  pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'x-of-b', array['master_data:read'], 30, pg_temp.h('b-owner')),
  'MQ409 key_hash',
  'also when the hash belongs to a key of another organization'
);

-- 20 active keys per organization: A has 8 active keys now (owner-all, admin-md-read,
-- owner-tx-read, removed-creator, demoted-creator, no-creator and the two created above); the
-- revoked and the expired key do not count.
reset role;
select is(
  (select format('%s active, %s revoked, %s expired',
                 count(*) filter (where k.revoked_at is null and k.expires_at > now()),
                 count(*) filter (where k.revoked_at is not null),
                 count(*) filter (where k.expires_at <= now()))
   from public.api_keys k where k.organization_id = '00000000-0000-4000-8000-a22000000000'),
  '8 active, 1 revoked, 1 expired',
  'A has 8 active keys, 1 revoked and 1 expired'
);
set local role authenticated;
select is(
  array(select distinct pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'bulk ' || i, array['master_data:read'], 30,
                                           pg_temp.h('bulk-' || i), 'maqdar_sk_Bulk', lpad(i::text, 4, '0'))
        from generate_series(1, 12) as i),
  array['ok'],
  '12 more keys reach 20 active keys'
);
select is(
  pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'one too many', array['master_data:read'], 30, pg_temp.h('bulk-21')),
  'MQ409 api_keys',
  'the 21st active key gets MQ409 api_keys'
);
select is(
  pg_temp.create_key('00000000-0000-4000-8000-b22000000000', 'not mine', array['master_data:read'], 30, pg_temp.h('bulk-b')),
  'MQ403 role',
  'and the cap does not let the owner of A create keys elsewhere'
);
select lives_ok(
  $$select public.revoke_api_key((select k.id from public.api_keys k where k.name = 'bulk 1'))$$,
  'revoking one of them'
);
select is(
  pg_temp.create_key('00000000-0000-4000-8000-a22000000000', 'after revoke', array['master_data:read'], 30, pg_temp.h('bulk-21')),
  'ok',
  'frees a slot: the key is created'
);

------------------------------------------------------------------------------------------------
-- revoke_api_key
------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-b22000000002');
select is(
  array[
    pg_temp.err($$select public.revoke_api_key('00000000-0000-4000-8000-a22c00000001')$$),
    pg_temp.err($$select public.revoke_api_key('00000000-0000-4000-8000-a22c0000ffff')$$),
    pg_temp.err($$select public.revoke_api_key(null)$$)],
  array['MQ404 key_id', 'MQ404 key_id', 'MQ404 key_id'],
  'an admin of B gets MQ404 key_id for a key of A, an unknown id and null'
);
select pg_temp.as_user('00000000-0000-4000-8000-a22000000003');
select is(
  pg_temp.err($$select public.revoke_api_key('00000000-0000-4000-8000-a22c00000001')$$),
  'MQ404 key_id',
  'a planner of A gets MQ404 key_id'
);
select pg_temp.as_user('00000000-0000-4000-8000-a22000000005', '00000000-0000-4000-8000-b22000000000');
select is(
  pg_temp.err($$select public.revoke_api_key('00000000-0000-4000-8000-a22c00000001')$$),
  'MQ404 key_id',
  'an admin of A whose active organization is B gets MQ404 key_id'
);
select pg_temp.as_user(null);
select is(
  pg_temp.err($$select public.revoke_api_key('00000000-0000-4000-8000-a22c00000001')$$),
  'MQ401',
  'signed out gets MQ401'
);
reset role;
select is(
  (select k.revoked_at is null from public.api_keys k where k.id = '00000000-0000-4000-8000-a22c00000001'),
  true,
  'the key of A is still active after those attempts'
);
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-a22000000002');
select is(
  pg_temp.err($$select public.revoke_api_key((select k.id from public.api_keys k where k.display_prefix = 'maqdar_sk_Ci01'))$$),
  'no error',
  'an admin of A revokes a key the owner created'
);
select pg_temp.as_user('00000000-0000-4000-8000-a22000000001');
select is(
  pg_temp.err($$select public.revoke_api_key((select k.id from public.api_keys k where k.display_prefix = 'maqdar_sk_Ci01'))$$),
  'no error',
  'a repeat by the owner succeeds'
);
select is(
  (select format('%s %s', k.revoked_at = now(), k.revoked_by) from public.api_keys k where k.display_prefix = 'maqdar_sk_Ci01'),
  't 00000000-0000-4000-8000-a22000000002',
  'and changes nothing: revoked_at and revoked_by (the admin) stay'
);

------------------------------------------------------------------------------------------------
-- app.api_authorize, through the api_* RPCs (as service_role)
------------------------------------------------------------------------------------------------
reset role;
select pg_temp.as_user(null);
set local role service_role;

select is(
  array[pg_temp.org_call(pg_temp.h('owner-all')), pg_temp.org_call(pg_temp.h('b-owner'))],
  array['ok key22-org-a owner-all', 'ok key22-org-b b-owner'],
  'a valid key gives its own organization and key'
);
select is(
  array[
    pg_temp.org_call(sha256('maqdar_sk_unknown'::bytea)),
    pg_temp.org_call(null),
    pg_temp.org_call(substring(pg_temp.h('owner-all') from 1 for 31)),
    pg_temp.org_call(pg_temp.h('owner-all') || '\x00'::bytea),
    pg_temp.org_call(''::bytea)],
  array['MQ401 api_key', 'MQ401 api_key', 'MQ401 api_key', 'MQ401 api_key', 'MQ401 api_key'],
  'unknown, null and malformed hashes (31, 33 and 0 bytes) get MQ401 api_key'
);
select is(
  array[pg_temp.org_call(pg_temp.h('revoked')), pg_temp.org_call(pg_temp.h('expired')),
        pg_temp.org_call((select pg_temp.h('created-1')))],
  array['MQ401 revoked', 'MQ401 expired', 'MQ401 revoked'],
  'a revoked key gets MQ401 revoked and an expired key MQ401 expired (also a key revoked through the RPC)'
);
select is(
  array[pg_temp.org_call(pg_temp.h('removed-creator')), pg_temp.org_call(pg_temp.h('demoted-creator')),
        pg_temp.org_call(pg_temp.h('no-creator'))],
  array['ok key22-org-a removed-creator', 'ok key22-org-a demoted-creator', 'MQ401 creator_inactive'],
  'keys of current admins work; a key without a creator gets MQ401 creator_inactive'
);

reset role;
delete from public.memberships
where organization_id = '00000000-0000-4000-8000-a22000000000' and user_id = '00000000-0000-4000-8000-a22000000006';
update public.memberships set role = 'planner'
where organization_id = '00000000-0000-4000-8000-a22000000000' and user_id = '00000000-0000-4000-8000-a22000000007';
set local role service_role;
select is(
  array[pg_temp.org_call(pg_temp.h('removed-creator')), pg_temp.org_call(pg_temp.h('demoted-creator'))],
  array['MQ401 creator_inactive', 'MQ401 creator_inactive'],
  'a key stops at once when its creator is removed from the organization or demoted to planner'
);
select is(
  pg_temp.err($$select public.api_list(pg_temp.h('demoted-creator'), 'items')$$),
  'MQ401 creator_inactive',
  'for every api_* RPC (api_list)'
);
reset role;
update public.memberships set role = 'admin'
where organization_id = '00000000-0000-4000-8000-a22000000000' and user_id = '00000000-0000-4000-8000-a22000000007';
set local role service_role;
select is(
  pg_temp.org_call(pg_temp.h('demoted-creator')),
  'ok key22-org-a demoted-creator',
  'and works again once the creator is an admin again'
);

-- Scopes: write does not imply read; api_organization accepts any valid key.
select is(
  array[
    pg_temp.err($$select public.api_list_demand(pg_temp.h('admin-md-read'), current_date - 7, current_date)$$),
    pg_temp.err($$select public.api_list(pg_temp.h('owner-tx-read'), 'items')$$),
    pg_temp.err($$select public.api_upsert(pg_temp.h('admin-md-read'), 'brands', '{"records": [{"brand_code": "X", "name_en": "X"}]}', gen_random_uuid())$$),
    pg_temp.err($$select public.api_upsert(pg_temp.h('owner-tx-read'), 'demand_history', '{"records": []}', gen_random_uuid())$$),
    pg_temp.err($$select public.api_list(pg_temp.h('created-2'), 'items')$$)],
  array['MQ403 scope', 'MQ403 scope', 'MQ403 scope', 'MQ403 scope', 'MQ403 scope'],
  'a key without the scope gets MQ403 scope (master data read, transactions read, both writes; write does not imply read)'
);
select is(
  array[pg_temp.org_call(pg_temp.h('owner-tx-read')), pg_temp.org_call(pg_temp.h('admin-md-read'))],
  array['ok key22-org-a owner-tx-read', 'ok key22-org-a admin-md-read'],
  'api_organization accepts a key with any scope'
);

-- last_used_at: set on first use, then at most once a minute.
reset role;
update public.api_keys set last_used_at = null where name = 'owner-tx-read';
set local role service_role;
select pg_temp.org_call(pg_temp.h('owner-tx-read')) is not null as used;
reset role;
select is(
  (select k.last_used_at = now() from public.api_keys k where k.name = 'owner-tx-read'),
  true,
  'the first use sets last_used_at'
);
update public.api_keys set last_used_at = now() - interval '59 seconds' where name = 'owner-tx-read';
set local role service_role;
select pg_temp.org_call(pg_temp.h('owner-tx-read')) is not null as used;
reset role;
select is(
  (select k.last_used_at = now() - interval '59 seconds' from public.api_keys k where k.name = 'owner-tx-read'),
  true,
  'a use within a minute leaves it unchanged'
);
update public.api_keys set last_used_at = now() - interval '61 seconds' where name = 'owner-tx-read';
set local role service_role;
select pg_temp.org_call(pg_temp.h('owner-tx-read')) is not null as used;
reset role;
select is(
  (select k.last_used_at = now() from public.api_keys k where k.name = 'owner-tx-read'),
  true,
  'a use more than a minute later records it again'
);
select is(
  (select k.last_used_at from public.api_keys k where k.name = 'revoked'),
  null,
  'a refused key records no use'
);

------------------------------------------------------------------------------------------------
-- Execution rights (as postgres, then as each API role)
------------------------------------------------------------------------------------------------
select is(
  array(select format('%s %s', r, p.proname)
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        cross join unnest(array['anon', 'authenticated']) as r
        where n.nspname = 'public' and p.proname in ('api_organization', 'api_list', 'api_list_demand', 'api_upsert')
          and has_function_privilege(r, p.oid, 'EXECUTE')
        order by 1),
  '{}'::text[],
  'anon and authenticated cannot execute api_organization, api_list, api_list_demand or api_upsert'
);
select is(
  (select count(*)::integer
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('api_organization', 'api_list', 'api_list_demand', 'api_upsert')
     and has_function_privilege('service_role', p.oid, 'EXECUTE')),
  4,
  'service_role can execute the four api_* RPCs'
);
select is(
  array(select format('%s %s', r, p.proname)
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        cross join unnest(array['anon', 'service_role']) as r
        where n.nspname = 'public' and p.proname in ('create_api_key', 'revoke_api_key')
          and has_function_privilege(r, p.oid, 'EXECUTE')
        order by 1),
  '{}'::text[],
  'anon and service_role cannot execute create_api_key or revoke_api_key'
);
select ok(
  has_function_privilege('authenticated', 'public.create_api_key(uuid, text, text[], integer, bytea, text, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.revoke_api_key(uuid)', 'EXECUTE'),
  'authenticated can execute create_api_key and revoke_api_key'
);
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname like 'api\_%'),
  10,
  'there are 10 internal app.api_* functions'
);
select is(
  array(select p.oid::regprocedure::text
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname like 'api\_%'
          and (p.proacl is null
               or exists (select 1 from aclexplode(p.proacl) as a where a.grantee <> p.proowner))
        order by 1),
  '{}'::text[],
  'nobody but their owner can execute them (no PUBLIC, anon, authenticated or service_role grant)'
);

set local role anon;
select is(
  pg_temp.state($$select public.api_organization('\x00')$$),
  '42501',
  'anon calling api_organization gets 42501'
);
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-a22000000001');
select is(
  array[
    pg_temp.state($$select public.api_organization(pg_temp.h('owner-all'))$$),
    pg_temp.state($$select public.api_upsert(pg_temp.h('owner-all'), 'brands', '{"records": [{"brand_code": "X", "name_en": "X"}]}', gen_random_uuid())$$),
    pg_temp.state($$select app.api_authorize(pg_temp.h('owner-all'), null)$$)],
  array['42501', '42501', '42501'],
  'the owner of A, signed in, gets 42501 calling api_organization, api_upsert or app.api_authorize'
);
reset role;
set local role service_role;
select is(
  array[
    pg_temp.state($$select app.api_authorize(pg_temp.h('owner-all'), null)$$),
    pg_temp.state($$select app.api_limits()$$),
    pg_temp.state($$select public.create_api_key('00000000-0000-4000-8000-a22000000000', 'x', '{master_data:read}', 30, sha256('x'::bytea), 'maqdar_sk_AbCd', 'wxyz')$$),
    pg_temp.state($$select count(id) from public.api_keys$$)],
  array['42501', '42501', '42501', '42501'],
  'service_role gets 42501 for app.api_*, create_api_key and reading api_keys'
);
reset role;

------------------------------------------------------------------------------------------------
-- The SHA-256 vector shared with apps/web/src/lib/api/keys.test.ts
------------------------------------------------------------------------------------------------
select is(
  encode(sha256(convert_to('maqdar_sk_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefg27zRqD', 'UTF8')), 'hex'),
  '57c5db9f1c461c47073a614bba4368a3902a3fa56525f94fa8fab6528f35efcb',
  'SHA-256 of the shared key vector'
);
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-b22000000001');
select is(
  pg_temp.create_key('00000000-0000-4000-8000-b22000000000', 'vector', array['master_data:read'], 30,
                     decode('57c5db9f1c461c47073a614bba4368a3902a3fa56525f94fa8fab6528f35efcb', 'hex'), 'maqdar_sk_0123', 'zRqD'),
  'ok',
  'a key created with the vector hash (as the Settings action sends it)'
);
reset role;
select pg_temp.as_user(null);
set local role service_role;
select is(
  (select r -> 'key' ->> 'display'
   from public.api_organization('\x57c5db9f1c461c47073a614bba4368a3902a3fa56525f94fa8fab6528f35efcb') as r),
  'maqdar_sk_0123…zRqD',
  'is authorized by the bytea literal the Worker sends (''\x'' + 64 lower-case hex digits)'
);
reset role;

select * from finish();

rollback;
