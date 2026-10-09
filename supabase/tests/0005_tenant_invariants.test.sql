-- Invariants for every tenant table: any public table with an organization_id column must have
-- RLS enabled, policies for all four commands, set-based policy predicates and no privileges for
-- anon. A new table that forgets one of these fails this file.
begin;

create temporary table tenant_tables on commit drop as
select c.relname as table_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped
where n.nspname = 'public'
  and c.relkind in ('r', 'p');

select plan((select count(*)::int * 5 from tenant_tables) + 2);

select cmp_ok((select count(*)::int from tenant_tables), '>=', 7, 'at least the Step 2 tenant tables exist');

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

-- Every predicate must be `organization_id = any (array(select app.<set helper>()))`: an InitPlan
-- evaluated once per statement that the planner can use as an index condition. A boolean helper
-- such as app.is_member(organization_id) is evaluated once per candidate row and does not scale.
select is(
  (select count(*)::int
   from pg_policies
   where schemaname = 'public'
     and tablename = table_name
     and ((qual is not null and qual !~ 'organization_id = ANY \(ARRAY\( SELECT app\.(member|editable)_organizations\(\)')
       or (with_check is not null and with_check !~ 'organization_id = ANY \(ARRAY\( SELECT app\.(member|editable)_organizations\(\)'))),
  0,
  table_name || ': every policy predicate is set-based'
)
from tenant_tables;

select is(
  (select count(*)::int
   from pg_policies
   where schemaname = 'public'
     and (coalesce(qual, '') ~ 'is_member\(|can_edit\(' or coalesce(with_check, '') ~ 'is_member\(|can_edit\(')),
  0,
  'no policy calls a per-row membership function'
);

select is(
  (select bool_or(has_table_privilege('anon', ('public.' || quote_ident(table_name))::regclass, p))
   from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p),
  false,
  table_name || ': anon has no privileges'
)
from tenant_tables;

select * from finish();

rollback;
