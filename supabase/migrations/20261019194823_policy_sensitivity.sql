-- Step 21b: additive contracts, no historical row rewrite. Upgrade workers before web.
-- Forward-only rollback: disable new comparisons, cancel queued comparisons, retain evidence.
set lock_timeout='5s';

create function public.simulation_sensitivity_enqueue(p_organization_id uuid,p_source_run_id uuid,
 p_request_id uuid,p_alternative_maxima jsonb,p_reuse_confirmed boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare prior public.planning_runs; source public.policy_simulations; options jsonb; payload jsonb;
 maxima jsonb; value jsonb; run uuid; location_code text;
begin
 if p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='sensitivity requires an editor';
 end if;
 if p_source_run_id is null or p_request_id is null or p_reuse_confirmed is distinct from true
  or jsonb_typeof(p_alternative_maxima) is distinct from 'array' then
  raise exception using errcode='MQ422',message='invalid sensitivity inputs or confirmation';
 end if;
 if jsonb_array_length(p_alternative_maxima) not between 1 and 10 then
  raise exception using errcode='MQ422',message='choose one to ten alternative maxima';
 end if;
 for value in select * from jsonb_array_elements(p_alternative_maxima) loop
  if jsonb_typeof(value) is distinct from 'string' or (value#>>'{}') !~ '^[0-9]{1,15}(\.[0-9]{1,3})?$' then
   raise exception using errcode='MQ422',message='invalid alternative maximum';
  end if;
 end loop;
 select jsonb_agg(trim_scale(n)::text order by n) into maxima
 from (select distinct (v#>>'{}')::numeric n from jsonb_array_elements(p_alternative_maxima) v) canonical;
 if jsonb_array_length(maxima)<>jsonb_array_length(p_alternative_maxima) then
  raise exception using errcode='MQ422',message='alternative maxima must be distinct';
 end if;
 options:=jsonb_build_object('method','periodic-sensitivity-v1','source_run_id',p_source_run_id,
  'alternative_maxima',maxima,'reuse_confirmed',true);
 perform pg_advisory_xact_lock(hashtextextended('maqdar.planning:'||p_organization_id::text,0));
 -- A request may have waited while membership or its active-organization scope changed.
 if not(p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='sensitivity requires an editor';
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
 payload:=(source.evidence-'output')||jsonb_build_object('method','periodic-sensitivity-v1',
  'computed_at',statement_timestamp(),
  'options',((source.evidence->'options')-'alternative_maximum')||options,
  'source_simulation',jsonb_build_object('id',source.id,'run_id',source.run_id,'evidence',source.evidence));
 if octet_length(payload::text)>20000000 then raise exception using errcode='MQ422',message='sensitivity evidence too large'; end if;
 run:=app.planning_enqueue_kind(p_organization_id,location_code,(payload->>'from_date')::date,
  (payload->>'to_date')::date,p_request_id,'simulation',options);
 insert into planning.simulation_inputs(run_id,payload) values(run,payload);
 return run;
end; $$;
revoke all on function public.simulation_sensitivity_enqueue(uuid,uuid,uuid,jsonb,boolean) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.simulation_sensitivity_enqueue(uuid,uuid,uuid,jsonb,boolean) to authenticated;

-- Keep the original validator unchanged and reuse its per-pair conservation checks.
alter function app.simulation_output_valid(jsonb,jsonb) rename to simulation_output_valid_v1;
create function app.simulation_output_valid(input jsonb,output jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare original jsonb; maxima jsonb; baseline jsonb; alternative jsonb; pair_input jsonb; pair_output jsonb; i integer; field text;
begin
 if input->>'method'='periodic-replay-v1' then return app.simulation_output_valid_v1(input,output); end if;
 if input->>'method' is distinct from 'periodic-sensitivity-v1'
  or output->>'method' is distinct from 'periodic-sensitivity-v1'
  or jsonb_typeof(output->'variants') is distinct from 'array' or octet_length(output::text)>5000000
  or input#>>'{options,reuse_confirmed}' is distinct from 'true' then return false; end if;
 original:=input#>'{source_simulation,evidence}'; maxima:=input#>'{options,alternative_maxima}';
 if original->>'method' is distinct from 'periodic-replay-v1'
  or app.simulation_output_valid_v1(original,original->'output') is distinct from true
  or jsonb_typeof(maxima) is distinct from 'array' then return false; end if;
 if jsonb_array_length(maxima) not between 1 and 10
  or jsonb_array_length(output->'variants')<>jsonb_array_length(maxima)+1 then return false; end if;
 foreach field in array array['policy','demand','from_date','to_date'] loop
  if input->field is distinct from original->field then return false; end if;
 end loop;
 foreach field in array array['opening_stock','history_confirmed','empty_start_confirmed'] loop
  if input->'options'->field is distinct from original->'options'->field then return false; end if;
 end loop;
 baseline:=output->'variants'->0;
 if baseline is distinct from original#>'{output,variants,0}' then return false; end if;
 for i in 0..jsonb_array_length(maxima)-1 loop
  alternative:=output->'variants'->(i+1);
  if alternative->>'name' is distinct from 'alternative-'||(i+1)::text
   or alternative->>'maximum' is distinct from maxima->>i then return false; end if;
  pair_input:=jsonb_set(original,'{options,alternative_maximum}',maxima->i);
  pair_output:=jsonb_build_object('method','periodic-replay-v1','variants',
   jsonb_build_array(baseline,alternative||jsonb_build_object('name','alternative')));
  if app.simulation_output_valid_v1(pair_input,pair_output) is distinct from true then return false; end if;
  if maxima->>i=original#>>'{options,alternative_maximum}'
   and pair_output#>'{variants,1}' is distinct from original#>'{output,variants,1}' then return false; end if;
  if maxima->>i=original#>>'{policy,maximum}'
   and (alternative-'name') is distinct from (baseline-'name') then return false; end if;
 end loop;
 return true;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then return false;
end; $$;
revoke all on function app.simulation_output_valid(jsonb,jsonb) from public,anon,authenticated,service_role,maqdar_worker;

create or replace function app.simulation_finish(p_run_id uuid,p_token uuid,p_output jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.planning_runs; l planning.leases; input jsonb;
begin
 select * into r from public.planning_runs where id=p_run_id for update;
 if not found or r.kind<>'simulation' or r.status<>'running' then return false; end if;
 select * into l from planning.leases where run_id=r.id;
 if p_token is null or l.token is distinct from p_token or l.expires_at<=clock_timestamp() then return false; end if;
 select payload into input from planning.simulation_inputs where run_id=r.id;
 if input is null or app.simulation_output_valid(input,p_output) is distinct from true then
  raise exception using errcode='MQ422',message='invalid simulation output';
 end if;
 insert into public.policy_simulations(organization_id,run_id,location_id,policy_id,item_id,item_code,unit,evidence)
 values(r.organization_id,r.id,r.location_id,(input#>>'{policy,id}')::uuid,(input#>>'{policy,item_id}')::uuid,
  input#>>'{policy,item_code}',input#>>'{policy,unit}',input||jsonb_build_object('output',p_output));
 if l.expires_at<=clock_timestamp() then raise exception using errcode='MQ409',message='simulation lease expired'; end if;
 update public.planning_runs set status='succeeded',finished_at=clock_timestamp(),error_code=null,
  result=jsonb_build_object('version',1,'method',input->>'method','computed_at',input->'computed_at','item_count',1) where id=r.id;
 perform pgmq.archive('planning',l.message_id);
 delete from planning.leases where run_id=r.id;
 return true;
end; $$;
reset lock_timeout;
