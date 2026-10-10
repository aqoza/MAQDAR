-- Invariants for every tenant table: any public table with an organization_id column must have
-- RLS enabled, at least one policy, only the approved set-based predicates, and no privileges for
-- anon. A new table that forgets one of these fails this file.
--
-- Predicates are compared EXACTLY (as Postgres deparses them), not by substring: a regex would
-- also accept `... OR true`, a per-row function call appended to an approved shape, or a
-- restrictive policy whose first leg makes branch scoping a no-op. Adding a helper or a shape is a
-- reviewed decision recorded here and in docs/PLAN.md.
begin;

create temporary table tenant_tables on commit drop as
select c.relname as table_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped
where n.nspname = 'public'
  and c.relkind in ('r', 'p');

-- `organization_id = any (array(select app.<helper>()))`: one InitPlan per statement, usable as an
-- index condition. Boolean helpers such as app.is_member(organization_id) run once per row.
create temporary table allowed_permissive on commit drop as
select format('(organization_id = ANY (ARRAY( SELECT app.%1$s() AS %1$s)))', helper) as predicate
from unnest(array['member_organizations', 'editable_organizations', 'admin_organizations']) as helper;

-- Branch scoping (Step 3): ANDed with the permissive policies, narrows branch users by location.
create temporary table allowed_restrictive on commit drop as
select format(
  '((organization_id = ANY (ARRAY( SELECT app.unscoped_organizations() AS unscoped_organizations))) OR (%s = ANY (ARRAY( SELECT app.scoped_locations() AS scoped_locations))))',
  column_name
) as predicate
from unnest(array['id', 'location_id']) as column_name;

-- Tables written only through the security-definer RPCs.
create temporary table rpc_only_tables on commit drop as
select unnest(array['organizations', 'memberships', 'membership_locations', 'organization_invitations', 'user_settings']) as table_name;

select plan((select count(*)::int * 7 from tenant_tables) + 6);

select cmp_ok((select count(*)::int from tenant_tables), '>=', 9, 'at least the Step 2 and Step 3 tenant tables exist');

select is(
  (select relrowsecurity from pg_class where oid = ('public.' || quote_ident(table_name))::regclass),
  true,
  table_name || ': row level security is enabled'
)
from tenant_tables;

select is(
  (select relforcerowsecurity from pg_class where oid = ('public.' || quote_ident(table_name))::regclass),
  false,
  table_name || ': owner keeps bypass (loader and migrations run as the owner)'
)
from tenant_tables;

select cmp_ok(
  (select count(distinct cmd)::int from pg_policies where schemaname = 'public' and tablename = table_name),
  '>=',
  1,
  table_name || ': has at least one policy'
)
from tenant_tables;

select is(
  (select count(*)::int
   from pg_policies p
   where p.schemaname = 'public'
     and p.tablename = table_name
     and p.permissive = 'PERMISSIVE'
     and ((p.qual is not null and p.qual not in (select predicate from allowed_permissive))
       or (p.with_check is not null and p.with_check not in (select predicate from allowed_permissive)))),
  0,
  table_name || ': every permissive predicate is an approved set-based shape'
)
from tenant_tables;

select is(
  (select count(*)::int
   from pg_policies p
   where p.schemaname = 'public'
     and p.tablename = table_name
     and p.permissive = 'RESTRICTIVE'
     and (p.cmd <> 'SELECT'
       or p.with_check is not null
       or coalesce(p.qual, '') not in (select predicate from allowed_restrictive))),
  0,
  table_name || ': restrictive policies are select-only branch scoping'
)
from tenant_tables;

select is(
  (select bool_or(has_table_privilege('anon', ('public.' || quote_ident(table_name))::regclass, p))
   from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as p),
  false,
  table_name || ': anon has no privileges'
)
from tenant_tables;

-- TRUNCATE and LOCK bypass row-level security; the rest has no use for API roles.
select is(
  (select bool_or(has_table_privilege('authenticated', ('public.' || quote_ident(table_name))::regclass, p))
   from unnest(array['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as p),
  false,
  table_name || ': authenticated has no TRUNCATE, REFERENCES, TRIGGER or MAINTAIN'
)
from tenant_tables;

select is(
  (select count(*)::int
   from pg_policies
   where schemaname = 'public'
     and (coalesce(qual, '') ~ 'is_member\(|can_edit\(|membership_role\(|require_role\('
       or coalesce(with_check, '') ~ 'is_member\(|can_edit\(|membership_role\(|require_role\(')),
  0,
  'no policy calls a per-row membership function'
);

select results_eq(
  $$select coalesce(qual, '-') collate "default" from pg_policies where schemaname = 'public' and tablename = 'organizations' order by policyname$$,
  $$values ('(id = ANY (ARRAY( SELECT app.member_organizations() AS member_organizations)))'::text)$$,
  'organizations: one set-based read policy, nothing else'
);

select results_eq(
  $$select (cmd::text || ' ' || coalesce(qual, '-')) collate "default" from pg_policies where schemaname = 'public' and tablename = 'user_settings' order by policyname$$,
  $$values ('SELECT (user_id = ( SELECT auth.uid() AS uid))'::text)$$,
  'user_settings: users read only their own row, nothing else'
);

select is(
  (select count(*)::int
   from rpc_only_tables t
   cross join unnest(array['INSERT', 'UPDATE', 'DELETE']) as p
   where has_table_privilege('authenticated', ('public.' || t.table_name)::regclass, p)),
  0,
  'authenticated cannot insert, update or delete the RPC-only tenancy tables'
);

select is(
  (select count(*)::int
   from pg_policies p
   join rpc_only_tables t on t.table_name = p.tablename
   where p.schemaname = 'public'
     and p.cmd <> 'SELECT'),
  0,
  'the RPC-only tenancy tables have read policies only'
);

select * from finish();

rollback;
