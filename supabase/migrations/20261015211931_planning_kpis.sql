-- Step 12b: additive read-only interfaces. Roll back the web build first; remove these
-- interfaces only in a reviewed forward migration. Existing summaries and evidence stay intact.
set lock_timeout = '5s';
-- Aggregate joins over materialized tenant sets must remain hash/merge joins even immediately after a bulk load,
-- when the new organization is absent from the statistics. A nested loop can revisit 50,000 rows per stock row.
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
  ), visible_locations as materialized (
    select id from public.locations where organization_id=p_organization_id and is_active and (selected_location is null or id=selected_location)
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
    'day',p_day,'location_code',p_location_code,'observed_pairs',(select count(*) from latest),
    'unobserved_pairs',(select count(*) from visible_items)*(select count(*) from visible_locations)-(select count(*) from latest),
    'available_pairs',(select count(*) from latest where quantity-allocated_quantity>0),
    'stock_outs',(select count(*) from latest where quantity-allocated_quantity<=0),
    'stale_pairs',(select count(*) from latest where snapshot_date<p_day-7),
    'oldest_snapshot',(select min(snapshot_date) from latest),
    'inventory_value',coalesce((select jsonb_agg(jsonb_build_object('currency',currency,'value',value::text) order by currency) from valuation),'[]'::jsonb)
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

revoke all on function public.dashboard_kpis(uuid,date,text) from public,anon,authenticated,service_role;
grant execute on function public.dashboard_kpis(uuid,date,text) to authenticated;

-- Compact projections of saved evidence, with the underlying tenant/branch RLS intact.
-- No live item join: saved identities survive catalog changes. No inferred unit label.
create view public.forecast_quality with (security_invoker=true) as
select f.id,f.organization_id,f.run_id,f.location_id,f.item_id,f.item_code,f.item_name,
  l.code as location_code,f.status,f.model,r.finished_at,r.from_date,r.to_date,
  r.options->>'method' as method,r.options->>'horizon' as horizon,
  app.normalize_search(f.item_code||' '||f.item_name) as search_text,
  f.evidence->'source'->'preparation'->>'unit' as unit,
  f.evidence->'output'->>'comparison' as comparison,
  (select s->>'rmse' from jsonb_array_elements(f.summary->'scores') s where s->>'model'=f.model limit 1) as rmse,
  (select s->>'mae' from jsonb_array_elements(f.summary->'scores') s where s->>'model'=f.model limit 1) as mae,
  (select s->>'bias' from jsonb_array_elements(f.summary->'scores') s where s->>'model'=f.model limit 1) as bias,
  coalesce(f.evidence->'output'->'folds','[]'::jsonb) as folds,
  jsonb_strip_nulls(jsonb_build_object(
    'status',coalesce(f.evidence->'output'->'evaluation'->>'status','unavailable'),
    'model',f.evidence->'output'->'evaluation'->>'model',
    'train_to',f.evidence->'output'->'evaluation'->>'train_to',
    'test_from',f.evidence->'output'->'evaluation'->>'test_from',
    'test_to',f.evidence->'output'->'evaluation'->>'test_to',
    'count',f.evidence->'output'->'evaluation'->'count',
    'coverage80',f.evidence->'output'->'evaluation'->>'coverage80',
    'coverage95',f.evidence->'output'->'evaluation'->>'coverage95'
  )) as evaluation
from public.forecast_results f
join public.planning_runs r on r.organization_id=f.organization_id and r.id=f.run_id and r.location_id=f.location_id
join public.locations l on l.organization_id=f.organization_id and l.id=f.location_id
where r.kind='forecast' and r.status='succeeded';
revoke all on public.forecast_quality from public,anon,authenticated,service_role;
grant select on public.forecast_quality to authenticated;
