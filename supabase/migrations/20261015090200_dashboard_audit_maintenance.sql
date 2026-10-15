-- Forward-only Step 6 operations. No data is dropped by partition maintenance.
set lock_timeout = '5s';

alter type ingest.api_record_stock_snapshots alter attribute snapshot_date type date;
alter type ingest.api_record_open_orders alter attribute expected_date type date;
alter type ingest.api_record_receipts alter attribute receipt_date type date;

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_user_id uuid,
  table_name text not null,
  operation text not null check (operation in ('INSERT','UPDATE','DELETE')),
  record_id uuid,
  row_count bigint not null default 1 check (row_count > 0),
  old_values jsonb,
  new_values jsonb
);
comment on table public.audit_log is 'Append-only business changes. Tenant administrators read their own organization. No foreign key: deleting business rows must not erase the audit trail. Demand changes are summarized per organization and statement to avoid duplicating bulk history.';
create index audit_log_org_time_idx on public.audit_log(organization_id,occurred_at desc,id);
alter table public.audit_log enable row level security;
revoke all on public.audit_log from public,anon,authenticated,service_role;
grant select on public.audit_log to authenticated;
create policy "admins read" on public.audit_log for select to authenticated using (organization_id = any (array(select app.admin_organizations())));

create or replace function app.audit_business_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare previous jsonb; following jsonb; r jsonb;
begin
  if tg_op <> 'INSERT' then previous := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then following := to_jsonb(new); end if;
  -- No-op writes and timestamp-only refreshes are not business changes.
  if tg_op='UPDATE' and previous - 'updated_at' is not distinct from following - 'updated_at' then return null; end if;
  r := coalesce(following,previous);
  insert into public.audit_log(organization_id,actor_user_id,table_name,operation,record_id,old_values,new_values)
  values((r->>'organization_id')::uuid,auth.uid(),tg_table_name,tg_op,(r->>'id')::uuid,previous,following);
  return null;
end; $$;
revoke all on function app.audit_business_row() from public,anon,authenticated,service_role;

-- Explicit allow-list: never attach a whole-row audit trigger to keys, credentials or auth tables.
do $$ declare t text; begin
  foreach t in array array['items','locations','suppliers','brands','supplier_items','item_supersessions',
    'item_interchanges','network_links','work_calendars','holiday_overrides','fx_rates',
    'stock_snapshots','open_orders','receipts'] loop
    execute format('create trigger audit_business_row after insert or update or delete on public.%I for each row execute function app.audit_business_row()',t);
  end loop;
end; $$;

create or replace function app.audit_demand_statement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='DELETE' then
    insert into public.audit_log(organization_id,actor_user_id,table_name,operation,row_count,old_values)
    select organization_id,auth.uid(),'demand_history',tg_op,count(*),jsonb_build_object('from',min(demand_date),'to',max(demand_date)) from old_rows group by organization_id;
  else
    insert into public.audit_log(organization_id,actor_user_id,table_name,operation,row_count,new_values)
    select organization_id,auth.uid(),'demand_history',tg_op,count(*),jsonb_build_object('from',min(demand_date),'to',max(demand_date)) from new_rows group by organization_id;
  end if;
  return null;
end; $$;
revoke all on function app.audit_demand_statement() from public,anon,authenticated,service_role;
create trigger audit_demand_insert after insert on public.demand_history referencing new table as new_rows for each statement execute function app.audit_demand_statement();
create trigger audit_demand_update after update on public.demand_history referencing new table as new_rows for each statement execute function app.audit_demand_statement();
create trigger audit_demand_delete after delete on public.demand_history referencing old table as old_rows for each statement execute function app.audit_demand_statement();

