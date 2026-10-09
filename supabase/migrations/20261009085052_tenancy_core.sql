-- Tenancy core: organizations, memberships and the helper functions every row-level security
-- policy uses. Step 3 adds invitations, the custom access-token hook (only the function bodies
-- below change; policies stay as they are), the organization switcher and organization settings.

create schema if not exists app;
comment on schema app is 'Internal helper functions (RLS predicates, triggers, maintenance). Not exposed through the API.';
grant usage on schema app to authenticated, service_role;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 64),
  name text not null check (length(name) between 1 and 200),
  base_currency char(3) not null default 'SAR',
  home_country char(2) not null default 'SA',
  arabic_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.organizations is 'Tenants. Every business table carries organization_id and is isolated by RLS.';

create table public.memberships (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'planner', 'approver', 'branch_user', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index memberships_user_id_idx on public.memberships (user_id);
comment on table public.memberships is 'Which users belong to which organization, with their role.';

create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function app.set_updated_at();
create trigger memberships_set_updated_at
  before update on public.memberships
  for each row execute function app.set_updated_at();

-- RLS helpers. Security definer (owned by postgres, which bypasses RLS) so the membership lookup
-- never recurses into the memberships policies, and an empty search_path so every reference is
-- schema-qualified. Step 3 may switch the two set-returning bodies to read the organization
-- claims from the JWT; callers do not change.
--
-- Policies are written as `organization_id = any (array(select app.member_organizations()))`, never as a
-- boolean function call per row. The array subquery is an InitPlan evaluated once per statement
-- and `= any` on that parameter is an index condition, so a query without an organization filter
-- reads only the member's rows through the (organization_id, ...) indexes. The plain
-- `in (select app.member_organizations())` form is a hashed subplan instead: cheap per row but
-- re-evaluated per partition scan and never pushed into an index (a small tenant's unscoped count
-- over 648 k demand rows took 250 ms against 13.5 ms). A boolean `app.is_member(organization_id)`
-- is called once per candidate row (~25 µs each: with the large synthetic preset an unscoped
-- count over 13.7 M demand rows did not finish in 150 s).
create or replace function app.member_organizations()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id
  from public.memberships m
  where m.user_id = (select auth.uid());
$$;
comment on function app.member_organizations() is 'Organizations the current user belongs to. Use in RLS policies as organization_id = any (array(select app.member_organizations())).';

create or replace function app.editable_organizations()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id
  from public.memberships m
  where m.user_id = (select auth.uid())
    and m.role in ('owner', 'admin', 'planner');
$$;
comment on function app.editable_organizations() is 'Organizations where the current user is owner, admin or planner. Use in RLS policies as organization_id = any (array(select app.editable_organizations())).';

-- Single-organization checks for application code and tests, never for policies. Direct lookups
-- rather than wrappers over the set helpers: a nested security-definer call costs ~350 µs instead
-- of ~25 µs. Keep the four bodies in sync when Step 3 changes the source of truth.
create or replace function app.is_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = org
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function app.can_edit(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = org
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin', 'planner')
  );
$$;

revoke all on function app.member_organizations() from public, anon;
revoke all on function app.editable_organizations() from public, anon;
revoke all on function app.is_member(uuid) from public, anon;
revoke all on function app.can_edit(uuid) from public, anon;
grant execute on function app.member_organizations() to authenticated, service_role;
grant execute on function app.editable_organizations() to authenticated, service_role;
grant execute on function app.is_member(uuid) to authenticated, service_role;
grant execute on function app.can_edit(uuid) to authenticated, service_role;

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
revoke all on public.organizations from anon;
revoke all on public.memberships from anon;

create policy "members read their organizations"
  on public.organizations for select to authenticated
  using (id = any (array(select app.member_organizations())));

create policy "members read memberships of their organizations"
  on public.memberships for select to authenticated
  using (organization_id = any (array(select app.member_organizations())));

-- No insert/update/delete policies yet: organizations and memberships are created by Step 3's
-- invitation flow through security-definer functions, never directly through the API.
