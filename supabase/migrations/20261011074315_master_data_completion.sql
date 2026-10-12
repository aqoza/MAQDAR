-- Step 4: master data completion.
--
-- * New tenant tables: brands, item_interchanges, network_links, fx_rates, work_calendars and
--   holiday_overrides. They follow the Step 2 template (surrogate id, natural code where there is
--   one, unique (organization_id, id), composite tenant foreign keys with explicit names) and get
--   exactly the four Step 2 policies from the same format() strings, so the exact predicate
--   allow-list in supabase/tests/0005_tenant_invariants.test.sql is unchanged.
-- * items.brand (free text) becomes items.brand_id referencing brands.
-- * Search: a stored search_text column built by app.normalize_search() (Arabic-aware folding) on
--   items, brands, locations, suppliers and work_calendars. The web app matches normalized tokens
--   with LIKE; under RLS that is a tenant filter scan (LIKE is not leakproof), measured at 50k.
-- * Graph guards the new screens need: one successor per predecessor and no supersession cycles,
--   no location parent cycles; a delete guard refuses to delete items or locations that still have
--   demand_history (which has no foreign keys by design).
-- * Organizations gain default_locale, time_zone and numbering_system, written through
--   update_organization_preferences(); my_organizations() returns them (appended columns).

set lock_timeout = '5s';

create extension if not exists btree_gist with schema extensions;

------------------------------------------------------------------------------------------------
-- Search normalization
------------------------------------------------------------------------------------------------