-- Invoker rights are deliberate: every input relation retains membership and branch RLS.
create or replace function public.dashboard_summary(p_organization_id uuid,p_day date default current_date)
returns jsonb language plpgsql stable security invoker set search_path = '' set plan_cache_mode = force_custom_plan as $$
declare result jsonb; trend jsonb;
begin
  if p_organization_id is null or not (p_organization_id = any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ404',message='no such organization';
  end if;
  if p_day is null or not isfinite(p_day) then raise exception using errcode='MQ422',message='a finite reporting day is required'; end if;
  with visible_items as materialized (
    select id from public.items where organization_id=p_organization_id and status <> 'discontinued'
  ), visible_locations as materialized (
    select id from public.locations where organization_id=p_organization_id and is_active
  ), latest as materialized (
    select distinct on(s.item_id,s.location_id) s.item_id,s.location_id,s.snapshot_date,s.quantity,s.allocated_quantity,s.unit_cost,s.currency
    from public.stock_snapshots s
    join visible_items i on i.id=s.item_id join visible_locations l on l.id=s.location_id
    where s.organization_id=p_organization_id and s.snapshot_date<=p_day
    order by s.item_id,s.location_id,s.snapshot_date desc
  ), valuation as (
    select currency,sum(quantity*unit_cost) as value from latest group by currency
  )
  select jsonb_build_object(
    'day',p_day,'observed_pairs',(select count(*) from latest),
    'unobserved_pairs',(select count(*) from visible_items)*(select count(*) from visible_locations)-(select count(*) from latest),
    'stock_outs',(select count(*) from latest where quantity-allocated_quantity<=0),
    'stale_pairs',(select count(*) from latest where snapshot_date<p_day-7),
    'oldest_snapshot',(select min(snapshot_date) from latest),
    'inventory_value',coalesce((select jsonb_agg(jsonb_build_object('currency',currency,'value',value::text) order by currency) from valuation),'[]'::jsonb)
  ) into result;
  with daily as (
    select demand_date,sum(quantity) as quantity,sum(lost_sales_quantity) as lost
    from public.demand_history
    where organization_id=p_organization_id and demand_date between p_day-29 and p_day
    group by demand_date
  )
  select jsonb_agg(jsonb_build_object('date',p_day-29+d,'quantity',coalesce(quantity,0)::text,'lost_sales_quantity',coalesce(lost,0)::text) order by d)
  into trend from generate_series(0,29) d left join daily on demand_date=p_day-29+d;
  return result || jsonb_build_object('demand',trend);
end; $$;
revoke all on function public.dashboard_summary(uuid,date) from public,anon,service_role;
grant execute on function public.dashboard_summary(uuid,date) to authenticated;

create extension if not exists pg_cron;
revoke all on schema cron from public,anon,authenticated,service_role;

create or replace function app.maintain_demand_partitions()
returns integer language plpgsql security definer set search_path = '' set lock_timeout = '2s' as $$
begin
  if not pg_try_advisory_xact_lock(hashtextextended('maqdar.partitions',0)) then return 0; end if;
  return app.ensure_demand_history_partitions(date_trunc('month',current_date)::date,(date_trunc('month',current_date)+interval '3 months')::date);
end; $$;
revoke all on function app.maintain_demand_partitions() from public,anon,authenticated,service_role;

create or replace function app.import_housekeeping()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('maqdar.housekeeping',0)) then return 0; end if;
  n:=app.import_sweep(20000);
  delete from ingest.api_writes where ctid in(select ctid from ingest.api_writes where created_at<=now()-interval '24 hours' limit 20000);
  delete from ingest.import_creations where ctid in(select ctid from ingest.import_creations where created_at<=now()-interval '24 hours' limit 20000);
  -- Preserve counts and summaries; only row-level error details expire after 30 days.
  delete from public.import_errors where ctid in (
    select e.ctid from public.import_errors e join public.import_batches b on b.id=e.batch_id
    where b.status in ('succeeded','canceled','expired') and b.finished_at<now()-interval '30 days' limit 20000
  );
  return n;
end; $$;
revoke all on function app.import_housekeeping() from public,anon,authenticated,service_role;

select cron.schedule('maqdar-demand-partitions','15 2 * * *','select app.maintain_demand_partitions()');
select cron.schedule('maqdar-import-housekeeping','*/5 * * * *','select app.import_housekeeping()');
select app.maintain_demand_partitions();
reset lock_timeout;
