-- Step 3: tenancy and auth completion.
--
-- * The custom access-token hook puts the user's active organization (`org_id`) and role
--   (`org_role`) into the JWT. Memberships stay the source of truth: the set helpers intersect the
--   membership table with the claim when it is present, so a claim can only narrow access, never
--   widen it, and removing a member takes effect on the next statement rather than at token expiry.
--   A malformed claim matches nothing (text comparison); an absent claim (pgTAP fixtures, tokens
--   issued before the hook, the synthetic loader) falls back to every membership.
-- * Existing policies are untouched. Branch scoping is added as RESTRICTIVE select policies on
--   locations and demand_history, ANDed by Postgres with the Step 2 predicates. Both legs stay
--   `= any (array(select ...))` InitPlans (see the Step 2 comments on why).
-- * Writes to organizations, memberships, membership_locations, organization_invitations and
--   user_settings happen only through the security-definer RPCs below. They raise custom SQLSTATEs
--   so the web app and pgTAP can react by code: MQ401 not signed in, MQ403 forbidden, MQ404 not
--   found or no longer pending, MQ409 conflict (last owner, already a member, resend cooldown),
--   MQ422 invalid input (email mismatch, role ceiling), MQ429 too many.
-- * Role semantics: owner manages everything including other owners; admin manages members up to
--   admin and the organization settings; planner edits data; approver reads (approvals arrive in
--   Phase 3, app.approving_organizations() is reserved for them); branch_user reads the catalogue
--   but only assigned locations and their demand; viewer reads.

------------------------------------------------------------------------------------------------
-- organizations: creator and reference-data foreign keys
------------------------------------------------------------------------------------------------

alter table public.organizations
  add column created_by uuid references auth.users (id) on delete set null;
comment on column public.organizations.created_by is 'User who created the organization through create_organization(); null for organizations loaded by tooling.';

alter table public.organizations
  add constraint organizations_base_currency_fkey foreign key (base_currency) references public.currencies (code),
  add constraint organizations_home_country_fkey foreign key (home_country) references public.countries (code);

create index organizations_created_by_created_at_idx on public.organizations (created_by, created_at);

------------------------------------------------------------------------------------------------
-- user_settings: the active organization per user (read by the hook)
------------------------------------------------------------------------------------------------

create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  active_organization_id uuid references public.organizations (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.user_settings is 'Per-user preferences. active_organization_id is what the access-token hook puts into the JWT; written only through set_active_organization() and the RPCs that create or accept.';

create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function app.set_updated_at();

alter table public.user_settings enable row level security;
revoke all on public.user_settings from anon;
revoke insert, update, delete on public.user_settings from authenticated;

create policy "users read their settings"
  on public.user_settings for select to authenticated
  using (user_id = (select auth.uid()));

------------------------------------------------------------------------------------------------
-- membership_locations: branch scoping for branch_user members
------------------------------------------------------------------------------------------------

create table public.membership_locations (
  organization_id uuid not null,
  user_id uuid not null,
  location_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id, location_id),
  foreign key (organization_id, user_id) references public.memberships (organization_id, user_id) on delete cascade,
  foreign key (organization_id, location_id) references public.locations (organization_id, id) on delete cascade
);
comment on table public.membership_locations is 'Locations a branch_user member may see. Composite foreign keys keep assignments inside one organization. Written only through set_member_locations().';
create index membership_locations_location_idx on public.membership_locations (organization_id, location_id);

alter table public.membership_locations enable row level security;
revoke all on public.membership_locations from anon;
revoke insert, update, delete on public.membership_locations from authenticated;

------------------------------------------------------------------------------------------------
-- organization_invitations
------------------------------------------------------------------------------------------------

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(email) and length(email) <= 255 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null check (role in ('owner', 'admin', 'planner', 'approver', 'branch_user', 'viewer')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  last_sent_at timestamptz not null default now(),
  send_count integer not null default 1 check (send_count >= 1),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  unique (organization_id, id),
  check (accepted_at is null or revoked_at is null)
);
comment on table public.organization_invitations is 'Invitations bound to a lower-cased e-mail address. The id in links is a locator, not a secret: accepting requires a signed-in, confirmed user with that address. Written only through invite_member(), revoke_invitation() and accept_invitation().';
create unique index organization_invitations_pending_email_key
  on public.organization_invitations (organization_id, email)
  where accepted_at is null and revoked_at is null;