-- NFKC, lower case, strip Arabic diacritics (tashkeel, superscript alef), fold alef variants to ا,
-- alef maqsura to ي and ta marbuta to ه, delete tatweel, map Arabic-Indic and extended digits to
-- ASCII, and turn everything that is not a Latin letter, digit or Arabic letter into one space.
-- apps/web/src/lib/master-data/search.ts mirrors this exactly; shared fixtures keep them in step.
-- Changing it requires rewriting every search_text column.
create or replace function app.normalize_search(value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(
    regexp_replace(
      translate(
        regexp_replace(lower(normalize(coalesce(value, ''), NFKC)), '[ً-ٰٟ]', '', 'g'),
        'أإآٱىة٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹ـ',
        'اااايه01234567890123456789'
      ),
      '[^a-z0-9à-ɏء-ي]+', ' ', 'g'
    )
  );
$$;
comment on function app.normalize_search(text) is 'Search folding shared by stored search_text columns and the web app (src/lib/master-data/search.ts).';
revoke all on function app.normalize_search(text) from public, anon;
-- Generated columns are evaluated as the writing role.
grant execute on function app.normalize_search(text) to authenticated, service_role;

------------------------------------------------------------------------------------------------
-- organizations: display preferences
------------------------------------------------------------------------------------------------

alter table public.organizations
  add column default_locale text not null default 'en' check (default_locale in ('en', 'ar')),
  add column time_zone text check (time_zone is null or length(time_zone) between 1 and 64),
  add column numbering_system text not null default 'latn' check (numbering_system in ('latn', 'arab')),
  add constraint organizations_default_locale_requires_arabic check (default_locale = 'en' or arabic_enabled);
comment on column public.organizations.default_locale is 'Language for members without a locale cookie; ar only while arabic_enabled.';
comment on column public.organizations.time_zone is 'IANA zone for timestamps; null follows countries.timezone of home_country.';
comment on column public.organizations.numbering_system is 'Digits in the Arabic interface: latn (123) or arab (١٢٣). English always uses latn.';

-- Turning Arabic off (update_organization_settings) resets the default language, so the check
-- above never rejects the existing RPC.
create or replace function app.organizations_sync_locale()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not new.arabic_enabled then
    new.default_locale := 'en';
  end if;
  return new;
end;
$$;
create trigger organizations_sync_locale
  before insert or update of arabic_enabled, default_locale on public.organizations
  for each row execute function app.organizations_sync_locale();

------------------------------------------------------------------------------------------------
-- brands, and items.brand (text) -> items.brand_id
------------------------------------------------------------------------------------------------

create table public.brands (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  code text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  name_en text not null check (length(name_en) between 1 and 200),
  name_ar text check (name_ar is null or length(name_ar) between 1 and 200),
  brand_type text check (brand_type is null or brand_type in ('oem', 'aftermarket')),
  country_of_origin char(2) check (country_of_origin is null or country_of_origin ~ '^[A-Z]{2}$'),
  is_active boolean not null default true,
  search_text text generated always as (app.normalize_search(code || ' ' || name_en || ' ' || coalesce(name_ar, ''))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id),
  unique (organization_id, id),
  unique (organization_id, code)
);
comment on table public.brands is 'Makes and aftermarket brands. country_of_origin is any ISO code (not the regional countries table), like suppliers.country_code. brand_type is null for brands backfilled from free text.';
create index brands_name_idx on public.brands (organization_id, name_en, code);

alter table public.items add column brand_id uuid;

with names as (
  select organization_id,
         lower(left(btrim(brand), 200)) as brand_key,
         min(left(btrim(brand), 200)) as name_en
  from public.items
  where brand is not null and btrim(brand) <> ''
  group by organization_id, lower(left(btrim(brand), 200))
), based as (
  select n.*,
         coalesce(nullif(btrim(left(upper(regexp_replace(n.name_en, '[^A-Za-z0-9]+', '-', 'g')), 56), '-'), ''), 'BRAND') as base
  from names n
), numbered as (
  select b.*, row_number() over (partition by b.organization_id, b.base order by b.brand_key) as n
  from based b
)
insert into public.brands (organization_id, code, name_en)
select organization_id, case when n = 1 then base else base || '-' || n end, name_en
from numbered;

update public.items i
set brand_id = b.id
from public.brands b
where b.organization_id = i.organization_id
  and i.brand is not null
  and lower(b.name_en) = lower(left(btrim(i.brand), 200));

alter table public.items drop column brand;
alter table public.items
  add constraint items_brand_fkey foreign key (organization_id, brand_id)
  references public.brands (organization_id, id); -- NO ACTION: a brand in use cannot be deleted

------------------------------------------------------------------------------------------------
-- Existing tables: Arabic name checks, search_text, list indexes ending in the tiebreaker
------------------------------------------------------------------------------------------------

update public.locations set name_ar = null where name_ar is not null and btrim(name_ar) = '';
update public.items set name_ar = null where name_ar is not null and btrim(name_ar) = '';
update public.suppliers set name_ar = null where name_ar is not null and btrim(name_ar) = '';
alter table public.locations add constraint locations_name_ar_check check (name_ar is null or length(name_ar) between 1 and 200);
alter table public.items add constraint items_name_ar_check check (name_ar is null or length(name_ar) between 1 and 200);
alter table public.suppliers add constraint suppliers_name_ar_check check (name_ar is null or length(name_ar) between 1 and 200);

alter table public.items
  add column search_text text generated always as (app.normalize_search(code || ' ' || name_en || ' ' || coalesce(name_ar, ''))) stored;
alter table public.locations
  add column search_text text generated always as (app.normalize_search(code || ' ' || name_en || ' ' || coalesce(name_ar, '') || ' ' || coalesce(city, ''))) stored;
alter table public.suppliers
  add column search_text text generated always as (app.normalize_search(code || ' ' || name_en || ' ' || coalesce(name_ar, ''))) stored;

create index items_name_idx on public.items (organization_id, name_en, code);
create index items_brand_idx on public.items (organization_id, brand_id, code);
create index items_status_idx on public.items (organization_id, status, code);
create index locations_name_idx on public.locations (organization_id, name_en, code);
create index suppliers_name_idx on public.suppliers (organization_id, name_en, code);

-- One preferred supplier per item (the save action clears the previous one first).
create unique index supplier_items_one_preferred_key
  on public.supplier_items (organization_id, item_id) where is_preferred;

-- The supplier-items list sorts by lead time and unit price (tiebreaker id); without these a sort
-- reads every row of the organization (~100 ms at 65,000 rows, ~3 ms with them).
create index supplier_items_lead_time_idx on public.supplier_items (organization_id, lead_time_days, id);
create index supplier_items_unit_price_idx on public.supplier_items (organization_id, unit_price, id);

------------------------------------------------------------------------------------------------
-- item_interchanges
------------------------------------------------------------------------------------------------

create table public.item_interchanges (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  item_id uuid not null,
  alternate_item_id uuid not null,
  direction text not null default 'two_way' check (direction in ('one_way', 'two_way')),
  priority smallint not null default 1 check (priority between 1 and 99),
  note text check (note is null or length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id),
  unique (organization_id, id),
  constraint item_interchanges_item_fkey foreign key (organization_id, item_id)
    references public.items (organization_id, id) on delete cascade,
  constraint item_interchanges_alternate_item_fkey foreign key (organization_id, alternate_item_id)
    references public.items (organization_id, id) on delete cascade,
  check (item_id <> alternate_item_id)
);
comment on table public.item_interchanges is 'one_way: alternate_item may be issued when item is requested, never the reverse. two_way: both directions; the engine derives equivalence classes from connected two_way pairs. priority 1 is tried first. One row per unordered pair.';
create unique index item_interchanges_pair_key
  on public.item_interchanges (organization_id, least(item_id, alternate_item_id), greatest(item_id, alternate_item_id));
create index item_interchanges_item_idx on public.item_interchanges (organization_id, item_id);
create index item_interchanges_alternate_idx on public.item_interchanges (organization_id, alternate_item_id);

------------------------------------------------------------------------------------------------
-- network_links
------------------------------------------------------------------------------------------------

create table public.network_links (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  from_location_id uuid not null,
  to_location_id uuid not null,
  lead_time_days_p50 integer not null check (lead_time_days_p50 between 0 and 3650),
  lead_time_days_p90 integer not null check (lead_time_days_p90 between 0 and 3650),
  freight_basis text not null default 'none' check (freight_basis in ('none', 'per_unit', 'per_shipment')),
  freight_cost numeric(18, 3),
  currency char(3) references public.currencies (code),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id),
  unique (organization_id, id),
  constraint network_links_lane_key unique (organization_id, from_location_id, to_location_id),
  constraint network_links_from_location_fkey foreign key (organization_id, from_location_id)
    references public.locations (organization_id, id) on delete cascade,
  constraint network_links_to_location_fkey foreign key (organization_id, to_location_id)
    references public.locations (organization_id, id) on delete cascade,
  check (from_location_id <> to_location_id),
  check (lead_time_days_p90 >= lead_time_days_p50),
  constraint network_links_freight_check check (
    case freight_basis
      when 'none' then freight_cost is null and currency is null
      else freight_cost is not null and freight_cost >= 0 and currency is not null
    end
  )
);
comment on table public.network_links is 'Transfer lanes between locations: lead times in calendar days (p50 typical, p90 slow) and freight cost in currency, per unit or per shipment. locations.parent_location_id stays the default replenishment source; a lane also describes alternate sources.';
create index network_links_to_idx on public.network_links (organization_id, to_location_id);

