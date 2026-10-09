-- Daily demand history, partitioned by month. One row per item, location and business day on
-- which demand occurred; quantity is what was sold and lost_sales_quantity what could not be
-- served. Days without a row had zero demand. Partitions live in the `partitions` schema, which
-- is not exposed through the API and carries no grants, so every read goes through the parent
-- and its RLS policies. Step 6 owns ongoing partition maintenance, stock snapshots, open orders
-- and receipts.
--
-- Deliberately no foreign keys: per-row constraint triggers cost about 0.2 ms per row, which
-- makes bulk loads of tens of millions of rows impractical. Integrity is enforced by the import
-- path instead (the loader validates references before COPY and runs a set-based anti-join check
-- after it), organization_id leads the primary key and every policy, and deleting an organization
-- deletes its demand rows first.

create schema if not exists partitions;
comment on schema partitions is 'Physical partitions of public tables. No API exposure, no grants: access the parent tables instead.';
revoke all on schema partitions from public;

create table public.demand_history (
  organization_id uuid not null,
  item_id uuid not null,
  location_id uuid not null,
  demand_date date not null,
  quantity numeric(18, 3) not null default 0 check (quantity >= 0),
  lost_sales_quantity numeric(18, 3) not null default 0 check (lost_sales_quantity >= 0),
  primary key (organization_id, item_id, location_id, demand_date),
  check (quantity > 0 or lost_sales_quantity > 0)
) partition by range (demand_date);
comment on table public.demand_history is 'Daily demand per item and location (business date at the location). Absent day = zero demand. Partitioned by month in schema partitions.';
comment on column public.demand_history.demand_date is 'Business day at the location (a date, not an instant), so weekend and holiday effects line up with the location calendar.';

create index demand_history_location_date_idx on public.demand_history (organization_id, location_id, demand_date);

-- Creates missing monthly partitions in [from_month, to_month]. Owned by postgres; only the
-- service role (and migrations) may call it.
create or replace function app.ensure_demand_history_partitions(from_month date, to_month date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_month date := date_trunc('month', from_month)::date;
  last_month date := date_trunc('month', to_month)::date;
  part_name text;
  created integer := 0;
begin
  if last_month < current_month then
    raise exception 'to_month (%) is before from_month (%)', to_month, from_month;
  end if;
  while current_month <= last_month loop
    part_name := 'demand_history_' || to_char(current_month, 'YYYYMM');
    if to_regclass('partitions.' || part_name) is null then
      execute format(
        'create table partitions.%I partition of public.demand_history for values from (%L) to (%L)',
        part_name,
        current_month,
        (current_month + interval '1 month')::date
      );
      created := created + 1;
    end if;
    current_month := (current_month + interval '1 month')::date;
  end loop;
  return created;
end;
$$;

revoke all on function app.ensure_demand_history_partitions(date, date) from public, anon, authenticated;
grant execute on function app.ensure_demand_history_partitions(date, date) to service_role;

select app.ensure_demand_history_partitions('2023-01-01', '2027-12-01');

alter table public.demand_history enable row level security;
revoke all on public.demand_history from anon;

create policy "members read"
  on public.demand_history for select to authenticated
  using (app.is_member(organization_id));
create policy "editors insert"
  on public.demand_history for insert to authenticated
  with check (app.can_edit(organization_id));
create policy "editors update"
  on public.demand_history for update to authenticated
  using (app.can_edit(organization_id))
  with check (app.can_edit(organization_id));
create policy "editors delete"
  on public.demand_history for delete to authenticated
  using (app.can_edit(organization_id));