create index organization_invitations_pending_by_email_idx
  on public.organization_invitations (email)
  where accepted_at is null and revoked_at is null;

alter table public.organization_invitations enable row level security;
revoke all on public.organization_invitations from anon;
revoke insert, update, delete on public.organization_invitations from authenticated;

------------------------------------------------------------------------------------------------
-- Helpers. The six set helpers below read the active-organization claim; the two booleans
-- (app.is_member, app.can_edit) deliberately do not, so RPCs can act on organizations other than
-- the active one. Keep the bodies in sync when the source of truth changes.
------------------------------------------------------------------------------------------------

create or replace function app.active_organization_claim()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(auth.jwt() ->> 'org_id', '');
$$;
comment on function app.active_organization_claim() is 'The org_id claim of the current JWT as text, or null when absent. The single place the claim is parsed.';
revoke all on function app.active_organization_claim() from public, anon;
grant execute on function app.active_organization_claim() to authenticated, service_role;

create or replace function app.member_organizations()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id
  from public.memberships m
  where m.user_id = (select auth.uid())
    and ((select app.active_organization_claim()) is null
         or m.organization_id::text = (select app.active_organization_claim()));
$$;

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
    and m.role in ('owner', 'admin', 'planner')
    and ((select app.active_organization_claim()) is null
         or m.organization_id::text = (select app.active_organization_claim()));
$$;

create or replace function app.admin_organizations()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id
  from public.memberships m
  where m.user_id = (select auth.uid())
    and m.role in ('owner', 'admin')
    and ((select app.active_organization_claim()) is null
         or m.organization_id::text = (select app.active_organization_claim()));
$$;
comment on function app.admin_organizations() is 'Organizations where the current user is owner or admin (member management, settings, invitations). Use in policies as organization_id = any (array(select app.admin_organizations())).';

create or replace function app.approving_organizations()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id
  from public.memberships m
  where m.user_id = (select auth.uid())
    and m.role in ('owner', 'admin', 'approver')
    and ((select app.active_organization_claim()) is null
         or m.organization_id::text = (select app.active_organization_claim()));
$$;
comment on function app.approving_organizations() is 'Organizations where the current user may approve (owner, admin, approver). Reserved for Phase 3 approval tables; no policy uses it yet.';

create or replace function app.unscoped_organizations()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id
  from public.memberships m
  where m.user_id = (select auth.uid())
    and m.role <> 'branch_user'
    and ((select app.active_organization_claim()) is null
         or m.organization_id::text = (select app.active_organization_claim()));
$$;
comment on function app.unscoped_organizations() is 'Organizations where the current user sees every location (every role except branch_user). First leg of the restrictive branch-scoping policies.';

create or replace function app.scoped_locations()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ml.location_id
  from public.membership_locations ml
  join public.memberships m
    on m.organization_id = ml.organization_id and m.user_id = ml.user_id
  where m.user_id = (select auth.uid())
    and m.role = 'branch_user'
    and ((select app.active_organization_claim()) is null
         or m.organization_id::text = (select app.active_organization_claim()));
$$;
comment on function app.scoped_locations() is 'Locations assigned to the current user as branch_user. Second leg of the restrictive branch-scoping policies.';

