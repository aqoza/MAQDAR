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

-- Tables written only through the security-definer RPCs (Step 3 tenancy, Step 5a imports, Step 5b
-- API keys).
create temporary table rpc_only_tables on commit drop as
select unnest(array['organizations', 'memberships', 'membership_locations', 'organization_invitations', 'user_settings',
                    'import_batches', 'import_files', 'import_errors', 'api_keys', 'planning_runs', 'demand_classifications', 'forecast_results', 'demand_preparations', 'inventory_policies', 'policy_overrides', 'replenishment_drafts', 'supplier_scenarios', 'delivery_scenarios']) as table_name;

-- Columns no API role may read or write in any way (Step 5b: the SHA-256 of every API key).
create temporary table secret_columns on commit drop as
select * from (values ('api_keys', 'key_hash')) as s (table_name, column_name);

select plan((select count(*)::int * 7 from tenant_tables) + 8);

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

-- has_any_column_privilege also sees column-level grants (api_keys has them); DELETE has none.
select is(
  (select count(*)::int
   from rpc_only_tables t
   cross join unnest(array['INSERT', 'UPDATE', 'DELETE']) as p
   where case p
           when 'DELETE' then has_table_privilege('authenticated', ('public.' || t.table_name)::regclass, p)
           else has_any_column_privilege('authenticated', ('public.' || t.table_name)::regclass, p)
         end),
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

-- Default privileges no longer grant new public tables to the API roles (Step 5a), so the read
-- access of every RPC-only table must be an explicit grant in its migration. api_keys, and only
-- api_keys, grants it column by column (every column but key_hash; 0020 pins the exact columns).
select is(
  (select array_agg(t.table_name order by t.table_name)
   from rpc_only_tables t
   where not exists (
     select 1
     from pg_class c
     cross join lateral aclexplode(c.relacl) as a
     where c.oid = ('public.' || t.table_name)::regclass
       and a.grantee = 'authenticated'::regrole
       and a.privilege_type = 'SELECT')
     and not (t.table_name = 'api_keys' and exists (
       select 1
       from pg_attribute att
       cross join lateral aclexplode(att.attacl) as a
       where att.attrelid = ('public.' || t.table_name)::regclass
         and att.attnum > 0
         and not att.attisdropped
         and a.grantee = 'authenticated'::regrole
         and a.privilege_type = 'SELECT'))),
  null,
  'every RPC-only table grants SELECT to authenticated explicitly (api_keys column by column)'
);

-- has_column_privilege is true for a table-level grant too, so this also catches a later
-- `grant select on public.api_keys`.
select is(
  (select array_agg(s.table_name || '.' || s.column_name || ' ' || r || ' ' || p order by 1)
   from secret_columns s
   cross join unnest(array['anon', 'authenticated', 'service_role']) as r
   cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) as p
   where has_column_privilege(r, ('public.' || s.table_name)::regclass, s.column_name, p)),
  null,
  'no API role can select, insert, update or reference a secret column (api_keys.key_hash)'
);

select * from finish();

rollback;
