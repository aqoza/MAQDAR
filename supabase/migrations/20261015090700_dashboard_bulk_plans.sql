-- Aggregate joins over materialized tenant sets must remain hash/merge joins even immediately after a bulk load,
-- when the new organization is absent from the statistics. A nested loop can revisit 50,000 rows per stock row.
create or replace function public.dashboard_summary(p_organization_id uuid,p_day date default current_date)
returns jsonb language plpgsql stable security invoker set search_path = '' set plan_cache_mode = force_custom_plan set enable_nestloop = off as $$
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
