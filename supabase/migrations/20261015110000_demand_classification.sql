-- Step 8: additive, forward-only. Historical rows retain their input evidence.
set lock_timeout = '5s';
alter table public.planning_runs drop constraint planning_runs_kind_check;
alter table public.planning_runs add constraint planning_runs_kind_check check(kind in ('readiness','classification'));
alter table public.planning_runs add column options jsonb not null default '{}';
alter table public.planning_runs add unique(organization_id,id,location_id);

create table planning.classification_inputs (
  run_id uuid primary key references public.planning_runs(id) on delete cascade,
  payload jsonb not null
);
revoke all on planning.classification_inputs from public,anon,authenticated,service_role,maqdar_worker;

create table public.demand_classifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  run_id uuid not null,
  location_id uuid not null,
  item_id uuid not null,
  item_code text not null,
  item_name text not null,
  currency char(3) not null,
  pattern text not null check(pattern in ('smooth','erratic','intermittent','lumpy','no_sales','insufficient','outside_lifecycle')),
  abc text not null check(abc in ('A','B','C','N')),
  xyz text not null check(xyz in ('X','Y','Z','U')),
  evidence jsonb not null,
  unique(organization_id,id),
  unique(run_id,item_id),
  foreign key(organization_id,run_id,location_id) references public.planning_runs(organization_id,id,location_id) on delete cascade
);
-- item_id identifies the captured source, not a live relation: deleting or
-- recoding an item must not rewrite the historical evidence (like audit_log).
comment on column public.demand_classifications.item_id is 'Snapshot identity, validated against private input at publication; intentionally not a live item FK.';
create index demand_classifications_page on public.demand_classifications(organization_id,run_id,item_code,item_id);
alter table public.demand_classifications enable row level security;
revoke all on public.demand_classifications from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.demand_classifications to authenticated;
create policy "members read" on public.demand_classifications for select to authenticated using (organization_id = any(array(select app.member_organizations())));
create policy "branch scope" on public.demand_classifications as restrictive for select to authenticated using (organization_id = any(array(select app.unscoped_organizations())) or location_id = any(array(select app.scoped_locations())));