------------------------------------------------------------------------------------------------
-- fx_rates
------------------------------------------------------------------------------------------------

create table public.fx_rates (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  from_currency char(3) not null references public.currencies (code),
  to_currency char(3) not null references public.currencies (code),
  valid_from date not null,
  rate numeric(20, 10) not null check (rate > 0),
  note text check (note is null or length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id),
  unique (organization_id, id),
  constraint fx_rates_pair_date_key unique (organization_id, from_currency, to_currency, valid_from),
  check (from_currency <> to_currency)
);
comment on table public.fx_rates is '1 from_currency = rate to_currency from valid_from until the next row of the same pair. A ratio, not money: 10 fractional digits keep small inverted rates exact. A pair and its reverse cannot both be entered for one date.';
create unique index fx_rates_unordered_pair_date_key
  on public.fx_rates (organization_id, least(from_currency, to_currency), greatest(from_currency, to_currency), valid_from);

------------------------------------------------------------------------------------------------
-- work_calendars, assignment to locations and suppliers
------------------------------------------------------------------------------------------------

create table public.work_calendars (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  code text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  name_en text not null check (length(name_en) between 1 and 200),
  name_ar text check (name_ar is null or length(name_ar) between 1 and 200),
  country_code char(2) references public.countries (code),
  weekend_days smallint[] not null default '{}',
  observe_public_holidays boolean not null default true,
  is_active boolean not null default true,
  search_text text generated always as (app.normalize_search(code || ' ' || name_en || ' ' || coalesce(name_ar, ''))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id),
  unique (organization_id, id),
  unique (organization_id, code),
  constraint work_calendars_weekend_days_check check (
    weekend_days <@ '{1,2,3,4,5,6,7}'::smallint[]
    and cardinality(weekend_days) <= 6
    and (cardinality(weekend_days) = 0 or (array_ndims(weekend_days) = 1 and array_lower(weekend_days, 1) = 1))
  ),
  constraint work_calendars_holidays_need_country check (country_code is not null or not observe_public_holidays)
);
comment on table public.work_calendars is 'Working-day calendars (ISO weekdays, 1 = Monday). country_code is the source of public holidays (sector all) when observe_public_holidays. Locations and suppliers without a calendar use their country default (countries.weekend_days and public_holidays). Precedence: calendar overrides > country overrides > public_holidays > weekly pattern.';
create index work_calendars_name_idx on public.work_calendars (organization_id, name_en, code);

