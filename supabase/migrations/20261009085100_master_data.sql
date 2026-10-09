-- Master data slice used by the synthetic data loader: locations, items, item supersessions,
-- suppliers and supplier items. Every table is tenant-scoped (organization_id), has a surrogate id
-- plus a natural code unique per organization, and a unique (organization_id, id) pair so child
-- tables reference parents with composite foreign keys: a row can never point at another
-- tenant's parent. Brands, interchanges, network links, fx rates and work calendars arrive in
-- Step 4 together with the CRUD screens.

create table public.locations (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  code text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  name_en text not null check (length(name_en) between 1 and 200),
  name_ar text,
  location_type text not null check (location_type in ('central', 'hub', 'branch')),
  country_code char(2) not null references public.countries (code),
  city text,
  latitude numeric(9, 6) check (latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude between -180 and 180),
  timezone text not null,
  parent_location_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id),
  unique (organization_id, id),
  unique (organization_id, code),
  foreign key (organization_id, parent_location_id)
    references public.locations (organization_id, id)
    on delete set null (parent_location_id),
  check (parent_location_id is distinct from id)
);
comment on table public.locations is 'Warehouses, regional hubs and branches. parent_location_id is the default replenishment source.';
create index locations_parent_idx on public.locations (organization_id, parent_location_id);

create table public.items (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  code text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$'),
  name_en text not null check (length(name_en) between 1 and 200),
  name_ar text,
  brand text,
  product_group text not null,
  unit_of_measure text not null check (unit_of_measure in ('EA', 'SET', 'L', 'KG')),
  unit_cost numeric(18, 3) not null check (unit_cost >= 0),
  currency char(3) not null references public.currencies (code),
  status text not null default 'active' check (status in ('new', 'active', 'phase_out', 'discontinued')),
  introduced_on date,
  discontinued_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id),
  unique (organization_id, id),
  unique (organization_id, code),
  check (discontinued_on is null or introduced_on is null or discontinued_on >= introduced_on)
);
comment on table public.items is 'Service parts. English name is required, Arabic optional. unit_cost is money in `currency` with 3 decimals.';
create index items_product_group_idx on public.items (organization_id, product_group);

create table public.item_supersessions (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  predecessor_item_id uuid not null,
  successor_item_id uuid not null,
  effective_on date not null,
  quantity_factor numeric(18, 3) not null default 1 check (quantity_factor > 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id),
  unique (organization_id, id),
  unique (organization_id, predecessor_item_id, successor_item_id),
  foreign key (organization_id, predecessor_item_id) references public.items (organization_id, id) on delete cascade,
  foreign key (organization_id, successor_item_id) references public.items (organization_id, id) on delete cascade,
  check (predecessor_item_id <> successor_item_id)
);
comment on table public.item_supersessions is 'Part replacements. quantity_factor = units of the successor per unit of the predecessor.';
create index item_supersessions_successor_idx on public.item_supersessions (organization_id, successor_item_id);

create table public.suppliers (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  code text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  name_en text not null check (length(name_en) between 1 and 200),
  name_ar text,
  country_code char(2) not null,
  currency char(3) not null references public.currencies (code),
  lead_time_days_p50 integer not null check (lead_time_days_p50 >= 0),
  lead_time_days_p90 integer not null check (lead_time_days_p90 >= lead_time_days_p50),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id),
  unique (organization_id, id),
  unique (organization_id, code)
);
comment on table public.suppliers is 'Suppliers with their typical (p50) and slow (p90) lead times in days. country_code is not constrained to the countries table because suppliers sit outside the trading region.';

create table public.supplier_items (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  supplier_id uuid not null,
  item_id uuid not null,
  supplier_part_number text,
  lead_time_days integer not null check (lead_time_days >= 0),
  lead_time_days_p90 integer check (lead_time_days_p90 is null or lead_time_days_p90 >= lead_time_days),
  min_order_quantity numeric(18, 3) not null default 0 check (min_order_quantity >= 0),
  pack_size numeric(18, 3) not null default 1 check (pack_size > 0),
  unit_price numeric(18, 3) not null check (unit_price >= 0),
  currency char(3) not null references public.currencies (code),
  is_preferred boolean not null default false,
  valid_from date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id),
  unique (organization_id, id),
  unique (organization_id, supplier_id, item_id),
  foreign key (organization_id, supplier_id) references public.suppliers (organization_id, id) on delete cascade,
  foreign key (organization_id, item_id) references public.items (organization_id, id) on delete cascade
);
comment on table public.supplier_items is 'What each supplier sells: lead time, minimum order quantity, pack size (order multiple) and price in the supplier currency.';
create index supplier_items_item_idx on public.supplier_items (organization_id, item_id);

-- Row-level security and updated_at triggers, identical for every tenant table.
do $$
declare
  t text;
begin
  foreach t in array array['locations', 'items', 'item_supersessions', 'suppliers', 'supplier_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (app.is_member(organization_id))', t);
    execute format('create policy "editors insert" on public.%I for insert to authenticated with check (app.can_edit(organization_id))', t);
    execute format('create policy "editors update" on public.%I for update to authenticated using (app.can_edit(organization_id)) with check (app.can_edit(organization_id))', t);
    execute format('create policy "editors delete" on public.%I for delete to authenticated using (app.can_edit(organization_id))', t);
    execute format('create trigger %I before update on public.%I for each row execute function app.set_updated_at()', t || '_set_updated_at', t);
  end loop;
end
$$;