create function app.classification_options(p jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare k text; v numeric; a numeric; b numeric; x numeric; y numeric; result jsonb:='{}';
begin
  if p is null or jsonb_typeof(p)<>'object' then raise exception using errcode='MQ422',message='invalid classification thresholds'; end if;
  if (select count(*) from jsonb_object_keys(p))<>6 then raise exception using errcode='MQ422',message='six classification thresholds required'; end if;
  foreach k in array array['adi','cv2','abc_a','abc_b','xyz_x','xyz_y'] loop
    if p->>k is null or length(p->>k)>20 or (p->>k)!~'^[0-9]+(\.[0-9]{1,6})?$' then
      raise exception using errcode='MQ422',message='invalid classification thresholds';
    end if;
    v:=(p->>k)::numeric;
    if v<=0 or v>1000000 then raise exception using errcode='MQ422',message='threshold out of range'; end if;
    result:=result||jsonb_build_object(k,trim_scale(v)::text);
  end loop;
  a:=(result->>'abc_a')::numeric; b:=(result->>'abc_b')::numeric;
  x:=(result->>'xyz_x')::numeric; y:=(result->>'xyz_y')::numeric;
  if (result->>'adi')::numeric<1 or a>=b or b>=1 or x>=y then
    raise exception using errcode='MQ422',message='threshold order is invalid';
  end if;
  return result;
end; $$;
revoke all on function app.classification_options(jsonb) from public,anon,authenticated,service_role;

create function app.planning_enqueue_kind(p_organization_id uuid,p_location_code text,p_from date,p_to date,p_request_id uuid,p_kind text,p_options jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.planning_runs; location uuid; run uuid; msg bigint;
begin
  if p_organization_id is null or not (p_organization_id = any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='planning requires an editor';
  end if;
  if p_request_id is null or p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
    or p_to<p_from or p_to-p_from>1095 then raise exception using errcode='MQ422',message='invalid planning window'; end if;
  select id into location from public.locations where organization_id=p_organization_id and code=p_location_code and is_active;
  if location is null then raise exception using errcode='MQ422',message='choose an active location'; end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.planning:'||p_organization_id::text,0));
  select * into r from public.planning_runs where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if r.location_id<>location or r.from_date<>p_from or r.to_date<>p_to or r.kind<>p_kind or r.options<>p_options then
      raise exception using errcode='MQ409',message='request id already used with different parameters';
    end if;
    return r.id;
  end if;
  if exists(select 1 from public.planning_runs where organization_id=p_organization_id and status in ('queued','running')) then
    raise exception using errcode='MQ409',message='a planning run is already active';
  end if;
  if (select count(*) from public.planning_runs where organization_id=p_organization_id and created_at>now()-interval '24 hours')>=20 then
    raise exception using errcode='MQ429',message='planning run limit reached';
  end if;
  insert into public.planning_runs(organization_id,location_id,request_id,from_date,to_date,created_by,kind,options)
  values(p_organization_id,location,p_request_id,p_from,p_to,auth.uid(),p_kind,p_options) returning id into run;
  select pgmq.send('planning',jsonb_build_object('run_id',run)) into msg;
  insert into planning.leases(run_id,message_id) values(run,msg);
  return run;
end; $$;
revoke all on function app.planning_enqueue_kind(uuid,text,date,date,uuid,text,jsonb) from public,anon,authenticated,service_role;

create or replace function public.planning_enqueue(p_organization_id uuid,p_location_code text,p_from date,p_to date,p_request_id uuid)
returns uuid language sql security definer set search_path = '' as $$
  select app.planning_enqueue_kind(p_organization_id,p_location_code,p_from,p_to,p_request_id,'readiness','{}');
$$;

create function public.classification_enqueue(p_organization_id uuid,p_location_code text,p_from date,p_to date,p_request_id uuid,p_history_complete boolean,p_options jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if p_history_complete is distinct from true then raise exception using errcode='MQ422',message='complete history confirmation required'; end if;
  return app.planning_enqueue_kind(p_organization_id,p_location_code,p_from,p_to,p_request_id,'classification',
    app.classification_options(p_options)||jsonb_build_object('history_complete',true,'method','daily-v1'));
end; $$;
revoke all on function public.classification_enqueue(uuid,text,date,date,uuid,boolean,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.classification_enqueue(uuid,text,date,date,uuid,boolean,jsonb) to authenticated;

-- An old worker must never publish a readiness result for a classification run.
alter function app.planning_execute(uuid,uuid) rename to planning_execute_readiness;
revoke all on function app.planning_execute_readiness(uuid,uuid) from maqdar_worker;
create function app.planning_execute(p_run_id uuid,p_token uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.planning_runs where id=p_run_id and kind<>'readiness') then
    raise exception using errcode='MQ422',message='worker upgrade required';
  end if;
  return app.planning_execute_readiness(p_run_id,p_token);
end; $$;
revoke all on function app.planning_execute(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function app.planning_execute(uuid,uuid) to maqdar_worker;

create function app.planning_task(p_run_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' set plan_cache_mode = force_custom_plan as $$
declare r public.planning_runs; l planning.leases; result jsonb;
begin
  select * into r from public.planning_runs where id=p_run_id for update;
  if not found or r.status<>'running' then return null; end if;
  select * into l from planning.leases where run_id=r.id;
  if p_token is null or l.token is distinct from p_token or l.expires_at<=clock_timestamp() then return null; end if;
  if r.kind='readiness' then return jsonb_build_object('kind','readiness'); end if;
  select payload into result from planning.classification_inputs where run_id=r.id;
  if found then return result; end if;
  if (select count(*) from public.items where organization_id=r.organization_id)>50000 then
    raise exception using errcode='MQ422',message='classification item limit exceeded';
  end if;
  -- A single statement captures catalog, costs, lifecycle dates and demand. No
  -- dense item-by-day expansion: sufficient statistics include implicit zeros.
  with catalog as materialized (
    select id,code,name_en,status,introduced_on,discontinued_on,unit_cost,currency,
      greatest(r.from_date,coalesce(introduced_on,r.from_date)) as start_day,
      least(r.to_date,coalesce(discontinued_on,r.to_date)) as end_day
    from public.items where organization_id=r.organization_id limit 50001
  ), stats as (
    select d.item_id,count(*) as stored_rows,count(*) filter(where d.quantity>0) as positive_days,
      sum(d.quantity) as quantity,sum(d.quantity*d.quantity) as sum_squares,sum(d.lost_sales_quantity) as lost_sales_quantity,
      max(d.demand_date) filter(where d.quantity>0) as last_sale
    from public.demand_history d join catalog i on i.id=d.item_id
    where d.organization_id=r.organization_id and d.location_id=r.location_id and d.demand_date between r.from_date and r.to_date
      and d.demand_date between i.start_day and i.end_day group by d.item_id
  )
  select jsonb_build_object('kind','classification','method','daily-v1','computed_at',statement_timestamp(),
    'from_date',r.from_date,'to_date',r.to_date,'options',r.options,
    'items',coalesce(jsonb_agg(jsonb_build_object(
      'item_id',i.id,'item_code',i.code,'item_name',i.name_en,'status',i.status,
      'introduced_on',i.introduced_on,'discontinued_on',i.discontinued_on,
      'start_day',i.start_day,'end_day',i.end_day,'days',greatest(0,i.end_day-i.start_day+1),
      'unit_cost',i.unit_cost::text,'currency',i.currency,
      'positive_days',coalesce(s.positive_days,0),'stored_rows',coalesce(s.stored_rows,0),
      'quantity',coalesce(s.quantity,0)::text,'sum_squares',coalesce(s.sum_squares,0)::text,
      'lost_sales_quantity',coalesce(s.lost_sales_quantity,0)::text,'last_sale',s.last_sale,
      'days_since_last_sale',r.to_date-s.last_sale
    ) order by i.id),'[]'::jsonb)) into result from catalog i left join stats s on s.item_id=i.id;
  -- The earlier count is only a fast rejection. An import can add items before
  -- this statement's snapshot, so cap the captured catalog and recheck it too.
  if jsonb_array_length(result->'items')>50000 then
    raise exception using errcode='MQ422',message='classification item limit exceeded';
  end if;
  if l.expires_at<=clock_timestamp() then return null; end if;
  insert into planning.classification_inputs(run_id,payload) values(r.id,result);
  return result;
end; $$;
revoke all on function app.planning_task(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function app.planning_task(uuid,uuid) to maqdar_worker;

create function app.classification_finish(p_run_id uuid,p_token uuid,p_rows jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare r public.planning_runs; l planning.leases; input jsonb; n integer;
begin
  select * into r from public.planning_runs where id=p_run_id for update;
  if not found or r.status<>'running' or r.kind<>'classification' then return false; end if;
  select * into l from planning.leases where run_id=r.id;
  if p_token is null or l.token is distinct from p_token or l.expires_at<=clock_timestamp() then return false; end if;
  select payload into input from planning.classification_inputs where run_id=r.id;
  if input is null or p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception using errcode='MQ422',message='invalid classification output'; end if;
  n:=jsonb_array_length(input->'items');
  if jsonb_array_length(p_rows)<>n or octet_length(p_rows::text)>80000000 or
    (select count(distinct x->>'item_id') from jsonb_array_elements(p_rows) x)<>n or exists(
      select 1 from jsonb_array_elements(p_rows) x where not exists(
        select 1 from jsonb_array_elements(input->'items') i where i->>'item_id'=x->>'item_id')) then
    raise exception using errcode='MQ422',message='classification output does not match input';
  end if;
  insert into public.demand_classifications(organization_id,run_id,location_id,item_id,item_code,item_name,currency,pattern,abc,xyz,evidence)
  select r.organization_id,r.id,r.location_id,(i->>'item_id')::uuid,i->>'item_code',i->>'item_name',i->>'currency',
    x->>'pattern',x->>'abc',x->>'xyz',jsonb_build_object('source',i,'metrics',x)
  from jsonb_array_elements(input->'items') i join jsonb_array_elements(p_rows) x on x->>'item_id'=i->>'item_id';
  if l.expires_at<=clock_timestamp() then raise exception using errcode='MQ409',message='classification lease expired'; end if;
  update public.planning_runs set status='succeeded',finished_at=clock_timestamp(),error_code=null,
    result=jsonb_build_object('version',1,'method','daily-v1','computed_at',input->'computed_at','item_count',n)
    where id=r.id;
  perform pgmq.archive('planning',l.message_id);
  delete from planning.leases where run_id=r.id;
  return true;
end; $$;
revoke all on function app.classification_finish(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function app.classification_finish(uuid,uuid,jsonb) to maqdar_worker;

create function app.classification_input_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('succeeded','failed','canceled') then delete from planning.classification_inputs where run_id=new.id; end if;
  return null;
end; $$;
revoke all on function app.classification_input_cleanup() from public,anon,authenticated,service_role;
create trigger classification_input_cleanup after update of status on public.planning_runs for each row execute function app.classification_input_cleanup();
reset lock_timeout;