alter table public.locations add column work_calendar_id uuid;
alter table public.locations add constraint locations_work_calendar_fkey
  foreign key (organization_id, work_calendar_id) references public.work_calendars (organization_id, id);
create index locations_work_calendar_idx on public.locations (organization_id, work_calendar_id);

alter table public.suppliers add column work_calendar_id uuid;
alter table public.suppliers add constraint suppliers_work_calendar_fkey
  foreign key (organization_id, work_calendar_id) references public.work_calendars (organization_id, id);
create index suppliers_work_calendar_idx on public.suppliers (organization_id, work_calendar_id);

------------------------------------------------------------------------------------------------
-- holiday_overrides
------------------------------------------------------------------------------------------------

create table public.holiday_overrides (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  work_calendar_id uuid,
  country_code char(2) references public.countries (code),
  starts_on date not null,
  ends_on date not null,
  kind text not null check (kind in ('closure', 'working_day')),
  name_en text not null check (length(name_en) between 1 and 200),
  name_ar text check (name_ar is null or length(name_ar) between 1 and 200),
  note text check (note is null or length(note) <= 1000),
  scope_key text generated always as (coalesce('calendar:' || work_calendar_id::text, 'country:' || country_code::text)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id),
  unique (organization_id, id),
  constraint holiday_overrides_scope_start_key unique (organization_id, scope_key, starts_on),
  constraint holiday_overrides_calendar_fkey foreign key (organization_id, work_calendar_id)
    references public.work_calendars (organization_id, id) on delete cascade,
  constraint holiday_overrides_one_scope check (num_nonnulls(work_calendar_id, country_code) = 1),
  constraint holiday_overrides_range_check check (ends_on >= starts_on and ends_on - starts_on < 366),
  constraint holiday_overrides_no_overlap exclude using gist (
    organization_id with =,
    scope_key with =,
    daterange(starts_on, ends_on, '[]') with &&
  )
);
comment on table public.holiday_overrides is 'Per-organization calendar exceptions for one country (every default calendar in it) or one work calendar. closure adds non-working days; working_day cancels a public holiday or weekend day. No overlaps within a scope.';
create index holiday_overrides_starts_idx on public.holiday_overrides (organization_id, starts_on);
create index holiday_overrides_calendar_idx on public.holiday_overrides (organization_id, work_calendar_id);

