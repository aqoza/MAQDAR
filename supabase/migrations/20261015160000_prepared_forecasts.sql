-- Step 10b: additive method; existing individual forecast contracts remain frozen.
set lock_timeout='5s';
alter table public.forecast_results drop constraint forecast_results_model_check;
alter table public.forecast_results add constraint forecast_results_model_check check(model in
  ('mean','naive','seasonal_naive','ses','croston','sba','tsb','auto_ets','auto_arima','calendar'));
alter table public.forecast_results drop constraint forecast_results_status_check;
alter table public.forecast_results add constraint forecast_results_status_check check(status in
  ('selected','insufficient','outside_lifecycle','unsupported_scale'));

create function public.forecast_prepared_enqueue(p_organization_id uuid,p_preparation_id uuid,p_request_id uuid,p_horizon integer,p_fixed_group_confirmed boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare prepared public.demand_preparations; source_run public.planning_runs; location_code text;
begin
  if p_organization_id is null or not (p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='prepared forecasting requires an editor';
  end if;
  if p_fixed_group_confirmed is distinct from true or p_horizon is null or p_horizon not between 1 and 90 then
    raise exception using errcode='MQ422',message='invalid prepared forecast request';
  end if;
  select * into prepared from public.demand_preparations where organization_id=p_organization_id and id=p_preparation_id;
  if not found or prepared.status<>'ready' then raise exception using errcode='MQ422',message='choose a valid prepared group'; end if;
  select * into source_run from public.planning_runs where organization_id=p_organization_id and id=prepared.run_id;
  if source_run.status<>'succeeded' or source_run.kind<>'preparation' or source_run.options->>'method'<>'preparation-v1'
    or source_run.options->>'history_complete'<>'true' then
    raise exception using errcode='MQ422',message='preparation history is not confirmed';
  end if;
  select code into location_code from public.locations where organization_id=p_organization_id and id=prepared.location_id;
  return app.planning_enqueue_kind(p_organization_id,location_code,source_run.from_date,source_run.to_date,p_request_id,'forecast',
    jsonb_build_object('method','regional-v1','horizon',p_horizon,'preparation_id',p_preparation_id,'comparison','fixed-group-v1'));
end; $$;
revoke all on function public.forecast_prepared_enqueue(uuid,uuid,uuid,integer,boolean) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.forecast_prepared_enqueue(uuid,uuid,uuid,integer,boolean) to authenticated;

alter function app.forecast_task(uuid,uuid) rename to forecast_task_individual;
revoke all on function app.forecast_task_individual(uuid,uuid) from public,anon,authenticated,service_role,maqdar_worker;
create function app.forecast_task(p_run_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path='' set plan_cache_mode=force_custom_plan as $$
declare r public.planning_runs; l planning.leases; result jsonb;
begin
  select * into r from public.planning_runs where id=p_run_id for update;
  if r.options->>'method' is distinct from 'regional-v1' then return app.forecast_task_individual(p_run_id,p_token); end if;
  if r.status<>'running' or r.kind<>'forecast' then return null; end if;
  select * into l from planning.leases where run_id=r.id;
  if p_token is null or l.token is distinct from p_token or l.expires_at<=clock_timestamp() then return null; end if;
  select payload into result from planning.forecast_inputs where run_id=r.id;
  if found then return result; end if;
  -- The saved group is immutable. Only future reference dates/overrides are captured now.
  with prepared as materialized (
    select p.*,greatest(r.from_date,coalesce((select max((d->>'date')::date)+1
      from jsonb_array_elements(p.evidence->'output'->'daily') d where d->'sold'='null'::jsonb),r.from_date)) start_day,
      p.evidence->'source'->'calendar' cal
    from public.demand_preparations p where p.organization_id=r.organization_id
      and p.location_id=r.location_id and p.id=(r.options->>'preparation_id')::uuid and p.status='ready'
  ), future as (
    select p.cal || jsonb_build_object('coverage_from',c.holiday_coverage_from,'coverage_to',c.holiday_coverage_to,
      'holidays',coalesce((select jsonb_agg(jsonb_build_object('date',h.holiday_date,'sector',h.sector,'name',h.name_en,'source',h.source) order by h.holiday_date,h.sector)
        from public.public_holidays h where h.country_code=c.code and h.holiday_date>r.to_date and h.holiday_date<=r.to_date+(r.options->>'horizon')::integer),'[]'::jsonb),
      'windows',coalesce((select jsonb_agg(to_jsonb(w) order by w.hijri_year) from public.ramadan_windows w where w.country_code=c.code),'[]'::jsonb),
      'overrides',coalesce((select jsonb_agg(jsonb_build_object('calendar_id',o.work_calendar_id,'starts_on',o.starts_on,'ends_on',o.ends_on,'kind',o.kind,'name',o.name_en) order by o.id)
        from public.holiday_overrides o where o.organization_id=r.organization_id and (o.work_calendar_id=(p.cal->>'calendar_id')::uuid or o.country_code=c.code)
        and o.starts_on<=r.to_date+(r.options->>'horizon')::integer and o.ends_on>r.to_date),'[]'::jsonb)) cal
    from prepared p join public.countries c on c.code=p.cal->>'country'
  )
  select jsonb_build_object('kind','forecast','method','regional-v1','computed_at',statement_timestamp(),
    'from_date',r.from_date,'to_date',r.to_date,'options',r.options,'calendar_future',(select cal from future),
    'items',coalesce((select jsonb_agg(jsonb_build_object('item_id',p.group_id,'item_code',p.summary->>'target_code',
      'item_name',p.summary->>'target_code','start_day',p.start_day,'end_day',r.to_date,'introduced_on',null,'discontinued_on',null,
      'demand',coalesce((select jsonb_agg(jsonb_build_array(d->>'date',d->>'sold',d->>'lost') order by d->>'date')
        from jsonb_array_elements(p.evidence->'output'->'daily') d where (d->>'date')::date>=p.start_day),'[]'::jsonb),
      'calendar',coalesce((select jsonb_agg(d order by d->>'date') from jsonb_array_elements(p.evidence->'output'->'daily') d
        where (d->>'date')::date>=p.start_day),'[]'::jsonb),
      'preparation',jsonb_build_object('id',p.id,'run_id',p.run_id,'group_id',p.group_id,'unit',p.summary->>'unit',
        'comparison','fixed-group-v1','original_from',r.from_date,'contributors',p.evidence->'output'->'contributors',
        'members',(select jsonb_agg(jsonb_build_object('item_id',i->'item_id','introduced_on',i->'introduced_on','discontinued_on',i->'discontinued_on') order by i->>'item_id')
          from jsonb_array_elements(p.evidence->'source'->'items') i)))) from prepared p),'[]'::jsonb)) into result;
  if jsonb_array_length(result->'items')<>1 or result->'calendar_future'='null'::jsonb or octet_length(result::text)>20000000 then
    raise exception using errcode='MQ422',message='prepared forecast input unavailable or too large';
  end if;
  if l.expires_at<=clock_timestamp() then return null; end if;
  insert into planning.forecast_inputs(run_id,payload) values(r.id,result);
  return result;
end; $$;
revoke all on function app.forecast_task(uuid,uuid) from public,anon,authenticated,service_role,maqdar_worker;

-- Publication and lease definitions follow below. No worker table privileges are added.

alter function app.forecast_finish(uuid,uuid,jsonb) rename to forecast_finish_individual;
revoke all on function app.forecast_finish_individual(uuid,uuid,jsonb) from public,anon,authenticated,service_role,maqdar_worker;
create function app.forecast_finish(p_run_id uuid,p_token uuid,p_rows jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare r public.planning_runs; l planning.leases; input jsonb; n integer;
begin
  select * into r from public.planning_runs where id=p_run_id for update;
  if r.options->>'method' is distinct from 'regional-v1' then return app.forecast_finish_individual(p_run_id,p_token,p_rows); end if;
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
        or (r.options->>'method'='baseline-v1' and jsonb_array_length(x->'scores')<>7)
        or (r.options->>'method'='regional-v1' and jsonb_array_length(x->'scores') not between 7 and 10)
        or jsonb_array_length(x->'folds')<>3))
      or (x->>'status'<>'selected' and (jsonb_array_length(x->'forecast')<>0 or jsonb_array_length(x->'scores')<>0))) then
    raise exception using errcode='MQ422',message='incomplete forecast evidence';
  end if;
  if r.options->>'method'='regional-v1' and exists(select 1 from jsonb_array_elements(p_rows) x where
      jsonb_typeof(x->'uncertainty') is distinct from 'object' or jsonb_typeof(x->'evaluation') is distinct from 'object'
      or jsonb_typeof(x->'unavailable_models') is distinct from 'array'
      or jsonb_typeof(x->'uncertainty'->'bands') is distinct from 'array'
      or (x->'uncertainty'->>'status'='available' and jsonb_array_length(x->'uncertainty'->'bands')<>(r.options->>'horizon')::integer)) then
    raise exception using errcode='MQ422',message='invalid expanded forecast evidence';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) x where x->>'comparison' is distinct from 'fixed-group-v1'
    or jsonb_typeof(x->'future_calendar') is distinct from 'array'
    or (x->>'status'='selected' and (jsonb_typeof(x->'calendar_model') is distinct from 'object'
      or jsonb_array_length(x->'future_calendar')<>(r.options->>'horizon')::integer))) then
    raise exception using errcode='MQ422',message='invalid fixed-group evidence';
  end if;
  insert into public.forecast_results(organization_id,run_id,location_id,item_id,item_code,item_name,status,model,summary,evidence)
  select r.organization_id,r.id,r.location_id,(i->>'item_id')::uuid,i->>'item_code',i->>'item_name',x->>'status',x->>'model',
    jsonb_build_object('total',x->'total','scores',x->'scores'),jsonb_build_object('source',i,'output',x,'calendar_future',input->'calendar_future')
  from jsonb_array_elements(input->'items') i join jsonb_array_elements(p_rows) x on x->>'item_id'=i->>'item_id';
  if l.expires_at<=clock_timestamp() then raise exception using errcode='MQ409',message='forecast lease expired'; end if;
  update public.planning_runs set status='succeeded',finished_at=clock_timestamp(),error_code=null,
    result=jsonb_build_object('version',1,'method',r.options->>'method','computed_at',input->'computed_at','item_count',n) where id=r.id;
  perform pgmq.archive('planning',l.message_id);
  delete from planning.leases where run_id=r.id;
  return true;