create or replace function app.membership_role(org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.memberships m
  where m.organization_id = org
    and m.user_id = (select auth.uid());
$$;
comment on function app.membership_role(uuid) is 'Role of the current user in one organization, or null. Internal to the RPCs; never use it in a policy.';

revoke all on function app.admin_organizations() from public, anon;
revoke all on function app.approving_organizations() from public, anon;
revoke all on function app.unscoped_organizations() from public, anon;
revoke all on function app.scoped_locations() from public, anon;
revoke all on function app.membership_role(uuid) from public, anon, authenticated;
grant execute on function app.admin_organizations() to authenticated, service_role;
grant execute on function app.approving_organizations() to authenticated, service_role;
grant execute on function app.unscoped_organizations() to authenticated, service_role;
grant execute on function app.scoped_locations() to authenticated, service_role;
grant execute on function app.membership_role(uuid) to service_role;

------------------------------------------------------------------------------------------------
-- Read policies on the new tables (writes go through RPCs)
------------------------------------------------------------------------------------------------

create policy "admins read assignments"
  on public.membership_locations for select to authenticated
  using (organization_id = any (array(select app.admin_organizations())));

create policy "admins read invitations"
  on public.organization_invitations for select to authenticated
  using (organization_id = any (array(select app.admin_organizations())));

------------------------------------------------------------------------------------------------
-- Branch scoping: additive restrictive policies, ANDed with the Step 2 "members read" policies.
-- A branch_user with no assignments sees no locations and no demand (fail closed).
------------------------------------------------------------------------------------------------

create policy "branch users see assigned locations"
  on public.locations as restrictive for select to authenticated
  using (organization_id = any (array(select app.unscoped_organizations()))
      or id = any (array(select app.scoped_locations())));

create policy "branch users see assigned locations"
  on public.demand_history as restrictive for select to authenticated
  using (organization_id = any (array(select app.unscoped_organizations()))
      or location_id = any (array(select app.scoped_locations())));

------------------------------------------------------------------------------------------------
-- Custom access-token hook. Called by Supabase Auth as supabase_auth_admin inside the sign-in or
-- refresh transaction (2 s statement timeout). Security definer owned by postgres so the auth role
-- needs no table privileges or policies. Only adds keys, so the required claims always survive; any
-- failure degrades to "no organization" instead of blocking sign-in.
------------------------------------------------------------------------------------------------

-- lock_timeout keeps a lock wait (for example an ALTER TABLE on memberships during a migration)
-- inside the exception handler: it raises lock_not_available, which degrades to null claims,
-- instead of running into the 2 s statement timeout, which nothing can catch.
create or replace function app.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set lock_timeout = '300ms'
as $$
declare
  v_claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_user uuid;
  v_org uuid;
  v_role text;
begin
  begin
    v_user := (event ->> 'user_id')::uuid;
    select m.organization_id, m.role
      into v_org, v_role
    from public.memberships m
    left join public.user_settings s on s.user_id = m.user_id
    where m.user_id = v_user
    order by (m.organization_id = s.active_organization_id) desc nulls last, m.created_at, m.organization_id
    limit 1;
  exception when others then
    raise warning 'custom_access_token_hook: % (%)', sqlerrm, sqlstate;
    v_org := null;
    v_role := null;
  end;
  return jsonb_build_object('claims', v_claims || jsonb_build_object('org_id', v_org, 'org_role', v_role));
end;
$$;
comment on function app.custom_access_token_hook(jsonb) is 'Supabase custom access token hook: adds org_id and org_role (the active organization, else the earliest membership, else null) to every JWT.';

grant usage on schema app to supabase_auth_admin;
revoke all on function app.custom_access_token_hook(jsonb) from public, anon, authenticated, service_role;
grant execute on function app.custom_access_token_hook(jsonb) to supabase_auth_admin;

------------------------------------------------------------------------------------------------
-- Internal guards for the RPCs
------------------------------------------------------------------------------------------------

create or replace function app.require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception using errcode = 'MQ401', message = 'sign in required';
  end if;
  return v_user;
end;
$$;

create or replace function app.require_role(org uuid, allowed text[])
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  perform app.require_user();
  v_role := app.membership_role(org);
  if v_role is null or not (v_role = any (allowed)) then
    raise exception using errcode = 'MQ403', message = 'not allowed for your role in this organization';
  end if;
  return v_role;
end;
$$;

-- Transaction-scoped lock on one organization's memberships (role changes, removals, location
-- assignments). Taken after a cheap authorization check, so non-members never wait on it.
create or replace function app.lock_memberships(org uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('maqdar.memberships:' || org::text, 0));
$$;

revoke all on function app.require_user() from public, anon, authenticated;
revoke all on function app.require_role(uuid, text[]) from public, anon, authenticated;
revoke all on function app.lock_memberships(uuid) from public, anon, authenticated;
grant execute on function app.require_user() to service_role;
grant execute on function app.require_role(uuid, text[]) to service_role;
grant execute on function app.lock_memberships(uuid) to service_role;

------------------------------------------------------------------------------------------------
-- Public RPCs
------------------------------------------------------------------------------------------------

