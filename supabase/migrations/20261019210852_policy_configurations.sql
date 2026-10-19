-- Step 21c: additive configuration replay contracts; deploy workers before web.
-- Forward-only rollback: disable new queues, cancel pending comparisons, retain results.
set lock_timeout='5s';
create function app.simulation_configurations_canonical(configurations jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare c jsonb; result jsonb;
begin
 if jsonb_typeof(configurations) is distinct from 'array' then return null; end if;
 if jsonb_array_length(configurations) not between 1 and 10 then return null; end if;
 for c in select * from jsonb_array_elements(configurations) loop
  if jsonb_typeof(c) is distinct from 'object' then return null; end if;
  if c-array['maximum','lead_time','review_interval']<>'{}'::jsonb
   or jsonb_typeof(c->'maximum') is distinct from 'string'
   or (c->>'maximum') !~ '^[0-9]{1,15}(\.[0-9]{1,3})?$'
   or jsonb_typeof(c->'lead_time') is distinct from 'number'
   or jsonb_typeof(c->'review_interval') is distinct from 'number'
   or (c->>'lead_time') !~ '^[0-9]{1,3}$' or (c->>'review_interval') !~ '^[0-9]{1,3}$' then return null; end if;
  if (c->>'lead_time')::integer not between 0 and 365
   or (c->>'review_interval')::integer not between 1 and 365 then return null; end if;
 end loop;
 select jsonb_agg(jsonb_build_object('maximum',trim_scale(maximum)::text,'lead_time',lead,'review_interval',review)
  order by maximum,lead,review) into result
 from (select distinct (v->>'maximum')::numeric maximum,(v->>'lead_time')::integer lead,
  (v->>'review_interval')::integer review from jsonb_array_elements(configurations) v) canonical;
 if jsonb_array_length(result)<>jsonb_array_length(configurations) then return null; end if;
 return result;
end; $$;
revoke all on function app.simulation_configurations_canonical(jsonb) from public,anon,authenticated,service_role,maqdar_worker;

create function public.simulation_configurations_enqueue(p_organization_id uuid,p_source_run_id uuid,
 p_request_id uuid,p_configurations jsonb,p_reuse_confirmed boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare prior public.planning_runs; source public.policy_simulations; options jsonb; payload jsonb;
 configurations jsonb; run uuid; location_code text;
begin
 if p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='configuration requires an editor';
 end if;
 configurations:=app.simulation_configurations_canonical(p_configurations);
 if p_source_run_id is null or p_request_id is null or p_reuse_confirmed is distinct from true or configurations is null then
  raise exception using errcode='MQ422',message='invalid configurations or confirmation';
 end if;
 options:=jsonb_build_object('method','periodic-configurations-v1','source_run_id',p_source_run_id,
  'configurations',configurations,'reuse_confirmed',true);
 perform pg_advisory_xact_lock(hashtextextended('maqdar.planning:'||p_organization_id::text,0));
 -- A request may have waited while membership or its active-organization scope changed.
 if not(p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='configuration requires an editor';
 end if;
 select * into prior from public.planning_runs where organization_id=p_organization_id and request_id=p_request_id;
 if found then
  if prior.kind<>'simulation' or prior.options<>options then
   raise exception using errcode='MQ409',message='request id already used with different parameters';
  end if;
  if not(p_organization_id=any(array(select app.unscoped_organizations())))
   and not(prior.location_id=any(array(select app.scoped_locations()))) then
   raise exception using errcode='MQ404',message='comparison unavailable';
  end if;
  return prior.id;
 end if;
 select s.* into source from public.policy_simulations s join public.planning_runs r
  on r.organization_id=s.organization_id and r.id=s.run_id
  where s.organization_id=p_organization_id and s.run_id=p_source_run_id
   and r.kind='simulation' and r.status='succeeded' for share of s,r;
 if not found or (not(p_organization_id=any(array(select app.unscoped_organizations())))
   and not(source.location_id=any(array(select app.scoped_locations())))) then
  raise exception using errcode='MQ404',message='source simulation unavailable';
 end if;
 if source.evidence->>'method' is distinct from 'periodic-replay-v1'
  or source.evidence#>>'{policy,unit}' is distinct from source.unit
  or source.evidence#>>'{options,history_confirmed}' is distinct from 'true'
  or source.evidence#>>'{options,empty_start_confirmed}' is distinct from 'true'
  or app.simulation_output_valid(source.evidence,source.evidence->'output') is distinct from true then
  raise exception using errcode='MQ422',message='choose a completed original policy simulation';
 end if;
 select code into location_code from public.locations where organization_id=p_organization_id
  and id=source.location_id and is_active;
 if location_code is null then raise exception using errcode='MQ422',message='choose an active location'; end if;
 payload:=(source.evidence-'output')||jsonb_build_object('method','periodic-configurations-v1',
  'computed_at',statement_timestamp(),
  'options',((source.evidence->'options')-'alternative_maximum')||options,
  'source_simulation',jsonb_build_object('id',source.id,'run_id',source.run_id,'evidence',source.evidence));
 if octet_length(payload::text)>20000000 then raise exception using errcode='MQ422',message='configuration evidence too large'; end if;
 run:=app.planning_enqueue_kind(p_organization_id,location_code,(payload->>'from_date')::date,
  (payload->>'to_date')::date,p_request_id,'simulation',options);
 insert into planning.simulation_inputs(run_id,payload) values(run,payload);
 return run;
end; $$;
revoke all on function public.simulation_configurations_enqueue(uuid,uuid,uuid,jsonb,boolean) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.simulation_configurations_enqueue(uuid,uuid,uuid,jsonb,boolean) to authenticated;

-- Preserve both published methods and reuse the original per-pair ledger checks.
alter function app.simulation_output_valid(jsonb,jsonb) rename to simulation_output_valid_sensitivity_v1;
create function app.simulation_output_valid(input jsonb,output jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare original jsonb; configurations jsonb; baseline jsonb; alternative jsonb; c jsonb;
 pair_input jsonb; pair_output jsonb; i integer; field text;
begin
 if input->>'method' in ('periodic-replay-v1','periodic-sensitivity-v1') then
  return app.simulation_output_valid_sensitivity_v1(input,output);
 end if;
 if input->>'method' is distinct from 'periodic-configurations-v1'
  or output->>'method' is distinct from 'periodic-configurations-v1'
  or jsonb_typeof(output->'variants') is distinct from 'array' or octet_length(output::text)>5000000
  or input#>>'{options,reuse_confirmed}' is distinct from 'true' then return false; end if;
 original:=input#>'{source_simulation,evidence}'; configurations:=input#>'{options,configurations}';
 if original->>'method' is distinct from 'periodic-replay-v1'
  or app.simulation_output_valid_v1(original,original->'output') is distinct from true
  or app.simulation_configurations_canonical(configurations) is null
  or app.simulation_configurations_canonical(configurations) is distinct from configurations then return false; end if;
 if jsonb_array_length(output->'variants')<>jsonb_array_length(configurations)+1 then return false; end if;
 foreach field in array array['policy','demand','from_date','to_date'] loop
  if input->field is distinct from original->field then return false; end if;
 end loop;
 foreach field in array array['opening_stock','history_confirmed','empty_start_confirmed'] loop
  if input->'options'->field is distinct from original->'options'->field then return false; end if;
 end loop;
 baseline:=output->'variants'->0;
 if baseline is distinct from ((original#>'{output,variants,0}')||jsonb_build_object(
  'lead_time',original#>'{policy,lead_time}','review_interval',original#>'{policy,review_interval}')) then return false; end if;
 for i in 0..jsonb_array_length(configurations)-1 loop
  c:=configurations->i; alternative:=output->'variants'->(i+1);
  if alternative->>'name' is distinct from 'alternative-'||(i+1)::text
   or alternative->'maximum' is distinct from c->'maximum'
   or alternative->'lead_time' is distinct from c->'lead_time'
   or alternative->'review_interval' is distinct from c->'review_interval' then return false; end if;
  -- Only this validation pair uses what-if settings; the saved policy stays unchanged.
  pair_input:=jsonb_set(jsonb_set(original,'{options,alternative_maximum}',c->'maximum'),
   '{policy}',(original->'policy')||c);
  pair_output:=jsonb_build_object('method','periodic-replay-v1','variants',jsonb_build_array(
   (alternative-array['lead_time','review_interval'])||jsonb_build_object('name','baseline'),
   (alternative-array['lead_time','review_interval'])||jsonb_build_object('name','alternative')));
  if app.simulation_output_valid_v1(pair_input,pair_output) is distinct from true then return false; end if;
  if c->'lead_time'=original#>'{policy,lead_time}' and c->'review_interval'=original#>'{policy,review_interval}' then
   if c->>'maximum'=original#>>'{policy,maximum}'
    and (alternative-'name') is distinct from (baseline-'name') then return false; end if;
   if c->>'maximum'=original#>>'{options,alternative_maximum}'
    and pair_output#>'{variants,1}' is distinct from original#>'{output,variants,1}' then return false; end if;
  end if;
 end loop;
 return true;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then return false;
end; $$;
revoke all on function app.simulation_output_valid(jsonb,jsonb) from public,anon,authenticated,service_role,maqdar_worker;
reset lock_timeout;
