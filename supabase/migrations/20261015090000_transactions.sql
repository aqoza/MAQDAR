-- Step 6 transaction feeds. Forward-only; rollback by a reviewed follow-up migration.
set lock_timeout = '5s';

create table public.stock_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null,
  location_id uuid not null,
  snapshot_date date not null check (isfinite(snapshot_date)),
  quantity numeric(18,3) not null check (quantity >= 0),
  allocated_quantity numeric(18,3) not null default '0' check (allocated_quantity >= 0),
  unit_cost numeric(18,3) not null check (unit_cost >= 0),
  currency char(3) not null references public.currencies(code),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,id),
  unique (organization_id,item_id,location_id,snapshot_date),
  foreign key (organization_id,item_id) references public.items(organization_id,id),
  foreign key (organization_id,location_id) references public.locations(organization_id,id)
);

create index stock_snapshots_location_idx on public.stock_snapshots(organization_id,location_id);
create trigger stock_snapshots_set_updated_at before update on public.stock_snapshots for each row execute function app.set_updated_at();
alter table public.stock_snapshots enable row level security;
revoke all on public.stock_snapshots from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.stock_snapshots to authenticated, service_role;
create policy "members read" on public.stock_snapshots for select to authenticated using (organization_id = any (array(select app.member_organizations())));
create policy "editors insert" on public.stock_snapshots for insert to authenticated with check (organization_id = any (array(select app.editable_organizations())));
create policy "editors update" on public.stock_snapshots for update to authenticated using (organization_id = any (array(select app.editable_organizations()))) with check (organization_id = any (array(select app.editable_organizations())));
create policy "editors delete" on public.stock_snapshots for delete to authenticated using (organization_id = any (array(select app.editable_organizations())));
create policy "branch scope" on public.stock_snapshots as restrictive for select to authenticated using (organization_id = any (array(select app.unscoped_organizations())) or location_id = any (array(select app.scoped_locations())));

create table public.open_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_code text not null check (order_code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  line_code text not null check (line_code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  item_id uuid not null,
  location_id uuid not null,
  supplier_id uuid not null,
  expected_date date not null check (isfinite(expected_date)),
  quantity numeric(18,3) not null check (quantity >= 0),
  unit_cost numeric(18,3) not null check (unit_cost >= 0),
  currency char(3) not null references public.currencies(code),
  status text not null default 'open' check (status in ('open', 'closed', 'canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,id),
  unique (organization_id,order_code,line_code),
  foreign key (organization_id,item_id) references public.items(organization_id,id),
  foreign key (organization_id,location_id) references public.locations(organization_id,id),
  foreign key (organization_id,supplier_id) references public.suppliers(organization_id,id)
);

create index open_orders_location_idx on public.open_orders(organization_id,location_id);
create trigger open_orders_set_updated_at before update on public.open_orders for each row execute function app.set_updated_at();
alter table public.open_orders enable row level security;
revoke all on public.open_orders from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.open_orders to authenticated, service_role;
create policy "members read" on public.open_orders for select to authenticated using (organization_id = any (array(select app.member_organizations())));
create policy "editors insert" on public.open_orders for insert to authenticated with check (organization_id = any (array(select app.editable_organizations())));
create policy "editors update" on public.open_orders for update to authenticated using (organization_id = any (array(select app.editable_organizations()))) with check (organization_id = any (array(select app.editable_organizations())));
create policy "editors delete" on public.open_orders for delete to authenticated using (organization_id = any (array(select app.editable_organizations())));
create policy "branch scope" on public.open_orders as restrictive for select to authenticated using (organization_id = any (array(select app.unscoped_organizations())) or location_id = any (array(select app.scoped_locations())));

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  receipt_code text not null check (receipt_code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  line_code text not null check (line_code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  item_id uuid not null,
  location_id uuid not null,
  supplier_id uuid not null,
  receipt_date date not null check (isfinite(receipt_date)),
  quantity numeric(18,3) not null check (quantity > 0),
  unit_cost numeric(18,3) not null check (unit_cost >= 0),
  currency char(3) not null references public.currencies(code),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,id),
  unique (organization_id,receipt_code,line_code),
  foreign key (organization_id,item_id) references public.items(organization_id,id),
  foreign key (organization_id,location_id) references public.locations(organization_id,id),
  foreign key (organization_id,supplier_id) references public.suppliers(organization_id,id)
);

create index receipts_location_idx on public.receipts(organization_id,location_id);
create trigger receipts_set_updated_at before update on public.receipts for each row execute function app.set_updated_at();
alter table public.receipts enable row level security;
revoke all on public.receipts from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.receipts to authenticated, service_role;
create policy "members read" on public.receipts for select to authenticated using (organization_id = any (array(select app.member_organizations())));
create policy "editors insert" on public.receipts for insert to authenticated with check (organization_id = any (array(select app.editable_organizations())));
create policy "editors update" on public.receipts for update to authenticated using (organization_id = any (array(select app.editable_organizations()))) with check (organization_id = any (array(select app.editable_organizations())));
create policy "editors delete" on public.receipts for delete to authenticated using (organization_id = any (array(select app.editable_organizations())));
create policy "branch scope" on public.receipts as restrictive for select to authenticated using (organization_id = any (array(select app.unscoped_organizations())) or location_id = any (array(select app.scoped_locations())));

create index stock_snapshots_latest_idx on public.stock_snapshots(organization_id,item_id,location_id,snapshot_date desc);
reset lock_timeout;