end; $$;

revoke all on function app.forecast_finish(uuid,uuid,jsonb) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function app.forecast_finish(uuid,uuid,jsonb) to maqdar_worker;
create or replace function app.planning_claim()
returns table(run_id uuid,lease_token uuid) language plpgsql security definer set search_path = '' as $$
declare m record; r public.planning_runs; new_token uuid;
begin
  -- Bound stale-message draining (e.g. an organization was deleted).
  for n in 1..10 loop
    select * into m from pgmq.read('planning',120,1);
    if not found then return; end if;
    -- The queue row is locked first by pgmq.read. Never wait for a run lock held
    -- by completion/cancellation, which acquires these locks in the other order.
    select * into r from public.planning_runs where id=(m.message->>'run_id')::uuid for update skip locked;
    if not found then
      if exists(select 1 from public.planning_runs where id=(m.message->>'run_id')::uuid) then continue; end if;
      perform pgmq.archive('planning',m.msg_id); continue;
    end if;
    if r.status not in ('queued','running') then
      perform pgmq.archive('planning',m.msg_id); continue;
    end if;
    if r.attempts>=3 then
      update public.planning_runs set status='failed',error_code='attempts_exhausted',finished_at=clock_timestamp() where id=r.id;
      perform pgmq.archive('planning',m.msg_id);
      delete from planning.leases where planning.leases.run_id=r.id;
      continue;
    end if;
    if r.kind='forecast' and r.options->>'method' in ('expanded-v1','regional-v1') then
      select vt into m.vt from pgmq.set_vt('planning',m.msg_id,900);
    end if;
    new_token:=gen_random_uuid();
    update planning.leases set token=new_token,expires_at=m.vt where planning.leases.run_id=r.id and message_id=m.msg_id;
    if not found then raise exception 'planning transport mismatch'; end if;
    update public.planning_runs set status='running',attempts=attempts+1,started_at=clock_timestamp(),error_code=null where id=r.id;
    return query select r.id,new_token;
    return;
  end loop;
end; $$;
reset lock_timeout;
