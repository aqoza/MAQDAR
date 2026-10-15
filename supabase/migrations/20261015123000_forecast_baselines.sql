-- Step 9: additive, forward-only; rollback preserves historical evidence.
set lock_timeout = '5s';
alter table public.planning_runs drop constraint planning_runs_kind_check;
alter table public.planning_runs add constraint planning_runs_kind_check check(kind in ('readiness','classification','forecast'));

create table planning.forecast_inputs (
  run_id uuid primary key references public.planning_runs(id) on delete cascade,
  payload jsonb not null
);
revoke all on planning.forecast_inputs from public,anon,authenticated,service_role,maqdar_worker;

create table public.forecast_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  run_id uuid not null,
  location_id uuid not null,
  item_id uuid not null,
  item_code text not null,
  item_name text not null,
  status text not null check(status in ('selected','insufficient','outside_lifecycle')),
  model text check(model in ('mean','naive','seasonal_naive','ses','croston','sba','tsb')),
  summary jsonb not null,
  evidence jsonb not null,
  unique(organization_id,id),
  unique(run_id,item_id),
  check((status='selected')=(model is not null)),
  foreign key(organization_id,run_id,location_id) references public.planning_runs(organization_id,id,location_id) on delete cascade
);
comment on column public.forecast_results.item_id is 'Captured item identity, intentionally historical rather than a live catalog FK.';
create index forecast_results_page on public.forecast_results(organization_id,run_id,item_code,item_id);
alter table public.forecast_results enable row level security;
revoke all on public.forecast_results from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.forecast_results to authenticated;
create policy "members read" on public.forecast_results for select to authenticated using (organization_id = any(array(select app.member_organizations())));
create policy "branch scope" on public.forecast_results as restrictive for select to authenticated using (organization_id = any(array(select app.unscoped_organizations())) or location_id = any(array(select app.scoped_locations())));