------------------------------------------------------------------------------------------------
-- RLS, privileges and updated_at: byte-identical policy text to 20261009085100_master_data.sql
------------------------------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['brands', 'item_interchanges', 'network_links', 'fx_rates', 'work_calendars', 'holiday_overrides'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke truncate, references, trigger, maintain on public.%I from authenticated', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (organization_id = any (array(select app.member_organizations())))', t);
    execute format('create policy "editors insert" on public.%I for insert to authenticated with check (organization_id = any (array(select app.editable_organizations())))', t);
    execute format('create policy "editors update" on public.%I for update to authenticated using (organization_id = any (array(select app.editable_organizations()))) with check (organization_id = any (array(select app.editable_organizations())))', t);
    execute format('create policy "editors delete" on public.%I for delete to authenticated using (organization_id = any (array(select app.editable_organizations())))', t);
    execute format('create trigger %I before update on public.%I for each row execute function app.set_updated_at()', t || '_set_updated_at', t);
  end loop;
end
$$;

------------------------------------------------------------------------------------------------
-- Graph guards
------------------------------------------------------------------------------------------------

-- At most one successor per predecessor: a supersession chain is a path.
alter table public.item_supersessions
  add constraint item_supersessions_one_successor_key unique (organization_id, predecessor_item_id);

create or replace function app.guard_supersession_cycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('maqdar.supersessions:' || new.organization_id::text, 0));
  if exists (
    with recursive chain(item_id) as (
      select new.successor_item_id
      union
      select s.successor_item_id
      from public.item_supersessions s
      join chain c on s.predecessor_item_id = c.item_id
      where s.organization_id = new.organization_id
    )
    select 1 from chain where item_id = new.predecessor_item_id
  ) then
    raise exception using errcode = 'MQ422', message = 'this supersession would create a cycle',
      hint = 'successor_item_code';
  end if;
  return null;
end;
$$;
revoke all on function app.guard_supersession_cycle() from public, anon, authenticated;
create trigger item_supersessions_guard_cycle
  after insert or update of predecessor_item_id, successor_item_id on public.item_supersessions
  for each row execute function app.guard_supersession_cycle();

create or replace function app.guard_location_parent_cycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.parent_location_id is null then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.locations:' || new.organization_id::text, 0));
  if exists (
    with recursive up(location_id) as (
      select new.parent_location_id
      union
      select l.parent_location_id
      from public.locations l
      join up u on l.id = u.location_id
      where l.organization_id = new.organization_id and l.parent_location_id is not null
    )
    select 1 from up where location_id = new.id
  ) then
    raise exception using errcode = 'MQ422', message = 'this parent would create a cycle',
      hint = 'parent_location_id';
  end if;
  return null;
end;
$$;
revoke all on function app.guard_location_parent_cycle() from public, anon, authenticated;
create trigger locations_guard_parent_cycle
  after insert or update of parent_location_id on public.locations
  for each row execute function app.guard_location_parent_cycle();

------------------------------------------------------------------------------------------------
-- Delete guard: demand_history has no foreign keys, so deleting an item or location that still
-- has demand would orphan it. Statement-level with a transition table; the per-organization
-- EXISTS keeps bulk deletes cheap when there is no demand. Deleting an organization that still
-- has demand is refused too (its items cascade here). The synthetic loader deletes demand first
-- and then sets maqdar.demand_guard = 'off' for its own transaction, which API callers cannot do.
------------------------------------------------------------------------------------------------

create or replace function app.refuse_delete_with_demand()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('maqdar.demand_guard', true), '') = 'off' then
    return null;
  end if;
  if not exists (
    select 1 from public.demand_history d
    where d.organization_id in (select distinct o.organization_id from deleted_rows o)
  ) then
    return null;
  end if;
  if tg_table_name = 'items' then
    perform 1 from deleted_rows o
      join public.demand_history d on d.organization_id = o.organization_id and d.item_id = o.id
      limit 1;
  else
    perform 1 from deleted_rows o
      join public.demand_history d on d.organization_id = o.organization_id and d.location_id = o.id
      limit 1;
  end if;
  if found then
    raise exception using errcode = 'MQ409',
      message = format('%s with demand history cannot be deleted; mark it inactive instead', tg_table_name);
  end if;
  return null;
