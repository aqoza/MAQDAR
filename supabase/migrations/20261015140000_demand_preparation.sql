-- Step 10: immutable demand preparation, additive and forward-only.
set lock_timeout='5s';
alter table public.planning_runs drop constraint planning_runs_kind_check;
alter table public.planning_runs add constraint planning_runs_kind_check check(kind in ('readiness','classification','forecast','preparation'));
create table planning.preparation_inputs (
  run_id uuid primary key references public.planning_runs(id) on delete cascade,
  payload jsonb not null
);
revoke all on planning.preparation_inputs from public,anon,authenticated,service_role,maqdar_worker;
create table public.demand_preparations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  run_id uuid not null, location_id uuid not null, group_id uuid not null,
  status text not null check(status in ('ready','blocked')),
  summary jsonb not null, evidence jsonb not null,
  unique(organization_id,id), unique(run_id,group_id),
  foreign key(organization_id,run_id,location_id) references public.planning_runs(organization_id,id,location_id) on delete cascade
);
comment on column public.demand_preparations.group_id is 'Captured terminal item identity, or stable component identity for blocked groups; no live catalog FK.';
create index demand_preparations_page on public.demand_preparations(organization_id,run_id,group_id);
alter table public.demand_preparations enable row level security;
revoke all on public.demand_preparations from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.demand_preparations to authenticated;
create policy "members read" on public.demand_preparations for select to authenticated using (organization_id = any(array(select app.member_organizations())));
create policy "branch scope" on public.demand_preparations as restrictive for select to authenticated using (organization_id = any(array(select app.unscoped_organizations())) or location_id = any(array(select app.scoped_locations())));
create function public.preparation_enqueue(p_organization_id uuid,p_location_code text,p_from date,p_to date,p_request_id uuid,p_history_complete boolean,p_item_codes text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare codes text[];
begin
  if p_organization_id is null or not (p_organization_id = any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='demand preparation requires an editor';
  end if;
  if p_to > (select (clock_timestamp() at time zone coalesce(o.time_zone,c.timezone,'UTC'))::date
    from public.organizations o left join public.countries c on c.code=o.home_country where o.id=p_organization_id) then
    raise exception using errcode='MQ422',message='preparation history cannot include future days';
  end if;
  if p_history_complete is distinct from true
    or p_item_codes is null or cardinality(p_item_codes) not between 1 and 25
    or exists(select 1 from unnest(p_item_codes) c where c is null or length(c) not between 1 and 64 or c<>btrim(c)) then
    raise exception using errcode='MQ422',message='invalid preparation request';
  end if;
  select array_agg(c order by c collate "C") into codes from (select distinct unnest(p_item_codes) c) x;
  if cardinality(codes)<>cardinality(p_item_codes) then raise exception using errcode='MQ422',message='duplicate item code'; end if;
  -- Validate references only for a new request: replay remains valid after catalog edits.
  if not exists(select 1 from public.planning_runs where organization_id=p_organization_id and request_id=p_request_id)
    and (select count(*) from public.items where organization_id=p_organization_id and code=any(codes))<>cardinality(codes) then
    raise exception using errcode='MQ422',message='unknown item code';
  end if;
  return app.planning_enqueue_kind(p_organization_id,p_location_code,p_from,p_to,p_request_id,'preparation',
    jsonb_build_object('history_complete',true,'method','preparation-v1','item_codes',codes));
end; $$;
revoke all on function public.preparation_enqueue(uuid,text,date,date,uuid,boolean,text[]) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.preparation_enqueue(uuid,text,date,date,uuid,boolean,text[]) to authenticated;

create function app.preparation_task(p_run_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path='' set plan_cache_mode=force_custom_plan as $$
declare r public.planning_runs; l planning.leases; result jsonb;
begin
  select * into r from public.planning_runs where id=p_run_id for update;
  if not found or r.status<>'running' or r.kind<>'preparation' then return null; end if;
  select * into l from planning.leases where run_id=r.id;
  if p_token is null or l.token is distinct from p_token or l.expires_at<=clock_timestamp() then return null; end if;
  select payload into result from planning.preparation_inputs where run_id=r.id;
  if found then return result; end if;
  -- One statement captures graph, observations and calendar under one MVCC snapshot.
  with recursive edges(a,b) as materialized (
    select predecessor_item_id,successor_item_id from public.item_supersessions where organization_id=r.organization_id and effective_on<=r.to_date
    union all select item_id,alternate_item_id from public.item_interchanges where organization_id=r.organization_id and direction='two_way'
  ), seeds as materialized (
    select id from public.items where organization_id=r.organization_id and code in (select jsonb_array_elements_text(r.options->'item_codes'))
  ), connected(id) as (
    select id from seeds union
    select case when e.a=c.id then e.b else e.a end from connected c join edges e on e.a=c.id or e.b=c.id
  ), bounded as materialized (select id from connected limit 101), catalog as materialized (
    select i.* from public.items i join bounded b on b.id=i.id where i.organization_id=r.organization_id
  ), history as (
    select d.item_id,jsonb_agg(jsonb_build_array(d.demand_date,d.quantity::text,d.lost_sales_quantity::text) order by d.demand_date) demand
    from public.demand_history d join catalog i on i.id=d.item_id
    where d.organization_id=r.organization_id and d.location_id=r.location_id and d.demand_date between r.from_date and r.to_date
    group by d.item_id
  ), context as (
    select jsonb_build_object('country',c.code,'calendar_id',w.id,'calendar_code',w.code,
      'weekend_days',coalesce(w.weekend_days,c.weekend_days),'observe_public_holidays',coalesce(w.observe_public_holidays,true),
      'active',coalesce(w.is_active,true),'coverage_from',c.holiday_coverage_from,'coverage_to',c.holiday_coverage_to,
      'holidays',coalesce((select jsonb_agg(jsonb_build_object('date',h.holiday_date,'sector',h.sector,'name',h.name_en,'source',h.source) order by h.holiday_date,h.sector)
        from public.public_holidays h where h.country_code=c.code and h.holiday_date between r.from_date and r.to_date),'[]'::jsonb),
      'windows',coalesce((select jsonb_agg(to_jsonb(v) order by v.hijri_year) from public.ramadan_windows v where v.country_code=c.code),'[]'::jsonb),
      'overrides',coalesce((select jsonb_agg(jsonb_build_object('calendar_id',o.work_calendar_id,'starts_on',o.starts_on,'ends_on',o.ends_on,'kind',o.kind,'name',o.name_en) order by o.id)
        from public.holiday_overrides o where o.organization_id=r.organization_id and (o.work_calendar_id=w.id or o.country_code=c.code)
        and o.starts_on<=r.to_date and o.ends_on>=r.from_date),'[]'::jsonb)) payload
    from public.locations loc left join public.work_calendars w on w.organization_id=loc.organization_id and w.id=loc.work_calendar_id
    join public.countries c on c.code=coalesce(w.country_code,loc.country_code)
    where loc.organization_id=r.organization_id and loc.id=r.location_id
  )
  select jsonb_build_object('kind','preparation','method','preparation-v1','computed_at',statement_timestamp(),
    'from_date',r.from_date,'to_date',r.to_date,'selected_count',(select count(*) from seeds),'calendar',(select payload from context),
    'items',(select coalesce(jsonb_agg(jsonb_build_object('item_id',i.id,'item_code',i.code,'item_name',i.name_en,'unit',i.unit_of_measure,
      'introduced_on',i.introduced_on,'discontinued_on',i.discontinued_on,'demand',coalesce(h.demand,'[]'::jsonb)) order by i.id),'[]'::jsonb)
      from catalog i left join history h on h.item_id=i.id),
    'supersessions',(select coalesce(jsonb_agg(jsonb_build_object('predecessor',s.predecessor_item_id,'successor',s.successor_item_id,'effective_on',s.effective_on,'factor',s.quantity_factor::text) order by s.id),'[]'::jsonb)
      from public.item_supersessions s where s.organization_id=r.organization_id and s.predecessor_item_id in (select id from bounded) and s.successor_item_id in (select id from bounded)),
    'interchanges',(select coalesce(jsonb_agg(jsonb_build_object('item',e.item_id,'alternate',e.alternate_item_id,'direction',e.direction) order by e.id),'[]'::jsonb)
      from public.item_interchanges e where e.organization_id=r.organization_id and e.item_id in (select id from bounded) and e.alternate_item_id in (select id from bounded))) into result;
  if (result->>'selected_count')::integer<>jsonb_array_length(r.options->'item_codes') or jsonb_array_length(result->'items') not between 1 and 100
    or result->'calendar'='null'::jsonb or octet_length(result::text)>8000000 then
    raise exception using errcode='MQ422',message='preparation input unavailable or exceeds source limits';
  end if;
  if l.expires_at<=clock_timestamp() then return null; end if;
  insert into planning.preparation_inputs(run_id,payload) values(r.id,result);
  return result;
end; $$;
revoke all on function app.preparation_task(uuid,uuid) from public,anon,authenticated,service_role,maqdar_worker;

create or replace function app.planning_task(p_run_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.planning_runs where id=p_run_id and kind='preparation') then return app.preparation_task(p_run_id,p_token); end if;
  if exists(select 1 from public.planning_runs where id=p_run_id and kind='forecast') then return app.forecast_task(p_run_id,p_token); end if;
  return app.planning_task_classification(p_run_id,p_token);
end; $$;

create function app.preparation_finish(p_run_id uuid,p_token uuid,p_rows jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.planning_runs; l planning.leases; input jsonb; n integer;
begin
  select * into r from public.planning_runs where id=p_run_id for update;
  if not found or r.status<>'running' or r.kind<>'preparation' then return false; end if;
  select * into l from planning.leases where run_id=r.id;
  if p_token is null or l.token is distinct from p_token or l.expires_at<=clock_timestamp() then return false; end if;
  select payload into input from planning.preparation_inputs where run_id=r.id;
  if input is null or p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception using errcode='MQ422',message='invalid preparation output'; end if;
  n:=jsonb_array_length(input->'items');
  if jsonb_array_length(p_rows) not between 1 and 25 or octet_length(p_rows::text)>10000000 or exists(select 1 from jsonb_array_elements(p_rows) x where
    jsonb_typeof(x->'source_ids') is distinct from 'array' or jsonb_typeof(x->'contributors') is distinct from 'array' or jsonb_typeof(x->'daily') is distinct from 'array') then
    raise exception using errcode='MQ422',message='invalid preparation evidence';
  end if;
  if (select count(*) from jsonb_array_elements(p_rows) x,jsonb_array_elements_text(x->'source_ids') s)<>n
    or (select count(distinct s) from jsonb_array_elements(p_rows) x,jsonb_array_elements_text(x->'source_ids') s)<>n
    or exists(select 1 from jsonb_array_elements(p_rows) x,jsonb_array_elements_text(x->'source_ids') s where not exists(select 1 from jsonb_array_elements(input->'items') i where i->>'item_id'=s))
    or exists(select 1 from jsonb_array_elements(p_rows) x where not (x->'source_ids' ? (x->>'group_id'))
      or (x->>'status'='ready' and jsonb_array_length(x->'daily')<>r.to_date-r.from_date+1)
      or (x->>'status'='blocked' and jsonb_array_length(x->'daily')<>0)) then
    raise exception using errcode='MQ422',message='preparation output does not match input';
  end if;
  insert into public.demand_preparations(organization_id,run_id,location_id,group_id,status,summary,evidence)
  select r.organization_id,r.id,r.location_id,(x->>'group_id')::uuid,x->>'status',
    jsonb_build_object('target_code',x->'target_code','unit',x->'unit','sold',x->'sold','lost',x->'lost','issue',x->'issue','source_count',jsonb_array_length(x->'source_ids')),
    jsonb_build_object('source',jsonb_build_object('items',(select jsonb_agg(i order by i->>'item_id') from jsonb_array_elements(input->'items') i where x->'source_ids' ? (i->>'item_id')),
      'supersessions',input->'supersessions','interchanges',input->'interchanges','calendar',input->'calendar'),'output',x)
  from jsonb_array_elements(p_rows) x;
  if l.expires_at<=clock_timestamp() then raise exception using errcode='MQ409',message='preparation lease expired'; end if;
  update public.planning_runs set status='succeeded',finished_at=clock_timestamp(),error_code=null,
    result=jsonb_build_object('version',1,'method','preparation-v1','computed_at',input->'computed_at','source_count',n,'group_count',jsonb_array_length(p_rows)) where id=r.id;
  perform pgmq.archive('planning',l.message_id);
  delete from planning.leases where run_id=r.id;
  return true;
end; $$;
revoke all on function app.preparation_finish(uuid,uuid,jsonb) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function app.preparation_finish(uuid,uuid,jsonb) to maqdar_worker;

create function app.preparation_input_cleanup() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status in ('succeeded','failed','canceled') then delete from planning.preparation_inputs where run_id=new.id; end if;
  return null;
end; $$;
revoke all on function app.preparation_input_cleanup() from public,anon,authenticated,service_role,maqdar_worker;
create trigger preparation_input_cleanup after update of status on public.planning_runs for each row execute function app.preparation_input_cleanup();
reset lock_timeout;
