-- Reuse the authorized latest-stock cohort for overall, currency and location aggregates.
-- No table, grant, security mode, business record, role or planner setting changes.
-- Old clients ignore the optional projection; new clients retain the legacy-read fallback.
-- Roll back the web build first; removing the projection requires a reviewed forward migration.
set lock_timeout = '5s';
create or replace function public.dashboard_kpis(p_organization_id uuid,p_day date,p_location_code text default null)
returns jsonb language plpgsql stable security invoker set search_path = '' set plan_cache_mode = force_custom_plan set enable_nestloop = off as $$
declare result jsonb; trend jsonb; selected_location uuid;
begin
  if p_organization_id is null or not (p_organization_id = any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ404',message='no such organization';
  end if;
  if p_day is null or not isfinite(p_day) then raise exception using errcode='MQ422',message='a finite reporting day is required'; end if;
  if p_location_code is not null then
    select id into selected_location from public.locations
    where organization_id=p_organization_id and code=p_location_code and is_active;
    if selected_location is null then raise exception using errcode='MQ404',message='no such location'; end if;
  end if;
  with visible_items as materialized (
    select id from public.items where organization_id=p_organization_id and status <> 'discontinued'
  ), item_count as materialized (select count(*) as total from visible_items), visible_locations as materialized (
    select id,code,name_en,name_ar from public.locations where organization_id=p_organization_id and is_active and (selected_location is null or id=selected_location)
  ), catalog as materialized (
    select id,code,name_en,name_ar from public.locations
    where organization_id=p_organization_id and is_active order by code limit 51
  ), preview as materialized (
    select * from visible_locations
    where selected_location is not null or id in(select id from catalog order by code limit 5)
  ), latest as (
    select distinct on(s.item_id,s.location_id) s.item_id,s.location_id,s.snapshot_date,s.quantity,s.allocated_quantity,s.unit_cost,s.currency
    from public.stock_snapshots s
    join visible_items i on i.id=s.item_id join visible_locations l on l.id=s.location_id
    where s.organization_id=p_organization_id and s.snapshot_date<=p_day
    order by s.item_id,s.location_id,s.snapshot_date desc
  ), stock_totals as materialized (
    select location_id,currency,grouping(location_id) as location_group,grouping(currency) as currency_group,
      count(*) as observed,count(*) filter(where quantity-allocated_quantity>0) as available,
      count(*) filter(where quantity-allocated_quantity<=0) as stock_outs,
      count(*) filter(where snapshot_date<p_day-7) as stale,min(snapshot_date) as oldest,
      sum(quantity*unit_cost) as value
    from latest group by grouping sets((location_id),(currency),())
  ), all_totals as (
    select * from stock_totals where location_group=1 and currency_group=1
  ), location_counts as (
    select * from stock_totals where location_group=0 and currency_group=1
  ), valuation as (
    select currency,value from stock_totals where location_group=1 and currency_group=0
  )
  select jsonb_build_object(
    'day',p_day,'location_code',p_location_code,'observed_pairs',(select observed from all_totals),
    'unobserved_pairs',(select total from item_count)*(select count(*) from visible_locations)-(select observed from all_totals),
    'available_pairs',(select available from all_totals),
    'stock_outs',(select stock_outs from all_totals),
    'stale_pairs',(select stale from all_totals),
    'oldest_snapshot',(select oldest from all_totals),
    'inventory_value',coalesce((select jsonb_agg(jsonb_build_object('currency',currency,'value',value::text) order by currency) from valuation),'[]'::jsonb),
    'location_preview',jsonb_build_object(
      'organization_id',p_organization_id,'day',p_day,'location_code',p_location_code,
      'suggestions',coalesce((select jsonb_agg(jsonb_build_object('code',code,'name_en',name_en,'name_ar',name_ar) order by code) from(select * from catalog order by code limit 50) c),'[]'::jsonb),
      'limited',(select count(*) from catalog)>50,
      'rows',coalesce((select jsonb_agg(jsonb_build_object(
        'location',jsonb_build_object('code',p.code,'name_en',p.name_en,'name_ar',p.name_ar),
        'summary',jsonb_build_object('observed_pairs',coalesce(c.observed,0),'available_pairs',coalesce(c.available,0),
          'unobserved_pairs',(select total from item_count)-coalesce(c.observed,0),'stale_pairs',coalesce(c.stale,0))
      ) order by p.code) from preview p left join location_counts c on c.location_id=p.id),'[]'::jsonb)
    )
  ) into result;
  with daily as (
    select demand_date,sum(quantity) as quantity,sum(lost_sales_quantity) as lost
    from public.demand_history
    where organization_id=p_organization_id and (selected_location is null or location_id=selected_location) and demand_date between p_day-29 and p_day
    group by demand_date
  )
  select jsonb_agg(jsonb_build_object('date',p_day-29+d,'quantity',coalesce(quantity,0)::text,'lost_sales_quantity',coalesce(lost,0)::text) order by d)
  into trend from generate_series(0,29) d left join daily on demand_date=p_day-29+d;
  return result || jsonb_build_object('demand',trend);
end; $$;

