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

-- RLS predicates. Security definer (owned by postgres, which bypasses RLS) so the membership
-- lookup never recurses into the memberships policies. Step 3 may switch the bodies to read the
-- organization claims from the JWT; callers do not change.
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

revoke all on function app.is_member(uuid) from public, anon;
revoke all on function app.can_edit(uuid) from public, anon;
grant execute on function app.is_member(uuid) to authenticated, service_role;
grant execute on function app.can_edit(uuid) to authenticated, service_role;

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
revoke all on public.organizations from anon;
revoke all on public.memberships from anon;

create policy "members read their organizations"
  on public.organizations for select to authenticated
  using (app.is_member(id));

create policy "members read memberships of their organizations"
  on public.memberships for select to authenticated
  using (app.is_member(organization_id));

-- No insert/update/delete policies yet: organizations and memberships are created by Step 3's
-- invitation flow through security-definer functions, never directly through the API.
