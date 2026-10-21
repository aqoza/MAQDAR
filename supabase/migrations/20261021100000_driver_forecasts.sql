-- Step 23b: captured single-driver forecasts; existing versioned methods stay unchanged.
set lock_timeout='5s';
alter table public.forecast_results drop constraint forecast_results_model_check;
alter table public.forecast_results add constraint forecast_results_model_check check(model in
 ('mean','naive','seasonal_naive','ses','croston','sba','tsb','auto_ets','auto_arima','calendar','driver_weekday'));

create function public.forecast_driver_enqueue(p_organization_id uuid,p_forecast_id uuid,p_dataset_id uuid,p_request_id uuid,p_confirmed boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare f public.forecast_results; d public.external_driver_datasets; source_run public.planning_runs;
 existing public.planning_runs; location_code text; run uuid; options jsonb; input jsonb; horizon integer;
begin
 if p_organization_id is null or not (p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='driver forecasting requires an editor'; end if;
 if p_confirmed is distinct from true or p_request_id is null or p_forecast_id is null or p_dataset_id is null then
  raise exception using errcode='MQ422',message='driver applicability confirmation required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('maqdar.planning:'||p_organization_id::text,0));
 if not (p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='driver forecasting requires an editor'; end if;
 select * into existing from public.planning_runs where organization_id=p_organization_id and request_id=p_request_id;
 if found then
  if not (p_organization_id=any(array(select app.unscoped_organizations())))
   and not (existing.location_id=any(array(select app.scoped_locations()))) then
   raise exception using errcode='MQ404',message='source unavailable'; end if;
  if existing.kind<>'forecast' or existing.options->>'method' is distinct from 'driver-v1'
   or existing.options->>'source_forecast_id' is distinct from p_forecast_id::text
   or existing.options->>'dataset_id' is distinct from p_dataset_id::text or existing.created_by is distinct from auth.uid() then
   raise exception using errcode='MQ409',message='conflicting request'; end if;
  return existing.id;
 end if;
 select * into f from public.forecast_results where organization_id=p_organization_id and id=p_forecast_id;
 select * into d from public.external_driver_datasets where organization_id=p_organization_id and id=p_dataset_id;
 if f.id is null or d.id is null or f.location_id<>d.location_id
  or (not (p_organization_id=any(array(select app.unscoped_organizations())))
   and not (f.location_id=any(array(select app.scoped_locations())))) then
  raise exception using errcode='MQ404',message='source unavailable'; end if;
 select * into source_run from public.planning_runs where organization_id=p_organization_id and id=f.run_id;
 horizon:=(source_run.options->>'horizon')::integer;
 if f.status<>'selected' or source_run.status is distinct from 'succeeded' or source_run.kind is distinct from 'forecast'
  or coalesce(source_run.options->>'method','') not in ('baseline-v1','expanded-v1')
  or source_run.options->>'history_complete' is distinct from 'true'
  or f.item_id is distinct from d.item_id or f.evidence->'source' ? 'preparation'
  or f.evidence#>>'{source,unit_provenance,status}' is distinct from 'consistent'
  or coalesce(f.evidence#>>'{source,unit_provenance,unit}','') not in ('EA','SET','L','KG')
  or source_run.from_date is distinct from (d.report#>>'{input,history_from}')::date
  or source_run.to_date is distinct from (d.report#>>'{input,cutoff}')::date
  or horizon is null or horizon not between 1 and 90
  or source_run.to_date+horizon is distinct from (d.report#>>'{input,forecast_to}')::date
  or (f.evidence#>>'{source,end_day}')::date is distinct from source_run.to_date
  or source_run.to_date-(f.evidence#>>'{source,start_day}')::date+1<56+3*horizon then
  raise exception using errcode='MQ422',message='choose matching individual forecast and driver evidence'; end if;
 select code into location_code from public.locations where organization_id=p_organization_id and id=f.location_id and is_active;
 if location_code is null then raise exception using errcode='MQ422',message='choose an active location'; end if;
 options:=jsonb_build_object('method','driver-v1','horizon',horizon,'source_forecast_id',f.id,'dataset_id',d.id,
  'history_complete',true,'applicability_confirmed',true);
 run:=app.planning_enqueue_kind(p_organization_id,location_code,source_run.from_date,source_run.to_date,p_request_id,'forecast',options);
 input:=jsonb_build_object('kind','forecast','method','driver-v1','computed_at',clock_timestamp(),
  'from_date',source_run.from_date,'to_date',source_run.to_date,'options',options,
  'items',jsonb_build_array(f.evidence->'source'),
  'driver',jsonb_build_object('id',d.id,'imported_at',d.created_at,'report',d.report),
  'original_forecast',jsonb_build_object('id',f.id,'run_id',f.run_id,'method',source_run.options->>'method','summary',f.summary));
 if octet_length(input::text)>20000000 then raise exception using errcode='MQ422',message='captured evidence too large'; end if;
 insert into planning.forecast_inputs(run_id,payload) values(run,input);
 return run;
end; $$;
revoke all on function public.forecast_driver_enqueue(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.forecast_driver_enqueue(uuid,uuid,uuid,uuid,boolean) to authenticated;

alter function app.forecast_task(uuid,uuid) rename to forecast_task_before_driver;
revoke all on function app.forecast_task_before_driver(uuid,uuid) from public,anon,authenticated,service_role,maqdar_worker;
create function app.forecast_task(p_run_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.planning_runs; l planning.leases; input jsonb;
begin
 select * into r from public.planning_runs where id=p_run_id for update;
 if r.options->>'method' is distinct from 'driver-v1' then return app.forecast_task_before_driver(p_run_id,p_token); end if;
 if r.status<>'running' or r.kind<>'forecast' then return null; end if;
 select * into l from planning.leases where run_id=r.id;
 if p_token is null or l.token is distinct from p_token or l.expires_at<=clock_timestamp() then return null; end if;
 select payload into input from planning.forecast_inputs where run_id=r.id;
 if input is null then raise exception using errcode='MQ422',message='captured driver evidence unavailable'; end if;
 return input;
end; $$;
revoke all on function app.forecast_task(uuid,uuid) from public,anon,authenticated,service_role,maqdar_worker;

create function app.driver_window_available(p_driver jsonb,p_start date,p_cutoff date,p_horizon integer)
returns boolean language sql immutable set search_path='' as $$
 select not exists(select 1 from generate_series(0,p_cutoff-p_start+p_horizon) n
  where not exists(select 1 from jsonb_array_elements(p_driver#>'{report,input,rows}') x
   where (x->>'date')::date=p_start+n and x->>'value' is not null and (x->>'available_on')::date<=p_cutoff))
$$;
revoke all on function app.driver_window_available(jsonb,date,date,integer) from public,anon,authenticated,service_role,maqdar_worker;

create function app.driver_output_valid(p_input jsonb,p_output jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare h integer:=(p_input#>>'{options,horizon}')::integer; x jsonb; s jsonb; b jsonb; field text; checks jsonb; e jsonb;
 start_day date:=(p_input#>>'{items,0,start_day}')::date; cutoff date:=(p_input->>'to_date')::date; n integer; total numeric:=0;
 allowed text[]:=array['mean','naive','seasonal_naive','ses','croston','sba','tsb','auto_ets','auto_arima','driver_weekday'];
begin
 if jsonb_typeof(p_output) is distinct from 'object' or p_output->>'status' is distinct from 'selected'
  or p_output->>'item_id' is distinct from p_input#>>'{items,0,item_id}'
  or not coalesce(p_output->>'model'=any(allowed),false)
  or jsonb_typeof(p_output->'forecast') is distinct from 'array' or jsonb_array_length(p_output->'forecast')<>h
  or jsonb_typeof(p_output->'scores') is distinct from 'array' or jsonb_array_length(p_output->'scores') not between 7 and 10
  or jsonb_typeof(p_output->'folds') is distinct from 'array' or jsonb_array_length(p_output->'folds')<>3
  or jsonb_typeof(p_output->'unavailable_models') is distinct from 'array'
  or jsonb_typeof(p_output->'driver_checks') is distinct from 'array'
  or jsonb_typeof(p_output->'driver_model') is distinct from 'object'
  or jsonb_typeof(p_output->'uncertainty') is distinct from 'object'
  or p_output#>>'{uncertainty,driver_uncertainty_included}' is distinct from 'false'
  or jsonb_typeof(p_output->'evaluation') is distinct from 'object' then return false; end if;
 if (select count(distinct y->>'model') from jsonb_array_elements(p_output->'scores') y)<>jsonb_array_length(p_output->'scores')
  or not exists(select 1 from jsonb_array_elements(p_output->'scores') y where y->>'model'=p_output->>'model') then return false; end if;
 for s in select value from jsonb_array_elements(p_output->'scores') loop
  if not coalesce(s->>'model'=any(allowed),false) or jsonb_typeof(s->'folds') is distinct from 'array' or jsonb_array_length(s->'folds')<>3 then return false; end if;
  for x in select s union all select value from jsonb_array_elements(s->'folds') loop
   foreach field in array array['rmse','mae','bias'] loop
    if jsonb_typeof(x->field) is distinct from 'string' or coalesce(x->>field,'') !~ '^-?[0-9]+(\.[0-9]+)?$'
     or abs((x->>field)::numeric)>1e30 then return false; end if;
   end loop;
   if (x->>'rmse')::numeric<0 or (x->>'mae')::numeric<0 then return false; end if;
  end loop;
 end loop;
 for x in select value from jsonb_array_elements(p_output->'unavailable_models') loop
  if not coalesce(x->>'model'=any(allowed),false)
   or coalesce(x->>'reason','') not in ('fit_failed','refit_failed','driver_missing','driver_late','driver_constant') then return false; end if;
 end loop;
 for checks in select p_output->'driver_checks' union all
  select p_output#>'{evaluation,driver_checks}' where p_output#>'{evaluation,driver_checks}' is not null loop
  if jsonb_typeof(checks) is distinct from 'array' or jsonb_array_length(checks)>4 then return false; end if;
  for x in select value from jsonb_array_elements(checks) loop
   if coalesce(x->>'cutoff','') !~ '^\d{4}-\d{2}-\d{2}$' or (x->>'cutoff')::date not between start_day and cutoff
    or coalesce(x->>'stage','') not in ('selection','final') or coalesce(x->>'status','') not in ('available','unavailable')
    or (x ? 'reason' and coalesce(x->>'reason','') not in ('driver_missing','driver_late','driver_constant'))
    or (x->>'phase' is not null and x->>'phase' not in ('training','prediction'))
    or (x->>'date' is not null and (x->>'date')::date not between start_day and cutoff+h) then return false; end if;
  end loop;
 end loop;
 x:=p_output->'driver_model';
 if x->>'status'='available' then
  foreach field in array array['penalty','center','scale','slope','training_min','training_max'] loop
   if jsonb_typeof(x->field) is distinct from 'string' or coalesce(x->>field,'') !~ '^-?[0-9]+(\.[0-9]+)?$' then return false; end if;
  end loop;
  if (x->>'penalty')::numeric<>0.01 or (x->>'scale')::numeric<=0 or (x->>'training_min')::numeric>(x->>'training_max')::numeric
   or jsonb_typeof(x->'weekday_intercepts') is distinct from 'array' or jsonb_array_length(x->'weekday_intercepts')<>7
   or jsonb_typeof(x->'extrapolated_dates') is distinct from 'array' then return false; end if;
  for b in select value from jsonb_array_elements(x->'weekday_intercepts') loop
   if jsonb_typeof(b) is distinct from 'string' or (b#>>'{}') !~ '^-?[0-9]+(\.[0-9]+)?$' then return false; end if;
  end loop;
  for b in select value from jsonb_array_elements(x->'extrapolated_dates') loop
   if jsonb_typeof(b) is distinct from 'string' or (b#>>'{}')::date not between cutoff+1 and cutoff+h then return false; end if;
  end loop;
 elsif x->>'status' is distinct from 'unavailable' then return false; end if;
 for n in 0..h-1 loop
  x:=p_output->'forecast'->n;
  if x->>'date' is distinct from (cutoff+n+1)::text or jsonb_typeof(x->'quantity') is distinct from 'string'
   or coalesce(x->>'quantity','') !~ '^[0-9]+(\.[0-9]{1,3})?$'
   or (x->>'quantity')::numeric>1e30 then return false; end if;
  total:=total+(x->>'quantity')::numeric;
 end loop;
 if jsonb_typeof(p_output->'total') is distinct from 'string' or coalesce(p_output->>'total','') !~ '^[0-9]+(\.[0-9]+)?$'
  or (p_output->>'total')::numeric<>total then return false; end if;
 for n in 1..3 loop
  x:=p_output->'folds'->(3-n);
  if x->>'train_from' is distinct from start_day::text or x->>'train_to' is distinct from (cutoff-n*h)::text
   or x->>'test_from' is distinct from (cutoff-n*h+1)::text or x->>'test_to' is distinct from (cutoff-(n-1)*h)::text then return false; end if;
 end loop;
 -- Independently enforce availability if the driver participates in model selection.
 if exists(select 1 from jsonb_array_elements(p_output->'scores') y where y->>'model'='driver_weekday') then
  for n in 0..3 loop
   if not app.driver_window_available(p_input->'driver',start_day,cutoff-n*h,h) then return false; end if;
  end loop;
 end if;
 if jsonb_typeof(p_output#>'{uncertainty,bands}') is distinct from 'array' then return false; end if;
 if p_output#>>'{uncertainty,status}'='available' then
  if jsonb_array_length(p_output#>'{uncertainty,bands}')<>h then return false; end if;
  for b in select value from jsonb_array_elements(p_output#>'{uncertainty,bands}') loop
   foreach field in array array['lower95','lower80','upper80','upper95'] loop
    if jsonb_typeof(b->field) is distinct from 'string' or coalesce(b->>field,'') !~ '^[0-9]+(\.[0-9]{1,3})?$' then return false; end if;
   end loop;
   if (b->>'lower95')::numeric>(b->>'lower80')::numeric or (b->>'lower80')::numeric>(b->>'upper80')::numeric
    or (b->>'upper80')::numeric>(b->>'upper95')::numeric then return false; end if;
  end loop;
 elsif p_output#>>'{uncertainty,status}' is distinct from 'insufficient_residuals' or jsonb_array_length(p_output#>'{uncertainty,bands}')<>0 then return false; end if;
 if p_output#>>'{evaluation,status}'='available' then
  e:=p_output->'evaluation';
  if jsonb_typeof(e->'count') is distinct from 'number' or (e->>'count')::integer<>h
   or jsonb_typeof(e->'calibration') is distinct from 'number' or (e->>'calibration')::integer<>3*h
   or jsonb_typeof(e->'forecast') is distinct from 'array' or jsonb_array_length(e->'forecast')<>h
   or jsonb_typeof(e->'bands') is distinct from 'array' or jsonb_array_length(e->'bands')<>h then return false; end if;
  foreach field in array array['coverage80','coverage95'] loop
   if jsonb_typeof(e->field) is distinct from 'string' or coalesce(e->>field,'') !~ '^[0-9]+(\.[0-9]+)?$'
    or (e->>field)::numeric not between 0 and 1 then return false; end if;
  end loop;
  for b in select value from jsonb_array_elements(e->'forecast') loop
   if jsonb_typeof(b) is distinct from 'string' or (b#>>'{}') !~ '^[0-9]+(\.[0-9]{1,3})?$' then return false; end if;
  end loop;
  for b in select value from jsonb_array_elements(e->'bands') loop
   foreach field in array array['lower95','lower80','upper80','upper95'] loop
    if jsonb_typeof(b->field) is distinct from 'string' or coalesce(b->>field,'') !~ '^[0-9]+(\.[0-9]{1,3})?$' then return false; end if;
   end loop;
   if (b->>'lower95')::numeric>(b->>'lower80')::numeric or (b->>'lower80')::numeric>(b->>'upper80')::numeric
    or (b->>'upper80')::numeric>(b->>'upper95')::numeric then return false; end if;
  end loop;
  if p_output#>>'{evaluation,train_to}' is distinct from (cutoff-h)::text
   or p_output#>>'{evaluation,test_from}' is distinct from (cutoff-h+1)::text
   or p_output#>>'{evaluation,test_to}' is distinct from cutoff::text
   or not coalesce(p_output#>>'{evaluation,model}'=any(allowed),false) then return false; end if;
  if p_output#>>'{evaluation,model}'='driver_weekday' then
   for n in 1..4 loop
    if not app.driver_window_available(p_input->'driver',start_day,cutoff-n*h,h) then return false; end if;
   end loop;
  end if;
 elsif coalesce(p_output#>>'{evaluation,status}','') not in ('insufficient_history','insufficient_residuals') then return false; end if;
 return true;
exception when others then return false;
end; $$;
revoke all on function app.driver_output_valid(jsonb,jsonb) from public,anon,authenticated,service_role,maqdar_worker;

alter function app.forecast_finish(uuid,uuid,jsonb) rename to forecast_finish_before_driver;
revoke all on function app.forecast_finish_before_driver(uuid,uuid,jsonb) from public,anon,authenticated,service_role,maqdar_worker;
create function app.forecast_finish(p_run_id uuid,p_token uuid,p_rows jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.planning_runs; l planning.leases; input jsonb; i jsonb; x jsonb;
begin
 select * into r from public.planning_runs where id=p_run_id for update;
 if r.options->>'method' is distinct from 'driver-v1' then return app.forecast_finish_before_driver(p_run_id,p_token,p_rows); end if;
 if r.status<>'running' or r.kind<>'forecast' then return false; end if;
 select * into l from planning.leases where run_id=r.id;
 if p_token is null or l.token is distinct from p_token or l.expires_at<=clock_timestamp() then return false; end if;
 select payload into input from planning.forecast_inputs where run_id=r.id;
 if input is null or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)<>1
  or octet_length(p_rows::text)>5000000 or not app.driver_output_valid(input,p_rows->0) then
  raise exception using errcode='MQ422',message='invalid driver forecast output'; end if;
 i:=input->'items'->0; x:=p_rows->0;
 insert into public.forecast_results(organization_id,run_id,location_id,item_id,item_code,item_name,status,model,summary,evidence)
 values(r.organization_id,r.id,r.location_id,(i->>'item_id')::uuid,i->>'item_code',i->>'item_name','selected',x->>'model',
  jsonb_build_object('total',x->'total','scores',x->'scores'),
  jsonb_build_object('source',i,'output',x,'driver',input->'driver','original_forecast',input->'original_forecast'));
 if l.expires_at<=clock_timestamp() then raise exception using errcode='MQ409',message='forecast lease expired'; end if;
 update public.planning_runs set status='succeeded',finished_at=clock_timestamp(),error_code=null,
  result=jsonb_build_object('version',1,'method','driver-v1','computed_at',input->'computed_at','item_count',1) where id=r.id;
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
  if r.kind='policy' or (r.kind='forecast' and r.options->>'method' in ('expanded-v1','regional-v1','driver-v1')) then
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
    or r.options->>'method'='driver-v1' then reason:='forecast_unavailable';
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