end;
$$;
revoke all on function app.refuse_delete_with_demand() from public, anon, authenticated;
create trigger items_refuse_delete_with_demand
  after delete on public.items
  referencing old table as deleted_rows
  for each statement execute function app.refuse_delete_with_demand();
create trigger locations_refuse_delete_with_demand
  after delete on public.locations
  referencing old table as deleted_rows
  for each statement execute function app.refuse_delete_with_demand();

------------------------------------------------------------------------------------------------
-- Organization preferences RPC and my_organizations with the preferences appended
------------------------------------------------------------------------------------------------

create or replace function public.update_organization_preferences(
  p_organization_id uuid,
  p_default_locale text,
  p_time_zone text,
  p_numbering_system text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_zone text := nullif(btrim(coalesce(p_time_zone, '')), '');
  v_arabic boolean;
begin
  perform app.require_role(p_organization_id, array['owner', 'admin']);
  if p_default_locale is null or p_default_locale not in ('en', 'ar') then
    raise exception using errcode = 'MQ422', message = 'unknown language', hint = 'default_locale';
  end if;
  if p_numbering_system is null or p_numbering_system not in ('latn', 'arab') then
    raise exception using errcode = 'MQ422', message = 'unknown numbering system', hint = 'numbering_system';
  end if;
  if v_zone is not null and v_zone <> 'UTC'
     and not exists (select 1 from public.countries c where c.timezone = v_zone) then
    raise exception using errcode = 'MQ422', message = 'unknown time zone', hint = 'time_zone';
  end if;
  select o.arabic_enabled into v_arabic from public.organizations o where o.id = p_organization_id;
  if p_default_locale = 'ar' and not coalesce(v_arabic, false) then
    raise exception using errcode = 'MQ422', message = 'enable Arabic before making it the default language', hint = 'default_locale';
  end if;
  update public.organizations
  set default_locale = p_default_locale,
      time_zone = v_zone,
      numbering_system = p_numbering_system
  where id = p_organization_id;
end;
$$;
comment on function public.update_organization_preferences(uuid, text, text, text) is 'Owner or admin sets the default language (ar requires Arabic enabled), the time zone (null or empty follows the home country; otherwise a zone from countries.timezone or UTC) and the numbering system. MQ422 otherwise.';

drop function public.my_organizations();
create function public.my_organizations()
returns table (
  id uuid,
  slug text,
  name text,
  role text,
  arabic_enabled boolean,
  base_currency char(3),
  home_country char(2),
  is_active boolean,
  default_locale text,
  time_zone text,
  effective_time_zone text,
  numbering_system text
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.slug, o.name, m.role, o.arabic_enabled, o.base_currency, o.home_country,
         coalesce(o.id = s.active_organization_id, false) as is_active,
         o.default_locale, o.time_zone, coalesce(o.time_zone, c.timezone, 'UTC') as effective_time_zone,
         o.numbering_system
  from public.memberships m
  join public.organizations o on o.id = m.organization_id
  left join public.countries c on c.code = o.home_country
  left join public.user_settings s on s.user_id = m.user_id
  where m.user_id = (select auth.uid())
  order by o.name, o.id;
$$;
comment on function public.my_organizations() is 'Every organization of the caller with their role and display preferences, regardless of the active-organization claim.';

revoke all on function public.update_organization_preferences(uuid, text, text, text) from public, anon;
grant execute on function public.update_organization_preferences(uuid, text, text, text) to authenticated, service_role;
revoke all on function public.my_organizations() from public, anon;
grant execute on function public.my_organizations() to authenticated, service_role;