create or replace function public.create_organization(
  p_slug text,
  p_name text,
  p_base_currency char(3) default 'SAR',
  p_home_country char(2) default 'SA',
  p_arabic_enabled boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.require_user();
  v_org uuid;
begin
  -- Serialise per user so parallel requests cannot all pass the count below.
  perform pg_advisory_xact_lock(hashtextextended('maqdar.create_organization:' || v_user::text, 0));
  if (select count(*) from public.organizations o
      where o.created_by = v_user and o.created_at > now() - interval '24 hours') >= 5 then
    raise exception using errcode = 'MQ429', message = 'too many organizations created in the last 24 hours';
  end if;
  insert into public.organizations (slug, name, base_currency, home_country, arabic_enabled, created_by)
  values (lower(trim(p_slug)), trim(p_name), upper(p_base_currency), upper(p_home_country), coalesce(p_arabic_enabled, false), v_user)
  returning id into v_org;
  insert into public.memberships (organization_id, user_id, role) values (v_org, v_user, 'owner');
  insert into public.user_settings (user_id, active_organization_id)
  values (v_user, v_org)
  on conflict (user_id) do update set active_organization_id = excluded.active_organization_id;
  return v_org;
end;
$$;
comment on function public.create_organization(text, text, char, char, boolean) is 'Creates an organization, makes the caller its owner and the organization active. At most five per user per 24 hours (MQ429).';

create or replace function public.update_organization_settings(
  p_organization_id uuid,
  p_name text,
  p_base_currency char(3),
  p_home_country char(2),
  p_arabic_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_role(p_organization_id, array['owner', 'admin']);
  update public.organizations
  set name = trim(p_name),
      base_currency = upper(p_base_currency),
      home_country = upper(p_home_country),
      arabic_enabled = coalesce(p_arabic_enabled, false)
  where id = p_organization_id;
end;
$$;
comment on function public.update_organization_settings(uuid, text, char, char, boolean) is 'Owner or admin updates name, base currency, home country and the Arabic toggle. The slug is immutable.';

create or replace function public.set_active_organization(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  perform app.require_role(p_organization_id, array['owner', 'admin', 'planner', 'approver', 'branch_user', 'viewer']);
  v_user := (select auth.uid());
  insert into public.user_settings (user_id, active_organization_id)
  values (v_user, p_organization_id)
  on conflict (user_id) do update set active_organization_id = excluded.active_organization_id;
end;
$$;
comment on function public.set_active_organization(uuid) is 'Records the organization the next token should carry. Call supabase.auth.refreshSession() afterwards.';

create or replace function public.my_organizations()
returns table (
  id uuid,
  slug text,
  name text,
  role text,
  arabic_enabled boolean,
  base_currency char(3),
  home_country char(2),
  is_active boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.slug, o.name, m.role, o.arabic_enabled, o.base_currency, o.home_country,
         coalesce(o.id = s.active_organization_id, false) as is_active
  from public.memberships m
  join public.organizations o on o.id = m.organization_id
  left join public.user_settings s on s.user_id = m.user_id
  where m.user_id = (select auth.uid())
  order by o.name, o.id;
$$;
comment on function public.my_organizations() is 'Every organization of the caller with their role, regardless of the active-organization claim.';

create or replace function public.organization_members(p_organization_id uuid)
returns table (
  user_id uuid,
  email text,
  role text,
  created_at timestamptz,
  location_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_role(p_organization_id, array['owner', 'admin']);
  return query
    select m.user_id, u.email::text, m.role, m.created_at,
           coalesce(array(select ml.location_id from public.membership_locations ml
                          where ml.organization_id = m.organization_id and ml.user_id = m.user_id
                          order by ml.location_id), '{}'::uuid[])
    from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.organization_id = p_organization_id
    order by m.created_at, m.user_id;
end;
$$;
comment on function public.organization_members(uuid) is 'Members with e-mail (from auth.users) and assigned locations. Owner and admin only (MQ403).';

create or replace function public.set_member_role(p_organization_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role text;
  v_target_role text;
  v_owners integer;
begin
  perform app.require_role(p_organization_id, array['owner', 'admin']);
  if p_role is null or not (p_role = any (array['owner', 'admin', 'planner', 'approver', 'branch_user', 'viewer'])) then
    raise exception using errcode = 'MQ422', message = 'unknown role';
  end if;
  -- Serialise membership changes per organization, then read every role after the lock, so two
  -- owners demoting each other at the same time cannot both pass the last-owner check.
  perform app.lock_memberships(p_organization_id);
  v_actor_role := app.require_role(p_organization_id, array['owner', 'admin']);
  select m.role into v_target_role from public.memberships m
  where m.organization_id = p_organization_id and m.user_id = p_user_id;
  if v_target_role is null then
    raise exception using errcode = 'MQ404', message = 'no such member';
  end if;
  if v_actor_role = 'admin' and (p_role = 'owner' or v_target_role = 'owner') then
    raise exception using errcode = 'MQ403', message = 'only owners manage owners';
  end if;
  if v_target_role = 'owner' and p_role <> 'owner' then
    select count(*) into v_owners from public.memberships m
    where m.organization_id = p_organization_id and m.role = 'owner';
    if v_owners <= 1 then
      raise exception using errcode = 'MQ409', message = 'an organization keeps at least one owner';
    end if;
  end if;
  update public.memberships set role = p_role
  where organization_id = p_organization_id and user_id = p_user_id;
  if p_role <> 'branch_user' then
    delete from public.membership_locations
    where organization_id = p_organization_id and user_id = p_user_id;
  end if;
end;
$$;
comment on function public.set_member_role(uuid, uuid, text) is 'Changes a member''s role. Admins may not grant or take the owner role (MQ403); the last owner is protected (MQ409).';

create or replace function public.remove_member(p_organization_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_user();
  v_actor_role text;
  v_target_role text;
  v_owners integer;
begin
  -- Authorise before looking at the target, so a non-member learns nothing about who belongs.
  if v_actor <> p_user_id then
    perform app.require_role(p_organization_id, array['owner', 'admin']);
  end if;
  perform app.lock_memberships(p_organization_id);
  select m.role into v_target_role from public.memberships m
  where m.organization_id = p_organization_id and m.user_id = p_user_id;
  if v_target_role is null then
    raise exception using errcode = 'MQ404', message = 'no such member';
  end if;
  if v_actor <> p_user_id then
    v_actor_role := app.require_role(p_organization_id, array['owner', 'admin']);
    if v_actor_role = 'admin' and v_target_role = 'owner' then
      raise exception using errcode = 'MQ403', message = 'only owners remove owners';
    end if;
  end if;
  if v_target_role = 'owner' then
    select count(*) into v_owners from public.memberships m
    where m.organization_id = p_organization_id and m.role = 'owner';
    if v_owners <= 1 then
      raise exception using errcode = 'MQ409', message = 'an organization keeps at least one owner';
    end if;
  end if;
  delete from public.memberships
  where organization_id = p_organization_id and user_id = p_user_id;
  update public.user_settings
  set active_organization_id = null
  where user_id = p_user_id and active_organization_id = p_organization_id;
end;
$$;
comment on function public.remove_member(uuid, uuid) is 'Owner or admin removes a member, or a member leaves. Admins cannot remove owners (MQ403); the last owner cannot leave (MQ409).';

create or replace function public.set_member_locations(p_organization_id uuid, p_user_id uuid, p_location_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_role text;
  v_known integer;
  v_ids uuid[] := coalesce((select array_agg(distinct x) from unnest(p_location_ids) as x), '{}'::uuid[]);
begin
  perform app.require_role(p_organization_id, array['owner', 'admin']);
  perform app.lock_memberships(p_organization_id);
  perform app.require_role(p_organization_id, array['owner', 'admin']);
  select m.role into v_target_role from public.memberships m
  where m.organization_id = p_organization_id and m.user_id = p_user_id;
  if v_target_role is null then
    raise exception using errcode = 'MQ404', message = 'no such member';
  end if;
  if v_target_role <> 'branch_user' then
    raise exception using errcode = 'MQ422', message = 'only branch users have location assignments';
  end if;
  select count(*) into v_known from public.locations l
  where l.organization_id = p_organization_id and l.id = any (v_ids);
  if v_known <> coalesce(array_length(v_ids, 1), 0) then
    raise exception using errcode = 'MQ422', message = 'every location must belong to the organization';
  end if;
  delete from public.membership_locations
  where organization_id = p_organization_id and user_id = p_user_id;
  insert into public.membership_locations (organization_id, user_id, location_id)
  select p_organization_id, p_user_id, x from unnest(v_ids) as x;
end;
$$;
comment on function public.set_member_locations(uuid, uuid, uuid[]) is 'Replaces a branch_user''s location assignments atomically. Owner and admin only.';

create or replace function public.invite_member(p_organization_id uuid, p_email text, p_role text)
returns table (id uuid, email text, resend boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_user();
  v_actor_role text := app.require_role(p_organization_id, array['owner', 'admin']);
  v_email text := lower(trim(p_email));
  v_existing public.organization_invitations%rowtype;
begin
  if p_role is null or not (p_role = any (array['owner', 'admin', 'planner', 'approver', 'branch_user', 'viewer'])) then
    raise exception using errcode = 'MQ422', message = 'unknown role';
  end if;
  if v_actor_role = 'admin' and p_role = 'owner' then
    raise exception using errcode = 'MQ422', message = 'only owners invite owners';
  end if;
  -- One invitation decision per address and organization at a time (first invites and resends).
  perform pg_advisory_xact_lock(hashtextextended('maqdar.invite:' || p_organization_id::text || ':' || v_email, 0));
  if exists (select 1 from public.memberships m join auth.users u on u.id = m.user_id
             where m.organization_id = p_organization_id and lower(u.email) = v_email) then
    raise exception using errcode = 'MQ409', message = 'already a member';
  end if;
  -- Throttles count every row for the address, revoked and accepted ones included, so revoking and
  -- re-inviting cannot reset them. Every call sends an e-mail through the platform's quota.
  if exists (select 1 from public.organization_invitations i
             where i.organization_id = p_organization_id and i.email = v_email
               and i.last_sent_at > now() - interval '2 minutes') then
    raise exception using errcode = 'MQ429', message = 'an invitation was sent less than two minutes ago';
  end if;
  if (select count(*) from public.organization_invitations i
      where i.organization_id = p_organization_id and i.email = v_email
        and i.created_at > now() - interval '24 hours') >= 5 then
    raise exception using errcode = 'MQ429', message = 'too many invitations to this address today';
  end if;
  if (select count(*) from public.organization_invitations i
      where i.organization_id = p_organization_id and i.last_sent_at > now() - interval '24 hours') >= 100 then
    raise exception using errcode = 'MQ429', message = 'too many invitations from this organization today';
  end if;
  if (select count(*) from public.organization_invitations i
      where i.invited_by = v_actor and i.last_sent_at > now() - interval '24 hours') >= 50 then
    raise exception using errcode = 'MQ429', message = 'too many invitations sent by you today';
  end if;
  select * into v_existing from public.organization_invitations i
  where i.organization_id = p_organization_id and i.email = v_email
    and i.accepted_at is null and i.revoked_at is null
  for update;
  if found then
    if v_actor_role = 'admin' and v_existing.role = 'owner' then
      raise exception using errcode = 'MQ403', message = 'only owners manage owner invitations';
    end if;
    if v_existing.send_count >= 10 then
      raise exception using errcode = 'MQ429', message = 'this invitation has been sent too many times';
    end if;
    update public.organization_invitations i
    set role = p_role,
        invited_by = v_actor,
        send_count = i.send_count + 1,
        last_sent_at = now(),
        expires_at = now() + interval '7 days'
    where i.id = v_existing.id;
    return query select v_existing.id, v_email, true;
    return;
  end if;
  return query
    insert into public.organization_invitations (organization_id, email, role, invited_by)
    values (p_organization_id, v_email, p_role, v_actor)
    returning organization_invitations.id, organization_invitations.email, false;
end;
$$;
comment on function public.invite_member(uuid, text, text) is 'Creates a pending invitation or, when one exists for the address, re-arms it. MQ429 on a 2-minute cooldown per address, 10 sends per invitation, 5 invitations per address, 100 per organization and 50 per inviter in 24 hours (revoked rows count). Only owners re-arm owner invitations (MQ403). Returns the id to send and whether it was a resend.';

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_user();
  v_inv public.organization_invitations%rowtype;
  v_actor_role text;
begin
  -- Lock the row so a concurrent accept either finishes first (then this sees it accepted) or
  -- waits and then finds it revoked. Unknown ids and ids of organizations the caller does not
  -- administer give the same MQ404, so the call reveals nothing about other organizations.
  select * into v_inv from public.organization_invitations i where i.id = p_invitation_id for update;
  if v_inv.id is not null then
    v_actor_role := app.membership_role(v_inv.organization_id);
  end if;
  if v_inv.id is null or v_actor_role is null or not (v_actor_role = any (array['owner', 'admin'])) then
    raise exception using errcode = 'MQ404', message = 'no pending invitation';
  end if;
  if v_inv.role = 'owner' and v_actor_role <> 'owner' then
    raise exception using errcode = 'MQ403', message = 'only owners manage owner invitations';
  end if;
  if v_inv.accepted_at is not null or v_inv.revoked_at is not null then
    raise exception using errcode = 'MQ404', message = 'no pending invitation';
  end if;
  update public.organization_invitations
  set revoked_at = now(), revoked_by = v_actor
  where id = p_invitation_id;
end;
$$;
comment on function public.revoke_invitation(uuid) is 'Owner or admin revokes a pending invitation; only owners revoke owner invitations (MQ403). MQ404 when it is not pending or not visible to the caller.';

create or replace function public.my_invitations()
returns table (
  id uuid,
  organization_id uuid,
  organization_name text,
  role text,
  invited_by_email text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.organization_id, o.name, i.role, inviter.email::text, i.expires_at
  from public.organization_invitations i
  join public.organizations o on o.id = i.organization_id
  join auth.users me on me.id = (select auth.uid())
  left join auth.users inviter on inviter.id = i.invited_by
  where i.email = lower(me.email)
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now()
  order by i.created_at desc;
$$;
comment on function public.my_invitations() is 'Pending, unexpired invitations addressed to the caller''s e-mail.';

create or replace function public.accept_invitation(p_invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.require_user();
  v_email text;
  v_confirmed timestamptz;
  v_inv public.organization_invitations%rowtype;
begin
  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = v_user;
  if v_confirmed is null then
    raise exception using errcode = 'MQ401', message = 'confirm your e-mail address first';
  end if;
  select * into v_inv from public.organization_invitations i where i.id = p_invitation_id for update;
  if not found or v_inv.accepted_at is not null or v_inv.revoked_at is not null or v_inv.expires_at <= now() then
    raise exception using errcode = 'MQ404', message = 'this invitation is no longer valid';
  end if;
  -- Fails closed for accounts without an e-mail address (phone or future providers).
  if v_email is null or v_inv.email is distinct from v_email then
    raise exception using errcode = 'MQ422', message = 'this invitation was sent to a different address';
  end if;
  insert into public.memberships (organization_id, user_id, role)
  values (v_inv.organization_id, v_user, v_inv.role)
  on conflict (organization_id, user_id) do nothing;
  update public.organization_invitations
  set accepted_at = now(), accepted_by = v_user
  where id = p_invitation_id;
  insert into public.user_settings (user_id, active_organization_id)
  values (v_user, v_inv.organization_id)
  on conflict (user_id) do update set active_organization_id = excluded.active_organization_id;
  return v_inv.organization_id;
end;
$$;
comment on function public.accept_invitation(uuid) is 'Signed-in, confirmed user with the invited address joins the organization (existing members keep their role) and makes it active. MQ401, MQ404 and MQ422 otherwise.';

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.create_organization(text, text, char, char, boolean)',
    'public.update_organization_settings(uuid, text, char, char, boolean)',
    'public.set_active_organization(uuid)',
    'public.my_organizations()',
    'public.organization_members(uuid)',
    'public.set_member_role(uuid, uuid, text)',
    'public.remove_member(uuid, uuid)',
    'public.set_member_locations(uuid, uuid, uuid[])',
    'public.invite_member(uuid, text, text)',
    'public.revoke_invitation(uuid)',
    'public.my_invitations()',
    'public.accept_invitation(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$$;

------------------------------------------------------------------------------------------------
-- Least privilege. Supabase's default ACL grants anon and authenticated TRUNCATE, REFERENCES,
-- TRIGGER and MAINTAIN on every table in public; TRUNCATE and LOCK bypass row-level security, so
-- they are revoked here and for tables created later. Tenancy tables are written only through the
-- RPCs above, so authenticated keeps SELECT on them and nothing else.
------------------------------------------------------------------------------------------------

revoke truncate, references, trigger, maintain on all tables in schema public from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables from anon, authenticated;
revoke insert, update, delete on public.organizations, public.memberships from authenticated;
