-- Step 23c: preserve versioned single-driver forecasts; capture a canonical driver set.
set lock_timeout='5s';
alter table public.forecast_results drop constraint forecast_results_model_check;
alter table public.forecast_results add constraint forecast_results_model_check check(model in
 ('mean','naive','seasonal_naive','ses','croston','sba','tsb','auto_ets','auto_arima','calendar','driver_weekday','multi_driver_weekday'));

create function public.forecast_multi_driver_enqueue(p_organization_id uuid,p_forecast_id uuid,p_dataset_ids uuid[],p_request_id uuid,p_confirmed boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare f public.forecast_results; d public.external_driver_datasets; source_run public.planning_runs;
 existing public.planning_runs; location_code text; run uuid; options jsonb; input jsonb; horizon integer;
 ids uuid[]; dataset_id uuid; drivers jsonb:='[]';
begin
 if p_organization_id is null or not (p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='driver forecasting requires an editor'; end if;
 if p_confirmed is distinct from true or p_request_id is null or p_forecast_id is null
  or coalesce(array_ndims(p_dataset_ids),0)<>1 or cardinality(p_dataset_ids) not between 2 and 5 then
  raise exception using errcode='MQ422',message='confirm two to five distinct applicable driver datasets'; end if;
 if array_position(p_dataset_ids,null) is not null then
  raise exception using errcode='MQ422',message='null driver dataset'; end if;
 select array_agg(distinct id order by id) into ids from unnest(p_dataset_ids) id;
 if cardinality(ids)<>cardinality(p_dataset_ids) then
  raise exception using errcode='MQ422',message='duplicate driver dataset'; end if;
 perform pg_advisory_xact_lock(hashtextextended('maqdar.planning:'||p_organization_id::text,0));
 if not (p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='driver forecasting requires an editor'; end if;
 select * into existing from public.planning_runs where organization_id=p_organization_id and request_id=p_request_id;
 if found then
  if not (p_organization_id=any(array(select app.unscoped_organizations())))
   and not (existing.location_id=any(array(select app.scoped_locations()))) then
   raise exception using errcode='MQ404',message='source unavailable'; end if;
  if existing.kind<>'forecast' or existing.options->>'method' is distinct from 'multi-driver-v1'
   or existing.options->>'source_forecast_id' is distinct from p_forecast_id::text
   or existing.options->'dataset_ids' is distinct from to_jsonb(ids) or existing.created_by is distinct from auth.uid() then
   raise exception using errcode='MQ409',message='conflicting request'; end if;
  return existing.id;
 end if;
 select * into f from public.forecast_results where organization_id=p_organization_id and id=p_forecast_id;
 if f.id is null or (not (p_organization_id=any(array(select app.unscoped_organizations())))
   and not (f.location_id=any(array(select app.scoped_locations())))) then
  raise exception using errcode='MQ404',message='source unavailable'; end if;
 select * into source_run from public.planning_runs where organization_id=p_organization_id and id=f.run_id;
 horizon:=(source_run.options->>'horizon')::integer;
 if f.status<>'selected' or source_run.status is distinct from 'succeeded' or source_run.kind is distinct from 'forecast'
  or coalesce(source_run.options->>'method','') not in ('baseline-v1','expanded-v1')
  or source_run.options->>'history_complete' is distinct from 'true' or f.evidence->'source' ? 'preparation'
  or f.evidence#>>'{source,unit_provenance,status}' is distinct from 'consistent'
  or coalesce(f.evidence#>>'{source,unit_provenance,unit}','') not in ('EA','SET','L','KG')
  or horizon is null or horizon not between 1 and 90
  or (f.evidence#>>'{source,end_day}')::date is distinct from source_run.to_date
  or source_run.to_date-(f.evidence#>>'{source,start_day}')::date+1<56+3*horizon then
  raise exception using errcode='MQ422',message='choose a completed individual forecast with known demand units'; end if;
 foreach dataset_id in array ids loop
  select * into d from public.external_driver_datasets where organization_id=p_organization_id and id=dataset_id;
  if d.id is null or d.location_id is distinct from f.location_id then
   raise exception using errcode='MQ404',message='source unavailable'; end if;
  if d.item_id is distinct from f.item_id
   or source_run.from_date is distinct from (d.report#>>'{input,history_from}')::date
   or source_run.to_date is distinct from (d.report#>>'{input,cutoff}')::date
   or source_run.to_date+horizon is distinct from (d.report#>>'{input,forecast_to}')::date then
   raise exception using errcode='MQ422',message='choose matching item and driver windows'; end if;
  drivers:=drivers||jsonb_build_array(jsonb_build_object('id',d.id,'imported_at',d.created_at,'report',d.report));
 end loop;
 select code into location_code from public.locations where organization_id=p_organization_id and id=f.location_id and is_active;
 if location_code is null then raise exception using errcode='MQ422',message='choose an active location'; end if;
 options:=jsonb_build_object('method','multi-driver-v1','horizon',horizon,'source_forecast_id',f.id,'dataset_ids',to_jsonb(ids),
  'history_complete',true,'applicability_confirmed',true,'distinct_drivers_confirmed',true);
 run:=app.planning_enqueue_kind(p_organization_id,location_code,source_run.from_date,source_run.to_date,p_request_id,'forecast',options);
 input:=jsonb_build_object('kind','forecast','method','multi-driver-v1','computed_at',clock_timestamp(),
  'from_date',source_run.from_date,'to_date',source_run.to_date,'options',options,
  'items',jsonb_build_array(f.evidence->'source'),'drivers',drivers,
  'original_forecast',jsonb_build_object('id',f.id,'run_id',f.run_id,'method',source_run.options->>'method','summary',f.summary));
 if octet_length(input::text)>20000000 then raise exception using errcode='MQ422',message='captured evidence too large'; end if;
 insert into planning.forecast_inputs(run_id,payload) values(run,input);
 return run;
end; $$;
revoke all on function public.forecast_multi_driver_enqueue(uuid,uuid,uuid[],uuid,boolean) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.forecast_multi_driver_enqueue(uuid,uuid,uuid[],uuid,boolean) to authenticated;

create function app.multi_driver_output_valid(p_input jsonb,p_output jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare drivers jsonb:=p_input->'drivers'; fit jsonb:=p_output->'driver_model'; projected jsonb;
 predictor jsonb; single_fit jsonb; checks jsonb; x jsonb; field text; n integer;
begin
 if jsonb_typeof(drivers) is distinct from 'array' or jsonb_array_length(drivers) not between 2 and 5
  or (select count(distinct d->>'id') from jsonb_array_elements(drivers) d)<>jsonb_array_length(drivers)
  or p_output->>'model'='driver_weekday' or p_output#>>'{evaluation,model}'='driver_weekday' then return false; end if;
 -- Reuse the unchanged single-driver numerical envelope/availability validator for
 -- every selected dataset. Only the joint model tag and per-predictor fit are projected.
 projected:=p_output||jsonb_build_object('model',case when p_output->>'model'='multi_driver_weekday'
  then 'driver_weekday' else p_output->>'model' end);
 foreach field in array array['scores','unavailable_models'] loop
  if jsonb_typeof(p_output->field) is distinct from 'array' then return false; end if;
  if exists(select 1 from jsonb_array_elements(p_output->field) s where s->>'model'='driver_weekday') then return false; end if;
  projected:=jsonb_set(projected,array[field],(select coalesce(jsonb_agg(s||jsonb_build_object('model',
   case when s->>'model'='multi_driver_weekday' then 'driver_weekday' else s->>'model' end) order by ord),'[]')
   from jsonb_array_elements(p_output->field) with ordinality a(s,ord)));
 end loop;
 if p_output#>>'{evaluation,model}'='multi_driver_weekday' then
  projected:=jsonb_set(projected,'{evaluation,model}','"driver_weekday"'); end if;
 for checks in select p_output->'driver_checks' union all
  select p_output#>'{evaluation,driver_checks}' where p_output#>'{evaluation,driver_checks}' is not null loop
  for x in select value from jsonb_array_elements(checks) loop
   if x->>'status'='unavailable' and not exists(select 1 from jsonb_array_elements(drivers) d where d->>'id'=x->>'dataset_id') then return false; end if;
   if x ? 'dataset_id' and not exists(select 1 from jsonb_array_elements(drivers) d where d->>'id'=x->>'dataset_id') then return false; end if;
  end loop;
 end loop;
 if fit->>'status'='available' then
  if jsonb_typeof(fit->'predictors') is distinct from 'array' or jsonb_array_length(fit->'predictors')<>jsonb_array_length(drivers) then return false; end if;
 elsif fit->>'status' is distinct from 'unavailable' or coalesce(fit->'predictors','[]')<>'[]'::jsonb then return false; end if;
 for n in 0..jsonb_array_length(drivers)-1 loop
  single_fit:=jsonb_build_object('status',fit->'status');
  if fit->>'status'='available' then
   predictor:=fit->'predictors'->n;
   if predictor->>'dataset_id' is distinct from drivers->n->>'id' then return false; end if;
   single_fit:=(predictor-'dataset_id')||jsonb_build_object('status','available','penalty',fit->'penalty','weekday_intercepts',fit->'weekday_intercepts');
  end if;
  if not app.driver_output_valid(p_input||jsonb_build_object('driver',drivers->n),
   projected||jsonb_build_object('driver_model',single_fit)) then return false; end if;
 end loop;
 return true;
exception when others then return false;
end; $$;
revoke all on function app.multi_driver_output_valid(jsonb,jsonb) from public,anon,authenticated,service_role,maqdar_worker;

alter function app.forecast_task(uuid,uuid) rename to forecast_task_before_multi_driver;
revoke all on function app.forecast_task_before_multi_driver(uuid,uuid) from public,anon,authenticated,service_role,maqdar_worker;
create function app.forecast_task(p_run_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.planning_runs; l planning.leases; input jsonb;
begin
 select * into r from public.planning_runs where id=p_run_id for update;
 if r.options->>'method' is distinct from 'multi-driver-v1' then return app.forecast_task_before_multi_driver(p_run_id,p_token); end if;
 if r.status<>'running' or r.kind<>'forecast' then return null; end if;
 select * into l from planning.leases where run_id=r.id;
 if p_token is null or l.token is distinct from p_token or l.expires_at<=clock_timestamp() then return null; end if;
 select payload into input from planning.forecast_inputs where run_id=r.id;
 if input is null then raise exception using errcode='MQ422',message='captured driver evidence unavailable'; end if;
 return input;
end; $$;
revoke all on function app.forecast_task(uuid,uuid) from public,anon,authenticated,service_role,maqdar_worker;

alter function app.forecast_finish(uuid,uuid,jsonb) rename to forecast_finish_before_multi_driver;
revoke all on function app.forecast_finish_before_multi_driver(uuid,uuid,jsonb) from public,anon,authenticated,service_role,maqdar_worker;
create function app.forecast_finish(p_run_id uuid,p_token uuid,p_rows jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.planning_runs; l planning.leases; input jsonb; i jsonb; x jsonb;
begin
 select * into r from public.planning_runs where id=p_run_id for update;
 if r.options->>'method' is distinct from 'multi-driver-v1' then return app.forecast_finish_before_multi_driver(p_run_id,p_token,p_rows); end if;
 if r.status<>'running' or r.kind<>'forecast' then return false; end if;
 select * into l from planning.leases where run_id=r.id;
 if p_token is null or l.token is distinct from p_token or l.expires_at<=clock_timestamp() then return false; end if;
 select payload into input from planning.forecast_inputs where run_id=r.id;
 if input is null or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)<>1
  or octet_length(p_rows::text)>5000000 or not app.multi_driver_output_valid(input,p_rows->0) then
  raise exception using errcode='MQ422',message='invalid driver forecast output'; end if;
 i:=input->'items'->0; x:=p_rows->0;
 insert into public.forecast_results(organization_id,run_id,location_id,item_id,item_code,item_name,status,model,summary,evidence)
 values(r.organization_id,r.id,r.location_id,(i->>'item_id')::uuid,i->>'item_code',i->>'item_name','selected',x->>'model',
  jsonb_build_object('total',x->'total','scores',x->'scores'),
  jsonb_build_object('source',i,'output',x,'drivers',input->'drivers','original_forecast',input->'original_forecast'));
 if l.expires_at<=clock_timestamp() then raise exception using errcode='MQ409',message='forecast lease expired'; end if;
 update public.planning_runs set status='succeeded',finished_at=clock_timestamp(),error_code=null,
  result=jsonb_build_object('version',1,'method','multi-driver-v1','computed_at',input->'computed_at','item_count',1) where id=r.id;
 perform pgmq.archive('planning',l.message_id);
 delete from planning.leases where run_id=r.id;
 return true;
end; $$;
revoke all on function app.forecast_finish(uuid,uuid,jsonb) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function app.forecast_finish(uuid,uuid,jsonb) to maqdar_worker;

-- Preserve scoped queue routing and extend the existing bounded forecast lease.
create or replace function app.planning_claim_scoped(p_organization_id uuid)
returns table(run_id uuid,lease_token uuid)
language plpgsql security definer set search_path='' as $$
declare m record; r public.planning_runs; new_token uuid;
begin
 perform pg_advisory_xact_lock_shared(hashtextextended('maqdar.simulation.routing',0));
 for n in 1..10 loop
  select q.*,p.id as resolved_run into m from pgmq.q_planning q
   left join public.planning_runs p on p.id=case
    when q.message->>'run_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then (q.message->>'run_id')::uuid end
   where q.vt<=clock_timestamp() and
    ((p_organization_id is not null and p.organization_id=p_organization_id and p.kind='simulation')
     or (p_organization_id is null and not exists(select 1 from planning.simulation_worker_scopes s
      where s.organization_id=p.organization_id and p.kind='simulation')))
   order by q.msg_id limit 1 for update of q skip locked;
  if not found then return; end if;
  update pgmq.q_planning set vt=clock_timestamp()+interval '120 seconds',read_ct=read_ct+1
   where msg_id=m.msg_id returning vt into m.vt;
  select * into r from public.planning_runs where id=m.resolved_run for update skip locked;
  if not found then
   if m.resolved_run is not null then continue; end if;
   perform pgmq.archive('planning',m.msg_id); continue;
  end if;
  if r.status not in ('queued','running') then perform pgmq.archive('planning',m.msg_id); continue; end if;
  if r.attempts>=3 then
   update public.planning_runs set status='failed',error_code='attempts_exhausted',finished_at=clock_timestamp() where id=r.id;
   perform pgmq.archive('planning',m.msg_id);
   delete from planning.leases where planning.leases.run_id=r.id;
   continue;
  end if;
  if r.kind='policy' or (r.kind='forecast' and r.options->>'method' in ('expanded-v1','regional-v1','driver-v1','multi-driver-v1')) then
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

-- Keep event v1 readers/exports closed to the new conditional forecast method.
create or replace function public.planned_event_source(p_organization_id uuid,p_forecast_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  f public.forecast_results; r public.planning_runs; reason text:='available';
  days jsonb; day jsonb; n integer:=0; unit text; location_code text;
begin
  if auth.uid() is null or p_organization_id is null
    or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ404',message='event source unavailable';
  end if;
  -- Explicit scope also protects callers through the definer save RPC.
  select * into f from public.forecast_results x where x.organization_id=p_organization_id and x.id=p_forecast_id
    and (x.organization_id=any(array(select app.unscoped_organizations())) or x.location_id=any(array(select app.scoped_locations())));
  if not found then raise exception using errcode='MQ404',message='event source unavailable'; end if;
  select * into r from public.planning_runs x where x.organization_id=p_organization_id and x.id=f.run_id;
  select code into location_code from public.locations where organization_id=p_organization_id and id=f.location_id;
  unit:=f.evidence#>>'{source,unit_provenance,unit}';
  days:=f.evidence#>'{output,forecast}';
  if r.kind is distinct from 'forecast' or r.status is distinct from 'succeeded' or f.status<>'selected'
    or f.evidence#>>'{output,status}' is distinct from 'selected'
    or r.options->>'method' in ('driver-v1','multi-driver-v1') then reason:='forecast_unavailable';
  elsif coalesce(f.evidence#>'{source,preparation}','null'::jsonb)<>'null'::jsonb
    or r.options->>'method'='regional-v1' then reason:='prepared_group';
  elsif f.evidence#>>'{source,unit_provenance,status}' is distinct from 'consistent'
    or unit is null or unit not in ('EA','SET','L','KG') then reason:='unit_unknown';
  elsif jsonb_typeof(days) is distinct from 'array' then reason:='source_invalid';
  elsif jsonb_array_length(days) not between 1 and 90 then reason:='source_invalid';
  else
    for day in select value from jsonb_array_elements(days) loop
      n:=n+1;
      if day->>'date' is distinct from (r.to_date+n)::text
        or coalesce(day->>'quantity','') !~ '^[0-9]{1,15}(\.[0-9]{1,6})?$' then
        reason:='source_invalid'; exit;
      end if;
    end loop;
  end if;
  return jsonb_build_object('status',reason,'forecast_id',f.id,'run_id',f.run_id,
    'location_id',f.location_id,'location_code',location_code,'item_id',f.item_id,
    'item_code',f.item_code,'item_name',f.item_name,'unit',unit,'cutoff',r.to_date,
    'model',f.model,'method',r.options->>'method','summary',f.summary,'evidence',f.evidence);
end; $$;

reset lock_timeout;