create function public.forecast_enqueue(p_organization_id uuid,p_location_code text,p_from date,p_to date,p_request_id uuid,p_history_complete boolean,p_item_codes text[],p_horizon integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare codes text[];
begin
  if p_organization_id is null or not (p_organization_id = any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='forecasting requires an editor';
  end if;
  if p_to > (select (clock_timestamp() at time zone coalesce(o.time_zone,c.timezone,'UTC'))::date
    from public.organizations o left join public.countries c on c.code=o.home_country where o.id=p_organization_id) then
    raise exception using errcode='MQ422',message='forecast history cannot include future days';
  end if;
  if p_history_complete is distinct from true or p_horizon is null or p_horizon not between 1 and 90
    or p_item_codes is null or cardinality(p_item_codes) not between 1 and 100
    or exists(select 1 from unnest(p_item_codes) c where c is null or length(c) not between 1 and 64 or c<>btrim(c)) then
    raise exception using errcode='MQ422',message='invalid forecast request';
  end if;
  select array_agg(c order by c collate "C") into codes from (select distinct unnest(p_item_codes) c) x;
  if cardinality(codes)<>cardinality(p_item_codes) then raise exception using errcode='MQ422',message='duplicate item code'; end if;
  -- Validate references only for a new request: replay remains valid after catalog edits.
  if not exists(select 1 from public.planning_runs where organization_id=p_organization_id and request_id=p_request_id)
    and (select count(*) from public.items where organization_id=p_organization_id and code=any(codes))<>cardinality(codes) then
    raise exception using errcode='MQ422',message='unknown item code';
  end if;
  return app.planning_enqueue_kind(p_organization_id,p_location_code,p_from,p_to,p_request_id,'forecast',
    jsonb_build_object('history_complete',true,'method','baseline-v1','item_codes',codes,'horizon',p_horizon));
end; $$;
revoke all on function public.forecast_enqueue(uuid,text,date,date,uuid,boolean,text[],integer) from public,anon,authenticated,service_role;
grant execute on function public.forecast_enqueue(uuid,text,date,date,uuid,boolean,text[],integer) to authenticated;

create function app.forecast_task(p_run_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' set plan_cache_mode = force_custom_plan as $$
declare r public.planning_runs; l planning.leases; result jsonb;
begin
  select * into r from public.planning_runs where id=p_run_id for update;
  if not found or r.status<>'running' or r.kind<>'forecast' then return null; end if;
  select * into l from planning.leases where run_id=r.id;
  if p_token is null or l.token is distinct from p_token or l.expires_at<=clock_timestamp() then return null; end if;
  select payload into result from planning.forecast_inputs where run_id=r.id;
  if found then return result; end if;
  with catalog as materialized (
    select id,code,name_en,status,introduced_on,discontinued_on,
      greatest(r.from_date,coalesce(introduced_on,r.from_date)) as start_day,
      least(r.to_date,coalesce(discontinued_on,r.to_date)) as end_day
    from public.items where organization_id=r.organization_id
      and code in (select jsonb_array_elements_text(r.options->'item_codes'))
  ), history as (
    select d.item_id,jsonb_agg(jsonb_build_array(d.demand_date,d.quantity::text,d.lost_sales_quantity::text) order by d.demand_date) as demand
    from public.demand_history d join catalog i on i.id=d.item_id
    where d.organization_id=r.organization_id and d.location_id=r.location_id
      and d.demand_date between r.from_date and r.to_date and d.demand_date between i.start_day and i.end_day
    group by d.item_id
  )
  select jsonb_build_object('kind','forecast','method','baseline-v1','computed_at',statement_timestamp(),
    'from_date',r.from_date,'to_date',r.to_date,'options',r.options,
    'items',coalesce(jsonb_agg(jsonb_build_object('item_id',i.id,'item_code',i.code,'item_name',i.name_en,
      'status',i.status,'introduced_on',i.introduced_on,'discontinued_on',i.discontinued_on,
      'start_day',i.start_day,'end_day',i.end_day,'demand',coalesce(h.demand,'[]'::jsonb)) order by i.id),'[]'::jsonb))
    into result from catalog i left join history h on h.item_id=i.id;
  if jsonb_array_length(result->'items')<>jsonb_array_length(r.options->'item_codes') or octet_length(result::text)>20000000 then
    raise exception using errcode='MQ422',message='forecast input unavailable or too large';
  end if;
  if l.expires_at<=clock_timestamp() then return null; end if;
  insert into planning.forecast_inputs(run_id,payload) values(r.id,result);
  return result;
end; $$;
revoke all on function app.forecast_task(uuid,uuid) from public,anon,authenticated,service_role,maqdar_worker;

-- Keep old task behavior behind a private dispatcher; clients retain one entry point.
alter function app.planning_task(uuid,uuid) rename to planning_task_classification;
revoke all on function app.planning_task_classification(uuid,uuid) from maqdar_worker;
create function app.planning_task(p_run_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.planning_runs where id=p_run_id and kind='forecast') then
    return app.forecast_task(p_run_id,p_token);
  end if;
  return app.planning_task_classification(p_run_id,p_token);
end; $$;
revoke all on function app.planning_task(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function app.planning_task(uuid,uuid) to maqdar_worker;

create function app.forecast_finish(p_run_id uuid,p_token uuid,p_rows jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare r public.planning_runs; l planning.leases; input jsonb; n integer;
begin
  select * into r from public.planning_runs where id=p_run_id for update;
  if not found or r.status<>'running' or r.kind<>'forecast' then return false; end if;
  select * into l from planning.leases where run_id=r.id;
  if p_token is null or l.token is distinct from p_token or l.expires_at<=clock_timestamp() then return false; end if;
  select payload into input from planning.forecast_inputs where run_id=r.id;
  if input is null or p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception using errcode='MQ422',message='invalid forecast output'; end if;
  n:=jsonb_array_length(input->'items');
  if jsonb_array_length(p_rows)<>n or octet_length(p_rows::text)>5000000
    or (select count(distinct x->>'item_id') from jsonb_array_elements(p_rows) x)<>n or exists(
      select 1 from jsonb_array_elements(p_rows) x where not exists(
        select 1 from jsonb_array_elements(input->'items') i where i->>'item_id'=x->>'item_id')) then
    raise exception using errcode='MQ422',message='forecast output does not match input';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) x where
      jsonb_typeof(x->'forecast') is distinct from 'array' or jsonb_typeof(x->'scores') is distinct from 'array'
      or jsonb_typeof(x->'folds') is distinct from 'array') then
    raise exception using errcode='MQ422',message='invalid forecast evidence';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) x where
      (x->>'status'='selected' and (jsonb_array_length(x->'forecast')<>(r.options->>'horizon')::integer
        or jsonb_array_length(x->'scores')<>7 or jsonb_array_length(x->'folds')<>3))
      or (x->>'status'<>'selected' and (jsonb_array_length(x->'forecast')<>0 or jsonb_array_length(x->'scores')<>0))) then
    raise exception using errcode='MQ422',message='incomplete forecast evidence';
  end if;
  insert into public.forecast_results(organization_id,run_id,location_id,item_id,item_code,item_name,status,model,summary,evidence)
  select r.organization_id,r.id,r.location_id,(i->>'item_id')::uuid,i->>'item_code',i->>'item_name',x->>'status',x->>'model',
    jsonb_build_object('total',x->'total','scores',x->'scores'),jsonb_build_object('source',i,'output',x)
  from jsonb_array_elements(input->'items') i join jsonb_array_elements(p_rows) x on x->>'item_id'=i->>'item_id';
  if l.expires_at<=clock_timestamp() then raise exception using errcode='MQ409',message='forecast lease expired'; end if;
  update public.planning_runs set status='succeeded',finished_at=clock_timestamp(),error_code=null,
    result=jsonb_build_object('version',1,'method','baseline-v1','computed_at',input->'computed_at','item_count',n) where id=r.id;
  perform pgmq.archive('planning',l.message_id);
  delete from planning.leases where run_id=r.id;
  return true;
end; $$;
revoke all on function app.forecast_finish(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function app.forecast_finish(uuid,uuid,jsonb) to maqdar_worker;

create function app.forecast_input_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('succeeded','failed','canceled') then delete from planning.forecast_inputs where run_id=new.id; end if;
  return null;
end; $$;
revoke all on function app.forecast_input_cleanup() from public,anon,authenticated,service_role,maqdar_worker;
create trigger forecast_input_cleanup after update of status on public.planning_runs for each row execute function app.forecast_input_cleanup();
reset lock_timeout;
